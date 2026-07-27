// Boot phase state — title screen, warp intro, and gameplay.

import { releaseGameplayKeyboardFocus } from './control-registry.js';

export const BOOT_PHASE = {
  TITLE: 'title',
  WARP_INTRO: 'warpIntro',
  COOP_INTRO: 'coopIntro',
  PLAYING: 'playing',
};

/** @type {'title' | 'warpIntro' | 'coopIntro' | 'playing'} */
let bootPhase = BOOT_PHASE.TITLE;

export function getBootPhase() {
  return bootPhase;
}

/** @param {'title' | 'warpIntro' | 'coopIntro' | 'playing'} phase */
export function setBootPhase(phase) {
  bootPhase = phase;
  // Multiplayer Join / title CTAs leave focus on buttons; clear it so WASD works.
  if (phase === BOOT_PHASE.PLAYING) releaseGameplayKeyboardFocus();
}

export function isPlaying() {
  return bootPhase === BOOT_PHASE.PLAYING;
}
