// Logical game cues mapped onto licensed SFX libraries under src/public/audio.
// Runtime code refers only to cue IDs; source variants stay interchangeable.

const asset = (library, file) => `audio/sfx/${library}/${file}`;
const mix = (...files) => files.map((file) => asset('mixkit', file));
const duck = (...files) => files.map((file) => asset('rubberduck', file));
const kenney = (pack, file) => asset('kenney', `${pack}/${file}`);
const numbered = (pack, stem, count, start = 0, pad = 3) =>
  Array.from({ length: count }, (_, index) => kenney(pack, `${stem}${String(index + start).padStart(pad, '0')}.ogg`));

export const AUDIO_CATALOG = Object.freeze({
  'ui.select': { bus: 'ui', files: mix('ui_click_a.mp3', 'ui_click_b.mp3', 'ui_click_c.mp3'), gain: 0.28, cooldownMs: 45 },
  'ui.confirm': { bus: 'ui', files: mix('ui_confirm_a.mp3', 'ui_confirm_b.mp3'), gain: 0.34, cooldownMs: 80 },
  'ui.cancel': { bus: 'ui', files: mix('ui_reject_a.mp3', 'ui_zoom_a.mp3'), gain: 0.28, cooldownMs: 80 },
  'ui.error': { bus: 'ui', files: mix('ui_reject_a.mp3', 'ui_glitch_small.mp3'), gain: 0.3, cooldownMs: 160 },
  'ui.panel_open': { bus: 'ui', files: mix('ui_expand_a.mp3', 'ui_zoom_a.mp3'), gain: 0.26, cooldownMs: 90 },
  'ui.panel_close': { bus: 'ui', files: mix('ui_glitch_small.mp3', 'ui_gear.mp3'), gain: 0.24, cooldownMs: 90 },
  'ui.pause': { bus: 'ui', files: mix('ui_gear.mp3', 'ui_glitch_small.mp3'), gain: 0.3, cooldownMs: 120 },
  'ui.resume': { bus: 'ui', files: mix('ui_confirm_b.mp3', 'ui_click_a.mp3'), gain: 0.3, cooldownMs: 120 },

  'notification.info': { bus: 'ui', files: mix('notify_tech.mp3', 'notify_bleep.mp3'), gain: 0.2, cooldownMs: 220 },
  'notification.success': { bus: 'ui', files: mix('notify_bleep_confirm.mp3', 'ui_confirm_a.mp3'), gain: 0.24, cooldownMs: 220 },
  'notification.warning': { bus: 'ui', files: mix('ui_reject_a.mp3', 'ui_glitch_small.mp3'), gain: 0.28, cooldownMs: 240 },

  'navigation.view': { bus: 'world', files: mix('trans_sweep_fast.mp3', 'trans_sweep_robot.mp3'), gain: 0.28, cooldownMs: 140 },
  'navigation.fleet_arrival': {
    bus: 'world', cooldownMs: 160,
    layers: [
      { files: mix('trans_passby.mp3', 'trans_warp_slide.mp3'), gain: 0.34 },
      { files: numbered('sci-fi', 'spaceEngineSmall_', 5), gain: 0.12, rateMin: 0.9, rateMax: 1.05 },
    ],
  },
  'navigation.warp_depart': {
    bus: 'world', priority: 5, cooldownMs: 280,
    layers: [
      { files: mix('trans_warp_fast.mp3', 'trans_warp_slide.mp3'), gain: 0.46 },
      { files: mix('cinematic_whoosh_fast.mp3', 'space_intro.mp3'), gain: 0.28, rateMin: 0.9, rateMax: 1.05, delayMs: 40 },
      { files: numbered('sci-fi', 'forceField_', 5), gain: 0.14, rateMin: 0.75, rateMax: 0.95, delayMs: 70 },
    ],
  },
  'navigation.warp_arrive': {
    bus: 'world', priority: 5, cooldownMs: 280,
    layers: [
      { files: mix('trans_passby.mp3', 'cinematic_impact.mp3'), gain: 0.42 },
      { files: mix('trans_sweep_robot.mp3', 'trans_warp_slide.mp3'), gain: 0.26, delayMs: 90 },
      { files: numbered('sci-fi', 'spaceEngineSmall_', 5), gain: 0.12, rateMin: 0.85, rateMax: 1, delayMs: 120 },
    ],
  },
  'navigation.wormhole': {
    bus: 'world', cooldownMs: 400,
    layers: [
      { files: mix('space_intro.mp3', 'trans_warp_slide.mp3'), gain: 0.36, rateMin: 0.85, rateMax: 1 },
      { files: numbered('sci-fi', 'forceField_', 5), gain: 0.2, rateMin: 0.7, rateMax: 0.86 },
      { files: mix('ambience_bass_suspense.mp3'), gain: 0.14, rateMin: 0.7, rateMax: 0.85 },
    ],
  },

  'combat.kinetic': {
    bus: 'combat', cooldownMs: 45,
    layers: [
      { files: numbered('impact', 'impactMetal_medium_', 5), gain: 0.22, rateMin: 0.92, rateMax: 1.08 },
      { files: numbered('impact', 'impactPunch_heavy_', 5), gain: 0.12, rateMin: 0.82, rateMax: 1 },
    ],
  },
  'combat.point_defense': { bus: 'combat', files: mix('weapon_laser.mp3'), gain: 0.18, rateMin: 1.12, rateMax: 1.35, cooldownMs: 35 },
  'combat.torpedo_launch': { bus: 'combat', files: numbered('sci-fi', 'thrusterFire_', 5), gain: 0.24, rateMin: 0.82, rateMax: 0.98, cooldownMs: 90 },
  'combat.torpedo_impact': {
    bus: 'combat', cooldownMs: 100,
    layers: [
      { files: numbered('sci-fi', 'explosionCrunch_', 5), gain: 0.4, rateMin: 0.82, rateMax: 0.96 },
      { files: numbered('impact', 'impactMetal_heavy_', 5), gain: 0.2, rateMin: 0.74, rateMax: 0.9 },
    ],
  },
  'combat.beam_lance': {
    bus: 'combat', cooldownMs: 100,
    layers: [
      { files: mix('weapon_laser.mp3', 'weapon_plasma_power.mp3'), gain: 0.34, rateMin: 0.72, rateMax: 0.92 },
      { files: numbered('sci-fi', 'laserLarge_', 5), gain: 0.18, rateMin: 0.7, rateMax: 0.9 },
    ],
  },
  'combat.ion': { bus: 'combat', files: mix('weapon_plasma_power.mp3', 'ui_glitch_small.mp3'), gain: 0.3, rateMin: 0.82, rateMax: 1.08, cooldownMs: 75 },
  'combat.shield_hit': { bus: 'combat', files: numbered('sci-fi', 'forceField_', 5), gain: 0.23, rateMin: 0.9, rateMax: 1.12, cooldownMs: 70 },
  'combat.hull_hit': { bus: 'combat', files: numbered('sci-fi', 'impactMetal_', 5), gain: 0.26, rateMin: 0.82, rateMax: 1.02, cooldownMs: 70 },
  'combat.fighter_launch': { bus: 'combat', files: numbered('sci-fi', 'thrusterFire_', 5), gain: 0.22, rateMin: 1.03, rateMax: 1.2, cooldownMs: 120 },
  'combat.small_kill': { bus: 'combat', files: numbered('sci-fi', 'explosionCrunch_', 5), gain: 0.32, rateMin: 0.95, rateMax: 1.14, cooldownMs: 80 },
  'combat.capital_kill': {
    bus: 'combat', priority: 5, cooldownMs: 280,
    layers: [
      { files: numbered('sci-fi', 'explosionCrunch_', 5), gain: 0.55, rateMin: 0.68, rateMax: 0.82 },
      { files: numbered('sci-fi', 'lowFrequency_explosion_', 2), gain: 0.7, rateMin: 0.65, rateMax: 0.78 },
      { files: numbered('impact', 'impactMetal_heavy_', 5), gain: 0.24, rateMin: 0.62, rateMax: 0.78, delayMs: 80 },
    ],
  },

  'dyson.launcher': { bus: 'world', files: mix('weapon_plasma_power.mp3'), gain: 0.22, rateMin: 1.05, rateMax: 1.25, cooldownMs: 90 },
  'dyson.crackle': { bus: 'world', files: mix('ui_glitch_small.mp3', 'ui_gear.mp3'), gain: 0.16, rateMin: 0.72, rateMax: 1.18, cooldownMs: 260 },
  'dyson.heartbeat': { bus: 'world', files: numbered('sci-fi', 'lowFrequency_explosion_', 2), gain: 0.28, rateMin: 0.48, rateMax: 0.58, cooldownMs: 1600 },
  'dyson.shell_complete': {
    bus: 'world', priority: 5, cooldownMs: 700,
    layers: [
      { files: mix('notify_bleep_confirm.mp3', 'ui_confirm_b.mp3'), gain: 0.3, rateMin: 0.85, rateMax: 1 },
      { files: numbered('sci-fi', 'lowFrequency_explosion_', 2), gain: 0.55, rateMin: 0.58, rateMax: 0.7 },
      { files: numbered('sci-fi', 'forceField_', 5), gain: 0.18, rateMin: 0.7, rateMax: 0.9, delayMs: 60 },
    ],
  },

  'helioclast.charge': { bus: 'world', files: mix('weapon_plasma_power.mp3', 'space_intro.mp3'), gain: 0.4, rateMin: 0.62, rateMax: 0.78, cooldownMs: 400 },
  'helioclast.target_lock': { bus: 'ui', files: mix('notify_tech.mp3', 'notify_bleep.mp3'), gain: 0.28, cooldownMs: 300 },
  'helioclast.fire': {
    bus: 'world', priority: 6, cooldownMs: 500,
    layers: [
      { files: mix('weapon_laser.mp3', 'weapon_plasma_power.mp3'), gain: 0.62, rateMin: 0.5, rateMax: 0.64 },
      { files: numbered('sci-fi', 'laserLarge_', 5), gain: 0.28, rateMin: 0.46, rateMax: 0.58 },
      { files: numbered('sci-fi', 'lowFrequency_explosion_', 2), gain: 0.65, rateMin: 0.45, rateMax: 0.56, delayMs: 40 },
    ],
  },
  'helioclast.impact': {
    bus: 'world', priority: 6, cooldownMs: 600,
    layers: [
      { files: numbered('sci-fi', 'explosionCrunch_', 5), gain: 0.68, rateMin: 0.5, rateMax: 0.66 },
      { files: numbered('sci-fi', 'lowFrequency_explosion_', 2), gain: 0.5, rateMin: 0.48, rateMax: 0.62 },
      { files: numbered('impact', 'impactMetal_heavy_', 5), gain: 0.28, rateMin: 0.55, rateMax: 0.7, delayMs: 110 },
    ],
  },

  'ambience.title': { bus: 'ambience', files: mix('ambience_drone_dark.mp3', 'ambience_bass_suspense.mp3'), gain: 0.3, loop: true },
  'ambience.command': { bus: 'ambience', files: mix('ambience_high_tech.mp3', 'ambience_engine_hum.mp3'), gain: 0.22, loop: true },
  'ambience.system': { bus: 'ambience', files: [...mix('ambience_engine_hum.mp3'), ...duck('sfx_19a.mp3', 'sfx_19b.mp3')], gain: 0.24, loop: true },
  'ambience.dyson': { bus: 'ambience', files: mix('ambience_bass_suspense.mp3', 'ambience_drone_dark.mp3'), gain: 0.26, rateMin: 0.85, rateMax: 1, loop: true },

  // Flagship drive bed — quiet Kenney low-engine hum; gain/rate nudged by thrust+speed.
  'flagship.engine': {
    bus: 'world',
    files: numbered('sci-fi', 'spaceEngineLow_', 5),
    gain: 0.12,
    rateMin: 0.72,
    rateMax: 0.8,
    loop: true,
  },

  'intro.awakening': {
    bus: 'world', priority: 6, cooldownMs: 700,
    layers: [
      { files: mix('cinematic_electric.mp3'), gain: 0.42, rateMin: 0.7, rateMax: 0.85 },
      { files: mix('weapon_plasma_power.mp3', 'ambience_bass_suspense.mp3'), gain: 0.22, rateMin: 0.65, rateMax: 0.8, delayMs: 80 },
      { files: numbered('sci-fi', 'forceField_', 5), gain: 0.12, rateMin: 0.55, rateMax: 0.7, delayMs: 140 },
    ],
  },
  'intro.ignition': {
    bus: 'world', priority: 6, cooldownMs: 700,
    layers: [
      { files: mix('cinematic_meteor.mp3', 'space_intro.mp3'), gain: 0.48, rateMin: 0.78, rateMax: 0.95 },
      { files: mix('trans_warp_fast.mp3'), gain: 0.26, rateMin: 0.85, rateMax: 1, delayMs: 100 },
      { files: numbered('sci-fi', 'spaceEngineLarge_', 5), gain: 0.16, rateMin: 0.7, rateMax: 0.9, delayMs: 160 },
    ],
  },
  'intro.breach': {
    bus: 'world', priority: 7, cooldownMs: 800,
    layers: [
      { files: mix('cinematic_tunnel.mp3', 'cinematic_whoosh_fast.mp3'), gain: 0.62 },
      { files: mix('cinematic_stutter.mp3', 'trans_warp_slide.mp3'), gain: 0.34, delayMs: 90 },
      { files: mix('space_intro.mp3'), gain: 0.22, rateMin: 0.9, rateMax: 1.1, delayMs: 160 },
    ],
  },
  // Soft bed under awakening/ignition before the tunnel takes over.
  // Keep this on a short file so phase seeks never miss the loop start.
  'intro.bed': {
    bus: 'ambience',
    files: mix('cinematic_tunnel.mp3'),
    gain: 0.18,
    rateMin: 0.55,
    rateMax: 0.65,
    loop: true,
  },
  // Prefer the short tunnel bed so the hyperspace loop starts instantly.
  'intro.translation': { bus: 'ambience', files: mix('cinematic_tunnel.mp3'), gain: 0.4, loop: true },
  'intro.arrival': {
    bus: 'world', priority: 7, cooldownMs: 800,
    layers: [
      { files: mix('cinematic_impact.mp3'), gain: 0.58 },
      { files: mix('trans_passby.mp3', 'trans_warp_slide.mp3'), gain: 0.34, delayMs: 70 },
      { files: mix('cinematic_whoosh_fast.mp3', 'space_intro.mp3'), gain: 0.28, delayMs: 160 },
      { files: numbered('sci-fi', 'forceField_', 5), gain: 0.14, rateMin: 0.7, rateMax: 0.9, delayMs: 210 },
    ],
  },
});

export const AUDIO_PRELOAD_CUES = Object.freeze([
  'ui.select', 'ui.confirm', 'ui.cancel', 'ui.error', 'ui.panel_open',
  'notification.success', 'notification.warning',
  'navigation.warp_depart', 'navigation.warp_arrive',
  'ambience.title', 'intro.awakening', 'intro.ignition', 'intro.breach', 'intro.arrival', 'intro.bed',
  'flagship.engine',
]);
