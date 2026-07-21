// Aggregate command UI for late-game production and strategic expansion.
//
// This module deliberately renders one row per order/campaign. A 400-ship
// manifest or a 50-system expansion remains a compact aggregate in the DOM.

import {
  bulkProductionSummary,
  cancelBulkProductionOrder,
  createBulkProductionOrder,
  pauseBulkProductionOrder,
  previewBulkProductionOrder,
  resumeBulkProductionOrder,
} from './bulk-production.js';
import {
  cancelExpansionCampaign,
  createExpansionCampaign,
  pauseExpansionCampaign,
  previewExpansionCampaign,
  resumeExpansionCampaign,
  strategicOrdersSummary,
} from './strategic-operations.js';
import { strategicIntegrationHooks } from './strategic-integration.js';
import { builderDroneSummary } from './builder-drones.js';
import {
  listProductionProducts,
  normalizeProductionProduct,
} from './production-products.js';

const PANEL_VERSION = 2;
const TERMINAL_BULK_STATUSES = new Set(['complete', 'cancelled']);
const TERMINAL_CAMPAIGN_STATUSES = new Set(['complete', 'cancelled']);
const PHASE_ORDER = [
  'planned',
  'recon',
  'staging',
  'traveling',
  'fighting',
  'capturing',
  'constructing',
  'securing',
  'complete',
  'cancelled',
];
const panelInstances = new WeakMap();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function copyCounts(value = {}) {
  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [key, Math.max(0, finite(count))]),
  );
}

function compactOrder(order) {
  return {
    id: order.id,
    name: order.name,
    status: order.status,
    storedStatus: order.storedStatus,
    priority: order.priority,
    progress: finite(order.progress),
    spent: finite(order.spent),
    budgetCap: order.budgetCap == null ? null : finite(order.budgetCap),
    protectedReserve: finite(order.protectedReserve),
    counts: copyCounts(order.counts),
    manifest: (order.manifest ?? []).map((line) => ({
      kind: line.kind,
      productId: line.productId,
      hull: line.hull,
      quantity: finite(line.quantity),
      completed: finite(line.completed),
      remaining: finite(line.remaining),
    })),
    deliveryCounts: copyCounts(order.deliveryCounts),
    rally: order.rally ? { ...order.rally } : { type: 'none' },
    packaging: order.packaging ? { ...order.packaging } : { mode: 'unassigned' },
    blockerCount: order.blockers?.length ?? 0,
    blocker: order.blockers?.[0]?.message ?? null,
    linkedCampaignId: order.linkedCampaignId ?? null,
  };
}

function compactCampaign(campaign) {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    pauseReason: campaign.pauseReason ?? null,
    templateId: campaign.templateId,
    progress: {
      complete: finite(campaign.progress?.complete),
      total: finite(campaign.progress?.total),
      phases: copyCounts(campaign.progress?.phases),
    },
    budget: {
      limit: campaign.budget?.limit == null ? null : finite(campaign.budget.limit),
      reserve: finite(campaign.budget?.reserve),
      spent: finite(campaign.budget?.spent),
      projected: finite(campaign.budget?.projected),
    },
    concurrency: finite(campaign.policy?.concurrency, 1),
    blockerCount: campaign.blockers?.length ?? 0,
    blocker: campaign.blockers?.[0]?.message ?? null,
    linkedBulkOrderCount: campaign.linkedBulkOrderIds?.length ?? 0,
    operationDoctrine: campaign.operationDoctrine ? { ...campaign.operationDoctrine } : null,
    operationStatus: campaign.operationStatus ? structuredClone(campaign.operationStatus) : null,
  };
}

/**
 * Return the compact read model used by both the UI and automation tests.
 * It never includes individual ships, deliveries, or target rows.
 */
export function operationsPanelSnapshot(state) {
  const bulk = bulkProductionSummary(state);
  const strategic = strategicOrdersSummary(state, { includeTargets: false });
  const orders = bulk.orders.map(compactOrder);
  const campaigns = strategic.campaigns.map(compactCampaign);
  const drones = builderDroneSummary(state);
  return {
    version: PANEL_VERSION,
    credits: finite(state?.credits),
    bulk: {
      totals: copyCounts(bulk.totals),
      deliveryCount: finite(bulk.deliveryCount),
      pendingDeliveryCount: bulk.pendingDeliveries?.length ?? 0,
      activeOrderCount: orders.filter((order) => !TERMINAL_BULK_STATUSES.has(order.storedStatus)).length,
      orders,
    },
    strategic: {
      counts: copyCounts(strategic.counts),
      templates: strategic.templates.map((template) => ({ ...template })),
      activeCampaignCount: campaigns.filter(
        (campaign) => !TERMINAL_CAMPAIGN_STATUSES.has(campaign.status),
      ).length,
      campaigns,
    },
    drones: {
      capacity: drones.capacity,
      available: drones.idle,
      reserved: drones.reserved,
      embarked: drones.embarked,
      active: drones.active,
      building: drones.building,
    },
  };
}

function normalizeHull(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

function addManifestLine(merged, errors, rawProduct, rawQuantity, label) {
  const product = normalizeProductionProduct(
    typeof rawProduct === 'string' ? { hull: normalizeHull(rawProduct) } : rawProduct,
  );
  const quantity = Number(rawQuantity);
  if (!product.productId) {
    errors.push(`${label}: product is missing`);
    return;
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    errors.push(`${label}: quantity must be a positive whole number`);
    return;
  }
  const key = `${product.kind}:${product.productId}`;
  const current = merged.get(key) ?? { ...product, quantity: 0 };
  current.quantity += quantity;
  merged.set(key, current);
}

function readBulkManifestRows(refs) {
  const errors = [];
  const merged = new Map();
  for (const [index, row] of refs.bulkManifestRows.querySelectorAll('[data-bulk-manifest-row]').entries()) {
    const rawValue = row.querySelector('[data-bulk-hull]')?.value ?? '';
    const [kind, productId] = rawValue.split(':');
    const quantity = row.querySelector('[data-bulk-quantity]')?.value;
    addManifestLine(merged, errors, { kind, productId }, quantity, `Unit ${index + 1}`);
  }
  const manifest = [...merged.values()];
  if (manifest.length === 0 && errors.length === 0) errors.push('Add at least one product');
  return { ok: errors.length === 0, manifest, errors };
}

/** Parse `corvette x400`, `400 corvette`, `corvette: 400`, or JSON manifests. */
export function parseBulkManifest(raw) {
  const text = String(raw ?? '').trim();
  const errors = [];
  const merged = new Map();
  if (!text) return { ok: false, manifest: [], errors: ['Manifest is empty'] };

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const lines = Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed).map(([hull, quantity]) => ({ hull, quantity }));
      for (const [index, line] of lines.entries()) {
        addManifestLine(merged, errors, line, line?.quantity, `Line ${index + 1}`);
      }
    } catch (error) {
      errors.push(`Manifest JSON is invalid: ${error.message}`);
    }
  } else {
    const tokens = text.split(/[\n,;]+/).map((token) => token.trim()).filter(Boolean);
    for (const [index, token] of tokens.entries()) {
      const hullFirst = token.match(/^(.+?)\s*(?:x|\*|:|=)\s*(\d+)$/i);
      const quantityFirst = token.match(/^(\d+)\s*(?:x|\*)?\s+(.+)$/i);
      const trailingQuantity = token.match(/^(.+?)\s+(\d+)$/);
      if (hullFirst) {
        addManifestLine(merged, errors, hullFirst[1], hullFirst[2], `Line ${index + 1}`);
      } else if (quantityFirst) {
        addManifestLine(merged, errors, quantityFirst[2], quantityFirst[1], `Line ${index + 1}`);
      } else if (trailingQuantity) {
        addManifestLine(merged, errors, trailingQuantity[1], trailingQuantity[2], `Line ${index + 1}`);
      } else {
        errors.push(`Line ${index + 1}: use "hull x quantity"`);
      }
    }
  }

  const manifest = [...merged.values()];
  if (manifest.length === 0 && errors.length === 0) errors.push('Manifest is empty');
  return { ok: errors.length === 0, manifest, errors };
}

function parseTargetIds(raw) {
  return [...new Set(
    String(raw ?? '').split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean),
  )];
}

/** Parse one named war authorization per line: `faction-id: claimed conquest`. */
export function parseWarAuthorizations(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, authorizations: [], errors: [] };
  const errors = [];
  const authorizations = [];
  const seen = new Set();
  const tokens = text.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
  for (const [index, token] of tokens.entries()) {
    const match = token.match(/^([^:=\s]+)(?:\s*[:=]\s*(.+))?$/);
    if (!match) {
      errors.push(`Authorization ${index + 1}: use "faction-id: war goal"`);
      continue;
    }
    const factionId = match[1];
    if (seen.has(factionId)) {
      errors.push(`Authorization ${index + 1}: ${factionId} is duplicated`);
      continue;
    }
    seen.add(factionId);
    authorizations.push({
      factionId,
      warGoal: String(match[2] ?? 'claimed_conquest').trim().toLowerCase().replace(/[\s-]+/g, '_'),
      authorized: true,
    });
  }
  return { ok: errors.length === 0, authorizations, errors };
}

function element(tag, className = '', text = null) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text != null) result.textContent = String(text);
  return result;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function makeInput(id, type, value = '') {
  const input = element('input');
  input.id = id;
  input.dataset.testid = id;
  input.type = type;
  input.value = value;
  return input;
}

function makeSelect(id, options) {
  const select = element('select');
  select.id = id;
  select.dataset.testid = id;
  for (const [value, label] of options) {
    const option = element('option', '', label);
    option.value = value;
    select.appendChild(option);
  }
  return select;
}

function makeField(labelText, control, options = {}) {
  const label = element('label');
  if (options.wide) label.style.gridColumn = '1 / -1';
  const caption = element('span', '', labelText);
  label.append(caption, control);
  return label;
}

function makeButton(id, label, kind = 'ghost') {
  const button = element('button', `btn btn--${kind} btn--sm`, label);
  button.type = 'button';
  if (id) {
    button.id = id;
    button.dataset.testid = id;
  }
  return button;
}

function metric(label, id) {
  const wrapper = element('div', 'command-metric');
  const value = element('strong', '', '0');
  value.id = id;
  value.dataset.testid = id;
  wrapper.append(label, value);
  return { wrapper, value };
}

function statusClass(status) {
  if (['active', 'complete'].includes(status)) return 'command-status--active';
  if (['blocked', 'cancelling'].includes(status)) return 'command-status--blocked';
  return '';
}

function labelize(value) {
  return String(value ?? '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCredits(value) {
  return `${Math.round(finite(value)).toLocaleString()} cr`;
}

function formatPercent(value) {
  return `${Math.round(Math.max(0, Math.min(1, finite(value))) * 100)}%`;
}

function optionalNumber(input, label, errors) {
  if (input.value.trim() === '') return null;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be zero or greater`);
    return null;
  }
  return value;
}

function updateBulkHullOptions(refs, state) {
  const products = listProductionProducts(state);
  const values = products.map((product) => `${product.kind}:${product.productId}`);
  const signature = values.join('|');
  for (const select of refs.bulkManifestRows.querySelectorAll('[data-bulk-hull]')) {
    if (select.dataset.optionsSignature === signature) continue;
    const previous = select.value;
    clear(select);
    for (const product of products) {
      const option = element('option', '', product.label);
      option.value = `${product.kind}:${product.productId}`;
      select.appendChild(option);
    }
    select.value = values.includes(previous)
      ? previous
      : (values.includes('hull:corvette') ? 'hull:corvette' : values[0] ?? '');
    select.dataset.optionsSignature = signature;
  }
}

function syncBulkManifestRemoveButtons(refs) {
  const rows = [...refs.bulkManifestRows.querySelectorAll('[data-bulk-manifest-row]')];
  for (const row of rows) {
    const button = row.querySelector('[data-remove-bulk-manifest-row]');
    if (button) button.disabled = rows.length === 1;
  }
}

function appendBulkManifestRow(refs, state, { hull = 'corvette', kind = 'hull', productId = hull, quantity = 1 } = {}) {
  refs.bulkManifestRowId = (refs.bulkManifestRowId ?? 0) + 1;
  const rowId = refs.bulkManifestRowId;
  const row = element('div', 'bulk-manifest-row');
  row.dataset.bulkManifestRow = String(rowId);

  const hullSelect = makeSelect(`ops-bulk-hull-${rowId}`, []);
  hullSelect.dataset.bulkHull = '';
  hullSelect.setAttribute('aria-label', `Production item ${rowId}`);
  const quantityInput = makeInput(`ops-bulk-quantity-${rowId}`, 'number', String(quantity));
  quantityInput.dataset.bulkQuantity = '';
  quantityInput.min = '1';
  quantityInput.step = '1';
  quantityInput.inputMode = 'numeric';
  quantityInput.setAttribute('aria-label', `Quantity for ship type ${rowId}`);
  const remove = makeButton(null, 'Remove');
  remove.classList.add('bulk-manifest-row__remove');
  remove.dataset.removeBulkManifestRow = '';
  remove.setAttribute('aria-label', `Remove ship type ${rowId}`);
  remove.addEventListener('click', () => {
    row.remove();
    syncBulkManifestRemoveButtons(refs);
  });

  row.append(hullSelect, quantityInput, remove);
  refs.bulkManifestRows.appendChild(row);
  updateBulkHullOptions(refs, state);
  const value = `${kind}:${productId}`;
  if ([...hullSelect.options].some((option) => option.value === value)) hullSelect.value = value;
  syncBulkManifestRemoveButtons(refs);
  return row;
}

function appendMessages(container, messages, className = 'panel-note panel-note--muted', limit = 4) {
  for (const message of messages.slice(0, limit)) {
    container.appendChild(element('p', className, message));
  }
  if (messages.length > limit) {
    container.appendChild(element(
      'p',
      'panel-note panel-note--muted',
      `+${messages.length - limit} more`,
    ));
  }
}

function renderBulkPreview(container, result, parserErrors = []) {
  clear(container);
  const errors = [
    ...parserErrors,
    ...(result?.errors ?? []).map((entry) => entry.message ?? String(entry)),
  ];
  container.dataset.status = errors.length > 0 || result?.ok === false ? 'error' : 'ok';
  if (errors.length > 0) {
    appendMessages(container, errors, 'panel-note command-status--blocked');
    return;
  }
  if (!result) {
    container.appendChild(element('p', 'panel-note panel-note--muted', 'Preview an aggregate manifest before issuing it.'));
    return;
  }
  const metrics = element('div', 'command-metrics');
  for (const [label, value] of [
    ['Units', result.totalQuantity?.toLocaleString?.() ?? result.totalQuantity],
    ['Projected', formatCredits(result.totalCost)],
    ['Tickets now', result.materializableNow],
    ['Shipyards', result.capacity?.operationalShipyards ?? 0],
  ]) {
    const item = element('div', 'command-metric', label);
    item.appendChild(element('strong', '', value));
    metrics.appendChild(item);
  }
  container.appendChild(metrics);
  appendMessages(
    container,
    (result.warnings ?? []).map((entry) => entry.message ?? String(entry)),
  );
}

function renderCampaignPreview(container, result, clientErrors = []) {
  clear(container);
  const blockers = [
    ...clientErrors,
    ...(result?.blockers ?? []).map((entry) => entry.message ?? String(entry)),
  ];
  container.dataset.status = blockers.length > 0 || result?.ok === false ? 'error' : 'ok';
  if (!result && blockers.length === 0) {
    container.appendChild(element('p', 'panel-note panel-note--muted', 'Preview targets, routes, construction, and authorization before launch.'));
    return;
  }
  if (result) {
    const metrics = element('div', 'command-metrics');
    for (const [label, value] of [
      ['Selected', `${result.selectedCount ?? 0}/${result.requestedCount ?? 0}`],
      ['Build cost', formatCredits(result.budget?.totalProjectedCost)],
      ['Concurrency', result.policy?.concurrency ?? 0],
      ['Recon needed', result.targets?.filter((target) => target.requiresRecon).length ?? 0],
    ]) {
      const item = element('div', 'command-metric', label);
      item.appendChild(element('strong', '', value));
      metrics.appendChild(item);
    }
    container.appendChild(metrics);
    const manifest = (result.projectedOperation?.manifest ?? []).map((line) => (
      `${line.kind === 'builder_drone' ? 'Construction Drone' : labelize(line.productId ?? line.hull)} × ${line.quantity}`
    )).join(' + ');
    const captureThresholds = (result.targets ?? []).map((target) => target.requirements?.captureForce ?? 0);
    const combatThresholds = (result.targets ?? []).map((target) => target.requirements?.combatPower ?? 0);
    const range = (values) => values.length
      ? `${Math.min(...values).toLocaleString()}–${Math.max(...values).toLocaleString()}`
      : '0';
    const buildList = (result.template?.steps ?? []).map((step) => labelize(step.structureType)).join(' → ');
    const payload = finite(result.doctrine?.dronePayload, 0);
    container.appendChild(element(
      'p',
      'panel-note panel-note--muted',
      `Doctrine: ${labelize(result.doctrine?.id ?? result.template?.id ?? 'generalist')} · `
        + `capture ${result.doctrine?.captureForceMultiplier ?? result.policy?.captureForceMultiplier}× (${range(captureThresholds)}) · `
        + `combat ${result.doctrine?.combatPowerMultiplier ?? result.policy?.combatPowerMultiplier}× (${range(combatThresholds)}) · `
        + `${payload} drones per target + ${result.doctrine?.campaignReserveDrones ?? 1} reserve`,
    ));
    container.appendChild(element(
      'p',
      'panel-note panel-note--muted',
      `Production shortage for ${result.projectedOperation?.concurrentPackageCount ?? 0} coordinated packages: `
        + (manifest || 'None — existing assets satisfy the package'),
    ));
    container.appendChild(element('p', 'panel-note panel-note--muted', `Post-capture build: ${buildList || 'No construction jobs'}`));
    const substitutions = [...new Set((result.targets ?? []).flatMap((target) => (
      (target.projectedOperation?.roleSubstitutions ?? []).map((entry) => `${labelize(entry.role)} → ${labelize(entry.fallbackRole)}`)
    )))];
    if (substitutions.length) {
      container.appendChild(element('p', 'panel-note command-status--blocked', `Role substitutions: ${substitutions.join(', ')}`));
    }
  }
  appendMessages(container, blockers, 'panel-note command-status--blocked');
  appendMessages(
    container,
    (result?.warnings ?? []).map((entry) => entry.message ?? String(entry)),
  );
}

function buildBulkSpec(refs) {
  const parsed = readBulkManifestRows(refs);
  const errors = [...parsed.errors];
  const budgetCap = optionalNumber(refs.bulkBudget, 'Budget cap', errors);
  const protectedReserve = optionalNumber(refs.bulkReserve, 'Protected reserve', errors) ?? 0;
  const rallyType = refs.bulkRally.value;
  const rallyTarget = refs.bulkRallyTarget.value.trim();
  let rally = { type: 'none' };
  if (rallyType === 'flagship') rally = { type: 'flagship' };
  if (rallyType === 'system') rally = { type: 'system', systemId: rallyTarget };
  if (rallyType === 'fleet') rally = { type: 'fleet', fleetId: rallyTarget };

  const packagingMode = refs.bulkPackaging.value;
  // The production API accepts null/string for the intentionally unassigned
  // case and normalizes it to the persisted aggregate packaging object.
  let packaging = null;
  if (packagingMode === 'single_fleet') packaging = { mode: 'single_fleet' };
  if (packagingMode === 'new_fleets') {
    packaging = {
      mode: 'new_fleets',
      splitSize: Math.max(1, Math.floor(finite(refs.bulkSplitSize.value, 40))),
    };
  }
  if (packagingMode === 'reinforce') {
    packaging = { mode: 'reinforce', fleetId: refs.bulkFleetId.value.trim() };
  }
  return {
    errors,
    spec: {
      name: refs.bulkName.value.trim() || 'Bulk Production Order',
      manifest: parsed.manifest,
      priority: refs.bulkPriority.value,
      budgetCap,
      protectedReserve,
      rally,
      packaging,
      allowedShipyardIds: null,
    },
  };
}

function buildCampaignSpec(instance) {
  const { refs, state } = instance;
  const errors = [];
  const mode = refs.campaignMode.value;
  const targets = parseTargetIds(refs.campaignTargets.value);
  const count = Math.floor(finite(refs.campaignCount.value));
  if (mode === 'explicit' && targets.length === 0) errors.push('Add at least one explicit target system');
  if (mode === 'count' && count <= 0) errors.push('Target count must be a positive whole number');
  const budgetLimit = optionalNumber(refs.campaignBudget, 'Campaign budget', errors);
  const reserve = optionalNumber(refs.campaignReserve, 'Campaign reserve', errors) ?? 0;
  const maxThreat = optionalNumber(refs.campaignMaxThreat, 'Maximum threat', errors);
  const wars = parseWarAuthorizations(refs.campaignWars.value);
  errors.push(...wars.errors);
  const filters = { owner: refs.campaignOwner.value };
  if (maxThreat != null) filters.maxThreat = maxThreat;
  if (refs.campaignIntel.checked) filters.requireIntel = true;
  const spec = {
    name: refs.campaignName.value.trim() || 'Strategic Expansion Campaign',
    galaxyId: state.activeGalaxyId,
    templateId: refs.campaignTemplate.value,
    concurrency: Math.max(1, Math.min(8, Math.floor(finite(refs.campaignConcurrency.value, 3)))),
    budgetLimit,
    reserve,
    allowPartial: refs.campaignPartial.checked,
    warAuthorizations: wars.authorizations,
    requiredStructureType: 'outpost',
    filters,
  };
  if (mode === 'explicit') spec.targets = targets;
  else spec.count = count;
  return { errors, spec };
}

function notify(instance, message, kind = '') {
  if (typeof instance.options.toast === 'function') instance.options.toast(message, kind);
}

function safeAction(instance, action, successMessage, coopSpec = null) {
  if (coopSpec?.command && typeof instance.options?.coopRun === 'function') {
    instance.options.coopRun(coopSpec.command, coopSpec.payload ?? {}).then((result) => {
      notify(instance, result?.ok ? successMessage(result) : (result?.reason ?? 'Order failed'), result?.ok ? 'ok' : 'error');
      instance.refresh();
    }).catch((error) => {
      notify(instance, error?.message ?? String(error), 'error');
    });
    return { ok: true, pending: true };
  }
  try {
    const result = action();
    notify(instance, result?.ok ? successMessage(result) : (result?.reason ?? 'Order failed'), result?.ok ? 'ok' : 'error');
    instance.refresh();
    return result;
  } catch (error) {
    notify(instance, error?.message ?? String(error), 'error');
    return { ok: false, reason: error?.message ?? String(error) };
  }
}

function syncBulkFields(refs) {
  const needsRallyTarget = ['system', 'fleet'].includes(refs.bulkRally.value);
  refs.bulkRallyTargetField.classList.toggle('hidden', !needsRallyTarget);
  refs.bulkSplitField.classList.toggle('hidden', refs.bulkPackaging.value !== 'new_fleets');
  refs.bulkFleetField.classList.toggle('hidden', refs.bulkPackaging.value !== 'reinforce');
}

function syncCampaignFields(refs) {
  const explicit = refs.campaignMode.value === 'explicit';
  refs.campaignTargetsField.classList.toggle('hidden', !explicit);
  refs.campaignCountField.classList.toggle('hidden', explicit);
  refs.campaignAddSelected.classList.toggle('hidden', !explicit);
}

function renderOrderCard(instance, order) {
  const card = element('article', 'command-card');
  card.dataset.bulkOrderId = order.id;
  card.dataset.testid = `ops-bulk-order-${order.id}`;
  const title = element('h4', 'command-card__title');
  title.append(
    element('span', '', order.name),
    element('span', statusClass(order.status), labelize(order.status)),
  );
  card.appendChild(title);
  const manifest = order.manifest
    .map((line) => `${line.kind === 'builder_drone' ? 'Construction Drone' : labelize(line.productId ?? line.hull)} × ${line.quantity.toLocaleString()}`)
    .join(' + ');
  card.appendChild(element('p', 'panel-note panel-note--muted', manifest || 'Empty manifest'));
  const metrics = element('div', 'command-metrics');
  for (const [label, value] of [
    ['Complete', `${order.counts.completed ?? 0}/${order.counts.ordered ?? 0}`],
    ['Progress', formatPercent(order.progress)],
    ['Remaining', (order.counts.remaining ?? 0).toLocaleString()],
    ['Spent', formatCredits(order.spent)],
  ]) {
    const item = element('div', 'command-metric', label);
    item.appendChild(element('strong', '', value));
    metrics.appendChild(item);
  }
  card.appendChild(metrics);
  const logistics = [
    `Priority: ${labelize(order.priority)}`,
    `Rally: ${labelize(order.rally?.type ?? 'none')}`,
    `Packaging: ${labelize(order.packaging?.mode ?? 'unassigned')}`,
  ].join(' · ');
  card.appendChild(element('p', 'panel-note panel-note--muted', logistics));
  if (order.blocker) card.appendChild(element('p', 'panel-note command-status--blocked', order.blocker));

  const actions = element('div', 'command-actions');
  if (order.storedStatus === 'paused') {
    const resume = makeButton(null, 'Resume', 'primary');
    resume.dataset.bulkAction = 'resume';
    resume.addEventListener('click', () => safeAction(
      instance,
      () => resumeBulkProductionOrder(instance.state, order.id),
      () => `${order.name} resumed`,
      { command: 'resumeBulkProductionOrder', payload: { orderId: order.id } },
    ));
    actions.appendChild(resume);
  } else if (order.storedStatus === 'active') {
    const pause = makeButton(null, 'Pause');
    pause.dataset.bulkAction = 'pause';
    pause.addEventListener('click', () => safeAction(
      instance,
      () => pauseBulkProductionOrder(instance.state, order.id),
      () => `${order.name} paused`,
      { command: 'pauseBulkProductionOrder', payload: { orderId: order.id } },
    ));
    actions.appendChild(pause);
  }
  if (!TERMINAL_BULK_STATUSES.has(order.storedStatus) && order.storedStatus !== 'cancelling') {
    const cancel = makeButton(null, 'Cancel');
    cancel.dataset.bulkAction = 'cancel';
    cancel.addEventListener('click', () => safeAction(
      instance,
      () => cancelBulkProductionOrder(instance.state, order.id),
      (result) => `${order.name} cancelled · ${formatCredits(result.refund ?? result.refunded ?? 0)} refunded`,
      { command: 'cancelBulkProductionOrder', payload: { orderId: order.id } },
    ));
    actions.appendChild(cancel);
  }
  card.appendChild(actions);
  return card;
}

function phaseSummary(phases) {
  return PHASE_ORDER
    .filter((phase) => finite(phases?.[phase]) > 0)
    .map((phase) => `${labelize(phase)} ${finite(phases[phase])}`)
    .join(' · ');
}

function renderCampaignCard(instance, campaign) {
  const card = element('article', 'command-card');
  card.dataset.campaignId = campaign.id;
  card.dataset.testid = `ops-campaign-${campaign.id}`;
  const title = element('h4', 'command-card__title');
  title.append(
    element('span', '', campaign.name),
    element('span', statusClass(campaign.status), labelize(campaign.status)),
  );
  card.appendChild(title);
  const metrics = element('div', 'command-metrics');
  for (const [label, value] of [
    ['Systems', `${campaign.progress.complete}/${campaign.progress.total}`],
    ['Concurrency', campaign.concurrency],
    ['Spent', formatCredits(campaign.budget.spent)],
    ['Fleet orders', campaign.linkedBulkOrderCount],
  ]) {
    const item = element('div', 'command-metric', label);
    item.appendChild(element('strong', '', value));
    metrics.appendChild(item);
  }
  card.appendChild(metrics);
  card.appendChild(element(
    'p',
    'panel-note panel-note--muted',
    phaseSummary(campaign.progress.phases) || 'No targets have advanced yet',
  ));
  const operation = campaign.operationStatus;
  if (operation) {
    const doctrineName = labelize(campaign.operationDoctrine?.id ?? campaign.templateId ?? 'generalist');
    card.appendChild(element(
      'p',
      'panel-note panel-note--muted',
      `${doctrineName} doctrine · ${operation.assignedFleetIds?.length ?? 0} fleets · `
        + `${operation.assignedDroneIds?.length ?? 0}/${operation.requiredDronePayload ?? 0} embarked/assigned drones · `
        + `${operation.reserveDroneIds?.length ?? 0} reserve`,
    ));
    card.appendChild(element(
      'p',
      operation.replacementPending ? 'panel-note command-status--blocked' : 'panel-note panel-note--muted',
      `${operation.replacementPending ? 'Replacement requisition pending · ' : ''}`
        + `Construction ${operation.constructionQueue?.completed ?? 0}/${operation.constructionQueue?.planned ?? 0}`,
    ));
  }
  if (campaign.blocker) card.appendChild(element('p', 'panel-note command-status--blocked', campaign.blocker));
  else if (campaign.pauseReason) card.appendChild(element('p', 'panel-note panel-note--muted', campaign.pauseReason));

  const actions = element('div', 'command-actions');
  if (campaign.status === 'paused') {
    const resume = makeButton(null, 'Resume', 'primary');
    resume.dataset.campaignAction = 'resume';
    resume.addEventListener('click', () => safeAction(
      instance,
      () => resumeExpansionCampaign(instance.state, campaign.id),
      () => `${campaign.name} resumed`,
      { command: 'resumeExpansionCampaign', payload: { campaignId: campaign.id } },
    ));
    actions.appendChild(resume);
  } else if (['active', 'cancelling'].includes(campaign.status)) {
    const pause = makeButton(null, 'Pause');
    pause.dataset.campaignAction = 'pause';
    pause.addEventListener('click', () => safeAction(
      instance,
      () => pauseExpansionCampaign(instance.state, campaign.id),
      () => `${campaign.name} paused`,
      { command: 'pauseExpansionCampaign', payload: { campaignId: campaign.id } },
    ));
    actions.appendChild(pause);
  }
  if (!TERMINAL_CAMPAIGN_STATUSES.has(campaign.status)) {
    const cancelMode = makeSelect('', [
      ['hold', 'Cancel & hold assets'],
      ['return', 'Cancel & return assets'],
      ['pending', 'Cancel pending only'],
    ]);
    cancelMode.dataset.campaignCancelMode = campaign.id;
    cancelMode.setAttribute('aria-label', `Cancellation mode for ${campaign.name}`);
    const cancel = makeButton(null, 'Cancel');
    cancel.dataset.campaignAction = 'cancel';
    cancel.addEventListener('click', () => safeAction(
      instance,
      () => cancelExpansionCampaign(instance.state, campaign.id, cancelMode.value),
      () => `${campaign.name} cancellation issued`,
      { command: 'cancelExpansionCampaign', payload: { campaignId: campaign.id, mode: cancelMode.value } },
    ));
    actions.append(cancelMode, cancel);
  }
  card.appendChild(actions);
  return card;
}

function updateTemplateOptions(select, templates) {
  const previous = select.value;
  const signature = JSON.stringify(templates.map((template) => [template.id, template.name, template.doctrine]));
  if (select.dataset.optionsSignature === signature) return;
  clear(select);
  for (const template of templates) {
    const option = element('option', '', `${template.name}${template.preset ? ' · preset' : ''}`);
    option.value = template.id;
    option.title = `${template.doctrine?.captureForceMultiplier ?? 1.2}× capture · `
      + `${template.doctrine?.combatPowerMultiplier ?? 1.35}× combat · `
      + `${template.doctrine?.dronePayload ?? 2} drones`;
    select.appendChild(option);
  }
  select.value = templates.some((template) => template.id === previous)
    ? previous
    : (templates.some((template) => template.id === 'frontier') ? 'frontier' : templates[0]?.id ?? '');
  select.dataset.optionsSignature = signature;
}

function refreshDynamic(instance) {
  const snapshot = operationsPanelSnapshot(instance.state);
  instance.snapshot = snapshot;
  const { refs } = instance;
  refs.metricCredits.textContent = Math.round(snapshot.credits).toLocaleString();
  refs.metricBulkRemaining.textContent = (snapshot.bulk.totals.remaining ?? 0).toLocaleString();
  refs.metricDeliveries.textContent = snapshot.bulk.pendingDeliveryCount.toLocaleString();
  refs.metricCampaigns.textContent = snapshot.strategic.activeCampaignCount.toLocaleString();
  refs.metricDronesAvailable.textContent = snapshot.drones.available.toLocaleString();
  refs.metricDronesReserved.textContent = snapshot.drones.reserved.toLocaleString();
  refs.metricDronesEmbarked.textContent = snapshot.drones.embarked.toLocaleString();
  refs.metricDronesActive.textContent = snapshot.drones.active.toLocaleString();
  refs.metricDronesBuilding.textContent = snapshot.drones.building.toLocaleString();
  updateBulkHullOptions(refs, instance.state);
  updateTemplateOptions(refs.campaignTemplate, snapshot.strategic.templates);

  const liveOrders = snapshot.bulk.orders.filter(
    (order) => !TERMINAL_BULK_STATUSES.has(order.storedStatus),
  );
  clear(refs.activeBulkOrders);
  if (liveOrders.length === 0) {
    refs.activeBulkOrders.appendChild(element('p', 'panel-note panel-note--muted', 'No active bulk production orders.'));
  } else {
    for (const order of liveOrders) refs.activeBulkOrders.appendChild(renderOrderCard(instance, order));
  }

  const liveCampaigns = snapshot.strategic.campaigns.filter(
    (campaign) => !TERMINAL_CAMPAIGN_STATUSES.has(campaign.status),
  );
  clear(refs.activeCampaigns);
  if (liveCampaigns.length === 0) {
    refs.activeCampaigns.appendChild(element('p', 'panel-note panel-note--muted', 'No active expansion campaigns.'));
  } else {
    for (const campaign of liveCampaigns) refs.activeCampaigns.appendChild(renderCampaignCard(instance, campaign));
  }
  return snapshot;
}

function buildPanel(container, state, options) {
  clear(container);
  const root = element('div', 'command-screen');
  root.id = 'operations-command-screen';
  root.dataset.testid = 'operations-command-screen';
  const header = element('header', 'command-screen__header');
  const heading = element('div');
  heading.append(
    element('h2', 'command-screen__title', 'Strategic Operations'),
    element('p', 'panel-note panel-note--muted', 'Issue bounded aggregate orders. Fleets, shipyards, scouts, and construction drones execute them over time.'),
  );
  const metrics = element('div', 'command-metrics');
  const creditsMetric = metric('Credits', 'ops-metric-credits');
  const remainingMetric = metric('Ships remaining', 'ops-metric-bulk-remaining');
  const deliveryMetric = metric('Pending delivery', 'ops-metric-deliveries');
  const campaignMetric = metric('Active campaigns', 'ops-metric-campaigns-active');
  const dronesAvailableMetric = metric('Drones available', 'ops-metric-drones-available');
  const dronesReservedMetric = metric('Reserved', 'ops-metric-drones-reserved');
  const dronesEmbarkedMetric = metric('Embarked', 'ops-metric-drones-embarked');
  const dronesActiveMetric = metric('Active', 'ops-metric-drones-active');
  const dronesBuildingMetric = metric('Building', 'ops-metric-drones-building');
  metrics.append(
    creditsMetric.wrapper,
    remainingMetric.wrapper,
    deliveryMetric.wrapper,
    campaignMetric.wrapper,
    dronesAvailableMetric.wrapper,
    dronesReservedMetric.wrapper,
    dronesEmbarkedMetric.wrapper,
    dronesActiveMetric.wrapper,
    dronesBuildingMetric.wrapper,
  );
  header.append(heading, metrics);
  const grid = element('div', 'command-screen__grid');
  root.append(header, grid);
  container.appendChild(root);

  const instance = {
    container,
    root,
    state,
    options,
    refs: {
      metricCredits: creditsMetric.value,
      metricBulkRemaining: remainingMetric.value,
      metricDeliveries: deliveryMetric.value,
      metricCampaigns: campaignMetric.value,
      metricDronesAvailable: dronesAvailableMetric.value,
      metricDronesReserved: dronesReservedMetric.value,
      metricDronesEmbarked: dronesEmbarkedMetric.value,
      metricDronesActive: dronesActiveMetric.value,
      metricDronesBuilding: dronesBuildingMetric.value,
    },
    snapshot: null,
    refresh: () => refreshDynamic(instance),
  };
  const { refs } = instance;

  const bulkCard = element('section', 'command-card');
  bulkCard.id = 'ops-bulk-command-card';
  bulkCard.appendChild(element('h3', 'command-card__title', 'Bulk Production Order'));
  const bulkForm = element('form', 'command-form');
  bulkForm.id = 'ops-bulk-form';
  bulkForm.dataset.testid = 'ops-bulk-form';
  bulkForm.addEventListener('submit', (event) => event.preventDefault());
  refs.bulkName = makeInput('ops-bulk-name', 'text', 'Late-game fleet order');
  refs.bulkManifestRows = element('div', 'bulk-manifest-rows');
  refs.bulkManifestRows.id = 'ops-bulk-manifest';
  refs.bulkManifestRows.dataset.testid = refs.bulkManifestRows.id;
  refs.bulkManifestRowId = 0;
  const manifestBuilder = element('fieldset', 'bulk-manifest-builder');
  manifestBuilder.appendChild(element('legend', '', 'Ships and drones to produce'));
  manifestBuilder.appendChild(refs.bulkManifestRows);
  const addManifestRow = makeButton('ops-bulk-add-ship', 'Add product');
  addManifestRow.addEventListener('click', () => appendBulkManifestRow(refs, instance.state));
  manifestBuilder.appendChild(addManifestRow);
  appendBulkManifestRow(refs, state, { hull: 'corvette', quantity: 400 });
  refs.bulkPriority = makeSelect('ops-bulk-priority', [
    ['emergency', 'Emergency'],
    ['high', 'High'],
    ['normal', 'Normal'],
    ['low', 'Low'],
  ]);
  refs.bulkPriority.value = 'normal';
  refs.bulkBudget = makeInput('ops-bulk-budget', 'number');
  refs.bulkBudget.min = '0';
  refs.bulkBudget.placeholder = 'No cap';
  refs.bulkReserve = makeInput('ops-bulk-reserve', 'number', '0');
  refs.bulkReserve.min = '0';
  refs.bulkRally = makeSelect('ops-bulk-rally', [
    ['none', 'No rally'],
    ['flagship', 'Flagship'],
    ['system', 'System'],
    ['fleet', 'Existing fleet'],
  ]);
  refs.bulkRallyTarget = makeInput('ops-bulk-rally-target', 'text');
  refs.bulkRallyTarget.placeholder = 'System or fleet ID';
  refs.bulkRallyTargetField = makeField('Rally target ID', refs.bulkRallyTarget);
  refs.bulkPackaging = makeSelect('ops-bulk-packaging', [
    ['unassigned', 'Leave unassigned'],
    ['single_fleet', 'One new fleet'],
    ['new_fleets', 'Split into fleets'],
    ['reinforce', 'Reinforce fleet'],
  ]);
  refs.bulkSplitSize = makeInput('ops-bulk-split-size', 'number', '40');
  refs.bulkSplitSize.min = '1';
  refs.bulkSplitField = makeField('Ships per fleet', refs.bulkSplitSize);
  refs.bulkFleetId = makeInput('ops-bulk-fleet-id', 'text');
  refs.bulkFleetId.placeholder = 'fleet-1';
  refs.bulkFleetField = makeField('Fleet ID', refs.bulkFleetId);
  bulkForm.append(
    makeField('Order name', refs.bulkName),
    manifestBuilder,
    makeField('Priority', refs.bulkPriority),
    makeField('Budget cap', refs.bulkBudget),
    makeField('Protected reserve', refs.bulkReserve),
    makeField('Rally', refs.bulkRally),
    refs.bulkRallyTargetField,
    makeField('Packaging', refs.bulkPackaging),
    refs.bulkSplitField,
    refs.bulkFleetField,
  );
  const bulkActions = element('div', 'command-actions');
  const useSelectedRally = makeButton('ops-bulk-use-selected', 'Use selected star');
  const previewBulk = makeButton('ops-bulk-preview-button', 'Preview');
  const createBulk = makeButton('ops-bulk-create-button', 'Issue order', 'primary');
  bulkActions.append(useSelectedRally, previewBulk, createBulk);
  refs.bulkPreview = element('div');
  refs.bulkPreview.id = 'ops-bulk-preview';
  refs.bulkPreview.dataset.testid = refs.bulkPreview.id;
  refs.bulkPreview.setAttribute('role', 'status');
  refs.bulkPreview.setAttribute('aria-live', 'polite');
  renderBulkPreview(refs.bulkPreview, null);
  bulkCard.append(bulkForm, bulkActions, refs.bulkPreview);
  grid.appendChild(bulkCard);

  refs.bulkRally.addEventListener('change', () => syncBulkFields(refs));
  refs.bulkPackaging.addEventListener('change', () => syncBulkFields(refs));
  useSelectedRally.addEventListener('click', () => {
    let selected = null;
    try { selected = instance.options.getGalaxyTargetStar?.() ?? null; } catch { selected = null; }
    if (!selected) {
      notify(instance, 'Select a star on the galaxy map first', 'error');
      return;
    }
    refs.bulkRally.value = 'system';
    refs.bulkRallyTarget.value = String(selected);
    syncBulkFields(refs);
    notify(instance, `Rally set to ${selected}`, 'ok');
  });
  previewBulk.addEventListener('click', () => {
    const { spec, errors } = buildBulkSpec(refs);
    if (errors.length > 0) {
      renderBulkPreview(refs.bulkPreview, null, errors);
      return;
    }
    try {
      renderBulkPreview(refs.bulkPreview, previewBulkProductionOrder(instance.state, spec));
    } catch (error) {
      renderBulkPreview(refs.bulkPreview, null, [error.message]);
    }
  });
  createBulk.addEventListener('click', () => {
    const { spec, errors } = buildBulkSpec(refs);
    if (errors.length > 0) {
      renderBulkPreview(refs.bulkPreview, null, errors);
      return;
    }
    if (typeof instance.options?.coopRun === 'function') {
      instance.options.coopRun('createBulkProductionOrder', { spec }).then((result) => {
        renderBulkPreview(
          refs.bulkPreview,
          result.preview ?? null,
          result.preview ? [] : [result.reason ?? 'Bulk order failed'],
        );
        notify(instance, result.ok ? `${result.order?.name ?? 'Bulk order'} issued as one aggregate order` : result.reason, result.ok ? 'ok' : 'error');
        instance.refresh();
      });
      return;
    }
    let result;
    try { result = createBulkProductionOrder(instance.state, spec); } catch (error) {
      result = { ok: false, reason: error.message };
    }
    renderBulkPreview(
      refs.bulkPreview,
      result.preview ?? null,
      result.preview ? [] : [result.reason ?? 'Bulk order failed'],
    );
    notify(instance, result.ok ? `${result.order.name} issued as one aggregate order` : result.reason, result.ok ? 'ok' : 'error');
    instance.refresh();
  });
  syncBulkFields(refs);

  const campaignCard = element('section', 'command-card');
  campaignCard.id = 'ops-campaign-command-card';
  campaignCard.appendChild(element('h3', 'command-card__title', 'Auto-Route & Build Campaign'));
  const campaignForm = element('form', 'command-form');
  campaignForm.id = 'ops-campaign-form';
  campaignForm.dataset.testid = campaignForm.id;
  campaignForm.addEventListener('submit', (event) => event.preventDefault());
  refs.campaignName = makeInput('ops-campaign-name', 'text', 'Frontier expansion');
  refs.campaignMode = makeSelect('ops-campaign-mode', [
    ['explicit', 'Explicit systems'],
    ['count', 'Nearest eligible count'],
  ]);
  refs.campaignTargets = element('textarea');
  refs.campaignTargets.id = 'ops-campaign-targets';
  refs.campaignTargets.dataset.testid = refs.campaignTargets.id;
  refs.campaignTargets.placeholder = 'system-12, system-19, system-22';
  refs.campaignTargetsField = makeField('Target system IDs', refs.campaignTargets, { wide: true });
  refs.campaignCount = makeInput('ops-campaign-count', 'number', '50');
  refs.campaignCount.min = '1';
  refs.campaignCountField = makeField('Systems to claim', refs.campaignCount);
  refs.campaignTemplate = makeSelect('ops-campaign-template', []);
  refs.campaignConcurrency = makeInput('ops-campaign-concurrency', 'number', '3');
  refs.campaignConcurrency.min = '1';
  refs.campaignConcurrency.max = '8';
  refs.campaignBudget = makeInput('ops-campaign-budget', 'number');
  refs.campaignBudget.min = '0';
  refs.campaignBudget.placeholder = 'No cap';
  refs.campaignReserve = makeInput('ops-campaign-reserve', 'number', '0');
  refs.campaignReserve.min = '0';
  refs.campaignOwner = makeSelect('ops-campaign-owner-filter', [
    ['not_player', 'Not player-owned'],
    ['neutral', 'Neutral only'],
    ['ai', 'AI-owned only'],
    ['any', 'Any owner'],
  ]);
  refs.campaignMaxThreat = makeInput('ops-campaign-max-threat', 'number');
  refs.campaignMaxThreat.min = '0';
  refs.campaignMaxThreat.placeholder = 'Any threat';
  refs.campaignWars = element('textarea');
  refs.campaignWars.id = 'ops-campaign-war-authorizations';
  refs.campaignWars.dataset.testid = refs.campaignWars.id;
  refs.campaignWars.placeholder = 'ai-0: claimed conquest\nai-2: border security';
  refs.campaignIntel = makeInput('ops-campaign-require-intel', 'checkbox');
  refs.campaignPartial = makeInput('ops-campaign-allow-partial', 'checkbox');
  const intelField = makeField('Require existing intel', refs.campaignIntel);
  const partialField = makeField('Allow partial target set', refs.campaignPartial);
  campaignForm.append(
    makeField('Campaign name', refs.campaignName),
    makeField('Targeting', refs.campaignMode),
    refs.campaignTargetsField,
    refs.campaignCountField,
    makeField('Operation preset', refs.campaignTemplate),
    makeField('Concurrent systems', refs.campaignConcurrency),
    makeField('Budget limit', refs.campaignBudget),
    makeField('Protected reserve', refs.campaignReserve),
    makeField('Owner filter', refs.campaignOwner),
    makeField('Maximum threat', refs.campaignMaxThreat),
    intelField,
    partialField,
    makeField('Named war authorizations', refs.campaignWars, { wide: true }),
  );
  const campaignActions = element('div', 'command-actions');
  refs.campaignAddSelected = makeButton('ops-campaign-add-selected', 'Add selected star');
  const previewCampaign = makeButton('ops-campaign-preview-button', 'Preview routes');
  const createCampaign = makeButton('ops-campaign-create-button', 'Launch campaign', 'primary');
  campaignActions.append(refs.campaignAddSelected, previewCampaign, createCampaign);
  refs.campaignPreview = element('div');
  refs.campaignPreview.id = 'ops-campaign-preview';
  refs.campaignPreview.dataset.testid = refs.campaignPreview.id;
  refs.campaignPreview.setAttribute('role', 'status');
  refs.campaignPreview.setAttribute('aria-live', 'polite');
  renderCampaignPreview(refs.campaignPreview, null);
  campaignCard.append(campaignForm, campaignActions, refs.campaignPreview);
  grid.appendChild(campaignCard);

  refs.campaignMode.addEventListener('change', () => syncCampaignFields(refs));
  refs.campaignAddSelected.addEventListener('click', () => {
    let selected = null;
    try { selected = instance.options.getGalaxyTargetStar?.() ?? null; } catch { selected = null; }
    if (!selected) {
      notify(instance, 'Select a star on the galaxy map first', 'error');
      return;
    }
    const ids = parseTargetIds(refs.campaignTargets.value);
    if (!ids.includes(String(selected))) ids.push(String(selected));
    refs.campaignTargets.value = ids.join(', ');
    notify(instance, `${selected} added to campaign targets`, 'ok');
  });
  previewCampaign.addEventListener('click', () => {
    const { spec, errors } = buildCampaignSpec(instance);
    if (errors.length > 0) {
      renderCampaignPreview(refs.campaignPreview, null, errors);
      return;
    }
    try {
      renderCampaignPreview(refs.campaignPreview, previewExpansionCampaign(instance.state, spec, {
        hooks: strategicIntegrationHooks(),
      }));
    } catch (error) {
      renderCampaignPreview(refs.campaignPreview, null, [error.message]);
    }
  });
  createCampaign.addEventListener('click', () => {
    const { spec, errors } = buildCampaignSpec(instance);
    if (errors.length > 0) {
      renderCampaignPreview(refs.campaignPreview, null, errors);
      return;
    }
    if (typeof instance.options?.coopRun === 'function') {
      instance.options.coopRun('createExpansionCampaign', { spec, options: {} }).then((result) => {
        renderCampaignPreview(
          refs.campaignPreview,
          result.preview ?? null,
          result.preview ? [] : [result.reason ?? 'Campaign launch failed'],
        );
        notify(instance, result.ok ? `${result.campaign?.name ?? 'Campaign'} launched` : result.reason, result.ok ? 'ok' : 'error');
        instance.refresh();
      });
      return;
    }
    let result;
    try {
      result = createExpansionCampaign(instance.state, spec, { hooks: strategicIntegrationHooks() });
    } catch (error) {
      result = { ok: false, reason: error.message };
    }
    renderCampaignPreview(
      refs.campaignPreview,
      result.preview ?? null,
      result.preview ? [] : [result.reason ?? 'Campaign launch failed'],
    );
    notify(instance, result.ok ? `${result.campaign.name} launched` : result.reason, result.ok ? 'ok' : 'error');
    instance.refresh();
  });
  syncCampaignFields(refs);

  const activeBulkCard = element('section', 'command-card command-card--wide');
  activeBulkCard.id = 'ops-active-bulk-card';
  activeBulkCard.appendChild(element('h3', 'command-card__title', 'Active Bulk Orders'));
  refs.activeBulkOrders = element('div');
  refs.activeBulkOrders.id = 'ops-active-bulk-orders';
  refs.activeBulkOrders.dataset.testid = refs.activeBulkOrders.id;
  activeBulkCard.appendChild(refs.activeBulkOrders);
  grid.appendChild(activeBulkCard);

  const activeCampaignCard = element('section', 'command-card command-card--wide');
  activeCampaignCard.id = 'ops-active-campaign-card';
  activeCampaignCard.appendChild(element('h3', 'command-card__title', 'Active Expansion Campaigns'));
  refs.activeCampaigns = element('div');
  refs.activeCampaigns.id = 'ops-active-campaigns';
  refs.activeCampaigns.dataset.testid = refs.activeCampaigns.id;
  activeCampaignCard.appendChild(refs.activeCampaigns);
  grid.appendChild(activeCampaignCard);

  return instance;
}

/**
 * Mount or refresh the late-game command screen.
 *
 * Forms are mounted once per container, so focused inputs and draft values are
 * preserved while aggregate order cards refresh around them.
 */
export function renderOperationsPanel(
  container,
  state,
  { getGalaxyTargetStar = null, toast = null } = {},
) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('Operations panel requires a DOM container');
  }
  if (!state || typeof state !== 'object') throw new TypeError('Operations panel requires game state');
  let instance = panelInstances.get(container);
  if (!instance || instance.root.parentNode !== container) {
    instance = buildPanel(container, state, { getGalaxyTargetStar, toast });
    panelInstances.set(container, instance);
  } else {
    instance.state = state;
    instance.options = { getGalaxyTargetStar, toast };
  }
  return instance.refresh();
}
