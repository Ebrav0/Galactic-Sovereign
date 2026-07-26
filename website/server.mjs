#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.env.GS_SITE_DIST_DIR || path.join(root, "dist", "client"));
const host = process.env.GS_SITE_HOST || "127.0.0.1";
const port = Number(process.env.GS_SITE_PORT || 8081);
const htmlRoutes = new Set(["/", "/changelog", "/changelog/", "/privacy", "/privacy/"]);
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".webp", "image/webp"], [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"], [".xml", "application/xml; charset=utf-8"],
]);

function setHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("content-security-policy", "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function sendFile(req, res, file, status = 200) {
  const ext = path.extname(file).toLowerCase();
  const fingerprinted = /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\./.test(file);
  res.writeHead(status, {
    "content-type": mime.get(ext) || "application/octet-stream",
    "cache-control": fingerprinted || [".png", ".webp", ".woff2"].includes(ext) ? "public, max-age=31536000, immutable" : "no-store",
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  setHeaders(res);
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true, service: "galactic-sovereign-site" });
  if (!["GET", "HEAD"].includes(req.method || "")) return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  let target;
  let status = 200;
  if (htmlRoutes.has(url.pathname)) target = path.join(dist, "index.html");
  else {
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    target = path.resolve(dist, relative);
    if (!target.startsWith(`${dist}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      target = path.join(dist, "index.html");
      status = 404;
    }
  }
  if (!fs.existsSync(target)) return sendJson(res, 503, { ok: false, error: "Site build unavailable" });
  return sendFile(req, res, target, status);
});

server.listen(port, host, () => console.log(`[site] listening on http://${host}:${port}`));

function shutdown(signal) {
  console.log(`[site] ${signal} — closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
