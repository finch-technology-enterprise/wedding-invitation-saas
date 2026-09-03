/**
 * Platform Worker.
 *
 * Routing (see arch report §D):
 *   /api/v1/*          versioned platform API (Hono sub-app; WS2+)
 *   /api/rsvp|/api/rsvps  legacy single-invitation routes (WS0–WS5 only;
 *                         retired when the frozen frontend is extracted)
 *   /i/{slug}          public invitation (WS5/WS6)
 *   /preview/{token}   draft preview (WS5)
 *   /media/{assetId}   R2 delivery (WS4)
 *   /admin             tenant console, served statically as clean URL for
 *                      /admin.html (auth is API-enforced; the shell is inert
 *                      without a session). WS7 replaces the file.
 *   /platform-admin    operator console (WS9 adds platform-admin.html, which
 *                      the same clean-URL rule then serves; until then the
 *                      Worker answers 501 on asset miss).
 *   everything else    Static Assets (frozen public invitation at / until WS6)
 */

import { Hono } from "hono";
import { fail, json, ok } from "./lib/respond.js";
import { deploymentMode } from "./lib/mode.js";
import { handleLegacyList, handleLegacyRsvp, logFailure } from "./routes/legacy.js";

const v1 = new Hono<{ Bindings: Env }>();

// WS2 owns: auth, tenants, invitations, media, rsvp, platform.
// Until then the versioned API surface does not exist.
v1.all("/*", (c) => fail("not_built", 501));

async function servePlatformAdmin(): Promise<Response> {
  // WS9 builds the operator console. JSON (not HTML) so the gap is
  // explicit rather than a half-built page.
  return fail("platform_admin_not_built", 501);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.startsWith("/api/v1/")) {
      return v1.fetch(req, env);
    }

    // --- legacy single-invitation API (behaviour frozen until WS6) ---
    if (path === "/api/rsvp") {
      if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      try {
        return await handleLegacyRsvp(req, env);
      } catch (err) {
        logFailure("POST /api/rsvp", err);
        return json({ ok: false, error: "server_error" }, 500);
      }
    }

    if (path === "/api/rsvps") {
      if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      try {
        return await handleLegacyList(req, env);
      } catch (err) {
        logFailure("GET /api/rsvps", err);
        return json({ ok: false, error: "server_error" }, 500);
      }
    }

    if (path === "/api/v1" || path === "/api/v1/") {
      return ok({ version: "v1", mode: deploymentMode(env) });
    }

    // --- platform surfaces (stubs until their workstreams) ---
    // Note: /admin is served statically (clean URL for /admin.html) and
    // never reaches the Worker. Only the not-yet-built platform console
    // needs a Worker answer (asset miss falls through to here).
    if (path === "/platform-admin") {
      if (req.method !== "GET") return fail("method_not_allowed", 405);
      return servePlatformAdmin();
    }

    if (path === "/platform-admin/" || path.startsWith("/platform-admin/")) {
      return servePlatformAdmin();
    }

    if (path === "/i/" || path.startsWith("/i/")) {
      if (req.method !== "GET") return fail("method_not_allowed", 405);
      return fail("invitation_not_found", 404);
    }

    if (path === "/preview/" || path.startsWith("/preview/")) {
      if (req.method !== "GET") return fail("method_not_allowed", 405);
      return fail("preview_not_found", 404);
    }

    if (path === "/media/" || path.startsWith("/media/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return fail("method_not_allowed", 405);
      }
      return fail("media_not_found", 404);
    }

    if (path === "/api/health") {
      return ok({ mode: deploymentMode(env) });
    }

    return fail("not_found", 404);
  },
};
