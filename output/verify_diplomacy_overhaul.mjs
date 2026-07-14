// Focused, browser-free verification for the diplomacy overhaul core.

import {
  AGREEMENT_OPEN_BORDERS,
  AGREEMENT_TRADE,
  CONTACT_ESTABLISHED,
  PROPOSAL_ACCEPTED,
  PROPOSAL_COUNTERED,
  addRelationshipModifier,
  applyProposalTermsAtomic,
  canAttackSystem,
  canRouteThroughSystem,
  castCouncilVote,
  concludePeace,
  createAgreement,
  createClaim,
  declareWar,
  diplomacySummary,
  ensureDiplomacy,
  establishContact,
  getActiveWar,
  getContact,
  getRelationshipBreakdown,
  isAtWar,
  isSanctioned,
  offerTreaty,
  previewProposal,
  proposeCouncilResolution,
  recordOccupation,
  recordWarEvent,
  resolveCouncilResolution,
  respondToProposal,
  routeLegality,
  submitProposal,
  tickDiplomacy,
  triggerSuperweaponPanic,
} from '../src/js/diplomacy.js';

const results = [];
function check(name, condition, detail = '') {
  const pass = !!condition;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

function system(id, owner, factionId = null, shells = 0) {
  return {
    id,
    name: id,
    owner,
    factionId,
    bodies: [{ id: `${id}-world`, type: 'habitable', moons: [] }],
    structures: [],
    dyson: { completedShells: shells },
  };
}

function makeState() {
  const state = {
    time: 100000,
    paused: false,
    activeGalaxyId: 'gal-0',
    credits: 10000,
    solarii: 100,
    solariiUnlocked: true,
    flagship: { hp: 2000 },
    playerShips: [{ id: 'p-1', hp: 300 }],
    heroFlagships: [],
    aiShips: [
      { id: 'a-1', factionId: 'ai-0', hp: 400 },
      { id: 'a-2', factionId: 'ai-1', hp: 250 },
    ],
    research: {
      activeNodeId: null,
      progress: 0,
      unlocked: [
        'eco_baseline',
        'dip_truce_protocol',
        'dip_trade_charter',
        'dip_alliance_pact',
        'dip_embassy_network',
        'dip_galactic_council',
      ],
      queue: [],
    },
    factions: {
      list: [
        { id: 'ai-0', name: 'Helix', personality: 'expansionist', credits: 4000, solarii: 20 },
        { id: 'ai-1', name: 'Veridian', personality: 'economic', credits: 6000, solarii: 25 },
      ],
    },
    systems: {
      home: system('home', 'player', null, 8),
      helix: system('helix', 'ai', 'ai-0'),
      market: system('market', 'ai', 'ai-1'),
      wild: system('wild', 'neutral'),
    },
    milestones: {
      completedDysonSystems: [],
      diplomacyUnlocked: false,
      superweaponUnlocked: false,
    },
    diplomacy: { relations: {} },
  };
  state.factions.ai = state.factions.list[0];
  return state;
}

// Legacy relation migration and safe collection backfill.
{
  const state = makeState();
  state.diplomacy = {
    relations: {
      'ai-0': { status: 'war', treaties: [], lastChangedAt: 500 },
      'ai-1': { status: 'trade', treaties: ['trade'], lastChangedAt: 600 },
    },
  };
  const diplomacy = ensureDiplomacy(state);
  const warsReference = diplomacy.wars;
  ensureDiplomacy(state);
  check('legacy diplomacy state backfills every collection',
    diplomacy.schemaVersion === 2
      && diplomacy.version === 2
      && Array.isArray(diplomacy.proposals)
      && Array.isArray(diplomacy.agreements)
      && Array.isArray(diplomacy.wars)
      && Array.isArray(diplomacy.history));
  check('repeated diplomacy normalization preserves collection identity', ensureDiplomacy(state).wars === warsReference);
  check('legacy war relation migrates to formal war', isAtWar(state, 'ai-0'));
  check('legacy explicit relations migrate as established contacts',
    getContact(state, 'ai-0').stage === CONTACT_ESTABLISHED && getContact(state, 'ai-1').stage === CONTACT_ESTABLISHED);
  check('legacy trade relation migrates to active agreement',
    diplomacy.agreements.some((agreement) => agreement.type === AGREEMENT_TRADE && agreement.status === 'active'));
}

// Contact stages and exact relationship ledger arithmetic.
{
  const state = makeState();
  ensureDiplomacy(state);
  check('newly backfilled contact starts unknown', getContact(state, 'ai-0').stage === 'unknown');
  const contact = establishContact(state, 'ai-0', { stage: CONTACT_ESTABLISHED, trigger: 'fleet_encounter' });
  check('first contact reaches established stage', contact.ok && contact.stage === CONTACT_ESTABLISHED);
  addRelationshipModifier(state, 'ai-0', {
    source: 'gift', label: 'Test gift', opinion: 13, trust: 7, fear: -2, respect: 3,
  });
  const breakdown = getRelationshipBreakdown(state, 'ai-0');
  const sum = (key) => Math.round(breakdown.modifiers.reduce((total, modifier) => total + (modifier[key] ?? 0), 0) * 100) / 100;
  check('relationship ledger exactly sums opinion', breakdown.rawTotals.opinion === sum('opinion'));
  check('relationship ledger exactly sums all four metrics',
    ['trust', 'fear', 'respect'].every((key) => breakdown.rawTotals[key] === sum(key)));
}

// Proposal preview, acceptance, resource transfer, treaty creation, and atomic failure.
{
  const state = makeState();
  establishContact(state, 'ai-1', { stage: CONTACT_ESTABLISHED, trigger: 'test' });
  const input = {
    from: 'player',
    to: 'ai-1',
    terms: [
      { type: 'credits', amount: 500, from: 'player', to: 'ai-1' },
      { type: 'agreement', agreementType: AGREEMENT_TRADE },
    ],
  };
  const preview = previewProposal(state, input);
  const modifierSum = Math.round(preview.modifiers.reduce((sum, modifier) => sum + modifier.value, 0) * 100) / 100;
  check('proposal preview exposes exact acceptance arithmetic', preview.ok && preview.score === modifierSum, `score ${preview.score}`);
  const submitted = submitProposal(state, input);
  const beforePlayer = state.credits;
  const beforeAi = state.factions.list[1].credits;
  const accepted = respondToProposal(state, submitted.proposal.id, 'accept', { actor: 'ai-1' });
  check('proposal accepts and marks persistent status', accepted.ok && accepted.proposal.status === PROPOSAL_ACCEPTED);
  check('accepted resource term transfers exactly once', state.credits === beforePlayer - 500 && state.factions.list[1].credits === beforeAi + 500);
  check('accepted agreement term creates trade treaty', createAgreement(state, AGREEMENT_TRADE, 'ai-1').existing === true);

  const atomic = {
    from: 'player',
    to: 'ai-1',
    terms: [
      { type: 'credits', amount: 100, from: 'player', to: 'ai-1' },
      { type: 'system_transfer', systemId: 'home', from: 'player', to: 'ai-1' },
      { type: 'system_transfer', systemId: 'home', from: 'player', to: 'ai-1' },
    ],
  };
  const creditsBeforeFailure = state.credits;
  const ownerBeforeFailure = state.systems.home.owner;
  const failed = applyProposalTermsAtomic(state, atomic);
  check('invalid atomic bundle is rejected', !failed.ok);
  check('failed atomic bundle changes no wallet or ownership',
    state.credits === creditsBeforeFailure && state.systems.home.owner === ownerBeforeFailure);
}

// Counteroffer chain keeps one resolved parent and a pending reverse proposal.
{
  const state = makeState();
  establishContact(state, 'ai-0', { stage: CONTACT_ESTABLISHED, trigger: 'test' });
  const original = submitProposal(state, {
    from: 'player', to: 'ai-0',
    terms: [{ type: 'credits', amount: 100, from: 'player', to: 'ai-0' }],
  });
  const counter = respondToProposal(state, original.proposal.id, 'counter', {
    actor: 'ai-0',
    terms: [{ type: 'credits', amount: 150, from: 'player', to: 'ai-0' }],
  });
  check('counteroffer resolves parent as countered', counter.ok && counter.proposal.status === PROPOSAL_COUNTERED);
  check('counteroffer reverses proposer and recipient',
    counter.counterProposal.from === 'ai-0' && counter.counterProposal.to === 'player');
}

// Formal war gates combat/routes; occupations settle through peace and cession.
{
  const state = makeState();
  establishContact(state, 'ai-0', { stage: CONTACT_ESTABLISHED, trigger: 'test' });
  const peacefulAttack = canAttackSystem(state, 'helix');
  check('neutral relation blocks attacks before formal war', !peacefulAttack.ok && /war/i.test(peacefulAttack.reason));
  const missingFaction = { ...state.systems.helix, factionId: null };
  check('legacy AI ownership without factionId fails closed to the primary faction',
    !canAttackSystem(state, missingFaction).ok && !canRouteThroughSystem(state, missingFaction).ok);
  check('closed borders block ordinary routes', !canRouteThroughSystem(state, 'helix').ok);
  const borders = createAgreement(state, AGREEMENT_OPEN_BORDERS, 'ai-0');
  check('open borders make route legal', borders.ok && canRouteThroughSystem(state, 'helix').ok);
  const war = declareWar(state, 'ai-0', {
    force: true,
    goals: [{ type: 'claimed_conquest', systemIds: ['helix'] }],
  });
  check('formal war enables attacks and hostile routing',
    war.ok && canAttackSystem(state, 'helix').ok && canRouteThroughSystem(state, 'helix', 'player', { allowHostile: true }).ok);
  createClaim(state, 'ai-0', 'helix');
  recordWarEvent(state, war.war.id, { type: 'battle_victory', actor: 'player', scoreDelta: 12, exhaustionDelta: 3 });
  check('war event updates score and exhaustion', war.war.score === 12 && war.war.exhaustion.player === 3);
  const occupied = recordOccupation(state, {
    systemId: 'helix', occupier: 'player', previousActor: 'ai-0', warId: war.war.id,
  });
  check('occupation records sovereignty and changes controller', occupied.ok && state.systems.helix.owner === 'player');
  const recaptured = recordOccupation(state, {
    systemId: 'helix', occupier: 'ai-0', previousActor: 'player', warId: war.war.id,
  });
  check('opposing recapture supersedes prior occupation and records a new one',
    recaptured.ok && recaptured.occupation.id !== occupied.occupation.id
      && recaptured.supersededOccupationId === occupied.occupation.id
      && occupied.occupation.status === 'superseded'
      && state.systems.helix.owner === 'ai' && state.systems.helix.factionId === 'ai-0');
  const reoccupied = recordOccupation(state, {
    systemId: 'helix', occupier: 'player', previousActor: 'ai-0', warId: war.war.id,
  });
  check('system can be occupied again after a recapture', reoccupied.ok && state.systems.helix.owner === 'player');
  const peace = concludePeace(state, war.war.id, { cededSystemIds: ['helix'], truceMs: 120000 });
  check('peace ends war and retains agreed cession', peace.ok && !getActiveWar(state, 'ai-0') && state.systems.helix.owner === 'player');
  check('peace creates enforced truce that closes hostile attack', !canAttackSystem(state, 'helix', 'ai-0').ok);
  check('path legality reports exact blocked hop',
    routeLegality(state, ['home', 'market']).ok === false && routeLegality(state, ['home', 'market']).systemId === 'market');
  check('route legality can ignore a stranded origin during replanning',
    routeLegality(state, ['market', 'home'], 'player', { skipOrigin: true }).ok);
}

// Council sanction lifecycle.
{
  const state = makeState();
  establishContact(state, 'ai-0', { stage: CONTACT_ESTABLISHED, trigger: 'test' });
  establishContact(state, 'ai-1', { stage: CONTACT_ESTABLISHED, trigger: 'test' });
  const proposed = proposeCouncilResolution(state, {
    type: 'sanction', target: 'ai-0', proposer: 'player', votingDurationMs: 1000,
  });
  castCouncilVote(state, proposed.resolution.id, 'ai-1', 'yes');
  castCouncilVote(state, proposed.resolution.id, 'ai-0', 'no');
  const resolved = resolveCouncilResolution(state, proposed.resolution.id, { force: true });
  check('council resolution passes by exact vote tally',
    resolved.ok && resolved.resolution.passed && resolved.resolution.tally.yes === 2 && resolved.resolution.tally.no === 1);
  check('passed sanction becomes active', isSanctioned(state, 'ai-0'));
}

// Superweapon reaction is proportional, and AI diplomacy tick is deterministic/coarse.
{
  const state = makeState();
  establishContact(state, 'ai-0', { stage: CONTACT_ESTABLISHED, trigger: 'test' });
  establishContact(state, 'ai-1', { stage: CONTACT_ESTABLISHED, trigger: 'test' });
  const panic = triggerSuperweaponPanic(state);
  check('superweapon panic records per-faction reactions', panic.ok && panic.reactions.length === 2);
  check('superweapon alarm does not force every faction into war', !isAtWar(state, 'ai-1'));
  const fear = getRelationshipBreakdown(state, 'ai-1').metrics.fear;
  check('superweapon alarm raises fear through visible modifier', fear >= 30);
  state.time += 61000;
  const events = tickDiplomacy(state);
  check('coarse deterministic tick creates at most one proposal per pair',
    events.filter((event) => event.type === 'ai_proposal').length <= 2
      && new Set(ensureDiplomacy(state).proposals.filter((proposal) => proposal.status === 'pending')
        .map((proposal) => [proposal.from, proposal.to].sort().join('|'))).size
        === ensureDiplomacy(state).proposals.filter((proposal) => proposal.status === 'pending').length);
}

// Legacy treaty API and rich summary remain available to existing UI/callers.
{
  const state = makeState();
  const offered = offerTreaty(state, 'ai-1', 'trade');
  check('legacy offerTreaty still charges and succeeds', offered.ok && offered.cost.credits > 0);
  const summary = diplomacySummary(state);
  check('rich summary preserves legacy faction status fields',
    summary.unlocked && summary.factions.length === 2 && summary.factions.every((faction) => typeof faction.status === 'string'));
  check('rich summary exposes overhaul collections',
    Array.isArray(summary.proposals) && Array.isArray(summary.wars)
      && Array.isArray(summary.occupations) && Array.isArray(summary.council.resolutions));
}

const failures = results.filter((result) => !result.pass);
if (failures.length) {
  console.error(`\n${failures.length} of ${results.length} diplomacy checks failed.`);
  process.exit(1);
}

console.log(`\n${results.length}/${results.length} diplomacy overhaul checks passed.`);
