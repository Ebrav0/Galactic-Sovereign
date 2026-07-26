import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '');

export function createAccessAuth({
  teamDomain,
  audience,
  adminOrigin,
  csrfSecret,
  jwks = null,
  verifyJwt = jwtVerify,
} = {}) {
  const issuer = normalizeOrigin(teamDomain);
  const origin = normalizeOrigin(adminOrigin);
  const aud = String(audience || '').trim();
  const secret = String(csrfSecret || '');
  let adminHost = '';
  try { adminHost = new URL(origin).host.toLowerCase(); } catch { /* reported through configured */ }
  const configured = Boolean(issuer && aud && origin && adminHost && secret.length >= 32);
  const keySet = jwks || (issuer ? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)) : null);

  function requestHost(req) {
    return String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',', 1)[0].trim().toLowerCase();
  }

  function csrfFor(identity) {
    return crypto.createHmac('sha256', secret)
      .update(`${identity.sub}\n${identity.expiresAt}\n${aud}`)
      .digest('base64url');
  }

  async function authenticate(req) {
    if (!configured) {
      const error = new Error('Admin identity verification is not configured');
      error.statusCode = 503;
      throw error;
    }
    if (requestHost(req) !== adminHost) {
      const error = new Error('Admin is unavailable on this hostname');
      error.statusCode = 404;
      throw error;
    }
    const token = String(req.headers['cf-access-jwt-assertion'] || '').trim();
    if (!token) {
      const error = new Error('Verified Cloudflare Access identity required');
      error.statusCode = 403;
      throw error;
    }
    try {
      const { payload } = await verifyJwt(token, keySet, {
        issuer,
        audience: aud,
        algorithms: ['RS256'],
      });
      if (!payload.sub || !payload.exp) throw new Error('Access token is missing required claims');
      return {
        sub: String(payload.sub),
        email: typeof payload.email === 'string' ? payload.email : null,
        issuedAt: Number(payload.iat || 0) * 1000,
        expiresAt: Number(payload.exp) * 1000,
      };
    } catch {
      const error = new Error('Invalid or expired Cloudflare Access identity');
      error.statusCode = 403;
      throw error;
    }
  }

  function verifyMutation(req, identity) {
    const requestOrigin = normalizeOrigin(req.headers.origin);
    const supplied = String(req.headers['x-csrf-token'] || '');
    const expected = csrfFor(identity);
    const tokenOk = supplied.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (requestOrigin !== origin || !tokenOk) {
      const error = new Error('Admin request verification failed');
      error.statusCode = 403;
      throw error;
    }
  }

  return { configured, issuer, audience: aud, adminOrigin: origin, adminHost, authenticate, csrfFor, verifyMutation };
}
