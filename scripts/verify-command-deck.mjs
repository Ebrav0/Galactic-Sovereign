#!/usr/bin/env node
/**
 * Adaptive Command Deck — unit + ID freeze + layout constant checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DECK_CONTEXTS,
  DECK_LAYOUT,
  DECK_PRIMARY_ACTIONS,
  applyDeckChrome,
  deckContextLabel,
  primaryActionsForContext,
  resolveDeckContext,
} from '../src/js/command-deck.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/fixtures/command-deck-ids.json'), 'utf8'),
);
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const htmlIdSet = new Set(htmlIds);

assert.equal(fixture.duplicateHtmlIds.length, 0, 'fixture reports no duplicate HTML IDs');

for (const id of fixture.staticCriticalIds || fixture.criticalIds) {
  const count = htmlIds.filter((x) => x === id).length;
  assert.equal(count, 1, `critical ID must exist exactly once: ${id} (found ${count})`);
}

for (const id of fixture.dynamicIds || []) {
  assert.equal(htmlIds.filter((x) => x === id).length, 0,
    `dynamic ID ${id} should not be duplicated in static HTML`);
}

for (const id of fixture.tutorialUiTargetIds) {
  assert.ok(
    htmlIdSet.has(id) || (fixture.dynamicIds || []).includes(id) || id === 'game-canvas',
    `tutorial uiTargetId missing: ${id}`,
  );
}
for (const id of fixture.coopTutorialUiTargetIds) {
  assert.ok(
    htmlIdSet.has(id) || (fixture.dynamicIds || []).includes(id) || id === 'game-canvas',
    `coop uiTargetId missing: ${id}`,
  );
}
for (const id of fixture.fieldManualTargetIds) {
  assert.ok(htmlIdSet.has(id), `field-manual targetId missing: ${id}`);
}

assert.equal(resolveDeckContext({ combatActive: true }), DECK_CONTEXTS.combat);
assert.equal(resolveDeckContext({ sidePanel: 'tech' }), DECK_CONTEXTS.activity);
assert.equal(resolveDeckContext({ sidePanel: 'diplomacy' }), DECK_CONTEXTS.activity);
assert.equal(resolveDeckContext({ selectedScoutId: 's1' }), DECK_CONTEXTS.scoutDroneConvoy);
assert.equal(resolveDeckContext({ selectedBuilderDroneId: 'd1' }), DECK_CONTEXTS.scoutDroneConvoy);
assert.equal(resolveDeckContext({ selectedBattleGroupId: 'bg1' }), DECK_CONTEXTS.fleet);
assert.equal(
  resolveDeckContext({ view: 'system', selection: 'planet-1' }),
  DECK_CONTEXTS.body,
);
assert.equal(
  resolveDeckContext({ view: 'system', selection: 'star' }),
  DECK_CONTEXTS.systemMap,
);
assert.equal(resolveDeckContext({ view: 'galaxy', selection: null }), DECK_CONTEXTS.systemMap);
assert.equal(resolveDeckContext({}), DECK_CONTEXTS.systemMap);

for (const [context, actions] of Object.entries(DECK_PRIMARY_ACTIONS)) {
  assert.ok(actions.length <= DECK_LAYOUT.maxPrimaryActions,
    `${context} has ${actions.length} primaries (max ${DECK_LAYOUT.maxPrimaryActions})`);
  assert.deepEqual(primaryActionsForContext(context), actions);
}

assert.match(deckContextLabel(DECK_CONTEXTS.combat), /Combat/);

const hud = {
  dataset: {},
  classList: {
    _c: new Set(),
    toggle(name, on) {
      if (on) this._c.add(name);
      else this._c.delete(name);
    },
  },
  querySelector(sel) {
    if (sel === '#deck-breadcrumb') return { textContent: '' };
    if (sel === '#command-mode') return { textContent: '' };
    return null;
  },
};
applyDeckChrome(hud, DECK_CONTEXTS.body, { view: 'system', systemName: 'Sol' });
assert.equal(hud.dataset.deckContext, DECK_CONTEXTS.body);

assert.ok(DECK_LAYOUT.wide.activityRail[0] >= 150);
assert.ok(DECK_LAYOUT.wide.activityRail[1] <= 170);
assert.ok(DECK_LAYOUT.wide.inspector[0] >= 280);
assert.ok(DECK_LAYOUT.wide.inspector[1] <= 320);
assert.equal(DECK_LAYOUT.compact.canvasHeightCollapsedMinRatio, 0.64);

// Shell markers expected after migration
assert.match(html, /id="activity-rail"/, 'activity-rail region required');
assert.match(html, /id="context-inspector"/, 'context-inspector region required');
assert.match(html, /id="action-deck"/, 'action-deck region required');
assert.match(html, /id="deck-breadcrumb"/, 'deck-breadcrumb required');
assert.match(html, /hud--command-deck|command-deck/, 'command deck shell class/marker required');

console.log('verify:command-deck passed', {
  staticCriticalIds: (fixture.staticCriticalIds || fixture.criticalIds).length,
  dynamicIds: (fixture.dynamicIds || []).length,
  contexts: Object.keys(DECK_CONTEXTS).length,
});
