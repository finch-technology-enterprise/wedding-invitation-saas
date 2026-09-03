/**
 * Public invitation rendering: GET /i/{slug} and GET /preview/{token}.
 *
 * The Worker fetches the theme shell from Static Assets and injects the
 * resolved configuration as an inline script. Inlining matters: the
 * alternative (shell → JS → config fetch → render) adds a round trip in
 * front of first paint, and the frozen invitation's opening frame is the
 * whole first impression.
 */

import { fail } from "../lib/respond.js";
import {
  resolvePublishedInvitation,
  resolvePreviewInvitation,
  type ResolvedInvitation,
} from "../lib/resolve.js";

/** Slugs are validated on write; re-checked here so a hostile path can
 * never reach D1 or the asset fetcher. */
function isPlausibleSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 60;
}

/**
 * JSON embedded in an HTML <script> must not be able to close the script
 * element or open a comment. Escaping `<` and the line separators is the
 * standard minimum; `&` is left alone because the content is parsed as
 * JavaScript, not HTML text.
 */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function bootstrapPayload(resolved: ResolvedInvitation) {
  // Only what the renderer needs. Tenant ID, revision internals and the
  // asset manifest stay server-side.
  return {
    slug: resolved.slug,
    revisionId: resolved.revisionId,
    isPreview: resolved.isPreview,
    config: resolved.config,
    mediaUrls: resolved.mediaUrls,
  };
}

async function loadShell(env: Env, req: Request, themeId: string): Promise<Response | null> {
  const url = new URL(req.url);
  url.pathname = `/themes/${themeId}/index.html`;
  url.search = "";

  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  return res.ok ? res : null;
}

async function render(
  env: Env,
  req: Request,
  resolved: ResolvedInvitation
): Promise<Response> {
  const shell = await loadShell(env, req, resolved.themeId);
  if (!shell) return fail("theme_unavailable", 500);

  const html = await shell.text();
  const inline = `<script>window.__INVITATION__=${safeJson(bootstrapPayload(resolved))}</script>`;

  // The shell carries a single marker so injection is deterministic
  // rather than a fragile string match against markup.
  const withBootstrap = html.includes("<!--BOOTSTRAP-->")
    ? html.replace("<!--BOOTSTRAP-->", inline)
    : html.replace("</head>", `${inline}</head>`);

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
  });

  if (resolved.isPreview) {
    // A preview is an unpublished draft shared with a partner. It must
    // never be indexed or cached by a shared cache.
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set("cache-control", "private, no-store");
  } else {
    // Revisions are immutable, so the revision ID is a complete cache
    // identity: publishing writes a new ID, which is a different entity.
    // No manual invalidation is required or wanted.
    headers.set("cache-control", "public, max-age=0, must-revalidate");
    headers.set("etag", `"${resolved.revisionId}"`);
  }

  if (req.headers.get("if-none-match") === `"${resolved.revisionId}"` && !resolved.isPreview) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(withBootstrap, { headers });
}

export async function serveInvitation(req: Request, env: Env, slug: string): Promise<Response> {
  if (!isPlausibleSlug(slug)) return fail("invitation_not_found", 404);

  const resolved = await resolvePublishedInvitation(env, slug);
  if (!resolved) return fail("invitation_not_found", 404);

  return render(env, req, resolved);
}

export async function servePreview(req: Request, env: Env, token: string): Promise<Response> {
  // Unpublished content: an invalid token is simply not found.
  if (!token || token.length > 128) return fail("preview_not_found", 404);

  const resolved = await resolvePreviewInvitation(env, token);
  if (!resolved) return fail("preview_not_found", 404);

  return render(env, req, resolved);
}
