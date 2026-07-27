# Production monitor worker

`wrangler.jsonc` is a public-safe template used for type generation, tests, and
dry runs. It deliberately contains example hostnames, email addresses, binding
IDs, and bucket names.

For production:

1. Copy `wrangler.jsonc` to the ignored `wrangler.production.jsonc`.
2. Replace every example value with the real monitor/mobile custom domains,
   Access team domain and application audience, KV namespace, R2 bucket, and
   email configuration. Keep `LOCAL_DEV_BYPASS` set to `0`.
3. Store `HEARTBEAT_SECRET` and `ARCHIVE_UPLOAD_SECRET` with `wrangler secret
   put`; do not add them to either configuration file.
4. Create a Cloudflare Access self-hosted application for the exact mobile
   hostname and an owner-only policy. The Worker independently verifies the
   Access JWT, issuer, audience, algorithm, and hostname.
5. Run `npm run check`, `node test/mobile-ui.mjs` against a fresh signed local
   heartbeat, then `npm run deploy`.

The generated `worker-configuration.d.ts` is ignored. `npm run types` recreates
it from the public-safe template whenever type checking is needed.

## Trust boundaries

- `monitor.<domain>` accepts only signed heartbeat/archive writes plus
  `/healthz`; mobile API and asset paths return 404 there.
- `mobile.<domain>` is read-only, Access-protected at the edge, and
  defense-in-depth protected inside the Worker. It never exposes credentials,
  network addresses, player identities, backup contents, or administrative
  actions.
- Heartbeats are strictly allowlisted, time-bounded, HMAC-verified, and
  duplicate/out-of-order suppressed. When telemetry becomes stale, service
  values become `unknown` instead of retaining an old healthy presentation.
- Trend partitions contain only sanitized numeric operations data and expire
  after 45 days.
