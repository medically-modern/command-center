/**
 * DailyBurndown's `look="stages"` — the redesign's Stages view (pixel-match
 * Phase 7, §5.52), rendered.
 *
 * The component computes ONE set of bars and draws it in one of two markups.
 * These tests pin the mockup's markup (`.cc-bars` · `.bars` > `.bar` · `.lbl` ·
 * `.track` > `.fill` · `.adhoc` · `.foot-note` · `.notice`) and — just as
 * important — that the markup is the ONLY thing the prop changes: the same
 * bars, in the same order, opening the same doors, celebrating the same way.
 *
 * ⚠️ Without the prop the component must be exactly what it was. The "as
 * today" layout (`Index.tsx`, `DashboardMainView`) renders it with no look, and
 * §5.39b's escape hatch is only one if that screen is untouched.
 *
 * Fake counts only; no patient data is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import confetti from "canvas-confetti";
import { filterQuery } from "@/lib/roleView";

vi.mock("@/hooks/useServerBaseline", () => ({
  useServerBaseline: () => ({ baseline: null, loading: false }),
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

import { DailyBurndown } from "./DailyBurndown";

type Props = ComponentProps<typeof DailyBurndown>;

/** The key the processor burndown keeps its start-of-day snapshot under. */
const SNAPSHOT_KEY = "daily-burndown-snapshot";

const COUNTS = { evaluate: 5, benefits: 0, fax: 2, authDenied: 1, subscription: 3 };
const VISIBLE = ["evaluate", "benefits", "fax", "authDenied", "subscription"];
/** Deliberately NOT the registry's order (evaluate · benefits · authDenied ·
 *  fax), so bars that ignored `order` would fail the first test. */
const ORDER = ["fax", "benefits", "evaluate", "authDenied", "subscription"];
const ZERO = { evaluate: 0, benefits: 0, fax: 0, authDenied: 0, subscription: 0 };

/** No `look` key at all — the old dashboard gets the prop ABSENT, not undefined. */
const BASE: Props = { roleCounts: COUNTS, countsLoading: false, visibleRoleIds: VISIBLE, order: ORDER };

/** Where the last click took us: a probe beside the bars, inside the same router. */
function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}
const where = () => screen.getByTestId("where").textContent;

function tree(p: Props) {
  return (
    <MemoryRouter initialEntries={["/"]}>
      <div data-testid="host">
        <DailyBurndown {...p} />
      </div>
      <Where />
    </MemoryRouter>
  );
}

function renderWith(initial: Props) {
  let props = initial;
  const utils = render(tree(props));
  return {
    ...utils,
    host: screen.getByTestId("host"),
    rerenderWith: (next: Partial<Props>) => {
      props = { ...props, ...next };
      utils.rerender(tree(props));
    },
  };
}
const mount = (over: Partial<Props> = {}) => renderWith({ ...BASE, look: "stages", ...over });
const mountDefault = (over: Partial<Props> = {}) => renderWith({ ...BASE, ...over });

/** The `.bar` rows, top to bottom. */
const barsIn = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>(".cc-bars > .bars > .bar")];
/** A bar's label: the row's own text, without the position number or the icon. */
const labelOf = (bar: Element) =>
  [...bar.querySelector(".lbl > .row").childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join("")
    .trim();
const barFor = (host: HTMLElement, label: string) => {
  const hit = barsIn(host).find((b) => labelOf(b) === label);
  if (!hit) throw new Error(`no bar labelled ${label}`);
  return hit;
};
const countOf = (bar: Element) => bar.querySelector(".lbl > .tn")?.textContent ?? null;
const fillWidth = (bar: Element) => (bar.querySelector(".track > .fill") as HTMLElement).style.width;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(confetti).mockClear();
  // The fills and the confetti both wait on an animation frame; run it now so
  // every test reads the settled screen.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("look=\"stages\" — the mockup's bar markup", () => {
  it("is his markup: a `.cc-bars` root, one `.bar` per stage in the given order, numbered 1..N", () => {
    const { host } = mount();
    expect(host.firstElementChild).toHaveClass("cc-bars");
    expect(host.querySelector(".space-y-6")).toBeNull();

    const bars = barsIn(host);
    expect(bars.map(labelOf)).toEqual(["FAX", "Benefits", "Evaluate", "Auth Denied"]);
    expect(bars.map((b) => b.querySelector(".lbl .n")?.textContent)).toEqual(["1", "2", "3", "4"]);
    for (const b of bars) {
      expect(b.tagName).toBe("BUTTON");
      expect(b).toHaveAttribute("type", "button");
      expect([...b.children].map((c) => c.classList[0])).toEqual(["lbl", "track"]);
    }
    // Each dot wears its role's own colour.
    expect(barFor(host, "Evaluate").querySelector(".dot")).toHaveClass("bg-violet-500");
    // A task role is a tile, never a bar.
    expect(bars.map(labelOf)).not.toContain("Subscription");
  });

  it("without `order` the bars keep the registry's order and carry no numbers", () => {
    const { host } = mount({ order: undefined });
    expect(barsIn(host).map(labelOf)).toEqual(["Evaluate", "Benefits", "Auth Denied", "FAX"]);
    expect(host.querySelector(".bar .n")).toBeNull();
  });

  it("shows each stage's count, and a stage at 0 reads \"🎉 Done!\" on a green track with no fill", () => {
    const { host } = mount();
    expect(countOf(barFor(host, "Evaluate"))).toBe("5");
    expect(countOf(barFor(host, "FAX"))).toBe("2");
    expect(countOf(barFor(host, "Auth Denied"))).toBe("1");

    const done = barFor(host, "Benefits");
    expect(done.querySelector(".lbl > .done-lbl").textContent).toBe("🎉 Done!");
    expect(countOf(done)).toBeNull();
    const track = done.querySelector(".track");
    expect(track).toHaveClass("done");
    expect(track.querySelector(".fill")).toBeNull();
    // Only the empty queue is done.
    expect(host.querySelectorAll(".done-lbl")).toHaveLength(1);
    expect(host.querySelectorAll(".track.done")).toHaveLength(1);
  });

  it("the fill is on a square-root scale — the biggest queue is 100%, the rest in proportion", () => {
    const { host } = mount();
    expect(fillWidth(barFor(host, "Evaluate"))).toBe("100%");
    expect(parseFloat(fillWidth(barFor(host, "FAX")))).toBeCloseTo(Math.sqrt(2 / 5) * 100, 5);
    expect(parseFloat(fillWidth(barFor(host, "Auth Denied")))).toBeCloseTo(Math.sqrt(1 / 5) * 100, 5);
  });

  it("a non-zero queue never draws thinner than 4%", () => {
    const { host } = mount({ roleCounts: { evaluate: 10000, fax: 1 }, visibleRoleIds: ["evaluate", "fax"], order: undefined });
    // 1% on the scale — floored so a single patient is still visible.
    expect(fillWidth(barFor(host, "FAX"))).toBe("4%");
  });

  it("the fills grow in from 0%, and nothing celebrates before the animation frame", () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    const { host } = mount();
    expect(fillWidth(barFor(host, "Evaluate"))).toBe("0%");
    expect(confetti).not.toHaveBeenCalled();
  });
});

describe("look=\"stages\" — the doors are the burndown's own", () => {
  it("a bar opens its queue with its filter's query — none for the default nonEscalated", () => {
    const { host } = mount();
    expect(filterQuery("nonEscalated")).toBe("");
    const evaluate = barFor(host, "Evaluate");
    expect(evaluate).toHaveAttribute("title", "Open Evaluate");
    fireEvent.click(evaluate);
    expect(where()).toBe(`/evaluate${filterQuery("nonEscalated")}`);
    expect(where()).toBe("/evaluate");
    // A finished queue is still a door.
    fireEvent.click(barFor(host, "Benefits"));
    expect(where()).toBe("/benefits");
  });

  it("FAX has no route and opens the in-app Fax Inbox (§4)", () => {
    const { host } = mount();
    fireEvent.click(barFor(host, "FAX"));
    expect(where()).toBe("/fax-inbox");
  });

  it("a role's stored filter decides the query: escalated → ?manager=1, all → ?filter=all", () => {
    const { host } = mount({ roleFilters: { evaluate: "escalated", benefits: "all", fax: "escalated" } });
    fireEvent.click(barFor(host, "Evaluate"));
    expect(where()).toBe("/evaluate?manager=1");
    fireEvent.click(barFor(host, "Benefits"));
    expect(where()).toBe("/benefits?filter=all");
    // FAX is the Fax Inbox whatever its filter says.
    fireEvent.click(barFor(host, "FAX"));
    expect(where()).toBe("/fax-inbox");
  });

  it("⚠️ Auth Denied is shown and inert — never a door, its stage is unbuilt (§7)", () => {
    const { host } = mount();
    const denied = barFor(host, "Auth Denied");
    expect(denied).toHaveClass("inert");
    expect(denied).toHaveAttribute("title", "Auth Denied has no page yet");
    expect(denied.querySelector(".ext")).toBeNull();
    // ⚠️ The registry gives it a route, so this is the id check in
    // `barClickable` doing the work — not an empty route.
    fireEvent.click(denied);
    expect(where()).toBe("/");
    // Every other bar is a door, and says so with the `.ext` icon.
    for (const label of ["FAX", "Benefits", "Evaluate"]) {
      expect(barFor(host, label)).not.toHaveClass("inert");
      expect(barFor(host, label).querySelector(".lbl .ext")).not.toBeNull();
    }
  });

  it("the ad-hoc task roles are `button.btn.teal` tiles with a count badge, and open their page", () => {
    const { host } = mount({
      roleCounts: { ...COUNTS, orders: 0 },
      visibleRoleIds: [...VISIBLE, "orders"],
      order: [...ORDER, "orders"],
    });
    const adhoc = host.querySelector<HTMLElement>(".cc-bars > .adhoc");
    expect(adhoc.querySelector(".eyebrow").textContent).toBe("Ad-hoc tasks");
    const tiles = [...adhoc.querySelectorAll("button.btn.teal")];
    expect(tiles.map((t) => t.getAttribute("title"))).toEqual(["Open Subscription", "Open Orders"]);

    const sub = within(adhoc).getByTitle("Open Subscription");
    expect(sub.querySelector(".count-badge").textContent).toBe("3");
    // A task at 0 has nothing to announce.
    expect(within(adhoc).getByTitle("Open Orders").querySelector(".count-badge")).toBeNull();
    fireEvent.click(sub);
    expect(where()).toBe("/subscription");
  });

  it("the footer says how fresh the numbers are and what a click does", () => {
    const { host } = mount();
    const foot = host.querySelector(".cc-bars > .foot-note");
    expect(foot.textContent).toContain("Refreshes every 60s");
    expect(foot.textContent).toContain("Click a bar to open that role's dashboard");
    expect(foot.textContent).not.toContain("Pulling live counts");
    expect(host.querySelector(".notice")).toBeNull();
  });
});

describe("look=\"stages\" — loading", () => {
  it("⚠️ while counts load with no snapshot it is a SKELETON: every bar reads \"…\", nothing says Done", () => {
    const { host } = mount({ countsLoading: true });
    const bars = barsIn(host);
    // The same rows in the same order — only the numbers are withheld.
    expect(bars.map(labelOf)).toEqual(["FAX", "Benefits", "Evaluate", "Auth Denied"]);
    expect(bars.map((b) => b.querySelector(".lbl .n")?.textContent)).toEqual(["1", "2", "3", "4"]);
    for (const b of bars) {
      expect(countOf(b)).toBe("…");
      expect(b.querySelector(".track .burndown-shimmer")).not.toBeNull();
      expect(b.querySelector(".fill")).toBeNull();
    }
    // Stale zeros must never celebrate — the reason the skeleton exists.
    expect(host.querySelector(".done-lbl")).toBeNull();
    expect(host.textContent).not.toContain("Done!");
    expect(host.querySelector(".count-badge").textContent).toBe("…");
    const foot = host.querySelector(".foot-note");
    expect(foot.textContent).toContain("Pulling live counts…");
    expect(foot.textContent).not.toContain("Refreshes every 60s");
    // A skeleton bar is still a door.
    fireEvent.click(barFor(host, "Evaluate"));
    expect(where()).toBe("/evaluate");
  });

  it("a refetch in flight never flashes Done! on a stage that was at 0", () => {
    const { host, rerenderWith } = mount();
    expect(barFor(host, "Benefits").querySelector(".done-lbl")).not.toBeNull();
    rerenderWith({ countsLoading: true });
    expect(barFor(host, "Benefits").querySelector(".done-lbl")).toBeNull();
    expect(countOf(barFor(host, "Benefits"))).toBe("…");
    expect(countOf(barFor(host, "Evaluate"))).toBe("…");
    // Not a skeleton — the snapshot stands, so the footer still says how fresh.
    expect(host.querySelector(".foot-note").textContent).toContain("Refreshes every 60s");
  });
});

describe("look=\"stages\" — the celebration", () => {
  it("a cleared stage celebrates once, and a re-render does not celebrate again", () => {
    const { rerenderWith } = mount();
    expect(confetti).toHaveBeenCalledTimes(1);
    rerenderWith({ roleCounts: { ...COUNTS } });
    expect(confetti).toHaveBeenCalledTimes(1);
  });
});

describe("look=\"stages\" — manager mode", () => {
  it("the red notice, \"Clear\" in place of Done, escalated links, and the escalated footer", () => {
    const { host } = mount({ managerMode: true });
    const notice = host.querySelector(".cc-bars > .notice");
    expect(notice).toHaveClass("red");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice.textContent).toContain("Escalated patients only");
    expect(notice.textContent).toContain("not the full queue");

    expect(barFor(host, "Benefits").querySelector(".done-lbl").textContent).toBe("Clear");
    expect(host.textContent).not.toContain("🎉");
    expect(host.querySelector(".foot-note").textContent).toContain(
      "Click a bar to open that role's escalated patients",
    );
    fireEvent.click(barFor(host, "Evaluate"));
    expect(where()).toBe("/evaluate?manager=1");

    // Manager counts are live escalations: nothing is baselined, nothing celebrates.
    expect(confetti).not.toHaveBeenCalled();
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it("every stage and every task at 0 turns the notice green — \"All clear\"", () => {
    const { host } = mount({ managerMode: true, roleCounts: ZERO });
    const notice = host.querySelector(".cc-bars > .notice");
    expect(notice).toHaveClass("green");
    expect(notice.textContent).toContain("All clear — no escalated patients");
    expect(host.querySelectorAll(".done-lbl")).toHaveLength(4);
  });

  it("a task with escalations keeps it red — all clear means ALL clear", () => {
    const { host } = mount({ managerMode: true, roleCounts: { ...ZERO, subscription: 3 } });
    expect(host.querySelector(".cc-bars > .notice")).toHaveClass("red");
  });

  it("while manager counts load: a skeleton, and no notice yet", () => {
    const { host } = mount({ managerMode: true, countsLoading: true });
    expect(host.querySelector(".notice")).toBeNull();
    expect(host.querySelector(".foot-note").textContent).toContain("Pulling live counts…");
  });
});

describe("⚠️ without the prop it is the old dashboard, untouched", () => {
  it("renders the old markup: `space-y-6`, `h-8` tracks, the PartyPopper \"Done!\", no `.cc-bars`", () => {
    const { host } = mountDefault();
    expect(host.firstElementChild).toHaveClass("space-y-6");
    expect(host.querySelector(".cc-bars, .bars, .bar, .foot-note, .adhoc, .notice, .done-lbl")).toBeNull();
    expect(host.querySelectorAll(".h-8")).toHaveLength(4);
    expect(host.querySelector(".lucide-party-popper")).not.toBeNull();
    expect(host.textContent).toContain("Done!");
    expect(host.textContent).not.toContain("🎉");
    expect(host.textContent).toContain("Refreshes every 60s");
  });

  it("…and opens the same doors", () => {
    mountDefault();
    fireEvent.click(screen.getByTitle("Auth Denied"));
    expect(where()).toBe("/");
    fireEvent.click(screen.getByTitle("Open Evaluate"));
    expect(where()).toBe("/evaluate");
    fireEvent.click(screen.getByTitle("Open FAX"));
    expect(where()).toBe("/fax-inbox");
  });

  it("its skeleton is the old one too", () => {
    const { host } = mountDefault({ countsLoading: true });
    expect(host.firstElementChild).toHaveClass("space-y-6");
    expect(host.textContent).toContain("Pulling live counts…");
    expect(host.querySelector(".cc-bars, .foot-note")).toBeNull();
  });
});

describe("⚠️ the look changes the markup and nothing else", () => {
  it("both looks write the same start-of-day snapshot — the baseline machinery is shared", () => {
    const a = mount();
    const stages = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)).counts;
    a.unmount();
    localStorage.clear();
    mountDefault();
    const old = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)).counts;
    expect(stages).toEqual(COUNTS);
    expect(stages).toEqual(old);
  });

  it("both looks decide \"is there anything to draw\" the same way", () => {
    const scenarios: Array<[string, Partial<Props>]> = [
      ["a working day", {}],
      ["every queue at 0, nothing loading", { roleCounts: ZERO }],
      ["manager mode, every queue at 0", { managerMode: true, roleCounts: ZERO }],
      ["counts still loading", { countsLoading: true }],
      ["no roles at all", { visibleRoleIds: [], order: [] }],
      ["only a task role", { visibleRoleIds: ["subscription"], order: ["subscription"] }],
    ];
    const draws = (props: Props) => {
      const r = renderWith(props);
      const drew = r.host.innerHTML !== "";
      r.unmount();
      localStorage.clear();
      return drew;
    };
    for (const [name, over] of scenarios) {
      expect(draws({ ...BASE, look: "stages", ...over }), name).toBe(draws({ ...BASE, ...over }));
    }
  });
});
