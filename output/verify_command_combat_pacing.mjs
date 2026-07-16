import { createNewGame } from '../src/js/state.js';
import { createShipInstance } from '../src/js/hull.js';
import { checkBattleTrigger, pooledDpsTickDamage, tickCombat } from '../src/js/combat.js';
import { tickFlagship } from '../src/js/flagship.js';

const state = createNewGame(171719);
const pooledParity = Math.abs(pooledDpsTickDamage(10, 50) - 0.5) < 1e-9;
console.log(`${pooledParity ? 'PASS' : 'FAIL'} pooled large-battle damage preserves displayed DPS`);
const systemId = state.stronghold;
for (const hull of ['cruiser', 'cruiser', 'cruiser', 'battleship', 'battleship']) {
  const ship = createShipInstance(`paced-player-${state.playerShips.length + 1}`, hull, state);
  Object.assign(ship, {
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
  });
  state.playerShips.push(ship);
}
state.pirates = {
  fleets: [{
    id: 'balanced-command-pirates',
    galaxyId: state.activeGalaxyId,
    systemId,
    transit: null,
    wanderCooldownMs: 999999,
    ships: [
      ...Array.from({ length: 4 }, (_, index) => ({
        ...createShipInstance(`paced-enemy-cruiser-${index}`, 'cruiser'),
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        ...createShipInstance(`paced-enemy-battleship-${index}`, 'battleship'),
      })),
    ],
  }],
  pendingRespawn: [],
};

const battle = checkBattleTrigger(state, systemId);
const startedAt = state.time;
while (battle?.active && state.time - startedAt < 130000) {
  state.time += 50;
  tickFlagship(state);
  tickCombat(state);
}
const durationMs = state.time - startedAt;
const result = {
  active: battle?.active === true,
  durationMs,
  winner: battle?.winner ?? null,
  doctrine: battle?.doctrine ?? null,
  remaining: (battle?.units ?? []).filter((unit) => unit.hp > 0 && !unit.escaped).reduce((summary, unit) => {
    const side = unit.side === 'player' ? 'player' : 'enemy';
    summary[side].count += 1;
    summary[side].hp += Math.round(unit.hp);
    summary[side].shield += Math.round(Object.values(unit.shieldFacings ?? unit.shields ?? {})
      .reduce((total, facing) => total + Math.max(0, facing?.value ?? 0), 0));
    return summary;
  }, { player: { count: 0, hp: 0, shield: 0 }, enemy: { count: 0, hp: 0, shield: 0 } }),
  shots: (battle?.fxEvents ?? []).filter((event) => event.kind === 'shot').length,
  shotsFired: battle?.shotsFired ?? 0,
  shotsFiredBySide: battle?.shotsFiredBySide ?? {},
  topShooters: Object.entries(battle?.shotsFiredByActor ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 8),
  units: (battle?.units ?? []).filter((unit) => unit.hp > 0 && !unit.escaped && !unit.isWing).map((unit) => ({
    id: unit.id,
    side: unit.side,
    x: Math.round(unit.x),
    y: Math.round(unit.y),
    target: unit.weaponTargetId ?? null,
  })),
};
const pass = !result.active && durationMs >= 60000 && durationMs <= 120000;
console.log(`${pass ? 'PASS' : 'FAIL'} deterministic balanced engagement resolves in 60–120 seconds - ${JSON.stringify(result)}`);
if (!pass || !pooledParity) process.exit(1);
