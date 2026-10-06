class TouchBlockBehavior {
  constructor() {
    this.size = 11.5;
    this.animationDuration = 0.1;
    this.Initialize();
  }

  Initialize() {
    this.position = { x: 0, y: 0 };
    this.scale = 0;
    this.fromScale = 0;
    this.targetScale = 0;
    this.age = this.animationDuration;
  }

  Show() {
    this.scale = 0;
    this.fromScale = 0;
    this.targetScale = this.size;
    this.age = 0;
  }

  Hide() {
    this.fromScale = this.scale;
    this.targetScale = 0;
    this.age = 0;
  }

  UpdatePosition(position) {
    this.position = { x: position.x, y: position.y };
  }

  Update(deltaTime) {
    this.age = Math.min(this.animationDuration, this.age + deltaTime);
    this.scale = this.fromScale + (this.targetScale - this.fromScale) * this.age / this.animationDuration;
  }
}

class BlockRender {
  constructor() {
    this.slots = Array.from({ length: 10 }, () => ({ finger: null, seen: false, behavior: new TouchBlockBehavior() }));
    this.touchPositions = [];
    this.time = 0;
    this.canvas = document.createElement("canvas");
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");
    this.gl = null;
    this.failed = false;
    this.contextLost = false;
    this.ready = false;
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.gl = null;
      this.contextLost = false;
      this.failed = false;
    });
    const loadImage = (path) => new Promise((resolve, reject) => {
      let image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${path}`));
      image.src = path;
    });
    Promise.all([
      loadImage("assets/TouchPoint.png"),
      loadImage("assets/BlockNoise1.png"),
      loadImage("assets/FD_Noise.png"),
      fetch("assets/BlockTouch.frag").then((response) => {
        if (!response.ok) throw new Error(`Block shader: HTTP ${response.status}`);
        return response.text();
      })
    ]).then(([hover, displacement, noise, shader]) => {
      this.hover = hover;
      this.displacement = displacement;
      this.noise = noise;
      this.shader = shader;
      this.ready = true;
    }).catch((error) => console.error("Could not load block indicators:", error));
  }

  Reset() {
    this.touchPositions = [];
    for (let slot of this.slots) {
      slot.finger = null;
      slot.seen = false;
      slot.behavior.Initialize();
    }
  }

  BeginTouchBlockFrame() {
    this.touchPositions = [];
    for (let slot of this.slots) slot.seen = false;
  }

  UpdateTouchBlock(finger) {
    let slot = this.slots.find(slot => slot.finger === finger);
    if (!slot) {
      slot = this.slots.find(slot => slot.finger == null);
      if (!slot) return;
      slot.finger = finger;
      slot.behavior.Show();
    }
    slot.seen = true;
    slot.behavior.UpdatePosition(finger.nowPosition);
  }

  EndTouchBlockFrame() {
    for (let slot of this.slots) {
      if (slot.finger != null && !slot.seen) {
        slot.behavior.Hide();
        slot.finger = null;
      }
    }
  }

  Update(deltaTime, fingerById, blockedFingerIds) {
    this.time += deltaTime;
    for (let slot of this.slots) slot.behavior.Update(deltaTime);
    this.BeginTouchBlockFrame();
    for (let [fingerId, finger] of fingerById) {
      if (!finger.pressed || !blockedFingerIds.has(fingerId)) continue;
      if (this.touchPositions.length < 10) this.touchPositions.push(finger.nowPosition);
      this.UpdateTouchBlock(finger);
    }
    this.EndTouchBlockFrame();
  }

  InitializeRenderer() {
    let gl = this.canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error("WebGL 2 unavailable; using simple block indicators");
    const compile = (type, source) => {
      let shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        let message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    };
    let vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      out vec2 uv;
      void main() {
        uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`);
    let fragment = compile(gl.FRAGMENT_SHADER, this.shader);
    let program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      let message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(message);
    }
    gl.useProgram(program);
    this.uniforms = {};
    for (let name of ["_ScreenParams", "_Time", "_TouchPosCount", "_TouchPos[0]"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.textures = [];
    for (let [unit, name, image] of [
      [0, "_TouchHoverRT", null], [1, "_ComposeRT", null],
      [2, "_TouchDisplaceMap", this.displacement], [3, "_NoiseMap", this.noise]
    ]) {
      let texture = gl.createTexture();
      this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, image ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, image ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, image ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, image ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
      if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    }
    this.gl = gl;
    this.program = program;
    this.touchPosData = new Float32Array(20);
  }

  Draw(ctx, regions, width, height, deviceScale) {
    if (!this.ready || (!this.touchPositions.length && !this.slots.some(slot => slot.behavior.scale > 0))) return;
    let pixelWidth = Math.max(1, Math.round(width * deviceScale));
    let pixelHeight = Math.max(1, Math.round(height * deviceScale));
    let maskWidth = Math.max(1, Math.floor(pixelWidth / 8));
    let maskHeight = Math.max(1, Math.floor(pixelHeight / 8));
    if (this.maskCanvas.width != maskWidth || this.maskCanvas.height != maskHeight) {
      this.maskCanvas.width = maskWidth;
      this.maskCanvas.height = maskHeight;
    }
    let mask = this.maskCtx;
    mask.clearRect(0, 0, maskWidth, maskHeight);
    for (let slot of this.slots) {
      let effect = slot.behavior;
      if (effect.scale <= 0) continue;
      let size = 0.44 * effect.scale;
      let x = (0.5 + effect.position.x * height / (10 * width)) * maskWidth;
      let y = (0.5 - effect.position.y / 10) * maskHeight;
      let w = size * height / (10 * width) * maskWidth;
      let h = size / 10 * maskHeight;
      mask.drawImage(this.hover, x - w / 2, y - h / 2, w, h);
    }
    if (!this.gl && !this.failed && !this.contextLost) {
      try {
        this.InitializeRenderer();
      } catch (error) {
        this.failed = true;
        console.warn("Block indicators:", error);
      }
    }
    ctx.save();
    ctx.beginPath();
    let visibleWidth = Math.min(width, height * 16 / 9);
    ctx.rect((width - visibleWidth) / 2, 0, visibleWidth, height);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    if (!this.gl || this.contextLost) {
      mask.globalCompositeOperation = "source-in";
      mask.fillStyle = "#f00";
      mask.fillRect(0, 0, maskWidth, maskHeight);
      mask.globalCompositeOperation = "source-over";
      ctx.drawImage(this.maskCanvas, 0, 0, width, height);
    } else {
      let gl = this.gl;
      if (this.canvas.width != pixelWidth || this.canvas.height != pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[0]);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.maskCanvas);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[1]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, regions);
      gl.uniform2f(this.uniforms._ScreenParams, pixelWidth, pixelHeight);
      gl.uniform2f(this.uniforms._Time, this.time / 20, this.time);
      gl.uniform1i(this.uniforms._TouchPosCount, this.touchPositions.length);
      for (let [i, p] of this.touchPositions.entries()) {
        this.touchPosData[2 * i] = width / (2 * height) + p.x / 10;
        this.touchPosData[2 * i + 1] = 0.5 + p.y / 10;
      }
      gl.uniform2fv(this.uniforms["_TouchPos[0]"], this.touchPosData);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ctx.drawImage(this.canvas, 0, 0, width, height);
    }
    ctx.restore();
  }
}
