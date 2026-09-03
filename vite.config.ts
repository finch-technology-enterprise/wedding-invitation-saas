import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Admin build.
 *
 * Emits into public/admin/, which Cloudflare Static Assets serves. The
 * public invitation is plain ES modules under public/themes/ and is NOT
 * part of this build — nothing here can end up on /i/{slug}, which is
 * asserted by tests rather than left to convention.
 *
 * `base` is absolute so deep links like /admin/invitations/:id/media
 * resolve chunks correctly instead of relative to the current path.
 */
export default defineConfig({
  plugins: [react()],
  root: "admin",
  base: "/admin/",
  build: {
    outDir: "../public/admin",
    emptyOutDir: true,
    // Source maps would leak admin internals to anyone poking at the
    // bundle; the admin is authenticated but there is no reason to ship
    // them to production.
    sourcemap: false,
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
