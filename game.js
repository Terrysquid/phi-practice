const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let screenWidth = 0;
let screenHeight = 0;
let deviceScale = 1;
let visibleWidth = 0;
let sideMaskWidth = 0;
let effectiveAspect = 0;

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
}

function gameLoop() {
  drawFrame();
  requestAnimationFrame(gameLoop);
}

window.addEventListener("resize", resizeCanvas);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeCanvas);
resizeCanvas();
requestAnimationFrame(gameLoop);
