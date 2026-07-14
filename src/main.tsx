import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AppErrorBoundary from "./components/shared/AppErrorBoundary";
import { installChunkReloadGuard } from "./lib/shared/chunkReload";
import "./index.css";

// Reload once (per tab) when a redeploy invalidates preloaded chunk files —
// must be installed before the router triggers any lazy imports.
installChunkReloadGuard();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
