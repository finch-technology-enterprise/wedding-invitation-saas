/**
 * Platform Worker.
 *
 * Routing (see arch report §D):
 *   /api/v1/*          versioned platform API (Hono sub-app)
 *   /i/{slug}          public invitation
 *   POST /i/{slug}/rsvp  public reply submission (scoped by slug, so a
 *                      reply cannot land on another invitation)
 *   /preview/{token}   draft preview
 *   /media/{assetId}   R2 delivery (WS4)
 *   /admin/*           tenant console (React SPA built by Vite into
 *                      public/admin/). Deep links are served the same
 *                      shell so client routing survives reload; auth is
 *                      API-enforced, and the shell is inert without a
 *                      session.
 *   /platform-admin    operator console (WS9 adds platform-admin.html, which
 *                      the same clean-URL rule then serves; until then the
 *                      Worker answers 501 on asset miss).
 *   everything else    Static Assets
 */

import { Hono } from "hono";
import { fail, json, ok } from "./lib/respond.js";
import { deploymentMode } from "./lib/mode.js";
import { AccessError } from "./lib/authz.js";
import { auth } from "./routes/auth.js";
import { invitations, tenants } from "./routes/tenants.js";
import { media } from "./routes/media.js";
import { publish } from "./routes/publish.js";
import { handlePublicRsvp, rsvp } from "./routes/rsvp.js";
import { serveMedia } from "./routes/deliver.js";
import { serveInvitation, servePreview } from "./routes/invite.js";
// Structured failure logging for the versioned API.
function logFailure(scope: string, err: unknown): void {
  console.error(scope, err instanceof Error ? err.message : String(err));
}

// basePath: the Worker forwards the untouched request, so routes below
// are matched against the full /api/v1/... path.
const v1 = new Hono<{ Bindings: Env }>().basePath("/api/v1");

/**
 * Authorization failures are thrown, not returned, so a route cannot
 * forget to check a result. This is the single place they become
 * responses — and the only place their status codes are decided.
 */
v1.onError((err) => {
  if (err instanceof AccessError) return fail(err.code, err.status);
  logFailure("api/v1", err);
  return fail("server_error", 500);
});

v1.route("/auth", auth);
v1.route("/tenants", tenants);
v1.route("/invitations", invitations);
// Media hangs off the invitation it belongs to, so it mounts on the same
// prefix and resolves ownership through the same requireInvitation check.
v1.route("/invitations", media);
v1.route("/invitations", publish);
v1.route("/invitations", rsvp);

// WS8+ own: rsvp configuration, platform operator API.
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

    if (path === "/api/v1" || path === "/api/v1/") {
      return ok({ version: "v1", mode: deploymentMode(env) });
    }

    // --- tenant console ---
    // A single-page app: every /admin/* path must return the same shell,
    // or a reload on a deep link would 404 against Static Assets. Real
    // files (JS, CSS) are matched first so they are not shadowed.
    if (path === "/admin" || path.startsWith("/admin/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return fail("method_not_allowed", 405);
      }
      if (!path.startsWith("/admin/assets/")) {
        const shell = new URL(req.url);
        shell.pathname = "/admin/index.html";
        shell.search = "";
        const res = await env.ASSETS.fetch(new Request(shell.toString(), { method: "GET" }));
        if (res.ok) {
          const headers = new Headers(res.headers);
          headers.set("content-type", "text/html; charset=utf-8");
          // The console is authenticated; keep it out of search results
          // and shared caches.
          headers.set("x-robots-tag", "noindex, nofollow");
          headers.set("cache-control", "no-cache");
          return new Response(res.body, { status: 200, headers });
        }
        return fail("admin_not_built", 501);
      }
      // Fall through to Static Assets for hashed bundle files.
    }

    // --- platform surfaces (stubs until their workstreams) ---
    if (path === "/platform-admin") {
      if (req.method !== "GET") return fail("method_not_allowed", 405);
      return servePlatformAdmin();
    }

    if (path === "/platform-admin/" || path.startsWith("/platform-admin/")) {
      return servePlatformAdmin();
    }

    if (path === "/i/" || path.startsWith("/i/")) {
      const rest = path.slice("/i/".length);

      // POST /i/{slug}/rsvp — scoped by slug, so a reply can only land on
      // the invitation whose page produced it.
      if (rest.endsWith("/rsvp")) {
        if (req.method !== "POST") return fail("method_not_allowed", 405);
        return handlePublicRsvp(req, env, rest.slice(0, -"/rsvp".length));
      }

      if (req.method !== "GET") return fail("method_not_allowed", 405);
      return serveInvitation(req, env, rest);
    }

    if (path === "/preview/" || path.startsWith("/preview/")) {
      if (req.method !== "GET") return fail("method_not_allowed", 405);
      return servePreview(req, env, path.slice("/preview/".length));
    }

    if (path === "/media/" || path.startsWith("/media/")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return fail("method_not_allowed", 405);
      }
      const assetId = path.slice("/media/".length);
      return serveMedia(req, env, assetId);
    }

    if (path === "/api/health") {
      return ok({ mode: deploymentMode(env) });
    }

    return fail("not_found", 404);
  },
};
