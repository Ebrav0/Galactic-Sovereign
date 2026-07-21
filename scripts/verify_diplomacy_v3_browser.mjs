import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const outputDir = new URL('../output/diplomacy-v3-browser/', import.meta.url);
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(7000);
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => consoleErrors.push(`page: ${error.message}`));

try {
  await page.goto(process.env.GS_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__newGame === 'function');
  const setup = await page.evaluate(() => {
    window.__newGame(913, { mode: 'sandbox', aiDifficulty: 'normal' });
    const state = window.getGameState();
    state.paused = false;
    state.credits = 10000;
    state.solarii = 100;
    state.milestones.diplomacyUnlocked = true;
    for (const tech of [
      'dip_truce_protocol', 'dip_trade_charter', 'dip_embassy_network', 'dip_embassy_complex',
      'dip_alliance_pact', 'dip_hegemony_doctrine', 'dip_galactic_council',
    ]) if (!state.research.unlocked.includes(tech)) state.research.unlocked.push(tech);
    document.getElementById('title-screen')?.classList.add('hidden');
    window.__setBootPhase?.('playing');
    const faction = state.factions.list[0];
    window.__establishContact(faction.id, { stage: 'detected', force: true, trigger: 'exploration' });
    window.__establishContact(faction.id, { stage: 'contacted', trigger: 'player_command' });
    return { factionId: faction.id, factionName: faction.name, factions: state.factions.list.length };
  });
  assert.equal(setup.factions, 4);
  console.log('browser stage: contact');

  await page.click('#tab-diplomacy');
  await page.waitForSelector('#diplomacy-command-screen');
  assert.deepEqual(await page.locator('.diplomacy-view-tabs button').allTextContents(),
    ['Overview', 'Relations', 'Negotiation', 'Conflicts', 'Council', 'History']);

  await page.click('#diplomacy-view-negotiation');
  for (const selector of [
    '#diplomacy-offer-credits', '#diplomacy-offer-solarii', '#diplomacy-offer-reparations',
    '#diplomacy-offer-tribute', '#diplomacy-offer-system', '#diplomacy-offer-claim',
    '#diplomacy-offer-favor', '#diplomacy-offer-war', '#diplomacy-demand-credits',
    '#diplomacy-demand-solarii', '#diplomacy-demand-reparations', '#diplomacy-demand-tribute',
    '#diplomacy-demand-system', '#diplomacy-demand-claim', '#diplomacy-demand-favor',
    '#diplomacy-demand-helioclast', '#diplomacy-demand-war', '#diplomacy-demand-sanction-target',
  ]) assert.equal(await page.locator(selector).count(), 1, `advanced builder exposes ${selector}`);
  await page.click('#diplomacy-proposal-trade');
  await page.waitForFunction((factionId) => window.__diplomacySummary().agreements
    .some((entry) => entry.status === 'active' && entry.type === 'trade' && entry.parties.includes(factionId)), setup.factionId);
  const tradeBenefit = await page.evaluate((factionId) => window.__settleDiplomaticTradeDelivery({
    from: 'player', to: factionId, baseValue: 100,
  }), setup.factionId);
  assert.equal(tradeBenefit.value, 120);
  assert.equal(tradeBenefit.partnerShare, 10);
  console.log('browser stage: trade');

  const counterPreview = await page.evaluate((factionId) => {
    const state = window.getGameState();
    const relation = state.diplomacy.pairRelations[[factionId, 'player'].sort().join('|')];
    let preview = null;
    for (const value of [-20, -30, -40, -50, -60, -70, -80, -90, -100]) {
      relation.baseMetrics = { opinion: value, trust: value, fear: 0, respect: 0 };
      preview = window.__previewDiplomaticProposal({ from: 'player', to: factionId,
        terms: [{ type: 'agreement', agreementType: 'open_borders' }] });
      if (preview.counterable) break;
    }
    state.diplomacy.revision += 1;
    return { score: preview.score, threshold: preview.threshold, counterable: preview.counterable };
  }, setup.factionId);
  console.log('counter preview', counterPreview);
  assert.equal(counterPreview.counterable, true);
  await page.waitForTimeout(100);
  await page.click('#diplomacy-proposal-open_borders');
  await page.waitForFunction(() => window.__diplomacySummary().proposals.some((entry) => entry.status === 'countered'));
  const counterId = await page.evaluate(() => window.__diplomacySummary().proposals
    .find((entry) => entry.status === 'pending' && entry.to === 'player')?.id ?? null);
  assert.ok(counterId, 'near-threshold proposal generates a counteroffer');
  await page.evaluate((proposalId) => window.__respondToDiplomaticProposal(proposalId, 'reject', { actor: 'player' }), counterId);
  console.log('browser stage: counteroffer');

  await page.click('#diplomacy-view-negotiation');
  await page.fill('#diplomacy-offer-credits', '1500');
  await page.fill('#diplomacy-offer-reparations', '100');
  await page.fill('#diplomacy-offer-tribute', '10');
  await page.click('#diplomacy-offer-claim');
  await page.click('#diplomacy-clause-open_borders');
  await page.click('#diplomacy-deal-preview');
  assert.match(await page.locator('#diplomacy-deal-forecast').innerText(), /Acceptance/);
  await page.click('#diplomacy-deal-submit');
  await page.waitForFunction((factionId) => window.__diplomacySummary().agreements
    .some((entry) => entry.status === 'active' && entry.type === 'open_borders' && entry.parties.includes(factionId)), setup.factionId);
  assert.ok(await page.evaluate((factionId) => {
    const state = window.getGameState();
    return state.diplomacy.agreements.some((entry) => entry.status === 'active' && entry.type === 'tribute'
      && entry.terms.payer === 'player' && entry.terms.payee === factionId)
      && state.diplomacy.claims.some((entry) => entry.status === 'active' && entry.claimant === factionId);
  }, setup.factionId), 'combined deal applies reparations, tribute, claim recognition, and treaty clauses atomically');
  await page.screenshot({ path: fileURLToPath(new URL('negotiation.png', outputDir)), fullPage: true });
  console.log('browser stage: advanced deal');

  const breach = await page.evaluate((factionId) => {
    const state = window.getGameState();
    const agreement = state.diplomacy.agreements.find((entry) => entry.status === 'active'
      && entry.type === 'open_borders' && entry.parties.includes(factionId));
    return window.__endDiplomaticAgreement(agreement.id, { reason: 'browser_verification', breachedBy: 'player' });
  }, setup.factionId);
  assert.equal(breach.ok, true);
  assert.ok(await page.evaluate((factionId) => window.getGameState().diplomacy.grievances
    .some((entry) => entry.status === 'active' && entry.aggrieved === factionId && entry.against === 'player'), setup.factionId));
  console.log('browser stage: breach');

  const warId = await page.evaluate((factionId) => {
    const state = window.getGameState();
    const target = state.factions.list.find((entry) => entry.id === factionId).homeSystemId;
    window.__createClaim({ claimant: 'player', target: factionId, systemId: target,
      galaxyId: state.activeGalaxyId, source: 'browser_verification' });
    return window.__declareWar({ attacker: 'player', defender: factionId,
      goals: [{ type: 'claimed_conquest', systemIds: [target] }] }).war.id;
  }, setup.factionId);
  await page.click('#diplomacy-view-conflicts');
  await page.waitForSelector('#diplomacy-white-peace');
  await page.evaluate(({ warId, factionId }) => {
    const war = window.getGameState().diplomacy.wars.find((entry) => entry.id === warId);
    war.score = 50;
    war.exhaustion[factionId] = 100;
  }, { warId, factionId: setup.factionId });
  await page.click('#diplomacy-white-peace');
  await page.waitForFunction((warId) => window.getGameState().diplomacy.wars.find((entry) => entry.id === warId)?.status === 'ended', warId);
  console.log('browser stage: war and peace');

  await page.click('#diplomacy-view-council');
  await page.selectOption('#diplomacy-council-resolution-type', 'sanction');
  await page.click('#diplomacy-council-sanction');
  const resolutionId = await page.evaluate(() => window.__diplomacySummary().council.resolutions
    .find((entry) => entry.status === 'voting')?.id ?? null);
  assert.ok(resolutionId);
  const council = await page.evaluate((resolutionId) => {
    const state = window.getGameState();
    for (const voterId of ['player', ...state.factions.list.map((entry) => entry.id)]) {
      window.__castCouncilVote(resolutionId, voterId, 'yes');
    }
    return window.__resolveCouncilResolution(resolutionId, { force: true });
  }, resolutionId);
  assert.equal(council.resolution.passed, true);
  console.log('browser stage: council');
  await page.screenshot({ path: fileURLToPath(new URL('council.png', outputDir)), fullPage: true });

  const textState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal(textState.saveVersion, 25);
  assert.equal(Object.hasOwn(textState.diplomacy, 'history'), false, 'text state exposes actionable diplomacy, not full history');
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
  fs.writeFileSync(new URL('e2e-result.json', outputDir), JSON.stringify({ setup, tradeBenefit, textState: textState.diplomacy, consoleErrors }, null, 2));
  console.log('Diplomacy v3 browser verification passed', {
    faction: setup.factionName,
    counteroffer: counterId,
    war: warId,
    council: resolutionId,
    consoleErrors: consoleErrors.length,
  });
} finally {
  await browser.close();
}
