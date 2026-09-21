import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AppErrorBoundary from "./components/shared/AppErrorBoundary";
import { installChunkReloadGuard } from "./lib/shared/chunkReload";
import { applyLayoutFromUrl, migrateOffOldLayout } from "./lib/shell/layout";
import { applyAppearanceAtBoot } from "./lib/shell/appearance";
import "./index.css";

// Reload once (per tab) when a redeploy invalidates preloaded chunk files —
// must be installed before the router triggers any lazy imports.
installChunkReloadGuard();

// ⚠️ `?layout=redesign` recovers a browser stuck in a layout whose own controls
// are unreachable (§5.39b). It runs HERE, before React, so it works even when
// the tree it would be a hook inside renders nothing useful.
migrateOffOldLayout(applyLayoutFromUrl());

// ⚠️ Light or dark, BEFORE React — both so `?appearance=light` recovers a
// browser stuck in an unreadable scheme, and so a dark session does not flash
// white on every load (§5.40).
applyAppearanceAtBoot();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
