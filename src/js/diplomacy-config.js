// Central tuning for the actor-to-actor diplomacy simulation.

export const DIPLOMACY_CONFIG = Object.freeze({
  simulationTickMs: 1000,
  strategicTickMs: 10000,
  proactiveOfferCooldownMs: 90000,
  proposalLifetimeMs: 120000,
  ceasefireDurationMs: 60000,
  truceDurationMs: 180000,
  sanctionDurationMs: 300000,
  councilVoteDurationMs: 60000,
  councilVoteCommitLeadMs: 10000,
  temporaryMemoryDecayPerMinute: 1,
  counterOfferWindow: 20,
  defenseTrustGate: 25,
  allianceTrustGate: 50,
  severeGrievanceThreshold: 60,
  tradeDeliveryMultiplier: 1.2,
  tradePartnerShare: 0.1,
  sanctionTradeMultiplier: 0.7,
  sanctionAuthorityMultiplier: 0.75,
  sanctionAcceptancePenalty: 15,
  war: Object.freeze({
    expandedAfterMs: 60000,
    totalAfterMs: 180000,
    expandedReputation: -10,
    totalReputation: -25,
    expandedExhaustion: 5,
  }),
  breach: Object.freeze({
    trust: -30,
    opinion: -20,
    reputation: -25,
    witnessTrust: -10,
    grievance: 75,
    memoryDurationMs: 900000,
  }),
  acceptanceWeights: Object.freeze({
    opinion: 0.12,
    trust: 0.2,
    fear: 0.04,
    respect: 0.08,
  }),
  acceptanceThresholds: Object.freeze({
    ceasefire: 0,
    truce: 0,
    trade: 10,
    open_borders: 10,
    defense: 25,
    alliance: 40,
    tribute: 15,
    resource: 0,
    peace: 0,
  }),
  intelligenceForecastError: Object.freeze({
    unknown: 30,
    detected: 20,
    contacted: 12,
    established: 8,
    embassy: 4,
    shared: 0,
  }),
});

export const DIPLOMATIC_AGENDAS = Object.freeze({
  expansionist: Object.freeze({
    priorities: ['territory', 'tribute', 'military_access'],
    redLines: ['containment', 'blocked_expansion'],
    reliability: 0.62,
    riskTolerance: 0.82,
  }),
  economic: Object.freeze({
    priorities: ['trade', 'convoy_safety', 'open_routes'],
    redLines: ['blockade', 'trade_embargo'],
    reliability: 0.86,
    riskTolerance: 0.38,
  }),
  megastructure: Object.freeze({
    priorities: ['dyson_security', 'long_truce', 'helioclast_restraint'],
    redLines: ['dyson_threat', 'system_destruction'],
    reliability: 0.8,
    riskTolerance: 0.48,
  }),
  wormhole: Object.freeze({
    priorities: ['open_borders', 'wormhole_access', 'anchors'],
    redLines: ['closed_routes', 'anchor_seizure'],
    reliability: 0.72,
    riskTolerance: 0.68,
  }),
});

export const COUNCIL_RESOLUTION_TYPES = Object.freeze([
  'sanction',
  'repeal_sanction',
  'condemnation',
  'trade_embargo',
  'emergency_coalition',
  'collective_defense',
  'helioclast_inspection',
]);

export const HELIOCLAST_CRISIS_STAGES = Object.freeze([
  'dormant',
  'concern',
  'inspection_demand',
  'sanction',
  'containment_coalition',
  'war',
]);
