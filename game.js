const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const pauseIcon = new Image();
pauseIcon.src = "assets/Pause.png";
const noteRing = new Image();
noteRing.src = "assets/NoteRing.png";
const audioContext = new AudioContext({ latencyHint: "interactive" });
let pauseAudioBuffer = null;
fetch("assets/Tap6.wav")
  .then((response) => {
    if (!response.ok) throw new Error(`Pause sound: HTTP ${response.status}`);
    return response.arrayBuffer();
  })
  .then((data) => audioContext.decodeAudioData(data))
  .then((buffer) => {
    pauseAudioBuffer = buffer;
  })
  .catch((error) => console.error("Could not load pause sound:", error));
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
const hitEffectStyles = {
  Perfect: { color: [1, 0.927049935, 0.627358496, 0.882352948], particleColor: "#ffeca0", count: 4 },
  Good: { color: [0.705882370, 0.882352948, 1, 0.921568632], particleColor: "#b4e1ff", count: 3 }
};
const hitEffectAtlases = {};
const hitEffectImage = new Image();
hitEffectImage.onload = () => {
  for (let result of ["Perfect", "Good"]) {
    hitEffectAtlases[result] = tintHitEffectAtlas(hitEffectStyles[result].color);
  }
};
hitEffectImage.src = "assets/HitEffect.png";
const backIcon = new Image();
backIcon.src = "assets/Back.png";
const retryIcon = new Image();
retryIcon.src = "assets/Retry.png";
const resumeIcon = new Image();
resumeIcon.src = "assets/Resume.png";
const zipInput = document.getElementById("zipInput");

let level = {
  zip: null,
  info: {},
  chart: null,
  nowTime: -3,
  startTime: -1,
  startDelay: 1.5,
  audioTime: 0,
  audioStarted: false,
  music: null,
  musicSource: null,
  musicStartTime: 0,
  musicOffset: 0,
  illustration: null, // not used yet
  illustrationBlur: null,
  illustrationLowRes: null // not used yet
};

let settings = {
  speed: 6.0, // 流速
  dpi: 264, // Screen.dpi
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
let perfectTimeRange = 0.08;
let goodTimeRange = 0.18;
let badTimeRange = 0.22;
let chartNoteSortByTime = [];
let noteControls = [];
let hitEffects = [];
let lineStates = [];
let fingers = [];
let fingerById = new Map();
let pendingFingerEvents = [];

class ScoreControl {
  constructor() {
    this.reset();
  }

  reset(totalNotes = 0) {
    this.totalNotes = totalNotes;
    this.score = 0;
    this.percent = 0;
    this.scoreOfNote = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfect = 0;
    this.good = 0;
    this.bad = 0;
    this.miss = 0;
    this.early = 0;
    this.late = 0;
    this.isAllPerfect = true;
    this.isFullCombo = true;
  }

  updateScore() {
    if (this.totalNotes <= 0) return;
    this.scoreOfNote = 900000 * (this.perfect + 0.65 * this.good) / this.totalNotes;
    this.score = this.scoreOfNote + 100000 * this.maxCombo / this.totalNotes;
    this.percent = this.scoreOfNote / 900000 * 100;
  }

  getScoreText() {
    return String(Math.floor(this.score + 0.5)).padStart(7, "0");
  }

  recordResult(note, result, judgeTime = 0) {
    if (note.judgeResult) return false;
    note.judgeResult = result;
    note.judgeTime = judgeTime;
    return true;
  }

  Perfect(note, judgeTime = 0, isHold = false) {
    if (!this.recordResult(note, "Perfect", judgeTime)) return;
    this.perfect++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.updateScore();
    if (!isHold) spawnHitEffect(note, "Perfect");
  }

  Good(note, judgeTime, isHold = false) {
    if (!this.recordResult(note, "Good", judgeTime)) return;
    this.good++;
    this.combo++;
    this.isAllPerfect = false;
    if (judgeTime <= 0) this.early++;
    else this.late++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.updateScore();
    if (!isHold) spawnHitEffect(note, "Good");
  }

  Bad(note, judgeTime = 0) {
    if (!this.recordResult(note, "Bad", judgeTime)) return;
    this.bad++;
    this.combo = 0;
    this.isAllPerfect = false;
    this.isFullCombo = false;
    this.updateScore();
  }

  Miss(note) {
    if (!this.recordResult(note, "Miss")) return;
    this.miss++;
    this.combo = 0;
    this.isAllPerfect = false;
    this.isFullCombo = false;
    this.updateScore();
  }
}

let scoreControl = new ScoreControl();

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
    let data = await file.async("arraybuffer");
    return audioContext.decodeAudioData(data);
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

class ClickControl {
  constructor(note) {
    this.note = note;
    this.isJudged = false;
  }

  Judge() {
    let dt = this.note.realTime - level.nowTime;
    this.isJudged = this.isJudged || this.note.isJudged;

    if (!this.isJudged) {
      if (dt < -goodTimeRange) {
        scoreControl.Miss(this.note);
        this.note.isJudged = true;
        return true;
      }
      return false;
    }

    if (Math.abs(dt) < perfectTimeRange) {
      scoreControl.Perfect(this.note, -dt);
    } else if (Math.abs(dt) < goodTimeRange) {
      scoreControl.Good(this.note, -dt);
    } else {
      scoreControl.Bad(this.note, -dt);
    }
    this.note.isJudged = true;
    return true;
  }
}

class HoldControl {
  constructor(note) {
    this.note = note;
    this.isJudged = false;
    this.missed = false;
    this.judged = false;
    this.judgeOver = false;
    this.isPerfect = false;
    this.judgeTime = 0;
    this.safeFrame = 2;
  }

  Judge() {
    let dt = this.note.realTime - level.nowTime;
    let tailTime = this.note.realTime + this.note.holdTime;
    this.isJudged = this.isJudged || this.note.isJudged;

    if (!this.judged && !this.missed) {
      if (!this.isJudged) {
        if (dt < -goodTimeRange) {
          scoreControl.Miss(this.note);
          this.note.isJudged = true;
          this.missed = true;
          return true;
        }
      } else {
        if (Math.abs(dt) < perfectTimeRange) {
          this.judged = true;
          this.isPerfect = true;
          this.judgeTime = -dt;
        } else if (Math.abs(dt) < goodTimeRange) {
          this.judged = true;
          this.isPerfect = false;
          this.judgeTime = -dt;
        }
        if (this.judged) spawnHitEffect(this.note, this.isPerfect ? "Perfect" : "Good");
      }
    }

    if (this.judged && !this.judgeOver) {
      let isHolding = false;
      for (let finger of fingers) {
        if (!finger.pressed) continue;
        let state = lineStates[Math.floor(this.note.judgeLineIndex / 2)];
        if (!state) continue;
        let position = fingerOnLine(finger, state);
        if (Math.abs(this.note.positionX - position.x) < 1.9) {
          isHolding = true;
          break;
        }
      }

      if (isHolding) {
        this.safeFrame = 2;
      } else if (this.safeFrame < 0) {
        scoreControl.Miss(this.note);
        this.note.isJudged = true;
        this.missed = true;
        return true;
      } else {
        this.safeFrame--;
      }

      if (tailTime - level.nowTime < badTimeRange) {
        if (this.isPerfect) scoreControl.Perfect(this.note, this.judgeTime, true);
        else scoreControl.Good(this.note, this.judgeTime, true);
        this.note.isJudged = true;
        this.judgeOver = true;
        return true;
      }
    }

    if (level.nowTime > tailTime + 0.25) {
      if (!this.judged && !this.missed && !this.judgeOver) {
        scoreControl.Miss(this.note);
        this.note.isJudged = true;
      }
      return true;
    }
    return false;
  }
}

class DragControl {
  constructor(note) {
    this.note = note;
    this.isJudged = false;
  }

  Judge() {
    let dt = this.note.realTime - level.nowTime;

    if (Math.abs(dt) <= 0.1 && !this.isJudged) {
      for (let finger of fingers) {
        if (!finger.pressed) continue;
        let state = lineStates[Math.floor(this.note.judgeLineIndex / 2)];
        if (!state) continue;
        let position = fingerOnLine(finger, state);
        if (Math.abs(this.note.positionX - position.x) < 2.1) {
          this.isJudged = true;
          break;
        }
      }
    }

    if (!this.isJudged) {
      if (dt < -0.1) {
        scoreControl.Miss(this.note);
        this.note.isJudged = true;
        return true;
      }
    }

    if (this.isJudged) {
      if (dt < 0.005) {
        scoreControl.Perfect(this.note, -dt);
        this.note.isJudged = true;
        return true;
      }
    }
    return false;
  }
}

class FlickControl {
  constructor(note) {
    this.note = note;
  }

  Judge() {
    let dt = this.note.realTime - level.nowTime;

    if (!this.note.isJudgedForFlick) {
      if (dt < -1.75 * perfectTimeRange) {
        scoreControl.Miss(this.note);
        this.note.isJudged = true;
        return true;
      }
    }

    if (this.note.isJudgedForFlick) {
      if (dt < 0.005) {
        scoreControl.Perfect(this.note, -dt);
        this.note.isJudged = true;
        return true;
      }
    }
    return false;
  }
}

function createNoteControl(note) {
  if (note.type == 1) return new ClickControl(note);
  if (note.type == 2) return new DragControl(note);
  if (note.type == 3) return new HoldControl(note);
  if (note.type == 4) return new FlickControl(note);
  return null;
}

function resetNoteControls() {
  noteControls = [];
  hitEffects = [];
  scoreControl.reset(chartNoteSortByTime.length);
  for (let note of chartNoteSortByTime) {
    note.isJudged = false;
    note.isJudgedForFlick = false;
    note.judgeResult = null;
    note.judgeTime = null;
    note.control = createNoteControl(note);
    if (note.control) noteControls.push(note.control);
  }
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
      note.isJudgedForFlick = false;
      note.judgeResult = null;
      note.judgeTime = null;
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
      note.isJudgedForFlick = false;
      note.judgeResult = null;
      note.judgeTime = null;
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
  chartNoteSortByTime = notes;
  resetNoteControls();
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
  if (note.judgeResult) return;
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

function tintHitEffectAtlas(color) {
  let atlas = document.createElement("canvas");
  atlas.width = hitEffectImage.naturalWidth;
  atlas.height = hitEffectImage.naturalHeight;
  let atlasCtx = atlas.getContext("2d");
  atlasCtx.drawImage(hitEffectImage, 0, 0);
  let pixels = atlasCtx.getImageData(0, 0, atlas.width, atlas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    for (let c = 0; c < 4; c++) pixels.data[i + c] *= color[c];
  }
  atlasCtx.putImageData(pixels, 0, 0);
  return atlas;
}

function spawnHitEffect(note, result) {
  let state = lineStates[Math.floor(note.judgeLineIndex / 2)];
  if (!state) return;
  let angle = state.angle * Math.PI / 180;
  let headY = 0;
  if (note.type == 3 && level.nowTime < note.realTime) {
    headY = (note.floorPosition - state.currentFloor) * settings.speed;
    if (note.side == 1) headY = -headY;
  }
  hitEffects.push({
    x: state.x + note.positionX * Math.cos(angle) - headY * Math.sin(angle),
    y: state.y + note.positionX * Math.sin(angle) + headY * Math.cos(angle),
    result,
    age: 0,
    scale: settings.noteScale * Math.min(1, effectiveAspect / (16 / 9)) * 1.35,
    particles: []
  });
}

function hermite(t, start, startSlope, end, endSlope) {
  let a = 2 * start - 2 * end + startSlope + endSlope;
  let b = -3 * start + 3 * end - 2 * startSlope - endSlope;
  return ((a * t + b) * t + startSlope) * t + start;
}

function updateHitParticle(particle, deltaTime) {
  let u = particle.age / 0.5;
  let drag = 5 * hermite(u, 0, 2.2, 1, 0);
  particle.speed *= Math.max(0, 1 - drag * particle.speed * deltaTime);
  particle.distance += particle.speed * deltaTime;
  particle.age += deltaTime;
}

function updateHitEffects(deltaTime) {
  if (deltaTime <= 0) return;
  let steps = Math.ceil(deltaTime / 0.03);
  let stepTime = deltaTime / steps;
  for (let effect of hitEffects) {
    if (effect.age + deltaTime >= 0.56) {
      effect.age += deltaTime;
      effect.particles = [];
      continue;
    }
    for (let step = 0; step < steps; step++) {
      let endAge = effect.age + stepTime;
      for (let particle of effect.particles) updateHitParticle(particle, stepTime);
      effect.particles = effect.particles.filter((particle) => particle.age < 0.5);
      if (endAge < 0.05999999865889549) {
        let first = Math.floor(effect.age * 100 + 1e-9);
        let last = Math.floor(endAge * 100 + 1e-9);
        let count = Math.min(last - first, hitEffectStyles[effect.result].count - effect.particles.length);
        for (let i = 0; i < count; i++) {
          let particle = {
            angle: Math.random() * Math.PI * 2,
            speed: 15 + Math.random() * 20,
            distance: Math.sqrt(0.16 ** 2 + Math.random() * (0.2 ** 2 - 0.16 ** 2)),
            age: 0
          };
          updateHitParticle(particle, Math.max(0, endAge - (last - i) / 100));
          effect.particles.push(particle);
        }
      }
      effect.age = endAge;
    }
  }
  hitEffects = hitEffects.filter((effect) => effect.age < 0.5 || effect.particles.length > 0);
}

function drawHitEffects() {
  ctx.save();
  for (let effect of hitEffects) {
    let x = worldToScreenX(effect.x);
    let y = worldToScreenY(effect.y);
    let scale = effect.scale * screenHeight / 10;
    let frame = Math.min(29, Math.floor(effect.age * 60));
    let atlas = hitEffectAtlases[effect.result];
    ctx.globalAlpha = 1;
    if (atlas && effect.age < 0.5) {
      let size = 2.56 * scale;
      ctx.drawImage(atlas, frame % 6 * 256, Math.floor(frame / 6) * 256, 256, 256,
        x - size / 2, y - size / 2, size, size);
    }

    ctx.fillStyle = hitEffectStyles[effect.result].particleColor;
    for (let particle of effect.particles) {
      let u = particle.age / 0.5;
      let size = 0.3 * hermite(u,
        0.498844922, 1.639878511,
        0.694114327, -1.041509628) * scale;
      let distance = particle.distance * scale;
      ctx.globalAlpha = Math.max(0, 1 - u);
      let particleX = x + distance * Math.cos(particle.angle);
      let particleY = y - distance * Math.sin(particle.angle);
      ctx.fillRect(particleX - size / 2, particleY - size / 2, size, size);
    }
  }
  ctx.restore();
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

function updateJudgeLineStates() {
  lineStates = [];
  if (!level.chart) return;
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
}

function drawJudgeLines() {
  if (!level.chart) return;
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

function fingerOnLine(finger, state) {
  let dx = finger.nowPosition.x - state.x;
  let dy = finger.nowPosition.y - state.y;
  let angle = state.angle * Math.PI / 180;
  return {
    x: dx * Math.cos(angle) + dy * Math.sin(angle),
    y: -dx * Math.sin(angle) + dy * Math.cos(angle)
  };
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

function drawPauseBar() {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, screenWidth, screenHeight);
  drawPauseBarButton(backIcon, -216, 0);
  drawPauseBarButton(retryIcon, 0, 0);
  drawPauseBarButton(resumeIcon, 216, 0);
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
  let viewport = window.visualViewport;
  let standalone = navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;
  document.documentElement.classList.toggle("standalone", standalone);
  let viewportWidth = viewport ? viewport.width : window.innerWidth;
  let viewportHeight = viewport ? viewport.height : window.innerHeight;
  canvas.style.width = standalone ? "100vw" : `${viewportWidth}px`;
  canvas.style.height = standalone ? "100vh" : `${viewportHeight}px`;
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
  document.body.classList.toggle("paused", paused);
  ctx.clearRect(0, 0, screenWidth, screenHeight);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, screenWidth, screenHeight);
  drawBackground();

  drawJudgeLines();
  drawHitEffects();
  if (sideMaskWidth > 0) {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, sideMaskWidth, screenHeight);
    ctx.fillRect(screenWidth - sideMaskWidth, 0, sideMaskWidth, screenHeight);
  }
  drawPause();
  drawPauseRing();
  drawScore(scoreControl.getScoreText());
  if (scoreControl.combo >= 3) {
    drawCombo(scoreControl.combo);
    drawComboText();
  }
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

function clearFingers() {
  fingers = [];
  fingerById.clear();
  pendingFingerEvents = [];
}

function queueFingerEvent(fingerId, phase, clientX, clientY) {
  if (paused) return;
  pendingFingerEvents.push({ fingerId, phase, clientX, clientY });
}

function syncFingers() {
  for (let finger of fingers) {
    finger.isNewClick = false;
    finger.lastPosition = finger.nowPosition;
    finger.lastMove = finger.nowMove;
    finger.nowMove = { x: 0, y: 0 };
  }
  for (let event of pendingFingerEvents) {
    let position = {
      x: screenToWorldX(event.clientX),
      y: screenToWorldY(event.clientY)
    };
    let finger = fingerById.get(event.fingerId);
    if (!finger) {
      finger = {
        fingerId: event.fingerId,
        pressed: event.phase != "ended" && event.phase != "canceled",
        isNewClick: event.phase == "began",
        isNewFlick: false,
        stopped: true,
        lastPosition: position,
        nowPosition: position,
        lastMove: { x: 0, y: 0 },
        nowMove: { x: 0, y: 0 }
      };
      fingers.push(finger);
      fingerById.set(event.fingerId, finger);
      continue;
    }
    finger.nowPosition = position;
    finger.nowMove = {
      x: finger.nowPosition.x - finger.lastPosition.x,
      y: finger.nowPosition.y - finger.lastPosition.y
    };
    finger.pressed = event.phase != "ended" && event.phase != "canceled";
    if (event.phase == "began") finger.isNewClick = true;
  }
  pendingFingerEvents = [];
}

function updateFlickTrigger(deltaTime) {
  if (deltaTime <= 0) return;
  let flickJudgeSpeed = 0.06 / 380 * settings.dpi;
  for (let finger of fingers) {
    if (!finger.pressed && finger.nowMove.x == 0 && finger.nowMove.y == 0) continue;
    let lastMoveLength = Math.hypot(finger.lastMove.x, finger.lastMove.y);
    let flickSpeed = 0;
    if (lastMoveLength > 0.1) {
      flickSpeed = (finger.nowMove.x * finger.lastMove.x + finger.nowMove.y * finger.lastMove.y) / lastMoveLength;
    }
    flickSpeed = flickSpeed / 60 / deltaTime;
    if (flickSpeed < flickJudgeSpeed || finger.stopped) {
      let speed = Math.hypot(finger.nowMove.x, finger.nowMove.y) / 60 / deltaTime;
      if (speed >= flickJudgeSpeed * 5) {
        finger.isNewFlick = true;
        finger.stopped = false;
      } else {
        finger.isNewFlick = false;
        finger.stopped = true;
      }
    }
  }
}

function CheckNote(finger) {
  let best = null;
  let bestAbsDt = 10000;

  let end = -1;
  while (end + 1 < chartNoteSortByTime.length) {
    let note = chartNoteSortByTime[end + 1];
    if (note.realTime >= level.nowTime + badTimeRange) break;
    end++;
  }
  let start = end;
  while (start > 0) {
    let note = chartNoteSortByTime[start - 1];
    if (note.realTime <= level.nowTime - goodTimeRange) break;
    start--;
  }

  if (start < 0) return null;
  if (end < start) return null;

  for (let i = start; i <= end; i++) {
    let note = chartNoteSortByTime[i];
    if (note.isJudged) continue;

    let dt = note.realTime - level.nowTime;
    let state = lineStates[Math.floor(note.judgeLineIndex / 2)];
    if (!state) continue;
    let position = fingerOnLine(finger, state);
    let dx = Math.abs(note.positionX - position.x);
    if (dx >= 1.9) continue;
    if (dt >= bestAbsDt + 0.01) continue;

    let badLimit = badTimeRange;
    if (dx > 0.9) {
      badLimit = badTimeRange - (dx - 0.9) * perfectTimeRange * 0.5;
    }
    if (dt > badLimit) continue;

    if (best != null) {
      if (best.type != 2 && best.type != 4) {
        if (note.type != 1 && note.type != 3) continue;
        if (Math.abs(best.realTime - note.realTime) > 0.01) continue;
        let bestState = lineStates[Math.floor(best.judgeLineIndex / 2)];
        if (!bestState) continue;
        let bestPosition = fingerOnLine(finger, bestState);
        let noteMetric = Math.abs(note.positionX - position.x) + Math.abs(position.y / 2.2);
        let bestMetric = Math.abs(best.positionX - bestPosition.x) + Math.abs(bestPosition.y / 2.2);
        if (noteMetric >= bestMetric) continue;
      }
    }

    best = note;
    bestAbsDt = Math.abs(dt);
  }

  if (best == null) return null;
  if (best.type == 4) return best;
  if (best.type == 1 || best.type == 2 || best.type == 3) {
    best.isJudged = true;
    return best;
  }
  return null;
}

function CheckFlick(finger) {
  let best = null;
  let bestAbsDt = 10000;

  let end = -1;
  while (end + 1 < chartNoteSortByTime.length) {
    let note = chartNoteSortByTime[end + 1];
    if (note.realTime >= level.nowTime + 1.75 * perfectTimeRange) break;
    end++;
  }
  let start = end;
  while (start > 0) {
    let note = chartNoteSortByTime[start - 1];
    if (note.realTime <= level.nowTime - 1.75 * perfectTimeRange) break;
    start--;
  }

  if (start < 0) return;
  if (end < start) return;

  for (let i = start; i <= end; i++) {
    let note = chartNoteSortByTime[i];
    if (note.type != 4) continue;
    if (note.isJudgedForFlick) continue;

    let dt = note.realTime - level.nowTime;
    if (dt >= bestAbsDt + 0.01) continue;

    let state = lineStates[Math.floor(note.judgeLineIndex / 2)];
    if (!state) continue;
    let position = fingerOnLine(finger, state);
    let dx = Math.abs(note.positionX - position.x);
    if (dx >= 2.1) continue;

    if (best != null) {
      if (Math.abs(best.realTime - note.realTime) > 0.01) continue;
      let bestState = lineStates[Math.floor(best.judgeLineIndex / 2)];
      if (!bestState) continue;
      let bestPosition = fingerOnLine(finger, bestState);
      let noteMetric = Math.abs(note.positionX - position.x) + Math.abs(position.y / 2.2);
      let bestMetric = Math.abs(best.positionX - bestPosition.x) + Math.abs(bestPosition.y / 2.2);
      if (noteMetric >= bestMetric) continue;
    }

    best = note;
    bestAbsDt = Math.abs(dt);
  }

  if (best == null) return;
  best.isJudgedForFlick = true;
  finger.isNewFlick = false;
}

function updateNoteMatching() {
  for (let finger of fingers) {
    if (finger.isNewClick) CheckNote(finger);
    if (finger.isNewFlick) CheckFlick(finger);
  }
}

function updateNoteControls() {
  for (let i = noteControls.length - 1; i >= 0; i--) {
    if (noteControls[i].Judge()) noteControls.splice(i, 1);
  }
}

function updateFingers(deltaTime) {
  syncFingers();
  updateFlickTrigger(deltaTime);
  updateNoteMatching();
}

function finishFingerFrame() {
  for (let i = fingers.length - 1; i >= 0; i--) {
    if (fingers[i].pressed) continue;
    fingerById.delete(fingers[i].fingerId);
    fingers.splice(i, 1);
  }
}

function pauseLevel() {
  stopMusic();
  clearFingers();
  playPauseSound();
}

function playPauseSound() {
  if (!pauseAudioBuffer) return;
  let source = audioContext.createBufferSource();
  source.buffer = pauseAudioBuffer;
  source.connect(audioContext.destination);
  source.onended = () => source.disconnect();
  source.start();
}

function resumeLevel() {
  level.startTime = -1;
  level.startDelay = 3.0;
  level.audioStarted = false;
  clearFingers();
}

function retryLevel() {
  stopMusic();
  level.audioTime = 0;
  level.nowTime = 0;
  level.startTime = -1;
  level.startDelay = 1.5;
  resetNoteControls();
  clearFingers();
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
  if (isInsidePauseMenuHitbox(event.clientX, event.clientY, 0) && level.chart && level.music) {
    pauseTime = 0;
    retryLevel();
    paused = false;
    return;
  }
  if (isInsidePauseMenuHitbox(event.clientX, event.clientY, 2) && level.chart && level.music) {
    pauseTime = 0;
    resumeLevel();
    paused = false;
    return;
  }
}

function handlePointer(event) {
  unlockAudio();
  if (paused) {
    handlePauseMenuPointer(event);
    return;
  }
  handlePausePointer(event);
}
function handlePointerDown(event) {
  if (event.pointerType == "touch") return;
  handlePointer(event);
  if (event.defaultPrevented) return;
  if (event.target.setPointerCapture) event.target.setPointerCapture(event.pointerId);
  queueFingerEvent(`pointer:${event.pointerId}`, "began", event.clientX, event.clientY);
}
function handlePointerMove(event) {
  if (event.pointerType == "touch") return;
  if (!fingerById.has(`pointer:${event.pointerId}`)) return;
  queueFingerEvent(`pointer:${event.pointerId}`, "moved", event.clientX, event.clientY);
}
function handlePointerUp(event) {
  if (event.pointerType == "touch") return;
  if (!fingerById.has(`pointer:${event.pointerId}`)) return;
  queueFingerEvent(`pointer:${event.pointerId}`, "ended", event.clientX, event.clientY);
}
function handlePointerCancel(event) {
  if (event.pointerType == "touch") return;
  if (!fingerById.has(`pointer:${event.pointerId}`)) return;
  queueFingerEvent(`pointer:${event.pointerId}`, "canceled", event.clientX, event.clientY);
}

function handleTouchStart(event) {
  let wasPaused = paused;
  let queued = false;
  for (let i = 0; i < event.changedTouches.length; i++) {
    let touch = event.changedTouches[i];
    let handledUi = wasPaused || isInsidePauseHitbox(touch.clientX, touch.clientY);
    handlePointer({
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault() {
        event.preventDefault();
      }
    });
    if (!handledUi) {
      queueFingerEvent(`touch:${touch.identifier}`, "began", touch.clientX, touch.clientY);
      queued = true;
    }
  }
  if (queued) event.preventDefault();
}
function handleTouchMove(event) {
  if (paused) return;
  event.preventDefault();
  for (let i = 0; i < event.changedTouches.length; i++) {
    let touch = event.changedTouches[i];
    queueFingerEvent(`touch:${touch.identifier}`, "moved", touch.clientX, touch.clientY);
  }
}
function handleTouchEnd(event) {
  if (paused) return;
  event.preventDefault();
  for (let i = 0; i < event.changedTouches.length; i++) {
    let touch = event.changedTouches[i];
    queueFingerEvent(`touch:${touch.identifier}`, "ended", touch.clientX, touch.clientY);
  }
}
function handleTouchCancel(event) {
  if (paused) return;
  event.preventDefault();
  for (let i = 0; i < event.changedTouches.length; i++) {
    let touch = event.changedTouches[i];
    queueFingerEvent(`touch:${touch.identifier}`, "canceled", touch.clientX, touch.clientY);
  }
}

function updatePauseTimer(deltaTime) {
  if (pauseTime <= 0) return;
  pauseTime = Math.max(0, pauseTime - deltaTime);
}

function unlockAudio() {
  if (audioContext.state != "running") {
    audioContext.resume().catch((error) => console.error("Could not resume audio:", error));
  }
}

function requestMusicPlayback() {
  if (!level.music || level.musicSource) return;
  let source = audioContext.createBufferSource();
  source.buffer = level.music;
  source.connect(audioContext.destination);
  source.onended = () => source.disconnect();
  // Buffer sources have no playback-position property; retain their clock anchor.
  level.musicStartTime = Math.max(audioContext.currentTime, level.startTime);
  level.musicOffset = level.audioTime;
  source.start(level.musicStartTime, level.musicOffset);
  level.musicSource = source;
}

function getMusicTime() {
  if (!level.musicSource) return level.audioTime;
  return Math.min(level.music.duration,
    level.musicOffset + Math.max(0, audioContext.currentTime - level.musicStartTime));
}

function stopMusic() {
  if (level.musicSource) {
    level.audioTime = getMusicTime();
    level.musicSource.stop();
    level.musicSource.disconnect();
    level.musicSource = null;
  }
  level.audioStarted = false;
}

function updateLevelTime() {
  if (!level.chart || !level.music) return;
  let time = audioContext.currentTime;
  if (level.startTime < 0) level.startTime = time + level.startDelay;
  if (!level.musicSource && time >= level.startTime - 1.0) requestMusicPlayback();
  level.audioStarted = !!level.musicSource && audioContext.state == "running" &&
    time >= level.musicStartTime;
  if (level.audioStarted) {
    level.audioTime = getMusicTime();
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
    updateJudgeLineStates();
    if (level.audioStarted) {
      updateHitEffects(deltaTime);
      updateFingers(deltaTime);
      updateNoteControls();
    } else {
      syncFingers();
    }
  }
  drawFrame();
  finishFingerFrame();
  requestAnimationFrame(gameLoop);
}

window.addEventListener("resize", resizeCanvas);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerCancel);
canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
canvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });
zipInput.addEventListener("change", async () => {
  let file = zipInput.files[0];
  if (file) {
    unlockAudio();
    stopMusic();
    paused = true;
    pauseTime = 0;
    clearFingers();
    hitEffects = [];
    level.info = {};
    level.chart = null;
    level.nowTime = -3;
    level.startTime = -1;
    level.startDelay = 1.5;
    level.audioTime = 0;
    level.audioStarted = false;
    level.music = null;
    level.illustration = null;
    level.illustrationBlur = null;
    level.illustrationLowRes = null;
    level.zip = await JSZip.loadAsync(file);
    let infoFile = level.zip.file("info.yml");
    if (infoFile) {
      let infoText = await infoFile.async("string");
      level.info = readYaml(infoText);
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
    level.music = await loadZipContent(level.info.music, "audio")
      .catch((error) => {
        console.error("Could not decode music:", error);
        return null;
      });
    level.illustration = await loadZipContent(level.info.illustration, "image");
    level.illustrationBlur = await loadZipContent(level.info.illustrationBlur, "image");
    level.illustrationLowRes = await loadZipContent(level.info.illustrationLowRes, "image");
  }
});
resizeCanvas();
requestAnimationFrame(gameLoop);
