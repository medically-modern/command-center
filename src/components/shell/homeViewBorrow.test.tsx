/**
 * The home screen and the "Viewing: <person>" borrow (§5.39c, rewritten
 * §5.39h) — Josh's *"I want to test how it looks for a processor … maybe we
 * make a fake login?"* (2026-09-18), then *"the home screen should be the
 * assigned view / bars for that person"* and *"the whole ui should be EXACTLY
 * what they see"* (2026-09-19).
 *
 * ⚠️⚠️ **Bug one: borrowing used to render `<Index />`.** `Index` reads the
 * signed-in identity itself and only takes its processor branch when the
 * SIGNED-IN person is a processor, so a manager picking somebody in the
 * dropdown got their own manager dashboard back — URL changed, banner shown,
 * screen unchanged.
 *
 * ⚠️⚠️ **Bug two: the home itself branched on `access.type`**, so a manager
 * never saw their own queues however many roles they were assigned. The home is
 * `homeProfileFor` now — mine, or the borrowed person's — and `Index` belongs
 * to "as today" alone.
 *
 * ⚠️⚠️ **Bug three, Josh's own report: *"i assigned madelins just manager
 * oversight and it still shows bars when i look at her view"*.** The custom
 * view has to follow the BORROWED person, not the signed-in one, on both halves
 * — which views exist and which one is active.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccessConfig } from "@/lib/accessStore";

// Stand-ins, so this test is about the WIRING and not about four heavy pages.
vi.mock("@/pages/Index", () => ({
  default: () => <div data-testid="manager-dashboard" />,
}));
vi.mock("@/pages/ProcessorView", () => ({
  default: ({ profile, email, mine, allRoles }: { profile: { name?: string; roles?: string[] }; email: string; mine?: boolean; allRoles?: boolean }) => (
    <div
      data-testid="processor-view"
      data-name={profile?.name}
      data-email={email}
      data-roles={(profile?.roles ?? []).join(",")}
      data-mine={mine ? "1" : "0"}
      data-allroles={allRoles ? "1" : "0"}
    />
  ),
}));
vi.mock("@/components/oversight/OversightTab", () => ({
  default: () => <div data-testid="oversight" />,
}));
vi.mock("@/pages/CareCoordinatorPage", () => ({
  default: () => <div data-testid="coordinator" />,
}));

/**
 * Shaped like the LIVE config on 2026-09-19, including the two things that
 * have broken a lookup already: people in BOTH lists, and a `homeView` on
 * somebody who is only a processor (Madeline).
 */
const CONFIG: AccessConfig = {
  managers: ["josh@medicallymodern.com", "katie@medicallymodern.com"],
  processors: {
    "josh@medicallymodern.com": { name: "josh", roles: ["profile", "evaluate"], perms: { viewOthers: true } },
    "katie@medicallymodern.com": { name: "katie", roles: ["profile"] },
    "masheke@medicallymodern.com": { name: "Masheke", roles: ["evaluate", "fax"] },
    "madeline@medicallymodern.com": { name: "Madeline", roles: ["benefits", "dvs"], homeView: ["oversight"] },
    "both@medicallymodern.com": { name: "Both", roles: ["profile"], homeView: ["bars", "coordinator"] },
  },
  callAnswerers: [],
};
// ⚠️ A dual manager+processor with a custom view — the `kindOf` trap, which
// hands back `profile: null` for anybody in `managers[]` and so made a home
// view unreadable for every "dual" person in the real config.
CONFIG.managers.push("both@medicallymodern.com");

let signedIn = "josh@medicallymodern.com";
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({ email: signedIn, config: CONFIG }),
}));

// Imported after the mocks are registered.
const { HomeViewHost } = await import("./HomeViewHost");
const { getViewAs } = await import("@/lib/shell/viewAs");

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <HomeViewHost />
    </MemoryRouter>,
  );
}

describe("the home screen is MY view", () => {
  it("⚠️ a manager lands on their OWN bars, not the team roster", () => {
    signedIn = "josh@medicallymodern.com";
    at("/");
    const view = screen.getByTestId("processor-view");
    expect(view.getAttribute("data-email")).toBe("josh@medicallymodern.com");
    expect(view.getAttribute("data-mine")).toBe("1");
    expect(view.getAttribute("data-roles")).toBe("profile,evaluate");
    // `Index` is the "as today" dashboard now and must not reach the redesign.
    expect(screen.queryByTestId("manager-dashboard")).toBeNull();
  });

  it("a manager with NO processor entry still gets a screen — every bar", async () => {
    const { homeProfileFor, isSyntheticHomeProfile } = await import("@/lib/shell/homeProfile");
    const cfg: AccessConfig = { managers: ["new@medicallymodern.com"], processors: {}, callAnswerers: [] };
    const p = homeProfileFor("new@medicallymodern.com", cfg);
    expect(p).not.toBeNull();
    expect((p?.roles ?? []).length).toBeGreaterThan(5);
    expect(isSyntheticHomeProfile("new@medicallymodern.com", cfg)).toBe(true);
  });

  it("a processor lands on their own bars with no switcher at all", () => {
    signedIn = "masheke@medicallymodern.com";
    const { container } = at("/");
    const view = screen.getByTestId("processor-view");
    expect(view.getAttribute("data-email")).toBe("masheke@medicallymodern.com");
    // One view, no ability ⇒ the strip collapses to null and the home page is
    // exactly what it was before any of this existed.
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("the borrow", () => {
  it("⚠️ renders THAT PERSON'S view, not mine — the whole point of the dropdown", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=masheke");
    const view = screen.getByTestId("processor-view");
    expect(view.getAttribute("data-name")).toBe("Masheke");
    expect(view.getAttribute("data-email")).toBe("masheke@medicallymodern.com");
    expect(view.getAttribute("data-mine")).toBe("0");
    // Never my own roles under their name.
    expect(view.getAttribute("data-roles")).toBe("evaluate,fax");
  });

  it("⚠️⚠️ follows the BORROWED person's custom view — Josh's Madeline report", async () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=madeline");
    // She is `homeView: ["oversight"]`, so her screen is Oversight and there
    // are no bars anywhere on it. (`await`, because the view is lazy.)
    expect(await screen.findByTestId("oversight")).toBeTruthy();
    expect(screen.queryByTestId("processor-view")).toBeNull();
  });

  it("⚠️⚠️ a newly granted view becomes the LANDING view — the other half of the Madeline report", async () => {
    const { withHomeView, homeViewsOf } = await import("@/lib/shell/abilities");
    const cfg: AccessConfig = {
      managers: [],
      processors: { "p@x.com": { name: "p", roles: [] } },
      callAnswerers: [],
    };
    // Default is ["bars"]. Granting oversight must put them ON oversight,
    // not leave them on bars behind a toggle nobody noticed.
    const next = withHomeView(cfg, "p@x.com", "oversight", true)!;
    expect(homeViewsOf("p@x.com", next)).toEqual(["oversight", "bars"]);
    // Removing one never reorders the rest.
    const off = withHomeView(next, "p@x.com", "bars", false)!;
    expect(homeViewsOf("p@x.com", off)).toEqual(["oversight"]);
  });

  it("⚠️ reads a DUAL manager+processor's custom view too", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=both");
    // Two views ⇒ a toggle, defaulting to the first.
    expect(screen.getByTestId("processor-view").getAttribute("data-email")).toBe("both@medicallymodern.com");
    expect(screen.getByText("My Patients")).toBeTruthy();
  });

  it("⚠️ an explicit ?home= the borrowed person does NOT have falls back to one they do", async () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=madeline&home=bars");
    expect(await screen.findByTestId("oversight")).toBeTruthy();
    expect(screen.queryByTestId("processor-view")).toBeNull();
  });

  it("publishes the borrowed email so the HEADER can follow it", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=masheke");
    expect(getViewAs()).toBe("masheke@medicallymodern.com");
  });

  it("says whose view it is", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=masheke");
    expect(screen.getAllByText(/Masheke/).length).toBeGreaterThan(0);
  });

  it("accepts a hand-typed full email, and still selects the right option", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=masheke@medicallymodern.com");
    expect(screen.getByTestId("processor-view").getAttribute("data-name")).toBe("Masheke");
    const select = screen.getByLabelText("Whose view to show") as HTMLSelectElement;
    expect(select.value).toBe("masheke");
  });

  it("⚠️ SAYS SO when ?viewing= names somebody who is gone, instead of quietly showing me myself", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=someone-who-left");
    // My own screen, and it does not pretend otherwise.
    expect(screen.getByTestId("processor-view").getAttribute("data-mine")).toBe("1");
    expect(screen.getByText(/isn't in the access list any more/)).toBeTruthy();
    expect(screen.queryByText(/You're looking at/)).toBeNull();
    expect(getViewAs()).toBe("");
  });

  it("⚠️ gives NO dropdown, and ignores ?viewing=, without the ability", () => {
    // Katie is a MANAGER and still does not get it — it is opt-in (§5.39c).
    signedIn = "katie@medicallymodern.com";
    at("/?viewing=masheke");
    expect(screen.queryByLabelText("Whose view to show")).toBeNull();
    const view = screen.getByTestId("processor-view");
    expect(view.getAttribute("data-email")).toBe("katie@medicallymodern.com");
    expect(getViewAs()).toBe("");
  });
});
