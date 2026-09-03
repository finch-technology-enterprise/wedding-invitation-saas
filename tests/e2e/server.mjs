/**
 * Static server for browser tests.
 *
 * `wrangler dev` watches the filesystem and hot-reloads, which drops
 * connections partway through a long Playwright run. The browser suite
 * only needs the static frontend plus a stub for POST /api/rsvp, so it
 * runs against this instead. Worker/API behaviour is covered by the
 * Vitest suite, which exercises the real Worker.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../public", import.meta.url));
const PORT = Number(process.env.PORT || 8789);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Mirror the Worker's RSVP contract closely enough for UI assertions.
  if (path === "/api/rsvp") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
      return;
    }
    const ok = typeof parsed?.name === "string" && parsed.name.trim().length > 0;
    res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
    res.end(JSON.stringify(ok ? { ok: true } : { ok: false, error: "invalid_name" }));
    return;
  }

  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, rel);

  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => {
  console.log(`test server on http://127.0.0.1:${PORT}`);
});
