import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AppErrorBoundary from "./components/shared/AppErrorBoundary";
import { installChunkReloadGuard } from "./lib/shared/chunkReload";
import { applyLayoutFromUrl } from "./lib/shell/layout";
import "./index.css";

// Reload once (per tab) when a redeploy invalidates preloaded chunk files —
// must be installed before the router triggers any lazy imports.
installChunkReloadGuard();

// ⚠️ `?layout=redesign` recovers a browser stuck in a layout whose own controls
// are unreachable (§5.39b). It runs HERE, before React, so it works even when
// the tree it would be a hook inside renders nothing useful.
applyLayoutFromUrl();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
