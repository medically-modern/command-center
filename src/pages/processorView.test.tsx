/**
 * ProcessorView's `stages` prop — the redesign's `barsHome` (pixel-match
 * Phase 7, §5.52): "<name>'s stages", the `.cc-bars.proc-main` column, and the
 * bars in the mockup's look.
 *
 * ⚠️ `HomeViewHost` passes `stages` inside the redesign and nothing else does,
 * so `Index.tsx` ("as today") must render this page exactly as it always has —
 * "Your work", the old column, and bars with no look. Both halves are pinned
 * here, plus the one property that makes the swap safe: the bars get the SAME
 * data either way, and only the look differs.
 *
 * The bars are a stand-in: this test is about the page, `stagesLook.test.tsx`
 * is about the bars. Fake people only.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import type { ProcessorProfile } from "@/lib/accessStore";

const hook = vi.hoisted(() => ({ counts: { evaluate: 2 } as Record<string, number>, loading: false }));

vi.mock("@/hooks/useFilteredRoleCounts", () => ({
  useFilteredRoleCounts: () => ({ counts: hook.counts, loading: hook.loading }),
}));
vi.mock("@/components/inboundCalls/CallConnectionBadge", () => ({ default: () => null }));
vi.mock("@/components/dashboard/DailyBurndown", () => ({
  DailyBurndown: (p: {
    look?: string;
    roleCounts: Record<string, number>;
    countsLoading: boolean;
    visibleRoleIds: string[];
    order?: string[];
    roleFilters?: Record<string, string>;
    managerMode?: boolean;
  }) => (
    <div
      data-testid="bars"
      data-look={p.look ?? ""}
      data-visible={p.visibleRoleIds.join(",")}
      data-order={(p.order ?? []).join(",")}
      data-filters={JSON.stringify(p.roleFilters ?? {})}
      data-counts={JSON.stringify(p.roleCounts)}
      data-loading={p.countsLoading ? "1" : "0"}
      data-manager={p.managerMode ? "1" : "0"}
    />
  ),
}));

import ProcessorView from "./ProcessorView";

const PROFILE: ProcessorProfile = {
  name: "Test Person",
  roles: ["evaluate", "benefits", "fax"],
  // FAX first, Evaluate second, Benefits unnumbered — so it falls in after them.
  roleOrder: { fax: 1, evaluate: 2 },
  roleFilters: { evaluate: "escalated" },
};
const EMAIL = "tperson@example.com";

function mount(over: Partial<ComponentProps<typeof ProcessorView>> = {}) {
  return render(
    <MemoryRouter>
      <ProcessorView profile={PROFILE} email={EMAIL} {...over} />
    </MemoryRouter>,
  );
}

/** The heading's hint line — the element the mockup puts right under the title. */
const hintUnder = (heading: HTMLElement) => heading.nextElementSibling;

/** Every prop the bars were handed, as strings. */
function barsProps() {
  const el = screen.getByTestId("bars");
  return {
    look: el.getAttribute("data-look"),
    visible: el.getAttribute("data-visible"),
    order: el.getAttribute("data-order"),
    filters: el.getAttribute("data-filters"),
    counts: el.getAttribute("data-counts"),
    loading: el.getAttribute("data-loading"),
    manager: el.getAttribute("data-manager"),
  };
}

describe("stages — the mockup's barsHome", () => {
  it("\"<name>'s stages\", the `.cc-bars.proc-main` column, and the bars in the stages look", () => {
    const { container } = mount({ stages: true });
    const heading = screen.getByRole("heading", { level: 2, name: "Test Person's stages" });
    expect(heading).toHaveClass("ttl");
    const main = container.querySelector("main");
    expect(main).toHaveClass("cc-bars", "proc-main");
    expect(within(main).getByTestId("bars")).toHaveAttribute("data-look", "stages");
    expect(screen.queryByText("Your work")).toBeNull();
  });

  it("names the owner even when it is mine, and the hint is the one line", () => {
    mount({ stages: true });
    const heading = screen.getByRole("heading", { name: "Test Person's stages" });
    expect(hintUnder(heading)).toHaveClass("small", "muted");
    expect(hintUnder(heading).textContent).toBe("Click a bar to open that queue.");
  });

  it("with no name on the profile, the email's local part stands in", () => {
    mount({ stages: true, profile: { ...PROFILE, name: "" } });
    expect(screen.getByRole("heading", { name: "tperson's stages" })).toBeTruthy();
  });

  it("while borrowing, the hint says whose bars these are", () => {
    mount({ stages: true, mine: false });
    const heading = screen.getByRole("heading", { name: "Test Person's stages" });
    expect(hintUnder(heading).textContent).toBe(
      "Click a bar to open that queue. You are looking at Test Person's bars.",
    );
  });

  it("the all-roles stand-in says so rather than claiming somebody chose these", () => {
    mount({ stages: true, allRoles: true });
    const heading = screen.getByRole("heading", { name: "Test Person's stages" });
    expect(hintUnder(heading).textContent).toBe(
      "Every queue — you have no assigned bars, so this is all of them.",
    );
  });

  it("no roles: the mockup's empty line, and no bars", () => {
    mount({ stages: true, profile: { ...PROFILE, roles: [] } });
    expect(screen.getByText("No stages assigned yet — an admin adds them in Users.")).toBeTruthy();
    expect(screen.queryByTestId("bars")).toBeNull();
    expect(screen.queryByText(/No queues assigned yet/)).toBeNull();
  });
});

describe("without `stages` — the old view, for \"as today\"", () => {
  it("\"Your work\", the old column, and bars with no look", () => {
    const { container } = mount();
    expect(screen.getByRole("heading", { level: 2, name: "Your work" })).toBeTruthy();
    expect(container.querySelector(".cc-bars")).toBeNull();
    expect(container.querySelector("main")).toHaveClass("p-6");
    expect(screen.getByTestId("bars")).toHaveAttribute("data-look", "");
    expect(screen.queryByText(/'s stages/)).toBeNull();
  });

  it("while borrowing: \"<name>'s work\"", () => {
    mount({ mine: false });
    expect(screen.getByRole("heading", { name: "Test Person's work" })).toBeTruthy();
    expect(screen.queryByText(/You are looking at/)).toBeNull();
  });

  it("no roles: the old empty line", () => {
    mount({ profile: { ...PROFILE, roles: [] } });
    expect(screen.getByText("No queues assigned yet — ask your manager to add some.")).toBeTruthy();
    expect(screen.queryByText(/No stages assigned yet/)).toBeNull();
    expect(screen.queryByTestId("bars")).toBeNull();
  });
});

describe("⚠️ the look changes nothing but the look", () => {
  it("the bars get the same roles, order, filters and counts either way", () => {
    const a = mount({ stages: true });
    const stages = barsProps();
    a.unmount();
    mount();
    const old = barsProps();

    expect(stages.look).toBe("stages");
    expect(old.look).toBe("");
    expect({ ...stages, look: "" }).toEqual(old);
    // …and what they are handed is the profile's, in its SOP order.
    expect(stages.visible).toBe("evaluate,benefits,fax");
    expect(stages.order).toBe("fax,evaluate,benefits");
    expect(stages.filters).toBe(JSON.stringify({ evaluate: "escalated" }));
    expect(stages.counts).toBe(JSON.stringify({ evaluate: 2 }));
    // A person's own home is never the escalated-only manager mode.
    expect(stages.manager).toBe("0");
  });

  it("the loading flag reaches the bars in the stages look too", () => {
    hook.loading = true;
    try {
      mount({ stages: true });
      expect(barsProps().loading).toBe("1");
    } finally {
      hook.loading = false;
    }
  });

  it("both keep the `data-cc-chrome` header the redesign shell hides", () => {
    const a = mount({ stages: true });
    expect(a.container.querySelector("header[data-cc-chrome]")).not.toBeNull();
    a.unmount();
    const b = mount();
    expect(b.container.querySelector("header[data-cc-chrome]")).not.toBeNull();
  });
});
