// Pure unit verification for combat-doctrine.js. No browser required.
import {
  COMBAT_DOCTRINES,
  analyzeFleetMix,
  normalizeDoctrine,
  recommendFormation,
} from '../src/js/combat-doctrine.js';

const results = [];
function check(name, condition, detail = '') {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

check('D1 COMBAT_DOCTRINES length 4 and stable ids',
  COMBAT_DOCTRINES.length === 4
    && COMBAT_DOCTRINES.join('|') === 'assault|screen|carrier_strike|hold_the_line');

check('D2 normalizeDoctrine rejects unknown → assault',
  normalizeDoctrine('blob') === 'assault' && normalizeDoctrine('screen') === 'screen');

check('D3 empty units → mix total 0, dominant mixed', (() => {
  const mix = analyzeFleetMix([]);
  return mix.total === 0 && mix.dominant === 'mixed';
})());

const carrierHeavy = [
  { id: 'c1', hull: 'fleet_carrier', hp: 500, maxHp: 500 },
  { id: 'c2', hull: 'light_carrier', hp: 400, maxHp: 400 },
  { id: 'e1', hull: 'corvette', hp: 100, maxHp: 100 },
  { id: 'e2', hull: 'corvette', hp: 100, maxHp: 100 },
  { id: 'e3', hull: 'corvette', hp: 100, maxHp: 100 },
];
const capitalEnemy = [
  { id: 'b1', hull: 'battleship', hp: 700, maxHp: 700 },
  { id: 'b2', hull: 'cruiser', hp: 500, maxHp: 500 },
  { id: 'b3', hull: 'destroyer', hp: 300, maxHp: 300 },
];
const fighterEnemy = [
  { id: 'f1', hull: 'fighter', hp: 20, maxHp: 20, isWing: true },
  { id: 'f2', hull: 'fighter', hp: 20, maxHp: 20, isWing: true },
  { id: 'f3', hull: 'interceptor', hp: 25, maxHp: 25, isWing: true },
  { id: 'f4', hull: 'corvette', hp: 100, maxHp: 100 },
];

const carrierStrikeCap = recommendFormation({
  doctrine: 'carrier_strike',
  ownMix: analyzeFleetMix(carrierHeavy),
  enemyMix: analyzeFleetMix(capitalEnemy),
});
check('D4 carrier_strike + capital-heavy enemy → column',
  carrierStrikeCap.formation === 'column',
  carrierStrikeCap.reason);

const assaultCap = recommendFormation({
  doctrine: 'assault',
  ownMix: analyzeFleetMix(carrierHeavy),
  enemyMix: analyzeFleetMix(capitalEnemy),
});
check('D5 assault + enemy capital-heavy → line + capital',
  assaultCap.formation === 'line' && assaultCap.targetClass === 'capital',
  `${assaultCap.formation}/${assaultCap.targetClass}`);

const screenFighters = recommendFormation({
  doctrine: 'screen',
  ownMix: analyzeFleetMix(carrierHeavy),
  enemyMix: analyzeFleetMix(fighterEnemy),
});
check('D6 screen + enemy fighter-heavy → screen + fighter',
  screenFighters.formation === 'screen' && screenFighters.targetClass === 'fighter',
  `${screenFighters.formation}/${screenFighters.targetClass}`);

const holdLine = recommendFormation({
  doctrine: 'hold_the_line',
  ownMix: analyzeFleetMix(carrierHeavy),
  enemyMix: analyzeFleetMix(capitalEnemy),
});
const holdSphere = recommendFormation({
  doctrine: 'hold_the_line',
  ownMix: analyzeFleetMix(carrierHeavy),
  enemyMix: analyzeFleetMix(fighterEnemy),
});
check('D7 hold_the_line → line or sphere, targetClass null',
  holdLine.formation === 'line' && holdLine.targetClass == null
    && holdSphere.formation === 'sphere' && holdSphere.targetClass == null,
  `${holdLine.formation}/${holdSphere.formation}`);

const shuffled = [...carrierHeavy].reverse();
const a = recommendFormation({
  doctrine: 'assault',
  ownMix: analyzeFleetMix(carrierHeavy),
  enemyMix: analyzeFleetMix(capitalEnemy),
});
const b = recommendFormation({
  doctrine: 'assault',
  ownMix: analyzeFleetMix(shuffled),
  enemyMix: analyzeFleetMix([...capitalEnemy].reverse()),
});
check('D8 recommendation is order-independent',
  a.formation === b.formation && a.targetClass === b.targetClass && a.reason === b.reason);

const again = recommendFormation({
  doctrine: 'assault',
  ownMix: analyzeFleetMix(carrierHeavy),
  enemyMix: analyzeFleetMix(capitalEnemy),
});
check('D9 recommendation is bit-stable across two calls',
  JSON.stringify(a) === JSON.stringify(again));

const failed = results.filter((result) => !result.pass);
console.log(`\nCombat doctrine unit: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`Failed: ${failed.map((result) => result.name).join(', ')}`);
  process.exit(1);
}
