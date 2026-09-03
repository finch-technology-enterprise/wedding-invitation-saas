import { renameSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Which console to build. Two passes rather than one multi-entry build:
 * each console gets its own output directory and its own chunk graph, so
 * a tenant page can never be served an operator chunk by accident.
 */
const TARGET = process.env.BUILD_TARGET === "platform" ? "platform" : "admin";

const ENTRY = {
  admin: { html: "index.html", base: "/admin/", outDir: "../public/admin" },
  platform: { html: "platform.html", base: "/platform-admin/", outDir: "../public/platform-admin" },
}[TARGET];

/** Vite names the output after its source file; the Worker serves every
 *  SPA path from index.html, so rename the platform shell after build. */
function renameShell() {
  return {
    name: "rename-shell",
    closeBundle() {
      if (ENTRY.html === "index.html") return;
      const dir = new URL(`${ENTRY.outDir.replace("..", ".")}/`, import.meta.url);
      const from = new URL(ENTRY.html, dir);
      const to = new URL("index.html", dir);
      renameSync(from, to);
    },
  };
}

/**
 * Console builds.
 *
 * Two entry points — the tenant admin and the operator console — emitted
 * into public/, which Cloudflare Static Assets serves. They share React,
 * Mantine and Query as common chunks, which is fine: they are one
 * codebase with two authorization domains.
 *
 * The public invitation is plain ES modules under public/themes/ and is
 * NOT part of this build, so nothing here can reach /i/{slug}. That is
 * asserted by tests rather than left to convention.
 *
 * Both are served from /assets/ with absolute URLs so deep links like
 * /admin/invitations/:id/media resolve chunks correctly.
 */
export default defineConfig({
  plugins: [react(), renameShell()],
  root: "admin",
  base: ENTRY.base,
  build: {
    outDir: ENTRY.outDir,
    emptyOutDir: true,
    // Source maps would hand out admin internals to anyone poking at the
    // bundle; there is no reason to ship them.
    sourcemap: false,
    rollupOptions: { input: `admin/${ENTRY.html}` },
  },
  server: {
    port: 5173,
    proxy: {
      // `npm run dev:admin` talks to a local `wrangler dev` so the admin
      // exercises the real Worker API and real session cookies.
      "/api": "http://127.0.0.1:8788",
      "/media": "http://127.0.0.1:8788",
      "/i": "http://127.0.0.1:8788",
      "/preview": "http://127.0.0.1:8788",
    },
  },
});
