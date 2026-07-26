import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const port = 18081 + Math.floor(Math.random() * 1000);
let child;

test.before(async () => {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, GS_SITE_HOST: "127.0.0.1", GS_SITE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return; } catch { /* wait */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("site server did not start");
});

test.after(() => child?.kill("SIGTERM"));

test("serves production health without caching", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, service: "galactic-sovereign-site" });
});

for (const route of ["/", "/changelog/", "/privacy/"]) {
  test(`serves ${route}`, async () => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root"><\/div>/);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  });
}

test("returns the branded app shell with a real 404 status", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/unknown-sector`);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /<div id="root"><\/div>/);
});
