// Presentation-only bridge from semantic game/FX state into logical audio cues.

import { flagshipEngineStatus } from './flagship.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function viewedSystem(state, systemId) {
  return state?.galaxies?.[state.activeGalaxyId]?.systems?.[systemId] ?? null;
}

function fxKey(event) {
  return `${event.kind}:${event.t}:${event.profile ?? ''}:${event.attackerId ?? ''}:${event.targetId ?? ''}`;
}

export function createAudioDirector(engine) {
  let lastPhase = null;
  let lastView = null;
  let lastIntroPhase = null;
  let lastSequenceKey = null;
  let lastSequencePhase = null;
  let primedBattle = null;
  let lastFlagshipSystemId = undefined;
  let lastFlagshipTraveling = false;
  const seenFx = new Set();
  let nextCrackleAt = 0;
  let nextHeartbeatAt = 0;
  let nextTelemetryAt = 0;

  const play = (cueId, opts) => engine.playCue(cueId, opts);

  const processTickEvents = (events = {}) => {
    for (const event of events.prodReady ?? []) play('notification.success');
    for (const event of events.scoutArrivals ?? []) play('navigation.fleet_arrival');
    for (const event of events.shipArrivals ?? []) play('navigation.fleet_arrival');
    for (const event of events.pirateArrivals ?? []) play('notification.warning');
    for (const event of events.pirateInterdictions ?? []) play('notification.warning');
    for (const event of events.battleEvents ?? []) {
      if (event.type === 'battle_started') play('notification.warning');
      else play(event.playerWins ? 'notification.success' : 'ui.error');
    }
    for (const event of events.builderDroneEvents ?? []) {
      play(event.type === 'builder_drone_build_failed' ? 'ui.error' : 'notification.success');
    }
    for (const event of events.logisticsEvents ?? []) {
      if (event.ownerId && event.ownerId !== 'player') continue;
      // Credit deliveries used to fire a ringing success chime on every convoy.
      // Keep audio only for threat / failure beats; income stays silent.
      if (event.type === 'convoy_intercepted') play('notification.warning');
      else if (event.type === 'convoy_destroyed' || event.type === 'route_blocked') play('ui.error');
    }
    for (const event of events.diplomacyEvents ?? []) {
      play(event.type?.includes('rejected') || event.type?.includes('refused') ? 'notification.warning' : 'notification.info');
    }
    for (const event of events.captures ?? []) if (event?.captured) play('notification.success');
    for (const event of events.dysonEvents ?? []) {
      if (event.launched) play('dyson.launcher');
      if (event.shellCompleted) play('dyson.shell_complete', { force: true });
    }
    for (const event of events.droneCompletions ?? []) play('notification.success');
    for (const event of events.campaignEvents ?? []) play(event.type === 'victory' ? 'notification.success' : 'notification.warning');
    // Wormhole arrival SFX is owned by syncFlagshipTravel (depart uses navigation.wormhole).
  };

  const processCombat = (state, systemId, cameraX = 0) => {
    const battle = state?.systemBattles?.[systemId];
    if (!battle || !Array.isArray(battle.fxEvents)) {
      primedBattle = null;
      seenFx.clear();
      return;
    }
    if (battle !== primedBattle) {
      primedBattle = battle;
      seenFx.clear();
      for (const event of battle.fxEvents) seenFx.add(fxKey(event));
      return;
    }
    for (const event of battle.fxEvents) {
      const key = fxKey(event);
      if (seenFx.has(key)) continue;
      seenFx.add(key);
      const pan = clamp(((event.tx ?? event.ax ?? cameraX) - cameraX) / 1200, -0.9, 0.9);
      if (event.kind === 'kill') {
        play(event.roleKill === 'capital' ? 'combat.capital_kill' : 'combat.small_kill', { pan });
      } else if (event.kind === 'heavy_impact') {
        play(event.profile === 'torpedo' ? 'combat.torpedo_impact' : 'combat.hull_hit', { pan });
      } else if (event.kind === 'wing_launch' || event.kind === 'wing_flyby') {
        play('combat.fighter_launch', { pan });
      } else if (event.kind === 'jump_in') {
        play('navigation.warp_arrive', { pan });
      } else if (event.kind === 'withdrawal') {
        play('navigation.warp_depart', { pan });
      } else if (event.kind === 'shot') {
        const cue = event.profile === 'point_defense' ? 'combat.point_defense'
          : event.profile === 'torpedo' ? 'combat.torpedo_launch'
            : event.profile === 'beam_lance' ? 'combat.beam_lance'
              : event.profile === 'ion' ? 'combat.ion'
                : 'combat.kinetic';
        play(cue, { pan });
        if ((event.shieldAbsorbed ?? 0) > 0) play('combat.shield_hit', { pan });
        else if ((event.hullDamage ?? 0) > 0) play('combat.hull_hit', { pan });
      }
    }
    if (seenFx.size > 360) {
      const keep = [...seenFx].slice(-240);
      seenFx.clear();
      for (const key of keep) seenFx.add(key);
    }
  };

  const processSuperweapon = (state) => {
    const sequence = state?.superweapon?.fireSequence;
    if (!sequence) {
      lastSequenceKey = null;
      lastSequencePhase = null;
      return;
    }
    const key = `${sequence.type}:${sequence.startedAt}`;
    if (key !== lastSequenceKey) {
      lastSequenceKey = key;
      lastSequencePhase = sequence.phase ?? 'charge';
      play(sequence.type === 'jump' ? 'navigation.wormhole' : 'helioclast.charge', { force: true });
      return;
    }
    const phase = sequence.phase ?? 'charge';
    if (phase === lastSequencePhase) return;
    lastSequencePhase = phase;
    if (phase === 'aim') play('helioclast.target_lock', { force: true });
    if (phase === 'fire') play(sequence.type === 'jump' ? 'navigation.warp_depart' : 'helioclast.fire', { force: true });
    if (phase === 'impact') play(sequence.type === 'jump' ? 'navigation.warp_arrive' : 'helioclast.impact', { force: true });
  };

  const syncIntro = (intro) => {
    if (!intro?.active || !intro.phase) {
      if (lastIntroPhase != null) {
        engine.stopLoop('intro');
        lastIntroPhase = null;
      }
      return;
    }
    if (!engine.isUnlocked()) return;
    if (intro.phase === lastIntroPhase) {
      if (intro.phase === 'awakening' || intro.phase === 'ignition') {
        engine.startLoop('intro', 'intro.bed', {
          gain: intro.phase === 'ignition' ? 0.7 : 0.5,
        });
      } else if (intro.phase === 'breach' || intro.phase === 'translation') {
        engine.startLoop('intro', 'intro.translation', {
          gain: intro.phase === 'translation' ? 1 : 0.72,
        });
      }
      return;
    }
    lastIntroPhase = intro.phase;
    if (intro.phase === 'awakening') {
      engine.startLoop('intro', 'intro.bed', { gain: 0.5, fadeSeconds: 0.55 });
      play('intro.awakening', { force: true });
      return;
    }
    if (intro.phase === 'ignition') {
      play('intro.ignition', { force: true });
      engine.startLoop('intro', 'intro.bed', { gain: 0.7, fadeSeconds: 0.3 });
      return;
    }
    if (intro.phase === 'breach') {
      play('intro.breach', { force: true });
      engine.startLoop('intro', 'intro.translation', { gain: 0.72, fadeSeconds: 0.28 });
      return;
    }
    if (intro.phase === 'translation') {
      play('intro.breach', { force: true, gain: 0.45 });
      engine.startLoop('intro', 'intro.translation', { gain: 1, fadeSeconds: 0.22 });
      return;
    }
    if (intro.phase === 'arrival') {
      engine.stopLoop('intro');
      play('intro.arrival', { force: true });
    }
  };

  const syncFlagshipTravel = (state, phase, cinematic) => {
    if (cinematic || phase !== 'playing' || !state?.flagship) {
      if (state?.flagship) {
        lastFlagshipSystemId = state.flagship.systemId;
        lastFlagshipTraveling = !!(state.flagship.transit || state.flagship.wormholeTransit);
      }
      return;
    }
    if (!engine.isUnlocked()) return;
    const f = state.flagship;
    const traveling = !!(f.transit || f.wormholeTransit);
    const systemId = f.systemId ?? null;

    // Prime only while idle so a travel that starts before the first observe
    // still gets a depart edge (new-game → immediate course-set).
    if (lastFlagshipSystemId === undefined) {
      if (!traveling) {
        lastFlagshipSystemId = systemId;
        lastFlagshipTraveling = false;
        return;
      }
      lastFlagshipSystemId = systemId;
      lastFlagshipTraveling = false;
    }

    if (traveling && !lastFlagshipTraveling) {
      play(f.wormholeTransit ? 'navigation.wormhole' : 'navigation.warp_depart', { force: true });
    } else if (!traveling && lastFlagshipTraveling && systemId) {
      play('navigation.warp_arrive', { force: true });
    } else if (!traveling && systemId && systemId !== lastFlagshipSystemId) {
      // Arrived between frames without catching the transit edge.
      play('navigation.warp_arrive', { force: true });
    }

    lastFlagshipSystemId = systemId;
    lastFlagshipTraveling = traveling;
  };

  const syncFlagshipEngine = ({ state, view, viewedSystemId, phase, cinematic }) => {
    if (!engine.isUnlocked() || cinematic || phase !== 'playing' || view !== 'system') {
      engine.stopLoop('flagship');
      return;
    }
    const f = state?.flagship;
    if (!f || f.systemId !== viewedSystemId) {
      engine.stopLoop('flagship');
      return;
    }
    const status = flagshipEngineStatus(state);
    if (!status.audible) {
      engine.stopLoop('flagship');
      return;
    }
    // Soft idle hum in-system; thrust/speed only nudges gain + pitch slightly.
    const intensity = status.intensity;
    const pausedMul = state?.paused ? 0.12 : 1;
    const gain = (0.35 + intensity * 0.4) * pausedMul;
    const rate = 0.74 + intensity * 0.14;
    engine.startLoop('flagship', 'flagship.engine', {
      gain,
      rate,
      fadeSeconds: 0.18,
    });
  };

  const syncAmbience = ({ state, view, viewedSystemId, phase, cinematic, now }) => {
    if (!engine.isUnlocked()) return;
    if (cinematic) {
      engine.stopLoop('primary');
      return;
    }
    engine.stopLoop('intro');
    const system = viewedSystem(state, viewedSystemId);
    const shells = system?.dyson?.completedShells ?? 0;
    const pausedGain = state?.paused ? 0.32 : 1;
    const cueId = phase === 'title'
      ? 'ambience.title'
      : view === 'galaxy'
        ? 'ambience.command'
        : shells > 0 ? 'ambience.dyson' : 'ambience.system';
    const tierGain = cueId === 'ambience.dyson' ? 0.7 + Math.min(8, shells) * 0.055 : 1;
    engine.startLoop('primary', cueId, { gain: pausedGain * tierGain });
    if (phase === 'playing' && view === 'system' && !state?.paused && now >= nextTelemetryAt) {
      play('ambience.system_telemetry', { gain: 0.55 + Math.random() * 0.35, pan: (Math.random() - 0.5) * 0.7 });
      nextTelemetryAt = now + 4200 + Math.random() * 5200;
    }
    if (phase !== 'playing' || view !== 'system' || state?.paused || shells < 3) return;
    if (now >= nextCrackleAt) {
      play('dyson.crackle', { gain: 0.55 + shells * 0.03, pan: Math.sin(now * 0.013) * 0.55 });
      nextCrackleAt = now + 2200 + Math.random() * 2800;
    }
    if (shells >= 5 && now >= nextHeartbeatAt) {
      play('dyson.heartbeat', { gain: 0.5 + shells * 0.03 });
      nextHeartbeatAt = now + 5200 + Math.random() * 2400;
    }
  };

  return {
    syncFrame({
      state,
      view,
      viewedSystemId,
      phase,
      tickEvents = null,
      intro = null,
      now = performance.now(),
      cameraX = 0,
    }) {
      // Prefer the live cinematic clock: boot phase can briefly desync around
      // campaign start (import sets playing, then warpIntro begins).
      const cinematic = phase === 'warpIntro' || intro?.active === true;
      const audioPhase = cinematic ? 'warpIntro' : phase;

      if (lastPhase != null && audioPhase !== lastPhase) {
        if (audioPhase === 'warpIntro') {
          engine.stopLoop('primary');
          engine.stopLoop('flagship');
          // Do not stamp lastIntroPhase here — syncIntro owns phase cues so
          // seek/skip and late first frames still fire the correct beat.
        }
        if (lastPhase === 'warpIntro' && audioPhase === 'playing') {
          engine.stopLoop('intro');
          // Arrival usually already fired from the cinematic phase clock; only
          // cover the skip-to-end path that jumps straight into gameplay.
          if (lastIntroPhase !== 'arrival') play('intro.arrival', { force: true });
          lastIntroPhase = null;
        }
        if (audioPhase === 'title') lastIntroPhase = null;
      }
      if (lastView != null && view !== lastView && audioPhase === 'playing') play('navigation.view');
      lastPhase = audioPhase;
      lastView = view;
      if (tickEvents) processTickEvents(tickEvents);
      if (audioPhase === 'playing') {
        processCombat(state, viewedSystemId, cameraX);
        processSuperweapon(state);
      }
      if (cinematic) syncIntro(intro);
      else if (lastIntroPhase != null) {
        engine.stopLoop('intro');
        lastIntroPhase = null;
      }
      syncAmbience({ state, view, viewedSystemId, phase: audioPhase, cinematic, now });
      syncFlagshipEngine({ state, view, viewedSystemId, phase: audioPhase, cinematic });
      syncFlagshipTravel(state, audioPhase, cinematic);
    },

    reset() {
      lastPhase = null;
      lastView = null;
      lastSequenceKey = null;
      lastSequencePhase = null;
      lastIntroPhase = null;
      lastFlagshipSystemId = undefined;
      lastFlagshipTraveling = false;
      primedBattle = null;
      seenFx.clear();
      nextCrackleAt = 0;
      nextHeartbeatAt = 0;
      nextTelemetryAt = 0;
      engine.stopLoop('intro');
      engine.stopLoop('primary');
      engine.stopLoop('flagship');
    },
  };
}
