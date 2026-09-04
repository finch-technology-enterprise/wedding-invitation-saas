/**
 * Static server for browser tests.
 *
 * `wrangler dev` watches the filesystem and hot-reloads, which drops
 * connections partway through a long Playwright run. The browser suite
 * only needs the theme shell plus an RSVP stub, so it runs against this
 * instead. Worker/API behaviour is covered by the Vitest suite, which
 * exercises the real Worker.
 *
 * This mirrors the Worker's /i/{slug} contract: it serves the theme shell
 * with the demo fixture inlined at the <!--BOOTSTRAP--> marker, so the
 * browser sees exactly the delivery mechanism production uses.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_BOOTSTRAP, DEMO_SLUG } from "./fixture.mjs";
import { EDITORIAL_BOOTSTRAP, EDITORIAL_SLUG } from "./editorial-fixture.mjs";

const ROOT = fileURLToPath(new URL("../../public", import.meta.url));
const PORT = Number(process.env.PORT || 8789);
const SHELL = "/themes/cinematic-classic/index.html";
const EDITORIAL_SHELL = "/themes/modern-editorial/index.html";

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

/** Same escaping the Worker applies before inlining. */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function renderInvitation(res, bootstrap, shell = SHELL) {
  const html = await readFile(join(ROOT, shell), "utf8");
  const inline = `<script>window.__INVITATION__=${safeJson(bootstrap)}</script>`;
  res.writeHead(200, { "content-type": TYPES[".html"] });
  res.end(html.replace("<!--BOOTSTRAP-->", inline));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Mirror the Worker's RSVP contract closely enough for UI assertions.
  if (path === `/i/${DEMO_SLUG}/rsvp` || path === `/i/${EDITORIAL_SLUG}/rsvp`) {
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

  // The public invitation route, and `/` as a convenience alias for it.
  if (path === "/" || path === `/i/${DEMO_SLUG}`) {
    await renderInvitation(res, DEMO_BOOTSTRAP);
    return;
  }

  if (path === "/editorial" || path === `/i/${EDITORIAL_SLUG}`) {
    await renderInvitation(res, EDITORIAL_BOOTSTRAP, EDITORIAL_SHELL);
    return;
  }

  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
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
