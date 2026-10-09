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
    this.loading = Promise.all([
      loadImage("assets/TouchPoint.png"),
      loadImage("assets/BlockNoise1.png"),
      loadImage("assets/FD_Noise.png"),
      fetch("assets/BlockTouch.frag?v=20261009").then((response) => {
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

  WarmUp(width, height, deviceScale) {
    if (!this.ready || this.failed || this.contextLost) return;
    let pixelWidth = Math.max(1, Math.round(width * deviceScale));
    let pixelHeight = Math.max(1, Math.round(height * deviceScale));
    if (this.gl && this.warmedWidth == pixelWidth && this.warmedHeight == pixelHeight &&
        this.uploadedWidth == pixelWidth && this.uploadedHeight == pixelHeight) return;
    let canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    let ctx = canvas.getContext("2d");
    ctx.scale(deviceScale, deviceScale);
    ctx.fillStyle = "#ff3030";
    ctx.fillRect(0, 0, width, height);
    let slots = this.slots;
    let touchPositions = this.touchPositions;
    let touch = new TouchBlockBehavior();
    touch.scale = touch.size;
    this.slots = [{ behavior: touch }];
    this.touchPositions = [touch.position];
    try {
      this.Draw(ctx, width, height, deviceScale, [
        { x: 0, y: 0, width: 10 * width / height, height: 10, angle: 0, isSubtract: false },
        { x: 0, y: 0, width: 2, height: 2, angle: 20, isSubtract: true }
      ]);
      if (this.gl) {
        this.gl.finish();
        this.warmedWidth = pixelWidth;
        this.warmedHeight = pixelHeight;
      }
    } finally {
      this.slots = slots;
      this.touchPositions = touchPositions;
      canvas.width = 0;
      canvas.height = 0;
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
    const createProgram = (vertexSource, fragmentSource) => {
      let vertex = compile(gl.VERTEX_SHADER, vertexSource);
      let fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
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
      return program;
    };
    let program = createProgram(`#version 300 es
      out vec2 uv;
      void main() {
        uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
      }`, this.shader);
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
      [2, "_TouchDisplaceMap", this.displacement], [3, "_NoiseMap", this.noise],
      [4, "_TouchPoint", this.hover]
    ]) {
      let texture = gl.createTexture();
      this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      let noise = image && unit != 4;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, noise ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, noise ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, noise ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, noise ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, unit == 4);
      if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
    }
    this.program = program;
    this.touchPosData = new Float32Array(20);
    this.uploadedWidth = 0;
    this.uploadedHeight = 0;
    this.warmedWidth = 0;
    this.warmedHeight = 0;
    this.maskProgram = createProgram(`#version 300 es
      uniform vec4 rect;
      uniform vec2 rotation;
      uniform vec2 worldToClip;
      out vec2 uv;
      void main() {
        vec2 corners[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(0, 1), vec2(1, 0), vec2(1, 1));
        uv = corners[gl_VertexID];
        vec2 p = (uv - 0.5) * rect.zw;
        p = mat2(rotation.x, rotation.y, -rotation.y, rotation.x) * p + rect.xy;
        gl_Position = vec4(p * worldToClip, 0, 1);
      }`, `#version 300 es
      precision highp float;
      uniform sampler2D touchPoint;
      uniform bool sprite;
      in vec2 uv;
      out vec4 color;
      void main() {
        color = sprite ? texture(touchPoint, uv) : vec4(1, 48.0 / 255.0, 48.0 / 255.0, 1);
      }`);
    gl.useProgram(this.maskProgram);
    this.maskUniforms = {};
    for (let name of ["rect", "rotation", "worldToClip", "sprite"]) {
      this.maskUniforms[name] = gl.getUniformLocation(this.maskProgram, name);
    }
    gl.uniform1i(gl.getUniformLocation(this.maskProgram, "touchPoint"), 4);
    this.maskFramebuffers = [gl.createFramebuffer(), gl.createFramebuffer()];
    this.regionFramebuffer = gl.createFramebuffer();
    this.regionBuffer = gl.createRenderbuffer();
    this.regionSamples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    this.gl = gl;
  }

  DrawMasks(blocks, width, height, pixelWidth, pixelHeight, maskWidth, maskHeight) {
    let gl = this.gl;
    if (this.uploadedWidth != pixelWidth || this.uploadedHeight != pixelHeight) {
      for (let [unit, w, h] of [[0, maskWidth, maskHeight], [1, pixelWidth, pixelHeight]]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFramebuffers[unit]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures[unit], 0);
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.regionBuffer);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.regionSamples, gl.RGBA8, pixelWidth, pixelHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.regionFramebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.regionBuffer);
      this.uploadedWidth = pixelWidth;
      this.uploadedHeight = pixelHeight;
    }
    gl.useProgram(this.maskProgram);
    gl.uniform2f(this.maskUniforms.worldToClip, height / (5 * width), 0.2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFramebuffers[0]);
    gl.viewport(0, 0, maskWidth, maskHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.maskUniforms.sprite, 1);
    gl.uniform2f(this.maskUniforms.rotation, 1, 0);
    for (let slot of this.slots) {
      let effect = slot.behavior;
      if (effect.scale <= 0) continue;
      let size = 0.44 * effect.scale;
      gl.uniform4f(this.maskUniforms.rect, effect.position.x, effect.position.y, size, size);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.regionFramebuffer);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(this.maskUniforms.sprite, 0);
    for (let block of blocks) {
      gl.blendFunc(block.isSubtract ? gl.ONE_MINUS_DST_ALPHA : gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      let angle = block.angle * Math.PI / 180;
      gl.uniform2f(this.maskUniforms.rotation, Math.cos(angle), Math.sin(angle));
      gl.uniform4f(this.maskUniforms.rect, block.x, block.y, block.width, block.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.regionFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.maskFramebuffers[1]);
    gl.blitFramebuffer(0, 0, pixelWidth, pixelHeight, 0, 0, pixelWidth, pixelHeight, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  Draw(ctx, width, height, deviceScale, blocks = []) {
    if (!this.ready || (!this.touchPositions.length && !this.slots.some(slot => slot.behavior.scale > 0))) return;
    let pixelWidth = Math.max(1, Math.round(width * deviceScale));
    let pixelHeight = Math.max(1, Math.round(height * deviceScale));
    let maskWidth = Math.max(1, Math.floor(pixelWidth / 8));
    let maskHeight = Math.max(1, Math.floor(pixelHeight / 8));
    if (!this.gl && !this.failed && !this.contextLost) {
      try {
        this.InitializeRenderer();
      } catch (error) {
        this.failed = true;
        console.warn("Block indicators:", error);
      }
    }
    let mask = this.maskCtx;
    if (!this.gl || this.contextLost) {
      if (this.maskCanvas.width != maskWidth || this.maskCanvas.height != maskHeight) {
        this.maskCanvas.width = maskWidth;
        this.maskCanvas.height = maskHeight;
      }
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
      this.DrawMasks(blocks, width, height, pixelWidth, pixelHeight, maskWidth, maskHeight);
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.useProgram(this.program);
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
