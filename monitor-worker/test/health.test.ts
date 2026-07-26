import test from 'node:test';
import assert from 'node:assert/strict';
import { findings, validateHeartbeat, type Heartbeat } from '../src/health';

const now = 2_000_000_000;
const healthy: Heartbeat = { timestamp: now, services: { gateway: true, coop: true, site: true, tunnel: true }, backupAgeSeconds: 120, diskUsePercent: 45, firewallOk: true, restoreTestAt: now - 86400, offsiteRestoreTestAt: now - 86400, upsState: 'OL', release: 'game-1', siteRelease: 'site-1' };
test('healthy heartbeat has no findings', () => assert.deepEqual(findings(healthy, now), []));
test('critical conditions are detected', () => {
  const bad = { ...healthy, services: { ...healthy.services, tunnel: false }, backupAgeSeconds: 1900, diskUsePercent: 91, firewallOk: false, upsState: 'OB LB' };
  assert.deepEqual(findings(bad, now).map((item) => item.key), ['service-tunnel', 'backup-stale', 'disk-critical', 'firewall-drift', 'ups-low']);
});
test('invalid payloads are rejected', () => { assert.equal(validateHeartbeat({}), null); assert.equal(validateHeartbeat({ ...healthy, services: { gateway: 'yes' } }), null); });
