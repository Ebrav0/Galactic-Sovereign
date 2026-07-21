// Grand-strategy diplomacy command screen.
//
// Rendering is intentionally read-only. Derived diplomacy values are calculated
// against a cloned diplomacy ledger so opening the screen cannot normalize or
// otherwise mutate the live campaign. Only explicit command button handlers
// invoke mutating diplomacy APIs.

import {
  AGREEMENT_ALLIANCE,
  AGREEMENT_CEASEFIRE,
  AGREEMENT_DEFENSE,
  AGREEMENT_OPEN_BORDERS,
  AGREEMENT_TRADE,
  AGREEMENT_TRUCE,
  CONTACT_CONTACTED,
  CONTACT_DETECTED,
  CONTACT_ESTABLISHED,
  CONTACT_UNKNOWN,
  PROPOSAL_ACCEPTED,
  PROPOSAL_PENDING,
  WAR_GOAL_TYPES,
  castCouncilVote,
  councilAuthority,
  createClaim,
  declareWar,
  diplomaticLeverage,
  diplomacySummary,
  establishContact,
  previewProposal,
  proposeCouncilResolution,
  respondToProposal,
  respondToCallToArms,
  submitProposal,
  withdrawClaim,
} from './diplomacy.js';

const PANEL_VERSION = 2;
const PLAYER_ID = 'player';
const panelInstances = new WeakMap();
const TREATY_ACTIONS = Object.freeze([
  [AGREEMENT_CEASEFIRE, 'Ceasefire'],
  [AGREEMENT_TRUCE, 'Truce'],
  [AGREEMENT_TRADE, 'Trade Charter'],
  [AGREEMENT_OPEN_BORDERS, 'Open Borders'],
  [AGREEMENT_DEFENSE, 'Mutual Defense'],
  [AGREEMENT_ALLIANCE, 'Alliance'],
]);
const DIPLOMACY_VIEWS = Object.freeze(['overview', 'relations', 'negotiation', 'conflicts', 'council', 'history']);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function deepClone(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function element(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function labelize(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function signed(value) {
  const number = Math.round(finite(value) * 10) / 10;
  return `${number > 0 ? '+' : ''}${number}`;
}

function formatDuration(milliseconds) {
  if (milliseconds == null) return 'Permanent';
  const seconds = Math.max(0, Math.ceil(finite(milliseconds) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}

function makeButton(id, text, kind = 'ghost') {
  const button = element('button', `btn btn--${kind} btn--sm`, text);
  button.type = 'button';
  if (id) {
    button.id = id;
    button.dataset.testid = id;
    button.dataset.focusKey = id;
  }
  return button;
}

function makeSelect(id, options) {
  const select = element('select');
  select.id = id;
  select.dataset.testid = id;
  select.dataset.focusKey = id;
  select.dataset.diplomacyField = id;
  for (const [value, text] of options) {
    const option = element('option', '', text);
    option.value = value;
    select.appendChild(option);
  }
  return select;
}

function makeNumberInput(id, placeholder = '0', step = '1') {
  const input = element('input');
  input.type = 'number';
  input.min = '0';
  input.step = step;
  input.placeholder = placeholder;
  input.id = id;
  input.dataset.testid = id;
  input.dataset.focusKey = id;
  input.dataset.diplomacyField = id;
  return input;
}

function makeCard(title, options = {}) {
  const card = element('section', `command-card${options.wide ? ' command-card--wide' : ''}`);
  if (options.id) {
    card.id = options.id;
    card.dataset.testid = options.id;
  }
  card.appendChild(element('h3', 'command-card__title', title));
  return card;
}

function appendEmpty(container, message) {
  container.appendChild(element('p', 'panel-note panel-note--muted', message));
}

function appendLedgerRow(container, left, right = '', options = {}) {
  const row = element('div', 'command-ledger__row');
  if (options.testid) row.dataset.testid = options.testid;
  const description = element(options.strong ? 'strong' : 'span', '', left);
  const value = element('span', options.valueClass ?? '', right);
  row.append(description, value);
  container.appendChild(row);
  return row;
}

function metric(label, value, id, valueClass = '') {
  const wrapper = element('div', 'command-metric', label);
  const strong = element('strong', valueClass, value);
  if (id) {
    strong.id = id;
    strong.dataset.testid = id;
  }
  wrapper.appendChild(strong);
  return wrapper;
}

function actorFactionList(state) {
  if (state?.factions?.list?.length) return state.factions.list;
  return state?.factions?.ai ? [state.factions.ai] : [];
}

function compactRecord(record, keys) {
  return Object.fromEntries(keys.map((key) => [key, deepClone(record?.[key])]).filter(([, value]) => value !== undefined));
}

function ownerCounts(state) {
  const counts = { player: 0, ai: 0, neutral: 0 };
  for (const galaxy of Object.values(state?.galaxies ?? {})) {
    const systems = Object.values(galaxy?.systems ?? {}).length
      ? Object.values(galaxy.systems)
      : Object.values(galaxy?.abstract?.systemOverlays ?? {});
    for (const system of systems) counts[system?.owner] = finite(counts[system?.owner]) + 1;
  }
  return counts;
}

/**
 * A compact, side-effect-free key for UI invalidation and automation.
 * Individual ships and full star records are deliberately excluded.
 */
export function diplomacyPanelSnapshot(state) {
  const diplomacy = state?.diplomacy ?? {};
  const relevantTech = new Set([
    'dip_truce_protocol',
    'dip_trade_charter',
    'dip_alliance_pact',
    'dip_galactic_council',
  ]);
  return {
    version: PANEL_VERSION,
    revision: Math.max(0, Math.floor(finite(diplomacy.revision))),
    unlocked: !!state?.milestones?.diplomacyUnlocked
      || Object.values(diplomacy.contacts ?? {}).some((contact) => contact?.stage !== CONTACT_UNKNOWN),
    panicUntil: finite(diplomacy.panicUntil),
    playerPower: {
      creditsBand: Math.floor(finite(state?.credits) / 100),
      solariiBand: Math.floor(finite(state?.solarii) / 5),
      ships: asArray(state?.playerShips).length + asArray(state?.heroFlagships).length,
      systems: ownerCounts(state).player,
    },
    tech: asArray(state?.research?.unlocked).filter((id) => relevantTech.has(id)).sort(),
    factions: actorFactionList(state).map((faction) => ({
      id: faction.id,
      name: faction.name,
      personality: faction.personality,
      creditsBand: Math.floor(finite(faction.credits) / 100),
      solariiBand: Math.floor(finite(faction.solarii) / 5),
      ships: asArray(state?.aiShips).filter((ship) => ship.factionId === faction.id).length,
      contact: compactRecord(diplomacy.contacts?.[faction.id], ['stage', 'firstContactAt', 'establishedAt', 'intelligence']),
      relation: compactRecord(diplomacy.relations?.[faction.id], ['status', 'baseMetrics', 'metrics', 'treaties']),
      modifiers: asArray(diplomacy.modifiers?.[faction.id]).map((entry) => compactRecord(entry, [
        'id', 'source', 'label', 'opinion', 'trust', 'fear', 'respect', 'expiresAt',
      ])),
    })),
    proposals: asArray(diplomacy.proposals).map((entry) => compactRecord(entry, [
      'id', 'from', 'to', 'terms', 'status', 'createdAt', 'expiresAt', 'resolvedAt',
    ])),
    agreements: asArray(diplomacy.agreements).map((entry) => compactRecord(entry, [
      'id', 'type', 'parties', 'status', 'startedAt', 'expiresAt',
    ])),
    claims: asArray(diplomacy.claims).map((entry) => compactRecord(entry, [
      'id', 'claimant', 'target', 'systemId', 'galaxyId', 'status',
    ])),
    wars: asArray(diplomacy.wars).map((entry) => compactRecord(entry, [
      'id', 'status', 'parties', 'goals', 'score', 'scoreByActor', 'exhaustion', 'events',
    ])),
    occupations: asArray(diplomacy.occupations).map((entry) => compactRecord(entry, [
      'id', 'warId', 'systemId', 'occupier', 'sovereignActor', 'status',
    ])),
    council: {
      resolutions: asArray(diplomacy.council?.resolutions).map((entry) => compactRecord(entry, [
        'id', 'type', 'target', 'status', 'votes', 'tally', 'passed', 'votingEndsAt',
      ])),
      sanctions: asArray(diplomacy.council?.sanctions).map((entry) => compactRecord(entry, [
        'id', 'target', 'status', 'startedAt', 'expiresAt',
      ])),
    },
    grievances: asArray(diplomacy.grievances).map((entry) => compactRecord(entry, ['id', 'aggrieved', 'against', 'label', 'severity', 'status', 'expiresAt'])),
    favors: asArray(diplomacy.favors).map((entry) => compactRecord(entry, ['id', 'debtor', 'creditor', 'value', 'purpose', 'status'])),
    transmissions: asArray(diplomacy.transmissions).slice(-20).map((entry) => compactRecord(entry, ['id', 'from', 'to', 'subject', 'kind', 'createdAt', 'read', 'status'])),
    callsToArms: asArray(diplomacy.callsToArms).map((entry) => compactRecord(entry, ['id', 'warId', 'caller', 'ally', 'status', 'expiresAt'])),
    history: asArray(diplomacy.history).slice(-20).map((entry) => compactRecord(entry, [
      'id', 'type', 'at', 'factionId', 'proposalId', 'warId', 'reason',
    ])),
  };
}

function readOnlyDiplomacyView(state) {
  return {
    ...state,
    diplomacy: deepClone(state?.diplomacy ?? {}),
    milestones: deepClone(state?.milestones ?? null),
  };
}

function readModel(state) {
  const viewState = readOnlyDiplomacyView(state);
  const summary = diplomacySummary(viewState);
  return { viewState, summary };
}

function selectedSystemId(instance) {
  try {
    const value = instance.options?.getGalaxyTargetStar?.();
    return typeof value === 'string' ? value : value?.id ?? null;
  } catch {
    return null;
  }
}

function systemName(state, systemId) {
  if (!systemId) return 'No map target';
  for (const galaxy of Object.values(state?.galaxies ?? {})) {
    const star = asArray(galaxy?.graph?.stars).find((entry) => entry.id === systemId);
    const system = galaxy?.systems?.[systemId] ?? galaxy?.abstract?.systemOverlays?.[systemId];
    if (system || star) return system?.name ?? star?.name ?? systemId;
  }
  return systemId;
}

function systemActor(state, systemId) {
  for (const galaxy of Object.values(state?.galaxies ?? {})) {
    const system = galaxy?.systems?.[systemId] ?? galaxy?.abstract?.systemOverlays?.[systemId];
    if (!system) continue;
    return system.owner === 'player' ? PLAYER_ID : system.factionId ?? system.owner ?? null;
  }
  return null;
}

function notify(instance, message, kind = '') {
  const text = String(message ?? 'Diplomatic command completed');
  instance.refs.live.textContent = text;
  instance.refs.live.dataset.status = kind || 'info';
  if (typeof instance.options?.toast === 'function') instance.options.toast(text, kind);
}

function resultReason(result) {
  return result?.reason
    ?? result?.errors?.map((entry) => entry?.message ?? String(entry)).join('; ')
    ?? 'Diplomatic command failed';
}

function safeAction(instance, action, successMessage, coopSpec = null) {
  if (coopSpec?.command && typeof instance.options?.coopRun === 'function') {
    instance.options.coopRun(coopSpec.command, coopSpec.payload ?? {}).then((result) => {
      if (!result?.ok) {
        notify(instance, resultReason(result), 'error');
      } else {
        const message = typeof successMessage === 'function' ? successMessage(result) : successMessage;
        notify(instance, message ?? 'Diplomatic command completed', 'ok');
      }
      instance.refresh();
    }).catch((error) => {
      notify(instance, error?.message ?? String(error), 'error');
    });
    return { ok: true, pending: true };
  }
  try {
    const result = action();
    if (!result?.ok) {
      notify(instance, resultReason(result), 'error');
    } else {
      const message = typeof successMessage === 'function' ? successMessage(result) : successMessage;
      notify(instance, message ?? 'Diplomatic command completed', 'ok');
    }
    instance.refresh();
    return result;
  } catch (error) {
    const reason = error?.message ?? String(error);
    notify(instance, reason, 'error');
    return { ok: false, reason };
  }
}

function diplomacyCoop(action, args = {}) {
  return { command: 'diplomacyAction', payload: { action, args } };
}

function captureControls(root) {
  const values = new Map();
  for (const control of root.querySelectorAll('[data-diplomacy-field]')) {
    values.set(control.dataset.diplomacyField, {
      value: control.value,
      checked: control.checked,
    });
  }
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  return {
    values,
    focusKey: active?.dataset?.focusKey ?? active?.id ?? null,
    selectionStart: typeof active?.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active?.selectionEnd === 'number' ? active.selectionEnd : null,
  };
}

function restoreControls(root, captured) {
  const restored = [];
  for (const control of root.querySelectorAll('[data-diplomacy-field]')) {
    const saved = captured.values.get(control.dataset.diplomacyField);
    if (!saved) continue;
    if ([...control.options ?? []].some((option) => option.value === saved.value) || control.tagName !== 'SELECT') {
      control.value = saved.value;
    }
    if ('checked' in control) control.checked = saved.checked;
    restored.push(control);
  }
  for (const control of restored) control.dispatchEvent(new Event('input', { bubbles: true }));
  if (!captured.focusKey) return;
  const target = [...root.querySelectorAll('[data-focus-key], [id]')]
    .find((node) => (node.dataset.focusKey ?? node.id) === captured.focusKey);
  if (!target || target.disabled) return;
  target.focus({ preventScroll: true });
  if (captured.selectionStart != null && typeof target.setSelectionRange === 'function') {
    target.setSelectionRange(captured.selectionStart, captured.selectionEnd ?? captured.selectionStart);
  }
}

function proposalTermLabel(term) {
  if (term.type === 'agreement') return labelize(term.agreementType);
  if (term.type === 'end_war') return 'End war / white peace';
  if (term.type === 'resource') return `${finite(term.amount).toLocaleString()} ${labelize(term.resource)}`;
  if (term.type === 'system_transfer') return `Transfer ${term.systemId}`;
  if (term.type === 'tribute') return 'Tribute agreement';
  if (term.type === 'reparations') return `${finite(term.credits)} Credits / ${finite(term.solarii)} Solarii reparations`;
  if (term.type === 'claim') return `Recognize claim on ${term.systemId}`;
  if (term.type === 'join_war') return `Join ${term.warId}`;
  if (term.type === 'sanction') return `Sanction ${term.target}`;
  return labelize(term.type);
}

function proposalInput(factionId, agreementType) {
  const durationMs = agreementType === AGREEMENT_CEASEFIRE ? 60000
    : agreementType === AGREEMENT_TRUCE ? 120000
      : null;
  return {
    from: PLAYER_ID,
    to: factionId,
    message: `Proposal: ${labelize(agreementType)}`,
    terms: [{
      type: 'agreement',
      agreementType,
      parties: [PLAYER_ID, factionId],
      durationMs,
    }],
  };
}

function treatyOutcomeMessage(result, label, factionName) {
  const status = result?.proposal?.status;
  if (status === PROPOSAL_ACCEPTED) return `${label} accepted by ${factionName}`;
  if (status && status !== PROPOSAL_PENDING) return `${label} ${status} by ${factionName}`;
  return `${label} sent to ${factionName}`;
}

function renderRelationshipCard(instance, faction, leverage) {
  const card = makeCard('Relationship & Intelligence', { id: 'diplomacy-relationship-card' });
  const contact = faction.contact ?? { stage: CONTACT_UNKNOWN };
  const header = element('p', 'panel-note');
  header.append(
    element('strong', '', faction.name),
    document.createTextNode(` · ${labelize(faction.personality)} · `),
    element('span', faction.status === 'war' ? 'command-status--war' : '', labelize(faction.status)),
  );
  card.appendChild(header);
  card.appendChild(element(
    'p',
    'panel-note panel-note--muted',
    `Contact: ${labelize(contact.stage)} · Intelligence: ${Math.round(finite(contact.intelligence))}% · Strategic leverage: ${signed(leverage.value)} · ${faction.sanctioned ? 'Council sanctioned' : 'No active sanction'}`,
  ));
  const profile = instance.model?.summary?.profiles?.[faction.id];
  if (profile) card.appendChild(element(
    'p', 'panel-note',
    `Known agenda: ${asArray(profile.priorities).slice(0, 3).map(labelize).join(', ') || labelize(profile.personality)} · Reliability ${Math.round(finite(profile.reliability) * 100)}%`,
  ));

  const metrics = element('div', 'command-metrics');
  for (const [key, label] of [['opinion', 'Opinion'], ['trust', 'Trust'], ['fear', 'Fear'], ['respect', 'Respect']]) {
    const value = finite(faction.relationship?.metrics?.[key]);
    const valueClass = value > 0 ? 'command-score--positive' : value < 0 ? 'command-score--negative' : '';
    metrics.appendChild(metric(label, signed(value), `diplomacy-metric-${key}`, valueClass));
  }
  metrics.appendChild(metric(
    'Leverage',
    signed(leverage.value),
    'diplomacy-metric-leverage',
    leverage.value > 0 ? 'command-score--positive' : leverage.value < 0 ? 'command-score--negative' : '',
  ));
  card.appendChild(metrics);

  if (contact.stage !== CONTACT_ESTABLISHED) {
    const actions = element('div', 'command-actions');
    const contactButton = makeButton('diplomacy-contact-button', contact.stage === CONTACT_UNKNOWN ? 'Detection Required' : 'Open Communications', 'primary');
    contactButton.disabled = contact.stage === CONTACT_UNKNOWN;
    contactButton.addEventListener('click', () => safeAction(
      instance,
      () => establishContact(instance.state, faction.id, {
        stage: contact.stage === CONTACT_DETECTED ? CONTACT_CONTACTED : CONTACT_ESTABLISHED,
        trigger: 'player_command',
      }),
      () => `Communications advanced with ${faction.name}`,
      diplomacyCoop('establishContact', {
        factionId: faction.id,
        options: {
          stage: contact.stage === CONTACT_DETECTED ? CONTACT_CONTACTED : CONTACT_ESTABLISHED,
          trigger: 'player_command',
        },
      }),
    ));
    actions.appendChild(contactButton);
    card.appendChild(actions);
  }

  const ledger = element('div', 'command-ledger');
  ledger.id = 'diplomacy-modifier-ledger';
  ledger.dataset.testid = ledger.id;
  const modifiers = asArray(faction.relationship?.modifiers);
  if (modifiers.length === 0) appendEmpty(ledger, 'No relationship modifiers recorded.');
  for (const modifier of modifiers.slice(-12).reverse()) {
    const changes = ['opinion', 'trust', 'fear', 'respect']
      .filter((key) => finite(modifier[key]) !== 0)
      .map((key) => `${key.slice(0, 3).toUpperCase()} ${signed(modifier[key])}`)
      .join(' · ');
    appendLedgerRow(ledger, modifier.label ?? labelize(modifier.source), changes || 'Neutral');
  }
  card.appendChild(ledger);
  const grievances = asArray(instance.model?.summary?.grievances).filter((entry) => (
    entry.status === 'active' && entry.aggrieved === faction.id && entry.against === PLAYER_ID
  ));
  if (grievances.length) {
    const grievanceLedger = element('div', 'command-ledger');
    grievanceLedger.appendChild(element('strong', '', 'Active grievances'));
    for (const grievance of grievances) appendLedgerRow(grievanceLedger, grievance.label ?? labelize(grievance.type), `Severity ${Math.round(finite(grievance.severity))}`);
    card.appendChild(grievanceLedger);
  }
  return card;
}

function renderNegotiationsCard(instance, faction, viewState) {
  const card = makeCard('Negotiations & Agreements', { id: 'diplomacy-negotiations-card' });
  const agreements = asArray(faction.agreements);
  const agreementLedger = element('div', 'command-ledger');
  agreementLedger.id = 'diplomacy-agreements-list';
  agreementLedger.dataset.testid = agreementLedger.id;
  if (agreements.length === 0) appendEmpty(agreementLedger, 'No active bilateral agreements.');
  for (const agreement of agreements) {
    const remaining = agreement.expiresAt == null ? 'Permanent' : formatDuration(agreement.expiresAt - finite(instance.state.time));
    appendLedgerRow(agreementLedger, labelize(agreement.type), remaining, { strong: true });
  }
  card.appendChild(agreementLedger);

  const actions = element('div', 'command-actions');
  for (const [type, label] of TREATY_ACTIONS) {
    const input = proposalInput(faction.id, type);
    const preview = previewProposal(viewState, input);
    const score = finite(preview.score);
    const button = makeButton(`diplomacy-proposal-${type}`, `${label} ${signed(score)}`);
    button.title = preview.ok
      ? `Acceptance score ${signed(score)} (${preview.acceptable ? 'likely accepted' : 'likely rejected'})`
      : preview.errors.join('; ');
    button.disabled = faction.contact?.stage === CONTACT_UNKNOWN;
    button.addEventListener('click', () => {
      const liveInput = proposalInput(faction.id, type);
      const evaluated = previewProposal(instance.state, liveInput);
      if (!evaluated.ok) {
        notify(instance, evaluated.errors.join('; '), 'error');
        instance.refresh();
        return;
      }
      safeAction(
        instance,
        () => submitProposal(instance.state, liveInput, { autoResolve: true }),
        (result) => treatyOutcomeMessage(result, label, faction.name),
        diplomacyCoop('submitProposal', { input: liveInput, options: { autoResolve: true } }),
      );
    });
    actions.appendChild(button);
  }
  card.appendChild(actions);

  const pending = asArray(faction.pendingProposals);
  const proposals = element('div', 'command-ledger');
  proposals.id = 'diplomacy-pending-proposals';
  proposals.dataset.testid = proposals.id;
  if (pending.length === 0) appendEmpty(proposals, 'No pending proposals.');
  for (const proposal of pending) {
    const incoming = proposal.to === PLAYER_ID;
    const terms = asArray(proposal.terms).map(proposalTermLabel).join(' + ') || 'No terms';
    const row = element('div', 'command-ledger__row');
    row.dataset.testid = `diplomacy-proposal-row-${proposal.id}`;
    const copy = element('div');
    copy.append(
      element('strong', '', incoming ? `Incoming · ${terms}` : `Outgoing · ${terms}`),
      element('div', 'panel-note panel-note--muted', `Expires in ${formatDuration(proposal.expiresAt - finite(instance.state.time))}`),
    );
    const rowActions = element('div', 'command-actions');
    if (incoming) {
      const accept = makeButton(`diplomacy-incoming-${proposal.id}-accept`, 'Accept', 'primary');
      const reject = makeButton(`diplomacy-incoming-${proposal.id}-reject`, 'Reject');
      accept.addEventListener('click', () => safeAction(
        instance,
        () => respondToProposal(instance.state, proposal.id, 'accept', { actor: PLAYER_ID }),
        () => `Proposal from ${faction.name} accepted`,
        diplomacyCoop('respondToProposal', {
          proposalId: proposal.id,
          decision: 'accept',
          options: { actor: PLAYER_ID },
        }),
      ));
      reject.addEventListener('click', () => safeAction(
        instance,
        () => respondToProposal(instance.state, proposal.id, 'reject', { actor: PLAYER_ID }),
        () => `Proposal from ${faction.name} rejected`,
        diplomacyCoop('respondToProposal', {
          proposalId: proposal.id,
          decision: 'reject',
          options: { actor: PLAYER_ID },
        }),
      ));
      rowActions.append(accept, reject);
    } else {
      rowActions.appendChild(element('span', 'panel-note panel-note--muted', 'Awaiting response'));
    }
    row.append(copy, rowActions);
    proposals.appendChild(row);
  }
  card.appendChild(proposals);
  return card;
}

function renderDealBuilderCard(instance, faction, viewState) {
  const card = makeCard('Advanced Deal Builder', { id: 'diplomacy-deal-builder', wide: true });
  card.appendChild(element('p', 'panel-note panel-note--muted', 'Combine concessions and demands. Previewing is read-only; accepted terms settle atomically.'));
  const columns = element('div', 'diplomacy-deal-columns');
  const offer = element('section', 'diplomacy-deal-column');
  const demand = element('section', 'diplomacy-deal-column');
  offer.appendChild(element('h4', '', 'We offer'));
  demand.appendChild(element('h4', '', 'We demand'));
  const fields = {};
  const addNumber = (column, id, label, step = '1') => {
    const wrapper = element('label');
    fields[id] = makeNumberInput(id, '0', step);
    wrapper.append(element('span', '', label), fields[id]);
    column.appendChild(wrapper);
  };
  addNumber(offer, 'diplomacy-offer-credits', 'Credits');
  addNumber(offer, 'diplomacy-offer-solarii', 'Solarii', '0.25');
  addNumber(offer, 'diplomacy-offer-reparations', 'Reparations Credits');
  addNumber(offer, 'diplomacy-offer-tribute', 'Tribute Credits / minute');
  addNumber(demand, 'diplomacy-demand-credits', 'Credits');
  addNumber(demand, 'diplomacy-demand-solarii', 'Solarii', '0.25');
  addNumber(demand, 'diplomacy-demand-reparations', 'Reparations Credits');
  addNumber(demand, 'diplomacy-demand-tribute', 'Tribute Credits / minute');
  const selected = selectedSystemId(instance);
  const owner = systemActor(instance.state, selected);
  const checkField = (column, id, label, disabled = false) => {
    const wrapper = element('label', 'diplomacy-check');
    const input = element('input');
    input.type = 'checkbox';
    input.id = id;
    input.dataset.testid = id;
    input.dataset.focusKey = id;
    input.dataset.diplomacyField = id;
    input.disabled = disabled;
    fields[id] = input;
    wrapper.append(input, element('span', '', label));
    column.appendChild(wrapper);
  };
  checkField(offer, 'diplomacy-offer-system', `Selected system: ${systemName(instance.state, selected)}`, !selected || owner !== PLAYER_ID);
  checkField(offer, 'diplomacy-offer-claim', 'Recognize their claim on selected system', !selected || owner !== PLAYER_ID);
  checkField(offer, 'diplomacy-offer-favor', 'A favor owed to them');
  checkField(demand, 'diplomacy-demand-system', `Selected system: ${systemName(instance.state, selected)}`, !selected || owner !== faction.id);
  checkField(demand, 'diplomacy-demand-claim', 'Recognize our claim on selected system', !selected || owner !== faction.id);
  checkField(demand, 'diplomacy-demand-favor', 'A favor owed to us');
  checkField(demand, 'diplomacy-demand-helioclast', 'Helioclast non-use commitment');
  const activeWars = asArray(instance.state.diplomacy?.wars).filter((war) => war.status === 'active');
  const playerWar = activeWars.find((war) => war.parties.includes(PLAYER_ID) && !war.parties.includes(faction.id));
  const factionWar = activeWars.find((war) => war.parties.includes(faction.id) && !war.parties.includes(PLAYER_ID));
  checkField(offer, 'diplomacy-offer-war', factionWar ? `Join their war: ${factionWar.id}` : 'Join their active war', !factionWar);
  checkField(demand, 'diplomacy-demand-war', playerWar ? `Join our war: ${playerWar.id}` : 'Join our active war', !playerWar);
  const sanctionTargets = [['', 'No sanction demand'], ...asArray(instance.state.factions?.list)
    .filter((candidate) => candidate.id !== faction.id)
    .map((candidate) => [candidate.id, `Sanction ${candidate.name}`])];
  const sanctionTarget = makeSelect('diplomacy-demand-sanction-target', sanctionTargets);
  const sanctionLabel = element('label');
  sanctionLabel.append(element('span', '', 'Council / bilateral sanction'), sanctionTarget);
  fields[sanctionTarget.id] = sanctionTarget;
  demand.appendChild(sanctionLabel);
  columns.append(offer, demand);
  card.appendChild(columns);

  const clauses = element('fieldset', 'diplomacy-deal-clauses');
  clauses.appendChild(element('legend', '', 'Shared treaty clauses'));
  for (const [type, label] of TREATY_ACTIONS) checkField(clauses, `diplomacy-clause-${type}`, label);
  card.appendChild(clauses);
  const forecast = element('p', 'panel-note');
  forecast.id = 'diplomacy-deal-forecast';
  forecast.dataset.testid = forecast.id;
  forecast.textContent = 'Add at least one term to calculate a forecast.';
  card.appendChild(forecast);

  const buildInput = () => {
    const terms = [];
    const transfer = (id, resource, from, to) => {
      const amount = Math.max(0, finite(fields[id]?.value));
      if (amount > 0) terms.push({ type: 'resource', resource, amount, from, to });
    };
    transfer('diplomacy-offer-credits', 'credits', PLAYER_ID, faction.id);
    transfer('diplomacy-offer-solarii', 'solarii', PLAYER_ID, faction.id);
    transfer('diplomacy-demand-credits', 'credits', faction.id, PLAYER_ID);
    transfer('diplomacy-demand-solarii', 'solarii', faction.id, PLAYER_ID);
    const offerReparations = Math.max(0, finite(fields['diplomacy-offer-reparations'].value));
    if (offerReparations > 0) terms.push({ type: 'reparations', from: PLAYER_ID, to: faction.id, credits: offerReparations, solarii: 0 });
    const demandReparations = Math.max(0, finite(fields['diplomacy-demand-reparations'].value));
    if (demandReparations > 0) terms.push({ type: 'reparations', from: faction.id, to: PLAYER_ID, credits: demandReparations, solarii: 0 });
    if (fields['diplomacy-offer-system'].checked) terms.push({ type: 'system_transfer', systemId: selected, galaxyId: instance.state.activeGalaxyId, from: PLAYER_ID, to: faction.id });
    if (fields['diplomacy-demand-system'].checked) terms.push({ type: 'system_transfer', systemId: selected, galaxyId: instance.state.activeGalaxyId, from: faction.id, to: PLAYER_ID });
    if (fields['diplomacy-offer-claim'].checked) terms.push({ type: 'claim', claimant: faction.id, target: PLAYER_ID, systemId: selected, galaxyId: instance.state.activeGalaxyId });
    if (fields['diplomacy-demand-claim'].checked) terms.push({ type: 'claim', claimant: PLAYER_ID, target: faction.id, systemId: selected, galaxyId: instance.state.activeGalaxyId });
    if (fields['diplomacy-offer-favor'].checked) terms.push({ type: 'favor', debtor: PLAYER_ID, creditor: faction.id, value: 25 });
    if (fields['diplomacy-demand-favor'].checked) terms.push({ type: 'favor', debtor: faction.id, creditor: PLAYER_ID, value: 25 });
    const offeredTribute = Math.max(0, finite(fields['diplomacy-offer-tribute'].value));
    if (offeredTribute > 0) terms.push({ type: 'tribute', payer: PLAYER_ID, payee: faction.id, creditsPerMinute: offeredTribute, durationMs: 300000 });
    const tribute = Math.max(0, finite(fields['diplomacy-demand-tribute'].value));
    if (tribute > 0) terms.push({ type: 'tribute', payer: faction.id, payee: PLAYER_ID, creditsPerMinute: tribute, durationMs: 300000 });
    if (fields['diplomacy-demand-helioclast'].checked) terms.push({ type: 'helioclast_commitment', actor: faction.id, commitment: 'non_use', durationMs: 300000 });
    if (fields['diplomacy-offer-war'].checked && factionWar) terms.push({
      type: 'join_war', warId: factionWar.id, actor: PLAYER_ID,
      side: factionWar.attackers.includes(faction.id) ? 'attacker' : 'defender',
    });
    if (fields['diplomacy-demand-war'].checked && playerWar) terms.push({
      type: 'join_war', warId: playerWar.id, actor: faction.id,
      side: playerWar.attackers.includes(PLAYER_ID) ? 'attacker' : 'defender',
    });
    if (fields['diplomacy-demand-sanction-target'].value) terms.push({
      type: 'sanction', actor: faction.id, issuer: faction.id,
      target: fields['diplomacy-demand-sanction-target'].value, durationMs: 300000,
    });
    for (const [type] of TREATY_ACTIONS) if (fields[`diplomacy-clause-${type}`].checked) {
      terms.push({ type: 'agreement', agreementType: type, parties: [PLAYER_ID, faction.id],
        durationMs: type === AGREEMENT_CEASEFIRE ? 60000 : type === AGREEMENT_TRUCE ? 180000 : null });
    }
    return { from: PLAYER_ID, to: faction.id, message: 'Advanced diplomatic package', terms };
  };
  const updateForecast = () => {
    const input = buildInput();
    if (!input.terms.length) {
      forecast.textContent = 'Add at least one term to calculate a forecast.';
      return null;
    }
    const preview = previewProposal(viewState, input);
    forecast.textContent = preview.ok
      ? `Acceptance ${signed(preview.scoreRange[0])} to ${signed(preview.scoreRange[1])} · threshold ${signed(preview.threshold)} · admin ${preview.administrativeCost.credits} Credits / ${preview.administrativeCost.solarii} Solarii · ${preview.hardBlock ?? preview.reasons.map((reason) => reason.label).join(', ')}`
      : preview.errors.join('; ');
    forecast.className = `panel-note ${preview.acceptable ? 'command-score--positive' : preview.hardBlock ? 'command-score--negative' : ''}`;
    return preview;
  };
  for (const control of Object.values(fields)) control.addEventListener('input', updateForecast);
  const actions = element('div', 'command-actions');
  const previewButton = makeButton('diplomacy-deal-preview', 'Preview Deal');
  const submitButton = makeButton('diplomacy-deal-submit', 'Send Deal', 'primary');
  previewButton.addEventListener('click', updateForecast);
  submitButton.addEventListener('click', () => {
    const input = buildInput();
    if (!input.terms.length) {
      notify(instance, 'Add at least one offer, demand, or treaty clause', 'error');
      return;
    }
    safeAction(instance, () => submitProposal(instance.state, input, { autoResolve: true }),
      (result) => treatyOutcomeMessage(result, 'Advanced deal', faction.name),
      diplomacyCoop('submitProposal', { input, options: { autoResolve: true } }));
  });
  actions.append(previewButton, submitButton);
  card.appendChild(actions);
  return card;
}

function activePlayerClaim(faction, targetSystemId = null) {
  return asArray(faction.claims).find((claim) => (
    claim.status === 'active'
      && claim.claimant === PLAYER_ID
      && (!targetSystemId || claim.systemId === targetSystemId)
  ));
}

function renderWarCard(instance, faction, summary) {
  const card = makeCard('Claims, War & Occupation', { id: 'diplomacy-war-card' });
  const targetSystemId = selectedSystemId(instance);
  card.appendChild(element(
    'p',
    'panel-note panel-note--muted',
    `Map target: ${systemName(instance.state, targetSystemId)}${targetSystemId ? ` [${targetSystemId}]` : ''}`,
  ));

  const claimActions = element('div', 'command-actions');
  const claim = makeButton('diplomacy-claim-selected', 'Claim Selected System', 'primary');
  claim.disabled = !targetSystemId || faction.contact?.stage === CONTACT_UNKNOWN;
  claim.addEventListener('click', () => {
    const selected = selectedSystemId(instance);
    if (!selected) {
      notify(instance, 'Select a target system on the galaxy map first', 'error');
      return;
    }
    safeAction(
      instance,
      () => createClaim(instance.state, {
        claimant: PLAYER_ID,
        target: faction.id,
        systemId: selected,
        galaxyId: instance.state.activeGalaxyId,
        source: 'player_command',
      }),
      () => `Claim recorded against ${faction.name} for ${systemName(instance.state, selected)}`,
      diplomacyCoop('createClaim', {
        input: {
          claimant: PLAYER_ID,
          target: faction.id,
          systemId: selected,
          galaxyId: instance.state.activeGalaxyId,
          source: 'player_command',
        },
      }),
    );
  });
  claimActions.appendChild(claim);
  card.appendChild(claimActions);

  const claims = element('div', 'command-ledger');
  claims.id = 'diplomacy-claims-list';
  claims.dataset.testid = claims.id;
  if (asArray(faction.claims).length === 0) appendEmpty(claims, 'No active claims involving this faction.');
  for (const entry of asArray(faction.claims)) {
    const row = element('div', 'command-ledger__row');
    const claimant = entry.claimant === PLAYER_ID ? 'Player claim' : `${faction.name} claim`;
    const copy = element('span', '', `${claimant} · ${systemName(instance.state, entry.systemId)}`);
    const actions = element('div', 'command-actions');
    if (entry.claimant === PLAYER_ID && entry.status === 'active') {
      const withdraw = makeButton(`diplomacy-claim-${entry.id}-withdraw`, 'Withdraw');
      withdraw.addEventListener('click', () => safeAction(
        instance,
        () => withdrawClaim(instance.state, entry.id, { reason: 'player_withdrawn' }),
        () => `Claim on ${systemName(instance.state, entry.systemId)} withdrawn`,
        diplomacyCoop('withdrawClaim', {
          claimId: entry.id,
          options: { reason: 'player_withdrawn' },
        }),
      ));
      actions.appendChild(withdraw);
    }
    row.append(copy, actions);
    claims.appendChild(row);
  }
  card.appendChild(claims);

  const war = faction.war;
  if (!war) {
    const warForm = element('div', 'command-form');
    const goal = makeSelect('diplomacy-war-goal', WAR_GOAL_TYPES.map((type) => [type, labelize(type)]));
    goal.value = activePlayerClaim(faction) ? 'claimed_conquest' : 'border_security';
    const label = element('label');
    label.append(element('span', '', 'Formal war goal'), goal);
    warForm.appendChild(label);
    card.appendChild(warForm);
    const warActions = element('div', 'command-actions');
    const declare = makeButton('diplomacy-declare-war', 'Declare Formal War');
    declare.classList.add('command-status--war');
    declare.disabled = faction.contact?.stage === CONTACT_UNKNOWN;
    declare.addEventListener('click', () => {
      const selectedGoal = goal.value;
      const selected = selectedSystemId(instance);
      const claimForGoal = activePlayerClaim(faction, selected) ?? activePlayerClaim(faction);
      const goalSystemId = selected ?? claimForGoal?.systemId ?? null;
      if (selectedGoal === 'claimed_conquest' && !goalSystemId) {
        notify(instance, 'Claim a system or select a map target for a conquest war goal', 'error');
        return;
      }
      safeAction(
        instance,
        () => declareWar(instance.state, {
          attacker: PLAYER_ID,
          defender: faction.id,
          goals: [{
            type: selectedGoal,
            systemIds: goalSystemId ? [goalSystemId] : [],
            target: faction.id,
          }],
        }),
        () => `Formal war declared against ${faction.name}`,
        diplomacyCoop('declareWar', {
          input: {
            attacker: PLAYER_ID,
            defender: faction.id,
            goals: [{
              type: selectedGoal,
              systemIds: goalSystemId ? [goalSystemId] : [],
              target: faction.id,
            }],
          },
        }),
      );
    });
    warActions.appendChild(declare);
    card.appendChild(warActions);
    return card;
  }

  const warMetrics = element('div', 'command-metrics');
  warMetrics.append(
    metric('War score', signed(war.score), 'diplomacy-war-score', war.score >= 0 ? 'command-score--positive' : 'command-score--negative'),
    metric('Our exhaustion', `${Math.round(finite(war.exhaustion?.[PLAYER_ID]))}%`, 'diplomacy-war-player-exhaustion'),
    metric('Their exhaustion', `${Math.round(finite(war.exhaustion?.[faction.id]))}%`, 'diplomacy-war-faction-exhaustion'),
    metric('War events', asArray(war.events).length, 'diplomacy-war-event-count'),
  );
  card.appendChild(warMetrics);
  card.appendChild(element(
    'p',
    'panel-note panel-note--muted',
    `Goals: ${asArray(war.goals).map((goal) => labelize(goal.type)).join(', ') || 'Unspecified'}`,
  ));

  const occupationLedger = element('div', 'command-ledger');
  occupationLedger.id = 'diplomacy-occupations-list';
  occupationLedger.dataset.testid = occupationLedger.id;
  const occupations = asArray(summary.occupations).filter((occupation) => occupation.warId === war.id && occupation.status === 'active');
  if (occupations.length === 0) appendEmpty(occupationLedger, 'No systems are currently occupied in this war.');
  for (const occupation of occupations) {
    appendLedgerRow(
      occupationLedger,
      systemName(instance.state, occupation.systemId),
      `${occupation.occupier === PLAYER_ID ? 'Occupied by us' : 'Enemy occupied'} · sovereign ${occupation.sovereignActor ?? 'unknown'}`,
    );
  }
  card.appendChild(occupationLedger);

  const peaceActions = element('div', 'command-actions');
  const peace = makeButton('diplomacy-white-peace', 'Offer White Peace', 'primary');
  peace.addEventListener('click', () => {
    const input = {
      from: PLAYER_ID,
      to: faction.id,
      message: 'White peace proposal',
      terms: [{ type: 'end_war', warId: war.id, cededSystemIds: [], truceMs: 120000 }],
    };
    const evaluated = previewProposal(instance.state, input);
    if (!evaluated.ok) {
      notify(instance, evaluated.errors.join('; '), 'error');
      instance.refresh();
      return;
    }
    safeAction(
      instance,
      () => submitProposal(instance.state, input, { autoResolve: true }),
      (result) => treatyOutcomeMessage(result, 'White peace', faction.name),
      diplomacyCoop('submitProposal', { input, options: { autoResolve: true } }),
    );
  });
  peaceActions.appendChild(peace);
  card.appendChild(peaceActions);
  return card;
}

function renderCouncilCard(instance, faction, summary) {
  const card = makeCard('Galactic Council', { id: 'diplomacy-council-card' });
  const activeSanction = asArray(summary.council?.sanctions).find((sanction) => (
    sanction.target === faction.id && sanction.status === 'active'
  ));
  card.appendChild(element(
    'p',
    'panel-note panel-note--muted',
    activeSanction
      ? `${faction.name} is under an active council sanction.`
      : `Open a council vote to sanction ${faction.name}.`,
  ));
  const authority = element('div', 'command-metrics');
  authority.append(
    metric('Our authority', councilAuthority(instance.model.viewState, PLAYER_ID), 'diplomacy-council-player-authority'),
    metric(`${faction.name} authority`, councilAuthority(instance.model.viewState, faction.id), 'diplomacy-council-faction-authority'),
  );
  card.appendChild(authority);
  const councilActions = element('div', 'command-actions');
  const resolutionSelect = makeSelect('diplomacy-council-resolution-type', [
    ['sanction', 'Sanctions'], ['repeal_sanction', 'Sanction Repeal'], ['condemnation', 'Condemnation'],
    ['trade_embargo', 'Trade Embargo'], ['emergency_coalition', 'Emergency Coalition'],
    ['collective_defense', 'Collective Defense'], ['helioclast_inspection', 'Helioclast Inspection'],
  ]);
  resolutionSelect.value = activeSanction ? 'repeal_sanction' : 'sanction';
  const propose = makeButton(
    'diplomacy-council-sanction',
    'Open Council Vote',
    'primary',
  );
  propose.addEventListener('click', () => safeAction(
    instance,
    () => proposeCouncilResolution(instance.state, {
      proposer: PLAYER_ID,
      target: faction.id,
      type: resolutionSelect.value,
      reason: activeSanction ? 'Diplomatic normalization' : 'Threat to galactic stability',
    }),
    () => `Council ${labelize(resolutionSelect.value)} vote opened`,
    diplomacyCoop('proposeCouncilResolution', {
      input: {
        proposer: PLAYER_ID,
        target: faction.id,
        type: resolutionSelect.value,
        reason: activeSanction ? 'Diplomatic normalization' : 'Threat to galactic stability',
      },
    }),
  ));
  councilActions.append(resolutionSelect, propose);
  card.appendChild(councilActions);

  const resolutions = element('div', 'command-ledger');
  resolutions.id = 'diplomacy-council-resolutions';
  resolutions.dataset.testid = resolutions.id;
  const voting = asArray(summary.council?.resolutions).filter((resolution) => resolution.status === 'voting');
  if (voting.length === 0) appendEmpty(resolutions, 'No council resolutions are open for voting.');
  for (const resolution of voting) {
    const row = element('div', 'command-ledger__row');
    row.dataset.testid = `diplomacy-council-resolution-${resolution.id}`;
    const targetName = actorFactionList(instance.state).find((entry) => entry.id === resolution.target)?.name ?? resolution.target;
    const copy = element('div');
    copy.append(
      element('strong', '', `${labelize(resolution.type)} · ${targetName}`),
      element('div', 'panel-note panel-note--muted', `Your vote: ${labelize(resolution.votes?.[PLAYER_ID] ?? 'not cast')} · closes in ${formatDuration(resolution.votingEndsAt - finite(instance.state.time))}`),
    );
    const votes = element('div', 'command-actions');
    for (const vote of ['yes', 'no', 'abstain']) {
      const button = makeButton(`diplomacy-council-${resolution.id}-vote-${vote}`, labelize(vote));
      button.addEventListener('click', () => safeAction(
        instance,
        () => castCouncilVote(instance.state, resolution.id, PLAYER_ID, vote),
        () => `Council vote recorded: ${labelize(vote)}`,
        diplomacyCoop('castCouncilVote', {
          resolutionId: resolution.id,
          voterId: PLAYER_ID,
          vote,
        }),
      ));
      votes.appendChild(button);
    }
    row.append(copy, votes);
    resolutions.appendChild(row);
  }
  card.appendChild(resolutions);
  return card;
}

function renderOverviewCard(instance, faction, summary) {
  const card = makeCard('Current Diplomatic Situation', { id: 'diplomacy-overview-card', wide: true });
  const activeAgreements = asArray(faction.agreements);
  const activeGrievances = asArray(summary.grievances).filter((entry) => entry.status === 'active'
    && [entry.aggrieved, entry.against].includes(PLAYER_ID) && [entry.aggrieved, entry.against].includes(faction.id));
  const metrics = element('div', 'command-metrics');
  metrics.append(
    metric('Stance', labelize(faction.status), 'diplomacy-overview-stance'),
    metric('Obligations', activeAgreements.length, 'diplomacy-overview-obligations'),
    metric('Grievances', activeGrievances.length, 'diplomacy-overview-grievances'),
    metric('Unread comms', asArray(summary.transmissions).filter((entry) => !entry.read
      && [entry.from, entry.to].includes(faction.id)).length, 'diplomacy-overview-comms'),
  );
  card.appendChild(metrics);
  const calls = asArray(summary.callsToArms).filter((entry) => entry.status === 'pending' && entry.ally === PLAYER_ID);
  for (const call of calls) {
    const row = element('div', 'command-ledger__row');
    const actions = element('div', 'command-actions');
    const accept = makeButton(`diplomacy-call-${call.id}-accept`, 'Join Defense', 'primary');
    const refuse = makeButton(`diplomacy-call-${call.id}-refuse`, 'Refuse');
    accept.addEventListener('click', () => safeAction(instance,
      () => respondToCallToArms(instance.state, call.id, true, PLAYER_ID), 'Defensive call honored',
      diplomacyCoop('respondToCallToArms', { callId: call.id, accept: true, actorId: PLAYER_ID })));
    refuse.addEventListener('click', () => safeAction(instance,
      () => respondToCallToArms(instance.state, call.id, false, PLAYER_ID), 'Defensive call refused; treaty consequences applied',
      diplomacyCoop('respondToCallToArms', { callId: call.id, accept: false, actorId: PLAYER_ID })));
    actions.append(accept, refuse);
    row.append(element('strong', '', `Call to arms from ${call.caller}`), actions);
    card.appendChild(row);
  }
  const transmissions = element('div', 'command-ledger');
  const relevant = asArray(summary.transmissions).filter((entry) => [entry.from, entry.to].includes(faction.id)).slice(-8).reverse();
  if (!relevant.length) appendEmpty(transmissions, 'No transmissions from this faction.');
  for (const entry of relevant) appendLedgerRow(transmissions, entry.subject ?? labelize(entry.kind), `T+${Math.round(finite(entry.createdAt) / 1000)}s`);
  card.appendChild(transmissions);
  return card;
}

function historyLabel(entry, state) {
  const faction = actorFactionList(state).find((candidate) => candidate.id === entry.factionId);
  const suffix = faction ? ` · ${faction.name}` : '';
  return `${labelize(entry.type)}${suffix}`;
}

function renderHistoryCard(state, summary) {
  const card = makeCard('Recent Diplomatic History', { id: 'diplomacy-history-card', wide: true });
  const ledger = element('div', 'command-ledger');
  ledger.id = 'diplomacy-history-list';
  ledger.dataset.testid = ledger.id;
  const history = asArray(summary.history).slice(-16).reverse();
  if (history.length === 0) appendEmpty(ledger, 'No diplomatic events have been recorded.');
  for (const entry of history) {
    appendLedgerRow(
      ledger,
      historyLabel(entry, state),
      `T+${Math.round(finite(entry.at) / 1000)}s`,
      { testid: `diplomacy-history-${entry.id}` },
    );
  }
  card.appendChild(ledger);
  return card;
}

function refresh(instance) {
  const captured = captureControls(instance.root);
  let model;
  try {
    model = readModel(instance.state);
  } catch (error) {
    clear(instance.refs.grid);
    const card = makeCard('Diplomacy Unavailable', { wide: true });
    card.appendChild(element('p', 'panel-note command-status--blocked', error?.message ?? String(error)));
    instance.refs.grid.appendChild(card);
    notify(instance, error?.message ?? String(error), 'error');
    return null;
  }
  const { summary, viewState } = model;
  instance.model = model;
  instance.refs.globalFactions.textContent = summary.factions.length.toLocaleString();
  instance.refs.globalAgreements.textContent = summary.agreements.filter((entry) => entry.status === 'active').length.toLocaleString();
  instance.refs.globalWars.textContent = summary.wars.filter((entry) => entry.status === 'active').length.toLocaleString();
  instance.refs.globalCouncil.textContent = summary.council.resolutions.filter((entry) => entry.status === 'voting').length.toLocaleString();

  const previousFactionId = instance.selectedFactionId ?? instance.refs.factionSelect.value;
  clear(instance.refs.factionSelect);
  for (const faction of summary.factions) {
    const option = element('option', '', `${faction.name} · ${labelize(faction.status)}`);
    option.value = faction.id;
    instance.refs.factionSelect.appendChild(option);
  }
  instance.selectedFactionId = summary.factions.some((entry) => entry.id === previousFactionId)
    ? previousFactionId
    : summary.factions[0]?.id ?? null;
  instance.refs.factionSelect.value = instance.selectedFactionId ?? '';
  instance.refs.factionSelect.disabled = summary.factions.length < 2;

  clear(instance.refs.grid);
  if (!summary.unlocked) {
    const locked = makeCard('Diplomacy Locked', { wide: true, id: 'diplomacy-locked-card' });
    locked.appendChild(element(
      'p',
      'empty-state',
      'Detect a major faction through exploration, intercepted ships, or a border encounter to open diplomacy.',
    ));
    instance.refs.grid.appendChild(locked);
    restoreControls(instance.root, captured);
    return summary;
  }
  const faction = summary.factions.find((entry) => entry.id === instance.selectedFactionId);
  if (!faction) {
    const empty = makeCard('No Known Factions', { wide: true });
    appendEmpty(empty, 'No foreign polity is available for diplomacy.');
    instance.refs.grid.appendChild(empty);
    restoreControls(instance.root, captured);
    return summary;
  }

  const leverage = diplomaticLeverage(viewState, PLAYER_ID, faction.id);
  for (const button of instance.refs.viewButtons) button.classList.toggle('is-active', button.dataset.diplomacyView === instance.activeView);
  if (instance.activeView === 'overview') instance.refs.grid.append(
    renderOverviewCard(instance, faction, summary),
    renderRelationshipCard(instance, faction, leverage),
  );
  if (instance.activeView === 'relations') instance.refs.grid.append(renderRelationshipCard(instance, faction, leverage));
  if (instance.activeView === 'negotiation') instance.refs.grid.append(
    renderNegotiationsCard(instance, faction, viewState),
    renderDealBuilderCard(instance, faction, viewState),
  );
  if (instance.activeView === 'conflicts') instance.refs.grid.append(renderWarCard(instance, faction, summary));
  if (instance.activeView === 'council') instance.refs.grid.append(renderCouncilCard(instance, faction, summary));
  if (instance.activeView === 'history') instance.refs.grid.append(renderHistoryCard(instance.state, summary));
  restoreControls(instance.root, captured);
  return summary;
}

function buildPanel(container, state, options) {
  clear(container);
  const root = element('div', 'command-screen');
  root.id = 'diplomacy-command-screen';
  root.dataset.testid = root.id;
  const header = element('header', 'command-screen__header');
  const heading = element('div');
  heading.append(
    element('h2', 'command-screen__title', 'Galactic Diplomacy'),
    element('p', 'panel-note panel-note--muted', 'Build relationships, negotiate binding terms, formalize claims and war goals, settle occupations, and lead council votes.'),
  );
  const globalMetrics = element('div', 'command-metrics');
  const factionsMetric = metric('Foreign powers', '0', 'diplomacy-global-factions');
  const agreementsMetric = metric('Agreements', '0', 'diplomacy-global-agreements');
  const warsMetric = metric('Active wars', '0', 'diplomacy-global-wars');
  const councilMetric = metric('Council votes', '0', 'diplomacy-global-council');
  globalMetrics.append(factionsMetric, agreementsMetric, warsMetric, councilMetric);
  header.append(heading, globalMetrics);

  const selectorForm = element('div', 'command-form');
  const factionSelect = makeSelect('diplomacy-faction-select', []);
  const selectorLabel = element('label');
  selectorLabel.append(element('span', '', 'Foreign polity'), factionSelect);
  selectorForm.appendChild(selectorLabel);
  const viewNav = element('nav', 'diplomacy-view-tabs');
  viewNav.setAttribute('aria-label', 'Diplomacy views');
  const viewButtons = DIPLOMACY_VIEWS.map((viewId) => {
    const button = makeButton(`diplomacy-view-${viewId}`, labelize(viewId));
    button.dataset.diplomacyView = viewId;
    viewNav.appendChild(button);
    return button;
  });
  const live = element('p', 'panel-note panel-note--muted');
  live.id = 'diplomacy-action-status';
  live.dataset.testid = live.id;
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const grid = element('div', 'command-screen__grid');
  root.append(header, selectorForm, viewNav, live, grid);
  container.appendChild(root);

  const instance = {
    container,
    root,
    state,
    options,
    selectedFactionId: container.dataset.diplomacyFactionId ?? null,
    activeView: DIPLOMACY_VIEWS.includes(container.dataset.diplomacyView)
      ? container.dataset.diplomacyView
      : 'overview',
    model: null,
    refs: {
      factionSelect,
      live,
      grid,
      viewButtons,
      globalFactions: factionsMetric.querySelector('strong'),
      globalAgreements: agreementsMetric.querySelector('strong'),
      globalWars: warsMetric.querySelector('strong'),
      globalCouncil: councilMetric.querySelector('strong'),
    },
    refresh: null,
  };
  instance.refresh = () => refresh(instance);
  factionSelect.addEventListener('change', () => {
    instance.selectedFactionId = factionSelect.value;
    container.dataset.diplomacyFactionId = factionSelect.value;
    instance.refresh();
  });
  for (const button of viewButtons) button.addEventListener('click', () => {
    instance.activeView = button.dataset.diplomacyView;
    container.dataset.diplomacyView = instance.activeView;
    instance.refresh();
  });
  return instance;
}

/**
 * Mount or refresh the command screen. Repeated calls reuse the panel instance,
 * so focused controls and the selected foreign faction survive simulation ticks.
 */
export function renderDiplomacyCommandScreen(container, state, options = {}) {
  if (!container) return null;
  let instance = panelInstances.get(container);
  if (!instance || instance.root.parentNode !== container) {
    instance = buildPanel(container, state, options);
    panelInstances.set(container, instance);
  } else {
    instance.state = state;
    instance.options = options;
  }
  instance.refresh();
  return instance;
}
