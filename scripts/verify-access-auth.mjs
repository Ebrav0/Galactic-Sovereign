import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { createAccessAuth } from '../server/access-auth.mjs';

const issuer = 'https://example.cloudflareaccess.com';
const audience = 'admin-audience';
const adminOrigin = 'https://admin.galacticsovereign.xyz';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'test-key';
publicJwk.alg = 'RS256';
const jwks = createLocalJWKSet({ keys: [publicJwk] });
const auth = createAccessAuth({ teamDomain: issuer, audience, adminOrigin, csrfSecret: crypto.randomBytes(32).toString('hex'), jwks });
const token = await new SignJWT({ email: 'owner@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
  .setIssuer(issuer).setAudience(audience).setSubject('owner-subject')
  .setIssuedAt().setExpirationTime('5m').sign(privateKey);
const req = { headers: { host: '127.0.0.1:8080', 'x-forwarded-host': 'admin.galacticsovereign.xyz', 'cf-access-jwt-assertion': token } };
const identity = await auth.authenticate(req);
assert.equal(identity.email, 'owner@example.test');
assert.equal(identity.sub, 'owner-subject');
auth.verifyMutation({ headers: { origin: adminOrigin, 'x-csrf-token': auth.csrfFor(identity) } }, identity);
await assert.rejects(() => auth.authenticate({ headers: { ...req.headers, 'x-forwarded-host': 'play.galacticsovereign.xyz' } }), (error) => error.statusCode === 404);
await assert.rejects(() => auth.authenticate({ headers: { ...req.headers, 'cf-access-jwt-assertion': '' } }), (error) => error.statusCode === 403);
assert.throws(() => auth.verifyMutation({ headers: { origin: 'https://play.galacticsovereign.xyz', 'x-csrf-token': auth.csrfFor(identity) } }, identity), (error) => error.statusCode === 403);
assert.throws(() => auth.verifyMutation({ headers: { origin: adminOrigin, 'x-csrf-token': 'tampered' } }, identity), (error) => error.statusCode === 403);
const unconfigured = createAccessAuth();
await assert.rejects(() => unconfigured.authenticate({ headers: {} }), (error) => error.statusCode === 503);
console.log('Cloudflare Access origin validation: PASS');
