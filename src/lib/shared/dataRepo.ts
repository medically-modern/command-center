/**
 * Which GitHub repo THIS deployment reads & writes its JSON data to
 * (assignments.json, access.json).
 *
 * Derived at build time from VITE_REPO_NAME, which deploy.yml sets to
 * `${{ github.event.repository.name }}`:
 *
 *   test build  → VITE_REPO_NAME "command-center-test" → medically-modern/command-center-test
 *   prod build  → VITE_REPO_NAME "command-center"      → medically-modern/command-center
 *   dev (unset) → falls back to the TEST repo
 *
 * Why not a hardcoded constant: the "Sync from Test Repo" workflow force-pushes
 * test's code over prod, so any hardcoded repo name would be copied verbatim and
 * prod would keep writing back into the test repo (the assignments-linked bug).
 * VITE_REPO_NAME is resolved per-repo at build time, so the SAME synced code
 * targets the right repo in each deployment. Dev falls back to test, never prod.
 *
 * History: this used to parse BASE_URL, but prod now serves from "/" on the
 * custom domain commandcenter.medicallymodern.com, so the base path no longer
 * encodes the repo name. BASE_URL parsing is kept only as a legacy fallback.
 */
const OWNER = "medically-modern";
const FALLBACK_REPO = "command-center-test";

/** Repo name this deployment targets, e.g. "command-center-test". */
export function dataRepoName(): string {
  const fromEnv = import.meta.env.VITE_REPO_NAME;
  if (fromEnv) return fromEnv;
  // Legacy fallback: derive from the base path (pre-custom-domain builds).
  const seg = (import.meta.env.BASE_URL || "/").split("/").filter(Boolean)[0];
  return seg || FALLBACK_REPO;
}

/** "owner/repo" this deployment reads & writes its JSON data to. */
export function dataRepo(): string {
  return `${OWNER}/${dataRepoName()}`;
}
