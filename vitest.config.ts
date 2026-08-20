import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // services/ holds the Railway-side Node services (monday-gateway et al).
    // They ship separately from the SPA but are tested in the same run.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "services/**/*.{test,spec}.mjs"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The gateway's own deps are installed from services/monday-gateway/
      // package.json, not the root, so anything importing auth.mjs cannot
      // resolve under this run. Stubbing it lets the gateway's ROUTE modules be
      // tested, not just the pure rules split out beside them. Test-only.
      "google-auth-library": path.resolve(
        __dirname, "./services/monday-gateway/test-stubs/google-auth-library.mjs",
      ),
    },
  },
});
