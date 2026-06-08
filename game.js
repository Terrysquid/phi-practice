const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const uiAtlas = new Image();
uiAtlas.src = "assets/Atlas.png";
const noteRing = new Image();
noteRing.src = "assets/NoteRing.png";
const pauseAudio = new Audio("assets/Tap6.wav");
pauseAudio.preload = "auto";

let screenWidth = 0;
let screenHeight = 0;
let deviceScale = 1;
let visibleWidth = 0;
let sideMaskWidth = 0;
let effectiveAspect = 0;
let pauseTime = 0;
let paused = false;
let lastFrameTime = performance.now();

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
function percentageToWorldX(x) {
  return (x - 0.5) * 10 * effectiveAspect;
}
function percentageToWorldY(y) {
  return (y - 0.5) * 10;
}

function drawJudgementLine(x, y, angle) {
  let length = 1920 * 3 * screenHeight / 1000;
  let thickness = 3 * 2.5 * screenHeight / 1000;
  let worldX = percentageToWorldX(x);
  let worldY = percentageToWorldY(y);
  ctx.save();
  ctx.translate(worldToScreenX(worldX), worldToScreenY(worldY));
  ctx.rotate(-angle * Math.PI / 180);
  ctx.fillStyle = "#fff";
  ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
  ctx.restore();
}

function drawPauseRing() {
  if (pauseTime <= 0 || !noteRing.complete || noteRing.naturalWidth == 0) return;
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
  if (!uiAtlas.complete || uiAtlas.naturalWidth == 0) return;
  let x = uiToScreenX(-838.3 + 500 * 16 / 9 - uiHalfWidth());
  let y = uiToScreenY(444.3);
  let width = 34.262 * screenHeight / 1000;
  let height = 37.966 * screenHeight / 1000;
  ctx.drawImage(
    uiAtlas,
    37, 38, 37, 41,
    x - width / 2,
    y - height / 2,
    width,
    height
  );
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

  drawJudgementLine(0.5, 0.5, 0);
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
  drawSongsName("BANGING STRIKE");
  drawSongsLevel("HD  Lv.10");
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

function handlePausePointer(event) {
  if (paused || !isInsidePauseHitbox(event.clientX, event.clientY)) return;
  event.preventDefault();
  if (pauseTime > 0) {
    pauseTime = 0;
    pauseAudio.currentTime = 0;
    pauseAudio.play().catch(() => {});
    paused = true;
    return;
  }
  pauseTime = 1.2;
}

function updatePauseTimer(deltaTime) {
  if (pauseTime <= 0) return;
  pauseTime = Math.max(0, pauseTime - deltaTime);
}

function gameLoop(now) {
  let deltaTime = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (!paused) {
    updatePauseTimer(deltaTime);
  }
  drawFrame();
  requestAnimationFrame(gameLoop);
}

window.addEventListener("resize", resizeCanvas);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeCanvas);
canvas.addEventListener("pointerdown", handlePausePointer);
resizeCanvas();
requestAnimationFrame(gameLoop);
