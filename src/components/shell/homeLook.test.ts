/**
 * The home screen's look (pixel-match Phase 7, §5.52) — source scans, for the
 * guarantees a render cannot give:
 *
 *   1. ONLY the redesign asks for it. `HomeViewHost` hands `ProcessorView` its
 *      `stages` prop and `ProcessorView` hands `DailyBurndown` its `look`;
 *      nothing in "as today" (`Index.tsx`, `DashboardMainView`) does, which is
 *      what keeps §5.39b's escape hatch an escape hatch.
 *   2. The old markup is still there, and nothing but the one stages branch
 *      reads `look` — so an absent prop cannot change the old dashboard.
 *   3. `pages/home/home.css` is scoped. The mockup styles bare `.bar`,
 *      `.notice`, `.btn` and `.input`, which mean other things elsewhere in the
 *      app (§9), and its colours must be the app's tokens (§5.40).
 *
 * Comments are stripped before matching: these files document the very props
 * and selectors they must (not) use.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
/** Source without comments: block comments (JSX ones included) and whole-line `//`. */
const live = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
/** Every `<Tag … />` element in a source file. */
const elements = (src: string, tag: string) => src.match(new RegExp(`<${tag}\\b[\\s\\S]*?\\/>`, "g")) ?? [];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(relative(SRC, p).split(sep).join("/"));
  }
  return out;
}
const TSX = walk(SRC);

/** The `{ … }` block that opens at or after `from`, braces balanced. */
function blockAt(text: string, from: number): { start: number; end: number } {
  const start = text.indexOf("{", from);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { start, end: i };
  }
  throw new Error("unbalanced braces");
}

describe("⚠️ only the redesign asks for the look", () => {
  it("HomeViewHost hands ProcessorView `stages` — after \"as today\" has already returned <Index />", () => {
    const host = live(read("components/shell/HomeViewHost.tsx"));
    const views = elements(host, "ProcessorView");
    expect(views).toHaveLength(1);
    expect(views[0]).toMatch(/\sstages(?=\s|\/>|=\{true\})/);
    const asToday = host.indexOf("if (!redesign) return <Index />");
    expect(asToday).toBeGreaterThan(-1);
    expect(asToday).toBeLessThan(host.indexOf("<ProcessorView"));
  });

  it("\"as today\" never asks: Index's ProcessorView has no `stages`, DashboardMainView's bars no `look`", () => {
    const index = elements(live(read("pages/Index.tsx")), "ProcessorView");
    expect(index.length).toBeGreaterThan(0);
    for (const el of index) expect(el).not.toMatch(/\bstages\b/);
    const dash = elements(live(read("components/dashboard/DashboardMainView.tsx")), "DailyBurndown");
    expect(dash.length).toBeGreaterThan(0);
    for (const el of dash) expect(el).not.toMatch(/\blook\b/);
  });

  it("exactly one component asks DailyBurndown for a look — ProcessorView — and one asks ProcessorView for stages", () => {
    const lookCallers = TSX.filter((f) =>
      elements(live(read(f)), "DailyBurndown").some((el) => /\blook\s*=/.test(el)),
    );
    expect(lookCallers).toEqual(["pages/ProcessorView.tsx"]);
    const stagesCallers = TSX.filter((f) =>
      elements(live(read(f)), "ProcessorView").some((el) => /\sstages\b/.test(el)),
    );
    expect(stagesCallers).toEqual(["components/shell/HomeViewHost.tsx"]);
  });

  it("both halves import the stylesheet — without it the markup renders unstyled, with nothing erroring", () => {
    for (const f of ["pages/ProcessorView.tsx", "components/shell/HomeViewSwitch.tsx"]) {
      expect(read(f), f).toMatch(/^import "@\/pages\/home\/home\.css";$/m);
    }
  });
});

describe("⚠️ DailyBurndown: the stages look is ONE branch, and the old markup is intact", () => {
  const burn = live(read("components/dashboard/DailyBurndown.tsx"));
  const at = burn.indexOf('if (look === "stages")');
  const { start, end } = blockAt(burn, at);
  const stagesBranch = burn.slice(start, end + 1);
  const before = burn.slice(0, at);
  const defaultBranch = burn.slice(end + 1);

  it("has the `look === \"stages\"` branch, drawing the `.cc-bars` markup", () => {
    expect(at).toBeGreaterThan(-1);
    expect(stagesBranch).toContain('className="cc-bars"');
    expect(stagesBranch).toContain('"bar"');
  });

  it("the default branch still carries the old markup, and none of the new", () => {
    expect(defaultBranch).toContain('"space-y-6"');
    expect(defaultBranch).toContain("PartyPopper");
    expect(defaultBranch).toMatch(/\bh-8\b/);
    expect(defaultBranch).not.toContain("cc-bars");
    expect(defaultBranch).not.toContain("🎉");
  });

  it("⚠️ nothing outside the stages branch reads `look` — an absent prop cannot touch the old dashboard", () => {
    expect(defaultBranch).not.toMatch(/\blook\b/);
    // Before the branch: the Props field and the destructure, and nothing else
    // — so the hooks, the baseline and the bar maths cannot differ by look.
    expect(before.match(/\blook\b/g) ?? []).toHaveLength(2);
    expect(before).toMatch(/look\?: "stages";/);
  });

  it("the stages branch opens the SAME doors — the burndown's `openBar` / `linkFor`, no second rule", () => {
    expect(stagesBranch).toContain("openBar(role.id, role.route)");
    expect(stagesBranch).toContain("linkFor(role.id, role.route)");
    expect(stagesBranch).not.toContain("/fax-inbox");
    expect(stagesBranch).not.toContain("filterQuery(");
  });
});

/** Every rule's selector list, descending into @media / @supports groups and
 *  skipping @keyframes-style bodies (whose "selectors" are `from` / `50%`). */
function ruleSelectors(css: string): { selector: string; inGroup: boolean }[] {
  const out: { selector: string; inGroup: boolean }[] = [];
  const stack: Array<"group" | "rule" | "skip"> = [];
  let head = "";
  for (const ch of css) {
    if (ch === "{") {
      const h = head.trim();
      head = "";
      const top = stack[stack.length - 1];
      if (top === "rule" || top === "skip") stack.push("skip");
      else if (/^@(media|supports|container|layer)\b/.test(h)) stack.push("group");
      else if (h.startsWith("@")) stack.push("skip");
      else {
        out.push({ selector: h, inGroup: stack.includes("group") });
        stack.push("rule");
      }
    } else if (ch === "}") {
      stack.pop();
      head = "";
    } else if (ch === ";" && stack[stack.length - 1] !== "rule") {
      head = "";
    } else {
      head += ch;
    }
  }
  return out;
}

/** The bodies of every `<head> {` block, braces balanced. */
function blocksOf(css: string, head: RegExp): string {
  const found: string[] = [];
  const re = new RegExp(head.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const { start, end } = blockAt(css, m.index);
    found.push(css.slice(start + 1, end));
  }
  return found.join("\n");
}

describe("⚠️ pages/home/home.css is scoped, and reads the app's tokens", () => {
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = stripComments(read("pages/home/home.css"));
  const rules = ruleSelectors(css);
  const SCOPE = /^(?:\.dark |:root\[data-theme="dark"\] )?\.cc-(?:bars|hometop)(?![\w-])/;

  it("every selector — inside @media too — starts with `.cc-bars` or `.cc-hometop`", () => {
    // The scanner must have found real rules, including the ones inside
    // @media, or every assertion below passes over nothing.
    expect(rules.length).toBeGreaterThan(20);
    expect(css).toContain("@media");
    expect(rules.some((r) => r.inGroup)).toBe(true);
    const parts = rules.flatMap((r) => r.selector.split(",").map((p) => p.replace(/\s+/g, " ").trim()));
    for (const part of parts) expect(SCOPE.test(part), part).toBe(true);
    // Both scopes are in use, and neither leaks onto the other's markup.
    expect(parts.some((p) => p.startsWith(".cc-bars"))).toBe(true);
    expect(parts.some((p) => p.startsWith(".cc-hometop"))).toBe(true);
  });

  it("no bare hex colour; a hex may only be the fallback of a token both themes define", () => {
    const index = stripComments(read("index.css"));
    const light = blocksOf(index, /(?:^|[\s}]):root\s*\{/);
    const dark = blocksOf(index, /(?:^|[\s}])\.dark\s*\{/);
    expect(light).toContain("--background");
    expect(dark).toContain("--background");
    const defines = (block: string, token: string) =>
      new RegExp(`(?:^|[\\s;{])${token.replace(/[-]/g, "\\-")}\\s*:`).test(block);

    const FALLBACK = /var\(\s*(--[\w-]+)\s*,\s*([^()]*?)\s*\)/g;
    for (const [, token, fallback] of css.matchAll(FALLBACK)) {
      if (!/#[0-9a-f]{3,8}\b/i.test(fallback)) continue;
      // A fallback only paints when the token is missing — so the token must be
      // there in BOTH themes, or dark mode gets the light hex.
      expect(defines(light, token), `${token} in :root`).toBe(true);
      expect(defines(dark, token), `${token} in .dark`).toBe(true);
    }
    const bare = css.replace(FALLBACK, "var()");
    expect(bare.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });
});
