import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AccessError, authenticateMobileRequest, type AccessEnvironment } from '../src/access';

const environment: AccessEnvironment = {
  MOBILE_HOST: 'mobile.galacticsovereign.xyz',
  TEAM_DOMAIN: 'https://galactic-sovereign.cloudflareaccess.com',
  POLICY_AUD: 'mobile-audience',
};

test('mobile access fails closed for a missing token and the wrong hostname', async () => {
  await assert.rejects(
    () => authenticateMobileRequest(new Request('https://mobile.galacticsovereign.xyz/api/status'), environment),
    (error: unknown) => error instanceof AccessError && error.status === 403,
  );
  await assert.rejects(
    () => authenticateMobileRequest(new Request('https://monitor.galacticsovereign.xyz/api/status'), environment),
    (error: unknown) => error instanceof AccessError && error.status === 404,
  );
});

test('mobile access fails closed when production identity configuration is placeholder data', async () => {
  await assert.rejects(
    () => authenticateMobileRequest(new Request('https://mobile.galacticsovereign.xyz/api/status'), { ...environment, POLICY_AUD: 'replace-with-mobile-access-audience' }),
    (error: unknown) => error instanceof AccessError && error.status === 503,
  );
});

test('a correctly issued Access JWT is accepted and the identity is bounded', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key';
  const keySet = createLocalJWKSet({ keys: [publicJwk] });
  const token = await new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('owner-identity')
    .setIssuer(environment.TEAM_DOMAIN)
    .setAudience(environment.POLICY_AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  const request = new Request('https://mobile.galacticsovereign.xyz/api/status', { headers: { 'cf-access-jwt-assertion': token } });
  const identity = await authenticateMobileRequest(request, environment, keySet);
  assert.equal(identity.sub, 'owner-identity');
  assert.equal(identity.email, 'owner@example.com');
  assert.ok(identity.expiresAt > Date.now());
});

test('local preview bypass is restricted to loopback hosts', async () => {
  const localEnvironment = { ...environment, LOCAL_DEV_BYPASS: '1' };
  const identity = await authenticateMobileRequest(new Request('http://127.0.0.1:8787/api/status'), localEnvironment);
  assert.equal(identity.sub, 'local-preview');
  await assert.rejects(
    () => authenticateMobileRequest(new Request('https://evil.example/api/status'), localEnvironment),
    (error: unknown) => error instanceof AccessError && error.status === 404,
  );
});
