import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateTrendPoints,
  findings,
  statusSnapshot,
  validateHeartbeat,
  type Heartbeat,
} from '../src/health';

const now = 2_000_000_000;
const healthy: Heartbeat = {
  timestamp: now,
  services: { gateway: true, coop: true, site: true, tunnel: true },
  backupAgeSeconds: 120,
  diskUsePercent: 45,
  firewallOk: true,
  restoreTestAt: now - 86400,
  offsiteRestoreTestAt: now - 86400,
  upsState: 'OL',
  release: 'game-1',
  siteRelease: 'site-1',
  playersOnline: 3,
};

test('healthy heartbeat has no findings and produces an operational snapshot', () => {
  assert.deepEqual(findings(healthy, now), []);
  const snapshot = statusSnapshot(healthy, now + 30);
  assert.equal(snapshot.state, 'operational');
  assert.equal(snapshot.freshness, 'live');
  assert.equal(snapshot.metrics.playersOnline, 3);
  assert.equal(snapshot.services.coop, 'operational');
});

test('critical conditions are detected', () => {
  const bad = { ...healthy, services: { ...healthy.services, tunnel: false }, backupAgeSeconds: 1900, diskUsePercent: 91, firewallOk: false, upsState: 'OB LB' };
  assert.deepEqual(findings(bad, now).map((item) => item.key), ['service-tunnel', 'backup-stale', 'disk-critical', 'firewall-drift', 'ups-low']);
});

test('missing restore verification is a critical finding', () => {
  const neverTested = { ...healthy, restoreTestAt: 0, offsiteRestoreTestAt: 0 };
  assert.deepEqual(findings(neverTested, now).map((item) => item.key), ['restore-missing', 'offsite-restore-missing']);
});

test('invalid and unsafe payloads are rejected while extra fields are stripped', () => {
  assert.equal(validateHeartbeat({}), null);
  assert.equal(validateHeartbeat({ ...healthy, services: { gateway: 'yes' } }), null);
  assert.equal(validateHeartbeat({ ...healthy, diskUsePercent: 101 }), null);
  assert.equal(validateHeartbeat({ ...healthy, playersOnline: -1 }), null);
  assert.equal(validateHeartbeat({ ...healthy, release: '<script>' }), null);
  const sanitized = validateHeartbeat({ ...healthy, secret: 'must-not-survive' });
  assert.ok(sanitized);
  assert.equal('secret' in sanitized, false);
});

test('stale data is never represented as currently healthy', () => {
  const stale = statusSnapshot(healthy, now + 901);
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.state, 'critical');
  assert.equal(stale.services.gateway, 'unknown');
  assert.equal(stale.metrics.playersOnline, null);
  assert.equal(stale.findings[0]?.key, 'heartbeat-stale');
});

test('offline and absent data have explicit states', () => {
  assert.equal(statusSnapshot(healthy, now + 3601).state, 'offline');
  assert.equal(statusSnapshot(null, now).state, 'unknown');
  assert.equal(statusSnapshot(null, now).freshness, 'awaiting');
});

test('trend aggregation preserves time order and averages source values', () => {
  const points = aggregateTrendPoints([
    { timestamp: 100, backupAgeSeconds: 100, diskUsePercent: 40, playersOnline: 2, servicesAvailable: 4 },
    { timestamp: 200, backupAgeSeconds: 200, diskUsePercent: 50, playersOnline: 4, servicesAvailable: 2 },
    { timestamp: 1000, backupAgeSeconds: 300, diskUsePercent: 60, playersOnline: 1, servicesAvailable: 4 },
  ], 900);
  assert.deepEqual(points, [
    { timestamp: 0, backupAgeSeconds: 150, diskUsePercent: 45, playersOnline: 3, servicesAvailable: 3 },
    { timestamp: 900, backupAgeSeconds: 300, diskUsePercent: 60, playersOnline: 1, servicesAvailable: 4 },
  ]);
});
