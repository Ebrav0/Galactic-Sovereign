# Production monitor worker

`wrangler.jsonc` is a public-safe template used for type generation, tests, and
dry runs. It deliberately contains example hostnames, email addresses, binding
IDs, and bucket names.

For production:

1. Copy `wrangler.jsonc` to the ignored `wrangler.production.jsonc`.
2. Replace every example value with the real Worker route, KV namespace, R2
   bucket, and email configuration.
3. Store `HEARTBEAT_SECRET` and `ARCHIVE_UPLOAD_SECRET` with `wrangler secret
   put`; do not add them to either configuration file.
4. Run `npm run check`, then `npm run deploy`.

The generated `worker-configuration.d.ts` is ignored. `npm run types` recreates
it from the public-safe template whenever type checking is needed.
