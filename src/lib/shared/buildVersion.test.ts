/**
 * The reload nudge's rules (§5.54). The property every test defends: it speaks
 * ONLY when a newer build is really live. A nudge that fired on a network blip,
 * a dev build, or the daily data commits would be ignored within a week — and
 * then the one that matters (a tab running days-old phone code) would be too.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entryFromHtml, fetchDeployedEntry, isNewerBuild, runningEntry } from "./buildVersion";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const DEPLOYED_HTML = `<!doctype html><html><head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <script type="module" crossorigin src="/command-center/assets/index-BHxd1vZ2.js"></script>
  <link rel="stylesheet" crossorigin href="/command-center/assets/index-ibOASHOx.css">
</head><body><div id="root"></div></body></html>`;

describe("entryFromHtml", () => {
  it("finds the hashed entry script in a deployed index.html", () => {
    expect(entryFromHtml(DEPLOYED_HTML)).toBe("assets/index-BHxd1vZ2.js");
  });

  it("ignores the stylesheet, which shares the index- prefix", () => {
    expect(entryFromHtml(`<link href="/x/assets/index-ibOASHOx.css">`)).toBeNull();
  });

  it("is null for a dev page or junk", () => {
    expect(entryFromHtml(`<script type="module" src="/src/main.tsx"></script>`)).toBeNull();
    expect(entryFromHtml("")).toBeNull();
  });
});

describe("runningEntry", () => {
  it("reads the entry THIS document loaded", () => {
    const doc = new DOMParser().parseFromString(DEPLOYED_HTML, "text/html");
    expect(runningEntry(doc)).toBe("assets/index-BHxd1vZ2.js");
  });

  it("⚠️ is null under the dev server — which is what keeps the nudge silent outside a real deploy", () => {
    const doc = new DOMParser().parseFromString(`<script type="module" src="/src/main.tsx"></script>`, "text/html");
    expect(runningEntry(doc)).toBeNull();
    expect(runningEntry(null)).toBeNull();
  });
});

describe("isNewerBuild — both halves must be known", () => {
  it("is true only when both are known and differ", () => {
    expect(isNewerBuild("assets/index-A.js", "assets/index-B.js")).toBe(true);
    expect(isNewerBuild("assets/index-A.js", "assets/index-A.js")).toBe(false);
  });

  it("⚠️ says nothing when either is unknown — a failed fetch is not a new version", () => {
    expect(isNewerBuild(null, "assets/index-B.js")).toBe(false);
    expect(isNewerBuild("assets/index-A.js", null)).toBe(false);
    expect(isNewerBuild(null, null)).toBe(false);
  });
});

describe("fetchDeployedEntry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("⚠️ busts the browser AND the CDN cache — or a tab is told it is current by a cached copy of itself", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(DEPLOYED_HTML, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDeployedEntry("/command-center/", 123)).resolves.toBe("assets/index-BHxd1vZ2.js");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/command-center/index.html?v=123");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("asks its OWN deployment — a test tab never compares against prod", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(DEPLOYED_HTML));
    vi.stubGlobal("fetch", fetchMock);
    await fetchDeployedEntry("/command-center-test", 1);
    expect(fetchMock.mock.calls[0][0]).toBe("/command-center-test/index.html?v=1");
  });

  it("is null on a failed or non-OK fetch, never an exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchDeployedEntry("/", 1)).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    await expect(fetchDeployedEntry("/", 1)).resolves.toBeNull();
  });
});

describe("the build stays deterministic — the nudge depends on it", () => {
  it("⚠️ nothing time- or commit-stamped is baked into the bundle", () => {
    // Measured 2026-09-28: two builds of unchanged source gave the same entry
    // hash. A Date.now()/commit-SHA `define` would change the hash on EVERY
    // build — the weekday cron rebuild included — and every tab would be told
    // to reload every morning for nothing.
    const vite = read("vite.config.ts");
    expect(vite).not.toMatch(/define\s*:/);
    expect(vite).not.toMatch(/Date\.now|GITHUB_SHA|COMMIT/);
  });
});

describe("wiring", () => {
  it("App mounts the nudge exactly once, outside the router", () => {
    const app = read("src/App.tsx");
    expect((app.match(/<NewVersionBanner \/>/g) || []).length).toBe(1);
    expect(app.indexOf("<NewVersionBanner />")).toBeLessThan(app.indexOf("<BrowserRouter"));
  });

  it("⚠️ the banner never reloads by itself — only the button does", () => {
    const code = read("src/components/shared/NewVersionBanner.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    // Exactly one reload, and it lives in an onClick.
    expect((code.match(/location\.reload\(\)/g) || []).length).toBe(1);
    expect(code).toMatch(/onClick=\{\(\) => window\.location\.reload\(\)\}/);
    // One polling timer (INCIDENT_2026-08-20's rule).
    expect((code.match(/setInterval\(/g) || []).length).toBe(1);
  });
});
