/**
 * Which GitHub repo THIS deployment reads & writes its JSON data to
 * (assignments.json, access.json).
 *
 * Derived at build time from Vite's BASE_URL, which deploy.yml sets to
 * `/<repo-name>/` via `--base=/${{ github.event.repository.name }}/`:
 *
 *   test build  → BASE_URL "/command-center-test/" → medically-modern/command-center-test
 *   prod build  → BASE_URL "/command-center/"      → medically-modern/command-center
 *   dev (root)  → BASE_URL "/"                      → falls back to the TEST repo
 *
 * Why not a hardcoded constant: the "Sync from Test Repo" workflow force-pushes
 * test's code over prod, so any hardcoded repo name would be copied verbatim and
 * prod would keep writing back into the test repo (the assignments-linked bug).
 * BASE_URL is resolved per-repo at build time, so the SAME synced code targets
 * the right repo in each deployment. Dev falls back to test, never prod.
 */
const OWNER = "medically-modern";
const FALLBACK_REPO = "command-center-test";

/** Repo name from the deployment base path, e.g. "command-center-test". */
export function dataRepoName(): string {
  const seg = (import.meta.env.BASE_URL || "/").split("/").filter(Boolean)[0];
  return seg || FALLBACK_REPO;
}

/** "owner/repo" this deployment reads & writes its JSON data to. */
export function dataRepo(): string {
  return `${OWNER}/${dataRepoName()}`;
}
