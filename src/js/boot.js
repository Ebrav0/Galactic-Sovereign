// Boot phase state — title screen, warp intro, and gameplay.

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

/** @param {'title' | 'warpIntro' | 'playing'} phase */
export function setBootPhase(phase) {
  bootPhase = phase;
}

export function isPlaying() {
  return bootPhase === BOOT_PHASE.PLAYING;
}
