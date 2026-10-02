import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";
import type { Plugin } from "vite";

/** Onboarding Oversight "snapshot" mode (dev server only, never in a build): serves the scout's read-only
 *  export from OO_SNAPSHOT_DIR (outside this repo) at /__oo_snapshot/<file>.json. */
function ooSnapshot(): Plugin {
  const dir = process.env.OO_SNAPSHOT_DIR;
  return { name: "oo-snapshot", apply: "serve", configureServer(server) {
    if (!dir) return;
    server.middlewares.use("/__oo_snapshot/", (req, res) => {
      const name = path.basename(decodeURIComponent((req.url ?? "").split("?")[0]));
      const file = path.join(dir, name);
      if (!/^[\w.-]+\.json$/.test(name) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
      res.setHeader("Content-Type", "application/json"); fs.createReadStream(file).pipe(res);
    });
  } };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: process.env.OO_SNAPSHOT_DIR ? "localhost" : "::", // real export: never expose it on the LAN (final red-team)
    port: 8080,
    hmr: { overlay: false },
  },
  plugins: [react(), ooSnapshot()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
