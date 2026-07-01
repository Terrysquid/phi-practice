const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const pauseIcon = new Image();
pauseIcon.src = "assets/Pause.png";
const noteRing = new Image();
noteRing.src = "assets/NoteRing.png";
const pauseAudio = new Audio("assets/Tap6.wav");
pauseAudio.preload = "auto";
const tapNote = new Image();
tapNote.src = "assets/Tap2.png";
const tapNoteHL = new Image();
tapNoteHL.src = "assets/Tap2HL.png";
const dragNote = new Image();
dragNote.src = "assets/Drag.png";
const dragNoteHL = new Image();
dragNoteHL.src = "assets/DragHL.png";
const flickNote = new Image();
flickNote.src = "assets/Flick2.png";
const flickNoteHL = new Image();
flickNoteHL.src = "assets/Flick2HL.png";
const holdBody = new Image();
holdBody.src = "assets/Hold.png";
const holdHead = new Image();
holdHead.src = "assets/Hold_Head.png";
const holdEnd = new Image();
holdEnd.src = "assets/Hold_End.png";
const holdHLHead = new Image();
holdHLHead.src = "assets/Hold2HL_0.png";
const holdHLBody = new Image();
holdHLBody.src = "assets/Hold2HL_1.png";
const backIcon = new Image();
backIcon.src = "assets/Back.png";
const retryIcon = new Image();
retryIcon.src = "assets/Retry.png";
const resumeIcon = new Image();
resumeIcon.src = "assets/Resume.png";
const zipInput = document.createElement("input");
zipInput.type = "file";
zipInput.accept = ".zip";
zipInput.style.display = "none";
document.body.appendChild(zipInput);

let level = {
  zip: null,
  info: {},
  chart: null,
  nowTime: -3,
  startTime: -1,
  startDelay: 1.5,
  audioTime: 0,
  audioStarted: false,
  audioRequested: false,
  music: null,
  illustration: null, // not used yet
  illustrationBlur: null,
  illustrationLowRes: null // not used yet
};

let settings = {
  speed: 6.0, // 流速
  offset: 0.0, // 谱面延时
  noteScale: 1.0, // 按键缩放
  backgroundAlpha: 0.85, // 背景亮度(?)
  hitFxIsOn: true, // 开启打击音效
  musicVol: 1.0, // 音乐音量
  SEVol: 1.0, // 界面音效音量
  HitFXVol: 1.0, // 打击音效音量
  isLowRes: false, // 低分辨率模式
};

let screenWidth = 0;
let screenHeight = 0;
let deviceScale = 1;
let visibleWidth = 0;
let sideMaskWidth = 0;
let effectiveAspect = 0;
let pauseTime = 0;
let paused = true;
let lastFrameTime = performance.now();

function readYaml(text) {
  let out = {};
  for (let line of text.split(/\r?\n/)) {
    let i = line.indexOf(":");
    if (i < 0) continue;
    let key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function loadZipContent(path, type) {
  let file = level.zip.file(path);
  if (!file) return null;
  if (type == "json") {
    let text = await file.async("string");
    return JSON.parse(text);
  }
  if (type == "audio") {
    let blob = await file.async("blob");
    let audio = new Audio(URL.createObjectURL(blob));
    audio.preload = "auto";
    audio.load();
    return audio;
  }
  if (type == "image") {
    let blob = await file.async("blob");
    let image = new Image();
    image.src = URL.createObjectURL(blob);
    return image;
  }
  return null;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function inverseLerp(a, b, v) {
  return (v - a) / (b - a);
}
function uiHalfWidth() {
  return 500 * effectiveAspect;
  return Math.min(500 * 16 / 9, 500 * screenWidth / screenHeight);
}
function worldToScreenX(x) {
  return screenWidth / 2 + x * screenHeight / 10;
}
function worldToScreenY(y) {
  return screenHeight / 2 - y * screenHeight / 10;
}
function uiToScreenX(x) {
  return screenWidth / 2 + x * screenHeight / 1000;
}
function uiToScreenY(y) {
  return screenHeight / 2 - y * screenHeight / 1000;
}
function screenToWorldX(x) {
  return (x - screenWidth / 2) * 10 / screenHeight;
}
function screenToWorldY(y) {
  return (screenHeight / 2 - y) * 10 / screenHeight;
}
function imageReady(image) {
  return image && image.complete && image.naturalWidth != 0;
}

function prepareChart(chart) {
  let notes = [];
  for (let lineIndex = 0; lineIndex < chart.judgeLineList.length; lineIndex++) {
    let line = chart.judgeLineList[lineIndex];
    let bpm = line.bpm;
    for (let noteIndex = 0; noteIndex < line.notesAbove.length; noteIndex++) {
      let note = line.notesAbove[noteIndex];
      if (effectiveAspect < 16 / 9) note.positionX = effectiveAspect / (16 / 9) * note.positionX;
      note.realTime = note.time * 1.875 / bpm;
      note.holdTime = Math.trunc(note.holdTime + 0.0001) * 1.875 / bpm;
      note.judgeLineIndex = lineIndex * 2;
      note.side = 0;
      note.noteIndex = noteIndex;
      note.isJudged = false;
      notes.push(note);
    }
    for (let noteIndex = 0; noteIndex < line.notesBelow.length; noteIndex++) {
      let note = line.notesBelow[noteIndex];
      if (effectiveAspect < 16 / 9) note.positionX = effectiveAspect / (16 / 9) * note.positionX;
      note.realTime = note.time * 1.875 / bpm;
      note.holdTime = Math.trunc(note.holdTime + 0.0001) * 1.875 / bpm;
      note.judgeLineIndex = lineIndex * 2 + 1;
      note.side = 1;
      note.noteIndex = noteIndex;
      note.isJudged = false;
      notes.push(note);
    }
    for (let i = 0; i < line.speedEvents.length; i++) {
      let event = line.speedEvents[i];
      if (i == 0) {
        event.floorPosition = event.startTime * 1.875 / bpm;
      } else {
        // integral of v dt
        let previous = line.speedEvents[i - 1];
        event.floorPosition = previous.floorPosition + (previous.endTime - previous.startTime) * 1.875 / bpm * previous.value;
        previous.startTime = Math.trunc(previous.startTime) * 1.875 / bpm;
        previous.endTime = Math.trunc(previous.endTime) * 1.875 / bpm;
      }
      if (i == line.speedEvents.length - 1) {
        event.startTime = Math.trunc(event.startTime) * 1.875 / bpm;
        event.endTime = Math.trunc(event.endTime) * 1.875 / bpm;
      }
    }
    for (let event of line.judgeLineDisappearEvents) {
      event.startTime = Math.trunc(event.startTime) * 1.875 / bpm;
      event.endTime = Math.trunc(event.endTime) * 1.875 / bpm;
    }
    for (let event of line.judgeLineMoveEvents) {
      event.startTime = Math.trunc(event.startTime) * 1.875 / bpm;
      event.endTime = Math.trunc(event.endTime) * 1.875 / bpm;
      if (chart.formatVersion == 3) { // it should not be anything other than 3
        event.start = (event.start - 0.5) * 10 * effectiveAspect;
        event.end = (event.end - 0.5) * 10 * effectiveAspect;
        event.start2 = (event.start2 - 0.5) * 10;
        event.end2 = (event.end2 - 0.5) * 10;
      }
    }
    for (let event of line.judgeLineRotateEvents) {
      event.startTime = Math.trunc(event.startTime) * 1.875 / bpm;
      event.endTime = Math.trunc(event.endTime) * 1.875 / bpm;
    }
  }
  notes.sort((a, b) => a.realTime - b.realTime);
  for (let i = 0; i < notes.length; i++) {
    notes[i].isHL = (
      (i > 0 && Math.abs(notes[i - 1].realTime - notes[i].realTime) <= 0.001) ||
      (i < notes.length - 1 && Math.abs(notes[i + 1].realTime - notes[i].realTime) < 0.001)
    );
  }
}

function getLineEvent(events, nowTime) {
  let activeEvent = events[0];
  for (let event of events) {
    if (nowTime < event.startTime) break;
    activeEvent = event;
    if (nowTime < event.endTime) break;
  }
  return activeEvent;
}

function drawNote(note, currentFloor) {
  if (note.type == 1 || note.type == 2 || note.type == 4) {
    let image;
    if (note.type == 1) image = note.isHL ? tapNoteHL : tapNote;
    else if (note.type == 2) image = note.isHL ? dragNoteHL : dragNote;
    else if (note.type == 4) image = note.isHL ? flickNoteHL : flickNote;
    if (!imageReady(image)) return;
    let distance = note.floorPosition - currentFloor;
    let headY = distance * note.speed * settings.speed; // to differ from dy for holds
    let tolerance = Math.max(note.floorPosition / 6000000, 0.001);
    if (level.nowTime <= note.realTime && (distance < -tolerance || headY > 20)) return;
    let scale = visibleWidth / 8000 * settings.noteScale;
    let width = image.naturalWidth * scale;
    let height = image.naturalHeight * scale;
    ctx.save();
    ctx.translate(note.positionX * screenHeight / 10, 0);
    if (note.side == 1) ctx.rotate(Math.PI);
    ctx.translate(0, -headY * screenHeight / 10);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }
  else if (note.type == 3) {
    let body = note.isHL ? holdHLBody : holdBody;
    let head = note.isHL ? holdHLHead : holdHead;
    let end = holdEnd;
    if (!imageReady(body) || !imageReady(head) || !imageReady(end)) return;
    if (level.nowTime > note.realTime + note.holdTime) return;
    let distance = note.floorPosition - currentFloor;
    let headY = distance * settings.speed;
    let tolerance = Math.max(note.floorPosition / 6000000, 0.001);
    if (level.nowTime <= note.realTime && (distance < -tolerance || headY > 20)) return;
    let started = level.nowTime >= note.realTime;
    if (started) headY = 0;
    let remaining = started ? note.realTime + note.holdTime - level.nowTime : note.holdTime;
    let dy = remaining * note.speed * settings.speed;
    if (dy <= 0) return;
    let endY = headY + dy;
    let scale = visibleWidth / 8000 * settings.noteScale;
    let bodyScale = body == holdHLBody ? 1089 / 1062 : 1;
    let headScale = head == holdHLHead ? 1089 / 1062 : 1;
    let bodyWidth = body.naturalWidth * bodyScale * scale;
    let bodyHeight = dy * screenHeight / 10;
    let headWidth = head.naturalWidth * headScale * scale;
    let headHeight = head.naturalHeight * headScale * scale;
    let endWidth = end.naturalWidth * scale;
    let endHeight = end.naturalHeight * scale;
    // end is slightly overlapping body
    let bodyWorldHeight = body == holdHLBody ? (2048 * 19 / 21) / (100 * 1062 / 1089) : 19;
    let overlap = bodyHeight * (bodyWorldHeight - 18.99) / bodyWorldHeight;
    let headScreenY = -headY * screenHeight / 10;
    let endScreenY = -endY * screenHeight / 10;
    ctx.save();
    ctx.translate(note.positionX * screenHeight / 10, 0);
    if (note.side == 1) ctx.rotate(Math.PI);
    ctx.drawImage(body, -bodyWidth / 2, endScreenY, bodyWidth, bodyHeight);
    if (!started) {
      ctx.drawImage(head, -headWidth / 2, headScreenY, headWidth, headHeight);
    }
    ctx.drawImage(end, -endWidth / 2, endScreenY + overlap - endHeight, endWidth, endHeight);
    ctx.restore();
  }
}

function drawNotes(notes, currentFloor, type) {
  for (let note of notes) {
    if (note.type == type) drawNote(note, currentFloor);
  }
}

function drawJudgeLine(x, y, angle, alpha) {
  let length = 1920 * 3 * screenHeight / 1000;
  let thickness = 3 * 2.5 * screenHeight / 1000;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(worldToScreenX(x), worldToScreenY(y));
  ctx.rotate(-angle * Math.PI / 180);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
  ctx.restore();
}

function drawJudgeLines() {
  if (!level.chart) return;
  let lineStates = [];
  for (let line of level.chart.judgeLineList) {
    let moveEvent = getLineEvent(line.judgeLineMoveEvents, level.nowTime);
    let rotateEvent = getLineEvent(line.judgeLineRotateEvents, level.nowTime);
    let disappearEvent = getLineEvent(line.judgeLineDisappearEvents, level.nowTime);
    let moveT = inverseLerp(moveEvent.startTime, moveEvent.endTime, level.nowTime);
    let rotateT = inverseLerp(rotateEvent.startTime, rotateEvent.endTime, level.nowTime);
    let disappearT = inverseLerp(disappearEvent.startTime, disappearEvent.endTime, level.nowTime);
    let x = lerp(moveEvent.start, moveEvent.end, moveT);
    let y = lerp(moveEvent.start2, moveEvent.end2, moveT);
    let angle = lerp(rotateEvent.start, rotateEvent.end, rotateT);
    let alpha = lerp(disappearEvent.start, disappearEvent.end, disappearT);
    let speedEvent = getLineEvent(line.speedEvents, level.nowTime);
    let currentFloor = speedEvent.floorPosition + (level.nowTime - speedEvent.startTime) * speedEvent.value;
    lineStates.push({ line, x, y, angle, alpha, currentFloor });
  }

  for (let state of lineStates) { // lines
    drawJudgeLine(state.x, state.y, state.angle, state.alpha);
  }
  for (let type of [3, 1, 2, 4]) { // notes: hold -> tap -> drag -> flick
    for (let state of lineStates) {
      ctx.save();
      ctx.translate(worldToScreenX(state.x), worldToScreenY(state.y));
      ctx.rotate(-state.angle * Math.PI / 180);
      drawNotes(state.line.notesAbove, state.currentFloor, type);
      drawNotes(state.line.notesBelow, state.currentFloor, type);
      ctx.restore();
    }
  }
}
function drawBackground() {
  // temporary
  let image = level.illustrationBlur;
  if (!imageReady(image)) return;
  let height = screenHeight;
  let width = image.naturalWidth / image.naturalHeight * height;
  let x = (screenWidth - width) / 2;
  let y = 0;
  ctx.drawImage(image, x, y, width, height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillRect(0, 0, screenWidth, screenHeight);
}

function drawPauseRing() {
  if (pauseTime <= 0 || !imageReady(noteRing)) return;
  let x = uiToScreenX(-838.3 + 500 * 16 / 9 - uiHalfWidth() - 1.7);
  let y = uiToScreenY(444.3 + 0.69);
  let size = 63.488 * screenHeight / 1000;
  let t = Math.min(0.25, 1.2 - pauseTime);
  let alpha = -25.6 * t * t * t + 9.6 * t * t;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(noteRing, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}

function drawPause() {
  if (!imageReady(pauseIcon)) return;
  let x = uiToScreenX(-838.3 + 500 * 16 / 9 - uiHalfWidth());
  let y = uiToScreenY(444.3);
  let width = 34.262 * screenHeight / 1000;
  let height = 37.966 * screenHeight / 1000;
  ctx.drawImage(pauseIcon, x - width / 2, y - height / 2, width, height);
}

function drawPauseBarButton(icon, x, y) {
  if (!imageReady(icon)) return;
  let centerX = uiToScreenX(x);
  let centerY = uiToScreenY(y);
  let boxSize = 82.08 * screenHeight / 1000;
  let scale = Math.min(boxSize / icon.naturalWidth, boxSize / icon.naturalHeight);
  let width = icon.naturalWidth * scale;
  let height = icon.naturalHeight * scale;
  ctx.drawImage(icon, centerX - width / 2, centerY - height / 2, width, height);
}

function drawLoadButton() {
  let x = uiToScreenX(0);
  let y = uiToScreenY(-180);
  let width = 180 * screenHeight / 1000;
  let height = 60 * screenHeight / 1000;
  let fontSize = 30 * screenHeight / 1000;
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2 * screenHeight / 1000;
  ctx.strokeRect(x - width / 2, y - height / 2, width, height);
  ctx.font = `${fontSize}px "Phigros UI"`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Load Zip", x, y);
  let file = zipInput.files[0];
  if (file) {
    ctx.fillText(file.name, uiToScreenX(0), uiToScreenY(-240));
  }
  ctx.restore();
}

function drawPauseBar() {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, screenWidth, screenHeight);
  drawPauseBarButton(backIcon, -216, 0);
  drawPauseBarButton(retryIcon, 0, 0);
  drawPauseBarButton(resumeIcon, 216, 0);
  drawLoadButton();
  ctx.restore();
}

function drawScore(score) {
  let x = uiToScreenX(651.5 + 400 / 2 + uiHalfWidth() - 500 * 16 / 9);
  let y = uiToScreenY(445.7);
  let fontSize = 50 * screenHeight / 1000;
  ctx.save();
  ctx.font = `${fontSize}px "Phigros UI"`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(score, x, y);
  ctx.restore();
}

function drawCombo(combo) {
  let x = uiToScreenX(0);
  let y = uiToScreenY(452);
  let fontSize = 70 * screenHeight / 1000;
  ctx.save();
  ctx.font = `${fontSize}px "Phigros UI"`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(combo, x, y);
  ctx.restore();
}

function drawComboText() {
  let x = uiToScreenX(0);
  let y = uiToScreenY(405);
  let fontSize = 24 * screenHeight / 1000;
  ctx.save();
  ctx.font = `${fontSize}px "Phigros UI"`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("COMBO", x, y);
  ctx.restore();
}

function drawSongsName(songsName) {
  let x = uiToScreenX(40 - uiHalfWidth());
  let y = uiToScreenY(-473.2 + 46 / 2);
  let fontSize = 36 * screenHeight / 1000;
  ctx.save();
  ctx.font = `${fontSize}px "Phigros UI"`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(songsName, x, y);
  ctx.restore();
}

function drawSongsLevel(songsLevel) {
  let x = uiToScreenX(uiHalfWidth() - 40);
  let y = uiToScreenY(-473.2 + 46 / 2);
  let fontSize = 36 * screenHeight / 1000;
  ctx.save();
  ctx.font = `${fontSize}px "Phigros UI"`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(songsLevel, x, y);
  ctx.restore();
}

function resizeCanvas() {
  let rect = canvas.getBoundingClientRect();
  deviceScale = Math.max(1, window.devicePixelRatio || 1);
  screenWidth = Math.max(1, rect.width);
  screenHeight = Math.max(1, rect.height);
  visibleWidth = Math.min(screenWidth, screenHeight * 16 / 9);
  sideMaskWidth = (screenWidth - visibleWidth) / 2;
  effectiveAspect = visibleWidth / screenHeight;
  canvas.width = Math.max(1, Math.round(screenWidth * deviceScale));
  canvas.height = Math.max(1, Math.round(screenHeight * deviceScale));
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
}

function drawFrame() {
  ctx.clearRect(0, 0, screenWidth, screenHeight);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, screenWidth, screenHeight);
  drawBackground();

  drawJudgeLines();
  if (sideMaskWidth > 0) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, sideMaskWidth, screenHeight);
    ctx.fillRect(screenWidth - sideMaskWidth, 0, sideMaskWidth, screenHeight);
  }
  drawPause();
  drawPauseRing();
  drawScore("0000000");
  drawCombo("99");
  drawComboText();
  drawSongsName(level.info.name);
  drawSongsLevel(level.info.level);
  if (paused) drawPauseBar();
}

function isInsidePauseHitbox(screenX, screenY) {
  let x = screenToWorldX(screenX);
  let y = screenToWorldY(screenY);
  if (y > 4.85) return false;
  if (y < 4.05) return false;
  let leftEdge = -5 * effectiveAspect;
  if (x < leftEdge + 0.05 * 16 / 9) return false;
  if (x > leftEdge + 0.5 * 16 / 9) return false;
  return true;
}

function isInsidePauseMenuHitbox(screenX, screenY, worldX) {
  let x = worldToScreenX(worldX);
  let y = worldToScreenY(0);
  let r = 0.65 * screenHeight / 10;
  return Math.hypot(screenX - x, screenY - y) <= r;
}

function isInsideLoadHitbox(screenX, screenY) {
  let x = uiToScreenX(0);
  let y = uiToScreenY(-180);
  let width = 180 * screenHeight / 1000;
  let height = 60 * screenHeight / 1000;
  return (
    Math.abs(screenX - x) <= width / 2 &&
    Math.abs(screenY - y) <= height / 2
  );
}

function pauseLevel() {
  pauseAudio.currentTime = 0;
  pauseAudio.play().catch(() => {});
  if (level.music) {
    level.audioTime = level.music.currentTime;
    level.music.pause();
  }
  level.audioStarted = false;
  level.audioRequested = false;
}

function resumeLevel() {
  level.startTime = -1;
  level.startDelay = 3.0;
  level.audioStarted = false;
  level.audioRequested = false;
}

function handlePausePointer(event) {
  if (paused || !isInsidePauseHitbox(event.clientX, event.clientY)) return;
  event.preventDefault();
  if (pauseTime > 0) {
    pauseTime = 0;
    pauseLevel();
    paused = true;
    return;
  }
  pauseTime = 1.2;
}

function handlePauseMenuPointer(event) {
  event.preventDefault();
  if (isInsideLoadHitbox(event.clientX, event.clientY)) {
    zipInput.value = "";
    zipInput.click();
    return;
  }
  if (isInsidePauseMenuHitbox(event.clientX, event.clientY, 2) && level.zip) {
    pauseTime = 0;
    resumeLevel();
    paused = false;
    return;
  }
}

function handlePointer(event) {
  if (paused) {
    handlePauseMenuPointer(event);
    return;
  }
  handlePausePointer(event);
}

function updatePauseTimer(deltaTime) {
  if (pauseTime <= 0) return;
  pauseTime = Math.max(0, pauseTime - deltaTime);
}

function updateLevelTime() {
  if (!level.chart || !level.music) return;
  let time = performance.now() / 1000;
  if (level.startTime < 0) level.startTime = time + level.startDelay;
  if (!level.audioStarted && !level.audioRequested && time >= level.startTime) {
    level.music.currentTime = level.audioTime;
    level.audioRequested = true;
    level.music.play()
      .then(() => {
        level.audioStarted = true;
      })
      .catch((error) => {
        level.audioRequested = false;
        console.log("music play failed:", error);
      });
  }
  if (level.audioStarted) {
    level.audioTime = level.music.currentTime;
    level.nowTime = level.audioTime - (level.chart.offset + settings.offset);
    if (level.nowTime < 0) level.nowTime = 0;
  }
}

function gameLoop(now) {
  let deltaTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (!paused) {
    updatePauseTimer(deltaTime);
    updateLevelTime();
  }
  drawFrame();
  requestAnimationFrame(gameLoop);
}

window.addEventListener("resize", resizeCanvas);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", handlePointer);
zipInput.addEventListener("change", async () => {
  let file = zipInput.files[0];
  if (file) {
    level.info = {};
    level.chart = null;
    level.nowTime = -3;
    level.startTime = -1;
    level.startDelay = 1.5;
    level.audioTime = 0;
    level.audioStarted = false;
    level.audioRequested = false;
    if (level.music) level.music.pause();
    level.music = null;
    level.illustration = null;
    level.illustrationBlur = null;
    level.illustrationLowRes = null;
    level.zip = await JSZip.loadAsync(file);
    let infoFile = level.zip.file("info.yml");
    if (infoFile) {
      let infoText = await infoFile.async("string");
      level.info = readYaml(infoText);
      console.log(level.info);
    }
    level.info.chart = level.info.chart || "chart.json";
    level.info.charter = level.info.charter || "UK";
    level.info.composer = level.info.composer || "UK";
    level.info.difficulty = Number(level.info.difficulty || 10.0);
    level.info.illustration = level.info.illustration || "illustration.jpg";
    level.info.illustrationBlur = level.info.illustrationBlur || "illustrationBlur.jpg";
    level.info.illustrationLowRes = level.info.illustrationLowRes || "illustrationLowRes.jpg";
    level.info.illustrator = level.info.illustrator || "UK";
    level.info.level = level.info.level || "UK  Lv.10";
    level.info.music = level.info.music || "music.wav";
    level.info.name = level.info.name || "UK";
    level.info.previewStart = Number(level.info.previewStart || 0.0);
    level.info.previewEnd = Number(level.info.previewEnd || level.info.previewStart + 15.0);
    level.chart = await loadZipContent(level.info.chart, "json");
    prepareChart(level.chart);
    level.music = await loadZipContent(level.info.music, "audio");
    level.illustration = await loadZipContent(level.info.illustration, "image");
    level.illustrationBlur = await loadZipContent(level.info.illustrationBlur, "image");
    level.illustrationLowRes = await loadZipContent(level.info.illustrationLowRes, "image");
  }
});
resizeCanvas();
requestAnimationFrame(gameLoop);
