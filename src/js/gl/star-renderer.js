// WebGL2 star and black-hole renderer — cinematic bloom pipeline.

import {
  STAR_BLOOM_SCALE,
  STAR_BLOOM_THRESHOLD,
  STAR_GL_QUALITY,
  CELESTIAL_VISUAL_SCALE,
} from '../constants.js';
import { getStarVisualProfile, starGpuUniforms, starFeatureBits } from '../star-types.js';
import { resolveVisualSeed } from '../celestial-render-canvas2d.js';
import {
  createGLContext,
  createProgram,
  createFullscreenQuad,
  createFBO,
  resizeFBO,
  bindFramebufferDraw,
  drawFullscreenQuad,
  hexToRgb,
  setUniform1f,
  setUniform1i,
  setUniform2f,
  setUniform3f,
} from './context.js';

import vertSrc from '../../glsl/fullscreen.vert?raw';
import starFrag from '../../glsl/star.frag?raw';
import blackholeFrag from '../../glsl/blackhole.frag?raw';
import bloomThresholdFrag from '../../glsl/bloom-threshold.frag?raw';
import bloomBlurFrag from '../../glsl/bloom-blur.frag?raw';
import bloomCompositeFrag from '../../glsl/bloom-composite.frag?raw';
import blitFrag from '../../glsl/blit.frag?raw';

/** @type {WebGL2RenderingContext | null} */
let gl = null;
/** @type {HTMLCanvasElement | null} */
let canvas = null;
let quad = null;
let programs = null;
let fbos = null;
let width = 0;
let height = 0;
let bloomW = 0;
let bloomH = 0;
let blurPasses = 4;
let enabled = false;
let passMode = 'system';

/** @type {Array<object>} */
let queuedStars = [];
/** @type {Array<object>} */
let queuedBlackHoles = [];
let sceneRendered = false;

const QUALITY_PASSES = { high: 7, medium: 4, low: 2 };

function disableRenderer(reason) {
  console.warn('Star renderer disabled:', reason);
  enabled = false;
  fbos = null;
}

/**
 * @param {HTMLCanvasElement} glCanvas
 * @returns {boolean}
 */
export function initStarRenderer(glCanvas) {
  canvas = glCanvas;
  gl = createGLContext(glCanvas);
  if (!gl) return false;

  try {
    quad = createFullscreenQuad(gl);
    programs = {
      star: createProgram(gl, vertSrc, starFrag),
      blackhole: createProgram(gl, vertSrc, blackholeFrag),
      threshold: createProgram(gl, vertSrc, bloomThresholdFrag),
      blur: createProgram(gl, vertSrc, bloomBlurFrag),
      composite: createProgram(gl, vertSrc, bloomCompositeFrag),
      blit: createProgram(gl, vertSrc, blitFrag),
    };
    blurPasses = QUALITY_PASSES[STAR_GL_QUALITY] ?? 4;
    enabled = true;
    return true;
  } catch (err) {
    disableRenderer(err);
    return false;
  }
}

export function isStarRendererEnabled() {
  return enabled;
}

function ensureFBOs() {
  if (!enabled || !gl || width < 1 || height < 1) return false;

  try {
    if (!fbos) {
      fbos = {
        scene: createFBO(gl, width, height),
        bloomScene: createFBO(gl, bloomW, bloomH),
        bloomA: createFBO(gl, bloomW, bloomH),
        bloomB: createFBO(gl, bloomW, bloomH),
        bloomResult: createFBO(gl, width, height),
      };
      return true;
    }

    const ok = resizeFBO(gl, fbos.scene, width, height)
      && resizeFBO(gl, fbos.bloomScene, bloomW, bloomH)
      && resizeFBO(gl, fbos.bloomA, bloomW, bloomH)
      && resizeFBO(gl, fbos.bloomB, bloomW, bloomH)
      && resizeFBO(gl, fbos.bloomResult, width, height);
    if (!ok) throw new Error('FBO resize incomplete');
    return true;
  } catch (err) {
    disableRenderer(err);
    return false;
  }
}

/**
 * @param {number} w
 * @param {number} h
 */
export function resizeStarRenderer(w, h) {
  if (!enabled || !gl) return;
  width = Math.max(1, w | 0);
  height = Math.max(1, h | 0);
  bloomW = Math.max(1, Math.floor(width * STAR_BLOOM_SCALE));
  bloomH = Math.max(1, Math.floor(height * STAR_BLOOM_SCALE));

  if (canvas) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  ensureFBOs();
}

/**
 * @param {'system' | 'galaxy'} mode
 */
export function beginStarPass(mode = 'system') {
  queuedStars = [];
  queuedBlackHoles = [];
  sceneRendered = false;
  passMode = mode;
}

export function queueStar(opts) {
  if (!enabled) return;
  queuedStars.push(opts);
}

export function queueBlackHole(opts) {
  if (!enabled) return;
  queuedBlackHoles.push(opts);
}

function bindFBO(target) {
  bindFramebufferDraw(gl, target.fbo);
  gl.viewport(0, 0, target.w, target.h);
}

function clearTransparent() {
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function drawStarEntity(entry, pass = 0) {
  const { star, x, y, screenR, time, intel, state, systemId, mode = 'system' } = entry;
  const r = screenR * CELESTIAL_VISUAL_SCALE;
  const profile = getStarVisualProfile(star);
  if (!profile) return;

  // Wrap to a small range: large raw seeds push noise coords past float32
  // fractional precision in the shader, quantizing fbm into visible blocks.
  const seed = resolveVisualSeed(state, systemId, 'star', star.visualSeed) % 8192;
  const color = intel ? (star.color ?? profile.color) : '#505868';
  const gpu = starGpuUniforms(profile);
  const [cr, cg, cb] = hexToRgb(color);
  const [sr, sg, sb] = hexToRgb(profile.secondaryColor);
  const [cor, cog, cob] = hexToRgb(profile.coronaColor);

  const prog = programs.star;
  gl.useProgram(prog);
  setUniform2f(gl, prog, 'u_resolution', width, height);
  setUniform2f(gl, prog, 'u_center', x, y);
  setUniform1f(gl, prog, 'u_radius', r);
  setUniform1f(gl, prog, 'u_time', time);
  setUniform1f(gl, prog, 'u_seed', seed);
  setUniform3f(gl, prog, 'u_color', cr, cg, cb);
  setUniform3f(gl, prog, 'u_secondary', sr, sg, sb);
  setUniform3f(gl, prog, 'u_corona', cor, cog, cob);
  setUniform1f(gl, prog, 'u_glowScale', profile.glowScale);
  setUniform1f(gl, prog, 'u_pulseSpeed', profile.pulseSpeed);
  setUniform1f(gl, prog, 'u_rotationSpeed', profile.rotationSpeed);
  setUniform1f(gl, prog, 'u_temperature', gpu.temperature);
  setUniform1f(gl, prog, 'u_coronaIntensity', gpu.coronaIntensity);
  setUniform1f(gl, prog, 'u_lensStrength', gpu.lensStrength);
  setUniform1f(gl, prog, 'u_turbulence', gpu.turbulence);
  setUniform1f(gl, prog, 'u_intel', intel ? 1.0 : 0.0);
  setUniform1i(gl, prog, 'u_mode', mode === 'galaxy' ? 1 : 0);
  setUniform1i(gl, prog, 'u_features', starFeatureBits(profile));
  setUniform1i(gl, prog, 'u_pass', pass);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  drawFullscreenQuad(gl, quad, prog);
}

function drawBlackHoleEntity(entry) {
  const { x, y, screenR, time, large } = entry;
  const prog = programs.blackhole;
  gl.useProgram(prog);
  setUniform2f(gl, prog, 'u_resolution', width, height);
  setUniform2f(gl, prog, 'u_center', x, y);
  setUniform1f(gl, prog, 'u_radius', screenR);
  setUniform1f(gl, prog, 'u_time', time);
  setUniform1f(gl, prog, 'u_large', large ? 1.0 : 0.0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  drawFullscreenQuad(gl, quad, prog);
}

function renderSceneToFBO(pass = 0) {
  if (!ensureFBOs()) return false;

  bindFBO(fbos.scene);
  clearTransparent();

  for (const bh of queuedBlackHoles) drawBlackHoleEntity(bh);
  for (const star of queuedStars) {
    const starPass = star.mode === 'galaxy' ? 0 : pass;
    drawStarEntity(star, starPass);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  sceneRendered = true;
  return true;
}

function runBloomPipeline(intelPresent) {
  if (!intelPresent || !sceneRendered || !fbos) return null;

  const isGalaxy = passMode === 'galaxy';
  const blurCount = isGalaxy ? Math.min(blurPasses, 2) : blurPasses;
  const intensity = isGalaxy ? 0.55 : 0.75;
  const threshold = isGalaxy ? 0.62 : 0.42;

  bindFBO(fbos.bloomScene);
  clearTransparent();
  gl.useProgram(programs.blit);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, fbos.scene.tex);
  setUniform1i(gl, programs.blit, 'u_texture', 0);
  setUniform1f(gl, programs.blit, 'u_alpha', 1.0);
  drawFullscreenQuad(gl, quad, programs.blit);

  bindFBO(fbos.bloomA);
  clearTransparent();
  gl.useProgram(programs.threshold);
  gl.bindTexture(gl.TEXTURE_2D, fbos.bloomScene.tex);
  setUniform1i(gl, programs.threshold, 'u_texture', 0);
  setUniform1f(gl, programs.threshold, 'u_threshold', threshold);
  drawFullscreenQuad(gl, quad, programs.threshold);

  let src = fbos.bloomA;
  let dst = fbos.bloomB;
  gl.useProgram(programs.blur);
  for (let i = 0; i < blurCount; i++) {
    bindFBO(dst);
    clearTransparent();
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    setUniform1i(gl, programs.blur, 'u_texture', 0);
    setUniform2f(gl, programs.blur, 'u_texelSize', 1 / bloomW, 1 / bloomH);
    setUniform2f(gl, programs.blur, 'u_direction', i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 0 : 1);
    drawFullscreenQuad(gl, quad, programs.blur);
    const tmp = src;
    src = dst;
    dst = tmp;
  }

  bindFBO(fbos.bloomResult);
  clearTransparent();
  gl.useProgram(programs.composite);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  setUniform1i(gl, programs.composite, 'u_bloom', 0);
  setUniform1f(gl, programs.composite, 'u_intensity', intensity);
  setUniform1f(gl, programs.composite, 'u_chromatic', isGalaxy ? 1.0 : 1.5);
  gl.disable(gl.BLEND);
  drawFullscreenQuad(gl, quad, programs.composite);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fbos.bloomResult.tex;
}

function blitToScreen(texture, alpha = 1.0, additive = false) {
  gl.viewport(0, 0, width, height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  clearTransparent();
  gl.useProgram(programs.blit);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  setUniform1i(gl, programs.blit, 'u_texture', 0);
  setUniform1f(gl, programs.blit, 'u_alpha', alpha);
  gl.enable(gl.BLEND);
  gl.blendFunc(additive ? gl.ONE : gl.SRC_ALPHA, additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
  drawFullscreenQuad(gl, quad, programs.blit);
}

/**
 * @param {CanvasRenderingContext2D} ctx2d
 * @param {'core' | 'outer' | 'bloom'} stage
 */
export function flushStars(ctx2d, stage) {
  if (!enabled || !gl || (queuedStars.length === 0 && queuedBlackHoles.length === 0)) return;

  const hasIntel = queuedStars.some((s) => s.intel) || queuedBlackHoles.length > 0;
  const isSystem = passMode === 'system';

  if (stage === 'core') {
    if (!renderSceneToFBO(isSystem ? 1 : 0)) return;
    blitToScreen(fbos.scene.tex, 1.0, false);
    ctx2d.drawImage(canvas, 0, 0);
  } else if (stage === 'outer') {
    if (!isSystem) return;
    if (!renderSceneToFBO(2)) return;
    blitToScreen(fbos.scene.tex, 1.0, true);
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'lighter';
    ctx2d.drawImage(canvas, 0, 0);
    ctx2d.restore();
  } else if (stage === 'bloom') {
    if (!renderSceneToFBO(0)) return;
    const bloomTex = runBloomPipeline(hasIntel);
    if (bloomTex) {
      blitToScreen(bloomTex, 1.0, true);
      ctx2d.save();
      ctx2d.globalCompositeOperation = 'lighter';
      ctx2d.drawImage(canvas, 0, 0);
      ctx2d.restore();
    }
  }
}
