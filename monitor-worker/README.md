# Production monitor worker

`wrangler.jsonc` is a public-safe template used for type generation, tests, and
dry runs. It deliberately contains example hostnames, email addresses, binding
IDs, and bucket names.

For production:

1. Copy `wrangler.jsonc` to the ignored `wrangler.production.jsonc`.
2. Replace every example value with the real Worker route, KV namespace, R2
   bucket, and email configuration.
3. Store `HEARTBEAT_SECRET`, `ARCHIVE_UPLOAD_SECRET`, and
   `LOGIN_NOTIFICATION_SECRET` with `wrangler secret put`; do not add them to
   either configuration file. `LOGIN_NOTIFICATION_SECRET` must match the
   gateway's `login-notification-secret` systemd credential.
4. Run `npm run check`, then `npm run deploy`.

The gateway posts a signed event to `/events/login` after successful credential
login, hosted solo play entry, and multiplayer joins. The Worker validates
freshness and signature, deduplicates retries for 24 hours, and sends the owner
a transactional email through the existing `ALERT_EMAIL` binding.

The generated `worker-configuration.d.ts` is ignored. `npm run types` recreates
it from the public-safe template whenever type checking is needed.
