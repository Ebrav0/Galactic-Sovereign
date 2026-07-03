// WebGL2 context helpers — init, shaders, FBOs, fullscreen quad.

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {WebGL2RenderingContext | null}
 */
export function createGLContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return gl;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 */
function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {string} vertSrc
 * @param {string} fragSrc
 */
export function createProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

/**
 * @param {WebGL2RenderingContext} gl
 */
export function createFullscreenQuad(gl) {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vbo };
}

/**
 * WebGL2 user FBOs default to GL_NONE draw buffers — must set COLOR_ATTACHMENT0.
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLFramebuffer} fbo
 */
export function bindFramebufferDraw(gl, fbo) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLFramebuffer} fbo
 * @returns {boolean}
 */
export function isFramebufferComplete(gl, fbo) {
  bindFramebufferDraw(gl, fbo);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return ok;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} w
 * @param {number} h
 */
export function createFBO(gl, w, h) {
  const safeW = Math.max(1, w | 0);
  const safeH = Math.max(1, h | 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, safeW, safeH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  bindFramebufferDraw(gl, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: ${status}`);
  }

  return { fbo, tex, w: safeW, h: safeH };
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {{ fbo: WebGLFramebuffer, tex: WebGLTexture, w: number, h: number }} target
 * @param {number} w
 * @param {number} h
 * @returns {boolean}
 */
export function resizeFBO(gl, target, w, h) {
  const safeW = Math.max(1, w | 0);
  const safeH = Math.max(1, h | 0);
  if (target.w === safeW && target.h === safeH) return true;

  target.w = safeW;
  target.h = safeH;
  gl.bindTexture(gl.TEXTURE_2D, target.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, safeW, safeH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return isFramebufferComplete(gl, target.fbo);
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {{ vao: WebGLVertexArrayObject }} quad
 * @param {WebGLProgram} program
 */
export function drawFullscreenQuad(gl, quad, program) {
  gl.useProgram(program);
  gl.bindVertexArray(quad.vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

/**
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string} name
 * @param {number} value
 */
export function setUniform1f(gl, program, name, value) {
  gl.uniform1f(gl.getUniformLocation(program, name), value);
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string} name
 * @param {number} value
 */
export function setUniform1i(gl, program, name, value) {
  gl.uniform1i(gl.getUniformLocation(program, name), value);
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string} name
 * @param {number} x
 * @param {number} y
 */
export function setUniform2f(gl, program, name, x, y) {
  gl.uniform2f(gl.getUniformLocation(program, name), x, y);
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLProgram} program
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function setUniform3f(gl, program, name, x, y, z) {
  gl.uniform3f(gl.getUniformLocation(program, name), x, y, z);
}
