import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';

export type AccessEnvironment = {
  MOBILE_HOST: string;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  LOCAL_DEV_BYPASS?: string;
};

export type AccessIdentity = {
  sub: string;
  email: string | null;
  expiresAt: number;
};

export class AccessError extends Error {
  constructor(message: string, readonly status: 403 | 404 | 503) {
    super(message);
  }
}

function normalizedIssuer(value: string): string {
  return String(value || '').trim().replace(/\/$/, '');
}

export function mobileRequestHost(request: Request): string {
  return new URL(request.url).hostname.toLowerCase();
}

function localBypassAllowed(request: Request, environment: AccessEnvironment): boolean {
  const host = mobileRequestHost(request);
  return environment.LOCAL_DEV_BYPASS === '1' && (host === '127.0.0.1' || host === 'localhost');
}

function identityFromPayload(payload: JWTPayload): AccessIdentity {
  if (!payload.sub || !payload.exp) throw new AccessError('Access identity is missing required claims', 403);
  return {
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email : null,
    expiresAt: Number(payload.exp) * 1000,
  };
}

export async function authenticateMobileRequest(
  request: Request,
  environment: AccessEnvironment,
  keySetOverride?: JWTVerifyGetKey,
): Promise<AccessIdentity> {
  if (localBypassAllowed(request, environment)) {
    return { sub: 'local-preview', email: null, expiresAt: Date.now() + 60 * 60 * 1000 };
  }

  const mobileHost = String(environment.MOBILE_HOST || '').trim().toLowerCase();
  if (!mobileHost || mobileRequestHost(request) !== mobileHost) throw new AccessError('Mobile status is unavailable on this hostname', 404);

  const issuer = normalizedIssuer(environment.TEAM_DOMAIN);
  const audience = String(environment.POLICY_AUD || '').trim();
  if (!issuer || !audience || audience.startsWith('replace-with-')) throw new AccessError('Mobile identity verification is not configured', 503);

  const token = String(request.headers.get('cf-access-jwt-assertion') || '').trim();
  if (!token) throw new AccessError('Verified Cloudflare Access identity required', 403);

  try {
    const keySet = keySetOverride ?? createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, keySet, {
      issuer,
      audience,
      algorithms: ['RS256'],
    });
    return identityFromPayload(payload);
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError('Invalid or expired Cloudflare Access identity', 403);
  }
}
