// Shared co-op protocol constants (browser + Node host).

export const PROTOCOL_VERSION = 2;

function flagshipPose(f) {
  return {
    pilotId: f.pilotId ?? null,
    callsign: f.callsign ?? f.pilotId ?? null,
    galaxyId: f.galaxyId ?? null,
    systemId: f.systemId ?? null,
    x: f.x ?? 0,
    y: f.y ?? 0,
    heading: f.heading ?? 0,
    vx: f.vx ?? 0,
    vy: f.vy ?? 0,
    hp: f.hp ?? 1,
    maxHp: f.maxHp ?? 1,
    transit: f.transit ?? null,
    wormholeTransit: f.wormholeTransit ?? null,
    orbit: f.orbit ?? null,
  };
}

function combatUnitPose(unit) {
  return {
    id: unit.id,
    side: unit.side ?? 'enemy',
    hull: unit.hull ?? null,
    x: unit.x ?? 0,
    y: unit.y ?? 0,
    heading: unit.heading ?? 0,
    vx: unit.vx ?? 0,
    vy: unit.vy ?? 0,
    hp: unit.hp ?? 0,
    maxHp: unit.maxHp ?? unit.hp ?? 0,
    ...(unit.isWing ? { isWing: true } : {}),
    ...(unit.isStructure ? { isStructure: true } : {}),
    ...(unit.hideSprite ? { hideSprite: true } : {}),
    ...(unit.factionId ? { factionId: unit.factionId } : {}),
  };
}

/**
 * Compact host-authoritative combat poses for active battles.
 * Clients merge these every summary so system-view ships stay live without
 * waiting on rare full-world snapshots.
 */
export function combatSummaryFromState(state) {
  /** @type {Array<{ systemId: string, id: string, active: boolean, mode: string, units: ReturnType<typeof combatUnitPose>[] }>} */
  const combat = [];
  const battles = state?.systemBattles;
  if (!battles || typeof battles !== 'object') return combat;

  for (const [systemId, battle] of Object.entries(battles)) {
    if (!battle?.active) continue;
    const units = Array.isArray(battle.units) ? battle.units : [];
    // Include hp<=0 briefly so clients can despawn; skip empty auto ghosts
    // with no unit list (those aren't drawn in system view anyway).
    if (!units.length && battle.mode !== 'tactical') continue;
    combat.push({
      systemId,
      id: battle.id ?? `battle-${systemId}`,
      active: true,
      mode: battle.mode ?? 'tactical',
      units: units.map(combatUnitPose),
    });
  }
  return combat;
}

/**
 * Fingerprint of active battle identity (start / promote / end), not unit poses.
 * Host uses this to schedule a full snapshot when composition must refresh.
 */
export function battleLifecycleFingerprint(state) {
  const battles = state?.systemBattles;
  if (!battles || typeof battles !== 'object') return '';
  const parts = [];
  for (const [systemId, battle] of Object.entries(battles)) {
    if (!battle?.active) continue;
    parts.push(`${systemId}:${battle.id ?? ''}:${battle.mode ?? ''}`);
  }
  parts.sort();
  return parts.join('|');
}

export const COOP_SYNC_LAG_MS = 250;
/** Default positional error budget (~flagship travel in COOP_SYNC_LAG_MS). */
export const COOP_SYNC_POS_ERR = 85;

/**
 * Merge compact combat summary into local systemBattles.
 * @param {object} state
 * @param {ReturnType<typeof combatSummaryFromState>} combat
 * @param {{ capturePose?: (unit: object) => void }} [opts]
 */
export function applyCombatSummary(state, combat, opts = {}) {
  if (!state) return;
  if (!state.systemBattles || typeof state.systemBattles !== 'object') {
    state.systemBattles = {};
  }
  const list = Array.isArray(combat) ? combat : [];
  const seenSystems = new Set();
  const maxErr = opts.maxErr ?? COOP_SYNC_POS_ERR;

  for (const entry of list) {
    if (!entry?.systemId) continue;
    seenSystems.add(entry.systemId);
    let battle = state.systemBattles[entry.systemId];
    const battleReplaced = battle && entry.id && battle.id && battle.id !== entry.id;
    if (!battle || battleReplaced) {
      battle = {
        id: entry.id ?? `battle-${entry.systemId}`,
        systemId: entry.systemId,
        active: true,
        mode: entry.mode ?? 'tactical',
        units: [],
        tacticalOrders: {},
        orderSequence: 0,
        events: [],
        fxEvents: [],
        objectives: [],
        alertAcknowledged: true,
        startEventEmitted: true,
      };
      state.systemBattles[entry.systemId] = battle;
    } else {
      battle.active = true;
      if (entry.mode) battle.mode = entry.mode;
      if (entry.id) battle.id = entry.id;
      if (!Array.isArray(battle.units)) battle.units = [];
    }

    const byId = new Map(battle.units.map((u) => [String(u.id), u]));
    const nextUnits = [];
    for (const pose of entry.units ?? []) {
      if (!pose?.id) continue;
      const key = String(pose.id);
      let unit = byId.get(key);
      if (!unit) {
        unit = {
          id: pose.id,
          side: pose.side ?? 'enemy',
          hull: pose.hull ?? 'frigate',
          x: pose.x ?? 0,
          y: pose.y ?? 0,
          heading: pose.heading ?? 0,
          vx: pose.vx ?? 0,
          vy: pose.vy ?? 0,
          hp: pose.hp ?? 0,
          maxHp: pose.maxHp ?? pose.hp ?? 1,
        };
        byId.set(key, unit);
      } else if (typeof opts.capturePose === 'function') {
        opts.capturePose(unit);
      }

      if (pose.side != null) unit.side = pose.side;
      if (pose.hull != null) unit.hull = pose.hull;
      if (pose.isWing) unit.isWing = true;
      if (pose.isStructure) unit.isStructure = true;
      if (pose.hideSprite) unit.hideSprite = true;
      if (pose.factionId != null) unit.factionId = pose.factionId;
      if (typeof pose.maxHp === 'number') unit.maxHp = pose.maxHp;
      if (typeof pose.hp === 'number') unit.hp = pose.hp;

      if (typeof pose.x === 'number' && typeof pose.y === 'number') {
        const hasPose = Number.isFinite(unit.x) && Number.isFinite(unit.y);
        const dx = pose.x - (unit.x ?? pose.x);
        const dy = pose.y - (unit.y ?? pose.y);
        const err = Math.hypot(dx, dy);
        if (!hasPose || err > maxErr * 2.5) {
          unit.x = pose.x;
          unit.y = pose.y;
        } else if (err > maxErr) {
          unit.x += dx * 0.9;
          unit.y += dy * 0.9;
        } else {
          // Converge inside the 250ms budget within ~2 pose packets.
          unit.x += dx * 0.55;
          unit.y += dy * 0.55;
        }
      }
      if (typeof pose.heading === 'number') {
        if (Number.isFinite(unit.heading)) {
          let dH = pose.heading - unit.heading;
          while (dH > Math.PI) dH -= 2 * Math.PI;
          while (dH < -Math.PI) dH += 2 * Math.PI;
          unit.heading += dH * 0.5;
        } else {
          unit.heading = pose.heading;
        }
      }
      if (typeof pose.vx === 'number') unit.vx = pose.vx;
      if (typeof pose.vy === 'number') unit.vy = pose.vy;

      nextUnits.push(unit);
    }
    battle.units = nextUnits;
  }

  // End battles the host no longer reports as active.
  for (const [systemId, battle] of Object.entries(state.systemBattles)) {
    if (!battle?.active) continue;
    if (seenSystems.has(systemId)) continue;
    battle.active = false;
    battle.units = [];
  }
}

function compactPlayerShip(ship) {
  return {
    id: ship.id,
    hull: ship.hull ?? 'corvette',
    galaxyId: ship.galaxyId ?? null,
    systemId: ship.systemId ?? null,
    hp: ship.hp ?? 0,
    maxHp: ship.maxHp ?? ship.hp ?? 1,
    transit: ship.transit ?? null,
    anchorBodyId: ship.anchorBodyId ?? null,
    ownerPlayerId: ship.ownerPlayerId ?? null,
    grantedControllers: Array.isArray(ship.grantedControllers) ? [...ship.grantedControllers] : [],
    postBattleReturn: ship.postBattleReturn ?? null,
  };
}

function compactScout(scout) {
  return {
    id: scout.id,
    galaxyId: scout.galaxyId ?? null,
    systemId: scout.systemId ?? null,
    transit: scout.transit ?? null,
    ownerPlayerId: scout.ownerPlayerId ?? null,
    grantedControllers: Array.isArray(scout.grantedControllers) ? [...scout.grantedControllers] : [],
  };
}

function compactPirateFleet(fleet) {
  return {
    id: fleet.id,
    galaxyId: fleet.galaxyId ?? null,
    systemId: fleet.systemId ?? null,
    transit: fleet.transit ?? null,
    ships: (fleet.ships ?? []).map((s) => ({
      id: s.id,
      hull: s.hull ?? 'raider',
      hp: s.hp ?? 0,
      maxHp: s.maxHp ?? s.hp ?? 1,
    })),
  };
}

/**
 * Compact fleet roster for ambient system-view sync. Poses are derived locally
 * from id+time; clients only need the same ships in the same systems.
 */
export function fleetsSummaryFromState(state) {
  return {
    ships: (state.playerShips ?? []).map(compactPlayerShip),
    scouts: (state.scouts ?? []).map(compactScout),
    pirates: (state.pirates?.fleets ?? []).map(compactPirateFleet),
  };
}

/** Roster identity (ids / locations) — host schedules snapshot when this changes. */
export function fleetRosterFingerprint(state) {
  const ships = (state.playerShips ?? [])
    .map((s) => `${s.id}@${s.systemId ?? ''}:${s.hull ?? ''}:${s.transit ? 1 : 0}`)
    .sort()
    .join(',');
  const scouts = (state.scouts ?? [])
    .map((s) => `${s.id}@${s.systemId ?? ''}:${s.transit ? 1 : 0}`)
    .sort()
    .join(',');
  const pirates = (state.pirates?.fleets ?? [])
    .map((f) => {
      const shipPart = (f.ships ?? []).map((s) => `${s.id}:${s.hp ?? 0}`).sort().join('+');
      return `${f.id}@${f.systemId ?? ''}:${f.transit ? 1 : 0}:${shipPart}`;
    })
    .sort()
    .join(',');
  return `${ships}|${scouts}|${pirates}`;
}

/**
 * Merge host fleet roster into local state so ambient system view matches.
 * @param {object} state
 * @param {{ ships?: any[], scouts?: any[], pirates?: any[] } | null} fleets
 */
export function applyFleetsSummary(state, fleets) {
  if (!state || !fleets || typeof fleets !== 'object') return;

  if (Array.isArray(fleets.ships)) {
    if (!Array.isArray(state.playerShips)) state.playerShips = [];
    const byId = new Map(state.playerShips.map((s) => [String(s.id), s]));
    const next = [];
    for (const pose of fleets.ships) {
      if (!pose?.id) continue;
      let ship = byId.get(String(pose.id));
      if (!ship) {
        ship = {
          id: pose.id,
          hull: pose.hull ?? 'corvette',
          galaxyId: pose.galaxyId,
          systemId: pose.systemId,
          hp: pose.hp ?? 1,
          maxHp: pose.maxHp ?? pose.hp ?? 1,
          transit: pose.transit ?? null,
          anchorBodyId: pose.anchorBodyId ?? null,
          ownerPlayerId: pose.ownerPlayerId ?? null,
          grantedControllers: Array.isArray(pose.grantedControllers) ? [...pose.grantedControllers] : [],
          postBattleReturn: pose.postBattleReturn ?? null,
        };
      } else {
        if (pose.hull != null) ship.hull = pose.hull;
        if (pose.galaxyId !== undefined) ship.galaxyId = pose.galaxyId;
        if (pose.systemId !== undefined) ship.systemId = pose.systemId;
        if (typeof pose.hp === 'number') ship.hp = pose.hp;
        if (typeof pose.maxHp === 'number') ship.maxHp = pose.maxHp;
        if ('transit' in pose) ship.transit = pose.transit;
        if ('anchorBodyId' in pose) ship.anchorBodyId = pose.anchorBodyId;
        if ('ownerPlayerId' in pose) ship.ownerPlayerId = pose.ownerPlayerId;
        if ('postBattleReturn' in pose) ship.postBattleReturn = pose.postBattleReturn;
        if (Array.isArray(pose.grantedControllers)) {
          ship.grantedControllers = [...pose.grantedControllers];
        }
      }
      next.push(ship);
    }
    state.playerShips = next;
  }

  if (Array.isArray(fleets.scouts)) {
    if (!Array.isArray(state.scouts)) state.scouts = [];
    const byId = new Map(state.scouts.map((s) => [String(s.id), s]));
    const next = [];
    for (const pose of fleets.scouts) {
      if (!pose?.id) continue;
      let scout = byId.get(String(pose.id));
      if (!scout) {
        scout = {
          id: pose.id,
          galaxyId: pose.galaxyId,
          systemId: pose.systemId,
          transit: pose.transit ?? null,
          ownerPlayerId: pose.ownerPlayerId ?? null,
          grantedControllers: Array.isArray(pose.grantedControllers) ? [...pose.grantedControllers] : [],
        };
      } else {
        if (pose.galaxyId !== undefined) scout.galaxyId = pose.galaxyId;
        if (pose.systemId !== undefined) scout.systemId = pose.systemId;
        if ('transit' in pose) scout.transit = pose.transit;
        if ('ownerPlayerId' in pose) scout.ownerPlayerId = pose.ownerPlayerId;
        if (Array.isArray(pose.grantedControllers)) {
          scout.grantedControllers = [...pose.grantedControllers];
        }
      }
      next.push(scout);
    }
    state.scouts = next;
  }

  if (Array.isArray(fleets.pirates)) {
    if (!state.pirates || typeof state.pirates !== 'object') state.pirates = { fleets: [] };
    if (!Array.isArray(state.pirates.fleets)) state.pirates.fleets = [];
    const byId = new Map(state.pirates.fleets.map((f) => [String(f.id), f]));
    const next = [];
    for (const pose of fleets.pirates) {
      if (!pose?.id) continue;
      let fleet = byId.get(String(pose.id));
      if (!fleet) {
        fleet = {
          id: pose.id,
          galaxyId: pose.galaxyId,
          systemId: pose.systemId,
          transit: pose.transit ?? null,
          ships: [],
        };
      } else {
        if (pose.galaxyId !== undefined) fleet.galaxyId = pose.galaxyId;
        if (pose.systemId !== undefined) fleet.systemId = pose.systemId;
        if ('transit' in pose) fleet.transit = pose.transit;
      }
      const shipById = new Map((fleet.ships ?? []).map((s) => [String(s.id), s]));
      const ships = [];
      for (const sp of pose.ships ?? []) {
        if (!sp?.id) continue;
        let ship = shipById.get(String(sp.id));
        if (!ship) {
          ship = {
            id: sp.id,
            hull: sp.hull ?? 'raider',
            hp: sp.hp ?? 1,
            maxHp: sp.maxHp ?? sp.hp ?? 1,
          };
        } else {
          if (sp.hull != null) ship.hull = sp.hull;
          if (typeof sp.hp === 'number') ship.hp = sp.hp;
          if (typeof sp.maxHp === 'number') ship.maxHp = sp.maxHp;
        }
        ships.push(ship);
      }
      fleet.ships = ships;
      next.push(fleet);
    }
    state.pirates.fleets = next;
  }
}

/** Compact live fields for HUD / pose between rare full world snapshots. */
export function summaryFromState(state, extras = {}) {
  const f = state.flagship ?? {};
  const roster = Array.isArray(state.playerFlagships) && state.playerFlagships.length
    ? state.playerFlagships
    : (state.flagship ? [state.flagship] : []);

  /** @type {Record<string, ReturnType<typeof flagshipPose>>} */
  const flagships = {};
  for (const entry of roster) {
    const key = entry.pilotId ?? 'solo';
    flagships[key] = flagshipPose(entry);
  }

  /** @type {Record<string, any>} */
  const heroes = {};
  for (const hero of state.heroFlagships ?? []) {
    heroes[hero.id] = {
      id: hero.id,
      ownerPlayerId: hero.ownerPlayerId ?? null,
      galaxyId: hero.galaxyId ?? null,
      systemId: hero.systemId ?? null,
      x: hero.x ?? 0,
      y: hero.y ?? 0,
      heading: hero.heading ?? 0,
      hp: hero.hp ?? 1,
      maxHp: hero.maxHp ?? 1,
      transit: hero.transit ?? null,
      rallyStarId: hero.rallyStarId ?? null,
      buildCompleteAt: hero.buildCompleteAt ?? 0,
    };
  }

  return {
    time: state.time ?? 0,
    paused: !!state.paused,
    credits: state.credits ?? 0,
    research: state.research?.points
      ?? state.research?.progress
      ?? state.researchPoints
      ?? 0,
    flagshipSystemId: f.systemId ?? null,
    flagshipInTransit: !!(f.transit || f.wormholeTransit),
    // Legacy single-pose field (primary/local binding) kept for older clients.
    flagship: flagshipPose(f),
    // Per-pilot poses — the core of multi-flagship visual sync.
    flagships,
    heroes,
    // Live construction progress so co-op clients don't wait on rare snapshots.
    builds: extras.builds ?? [],
    // Host-authoritative system combat poses (~10 Hz) so battles don't freeze.
    combat: extras.combat ?? combatSummaryFromState(state),
    // Ambient fleet roster (player / scout / pirate) for system-view parity.
    fleets: extras.fleets ?? fleetsSummaryFromState(state),
    players: extras.players ?? [],
    playersOnline: extras.playersOnline ?? 0,
    tick: extras.tick ?? 0,
    savedAt: extras.savedAt ?? null,
  };
}

export function welcomeMessage({
  playerId,
  displayName,
  reconnectToken,
  passwordRequired,
  summary,
  snapshotJson,
  worldId,
  tick,
  manifest,
}) {
  return {
    type: 'welcome',
    protocolVersion: PROTOCOL_VERSION,
    mode: 'coop',
    playerId,
    displayName: displayName ?? playerId,
    reconnectToken: reconnectToken ?? null,
    passwordRequired,
    summary,
    snapshotJson,
    worldId: worldId ?? null,
    tick: Number(tick) || 0,
    manifest: manifest ?? null,
  };
}
