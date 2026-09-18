/**
 * The "Viewing: <person>" borrow (§5.39c) — Josh's "I want to test how it looks
 * for a processor … maybe we make a fake login?" (2026-09-18).
 *
 * ⚠️⚠️ **The bug this pins: borrowing used to render `<Index />`.** `Index` reads
 * the signed-in identity itself and only takes its processor branch when the
 * SIGNED-IN person is a processor, so a manager picking somebody in the dropdown
 * got their own manager dashboard back — URL changed, banner shown, screen
 * unchanged. And `bars` is the only view anybody in the config has, so that was
 * the borrow doing nothing, for everyone, every time.
 *
 * ⚠️ The second half is the gate: the dropdown exists only for the people
 * granted `viewOthers`, which is opt-in (§5.39c).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccessConfig } from "@/lib/accessStore";

// Stand-ins, so this test is about the WIRING and not about two heavy pages.
vi.mock("@/pages/Index", () => ({
  default: () => <div data-testid="manager-dashboard" />,
}));
vi.mock("@/pages/ProcessorView", () => ({
  default: ({ profile, email }: { profile: { name?: string }; email: string }) => (
    <div data-testid="processor-view" data-name={profile?.name} data-email={email} />
  ),
}));

const CONFIG: AccessConfig = {
  managers: ["josh@medicallymodern.com", "katie@medicallymodern.com"],
  processors: {
    // ⚠️ Josh is in BOTH lists, like the real config — the case that broke the
    // grant lookup once already.
    "josh@medicallymodern.com": { name: "josh", roles: [], perms: { viewOthers: true } },
    "katie@medicallymodern.com": { name: "katie", roles: ["profile"] },
    "masheke@medicallymodern.com": { name: "Masheke", roles: ["evaluate", "fax"] },
  },
  callAnswerers: [],
};

let signedIn = "josh@medicallymodern.com";
vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({ email: signedIn, config: CONFIG }),
}));

// Imported after the mocks are registered.
const { HomeViewHost } = await import("./HomeViewHost");

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <HomeViewHost />
    </MemoryRouter>,
  );
}

describe("the home screen's borrow", () => {
  it("is my own screen with no ?viewing=", () => {
    signedIn = "josh@medicallymodern.com";
    at("/");
    expect(screen.getByTestId("manager-dashboard")).toBeTruthy();
    expect(screen.queryByTestId("processor-view")).toBeNull();
  });

  it("⚠️ renders THAT PERSON'S view, not mine — the whole point of the dropdown", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=masheke");
    const view = screen.getByTestId("processor-view");
    expect(view.getAttribute("data-name")).toBe("Masheke");
    expect(view.getAttribute("data-email")).toBe("masheke@medicallymodern.com");
    // The manager dashboard must be GONE, or the borrow is decoration.
    expect(screen.queryByTestId("manager-dashboard")).toBeNull();
  });

  it("says whose view it is, and that it runs with MY permissions", () => {
    signedIn = "josh@medicallymodern.com";
    at("/?viewing=masheke");
    expect(screen.getByText(/You're looking at Masheke's view/)).toBeTruthy();
    expect(screen.getByText(/permissions, not theirs/)).toBeTruthy();
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
    expect(screen.getByTestId("manager-dashboard")).toBeTruthy();
    expect(screen.getByText(/isn't in the access list any more/)).toBeTruthy();
    // And it must not claim to be showing them.
    expect(screen.queryByText(/You're looking at/)).toBeNull();
  });

  it("⚠️ gives NO dropdown, and ignores ?viewing=, without the ability", () => {
    // Katie is a MANAGER and still does not get it — it is opt-in (§5.39c).
    signedIn = "katie@medicallymodern.com";
    at("/?viewing=masheke");
    expect(screen.queryByLabelText("Whose view to show")).toBeNull();
    expect(screen.queryByTestId("processor-view")).toBeNull();
    expect(screen.getByTestId("manager-dashboard")).toBeTruthy();
  });

  it("renders nothing at all above the page for somebody with one view and no ability", () => {
    signedIn = "masheke@medicallymodern.com";
    const { container } = at("/");
    // `Index` is the only child: the switch collapses to null, so the home page
    // is byte-identical for everybody who was not granted anything.
    expect(container.querySelector("[data-testid='manager-dashboard']")).toBeTruthy();
    expect(container.textContent).toBe("");
  });
});
