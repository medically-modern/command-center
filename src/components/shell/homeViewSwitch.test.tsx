/**
 * HomeViewSwitch in the mockup's look (pixel-match Phase 7, §5.52): the
 * `.cc-hometop` > `.home-top` row, the `.segc.home-toggle` segmented control,
 * and the `input.sm` "Viewing" picker.
 *
 * The WIRING — which views a person has, whose view a borrow shows — is
 * `homeViewBorrow.test.tsx`'s job. This file is the component on its own: what
 * it draws for each combination of props, and what each control calls.
 *
 * ⚠️ With one view, no ability and no borrow it must render NOTHING — every
 * access.json without a `homeView` reads as `["bars"]` (§5.39c), so that is
 * almost everybody's home screen.
 *
 * Fake people only.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { HomeViewSwitch } from "./HomeViewSwitch";

type Props = ComponentProps<typeof HomeViewSwitch>;

const PEOPLE = [
  { key: "tperson", name: "Test Person" },
  { key: "srep", name: "Sample Rep" },
];

function mount(over: Partial<Props> = {}) {
  const props: Props = {
    views: ["bars", "oversight"],
    active: "bars",
    onView: vi.fn(),
    people: [],
    viewingKey: "",
    onViewing: vi.fn(),
    borrowedName: null,
    ...over,
  };
  return { ...render(<HomeViewSwitch {...props} />), props };
}

describe("the home toggle — the mockup's segmented control", () => {
  it("two views: a tablist of two tabs inside `.cc-hometop > .home-top`, the active one `.on`", () => {
    const { container, props } = mount();
    expect(container.firstElementChild).toHaveClass("cc-hometop");

    const list = screen.getByRole("tablist", { name: "Home view" });
    expect(list).toHaveClass("segc", "home-toggle");
    expect(list.parentElement).toHaveClass("home-top");
    expect(list.parentElement.parentElement).toBe(container.firstElementChild);

    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Stages", "Oversight"]);
    expect(tabs[0]).toHaveClass("on");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).not.toHaveClass("on");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(list.querySelectorAll(".on")).toHaveLength(1);
    for (const t of tabs) {
      expect(t).toHaveAttribute("type", "button");
      expect(t.querySelector("svg")).not.toBeNull();
    }

    fireEvent.click(tabs[1]);
    expect(props.onView).toHaveBeenCalledWith("oversight");
    expect(props.onView).toHaveBeenCalledTimes(1);
  });

  it("three views keep the order they are given, and `.on` follows `active`", () => {
    mount({ views: ["oversight", "bars", "coordinator"], active: "coordinator" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Oversight", "Stages", "My Patients"]);
    expect(tabs.filter((t) => t.classList.contains("on")).map((t) => t.textContent)).toEqual(["My Patients"]);
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });
});

describe("the Viewing picker", () => {
  it("is `select.input.sm`, \"My view\" first and then the people; changing it calls onViewing", () => {
    const { props } = mount({ people: PEOPLE, viewingKey: "tperson" });
    const select = screen.getByLabelText("Whose view to show") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveClass("input", "sm");
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["", "My view"],
      ["tperson", "Test Person"],
      ["srep", "Sample Rep"],
    ]);
    expect(select.value).toBe("tperson");

    const label = select.closest("label");
    expect(label).toHaveClass("row", "xs", "muted");
    expect(label.textContent).toContain("Viewing");

    fireEvent.change(select, { target: { value: "srep" } });
    expect(props.onViewing).toHaveBeenCalledWith("srep");
    fireEvent.change(select, { target: { value: "" } });
    expect(props.onViewing).toHaveBeenLastCalledWith("");
  });

  it("the row reads toggle · spacer · picker, like the mockup's `.home-top`", () => {
    const { container } = mount({ people: PEOPLE });
    const top = container.querySelector(".cc-hometop > .home-top");
    expect([...top.children].map((c) => c.className)).toEqual(["segc home-toggle", "grow", "row xs muted"]);
  });

  it("one view with the ability: the picker and no toggle", () => {
    mount({ views: ["bars"], people: PEOPLE });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByLabelText("Whose view to show")).toBeTruthy();
  });

  it("two views without the ability: the toggle and no picker", () => {
    mount({ people: [] });
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.queryByLabelText("Whose view to show")).toBeNull();
    expect(screen.queryByText("Viewing")).toBeNull();
  });
});

describe("⚠️ a ?viewing= naming somebody who has gone is SAID, not swallowed", () => {
  it("an amber `.notice` with the name, and Clear takes you back to your own view", () => {
    const onClearViewing = vi.fn();
    const { container } = mount({ people: PEOPLE, missingViewing: "former-rep", onClearViewing });
    const notice = container.querySelector<HTMLElement>(".cc-hometop > .notice.amber");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice.textContent).toContain("Showing your own view.");
    expect(notice.textContent).toContain("“former-rep” isn't in the access list any more");
    fireEvent.click(within(notice).getByRole("button", { name: "Clear" }));
    expect(onClearViewing).toHaveBeenCalledTimes(1);
  });

  it("with no Clear handler the notice still says so, with no dead button", () => {
    const { container } = mount({ people: PEOPLE, missingViewing: "former-rep" });
    const notice = container.querySelector<HTMLElement>(".notice.amber");
    expect(notice.textContent).toContain("Showing your own view.");
    expect(within(notice).queryByRole("button")).toBeNull();
  });

  it("it keeps the strip up even when there is nothing else to draw", () => {
    const { container } = mount({ views: ["bars"], missingViewing: "former-rep" });
    expect(container.querySelector(".notice.amber")).not.toBeNull();
  });
});

describe("⚠️ what renders nothing", () => {
  it("one view, no people, no borrow, nothing missing ⇒ NOTHING — not an empty bar", () => {
    const { container } = mount({ views: ["bars"] });
    expect(container.innerHTML).toBe("");
  });

  it("an empty missing name is not a missing person", () => {
    const { container } = mount({ views: ["bars"], missingViewing: "" });
    expect(container.innerHTML).toBe("");
  });

  it("a borrow keeps the strip mounted, but the banner is the shell's — never a second copy here", () => {
    const { container } = mount({ views: ["bars"], people: PEOPLE, borrowedName: "Test Person", viewingKey: "tperson" });
    expect(container.querySelector(".cc-hometop")).not.toBeNull();
    // The way back is the picker; the say-so is ViewAsBanner's (§5.39h).
    expect(screen.getByLabelText("Whose view to show")).toHaveValue("tperson");
    expect(container.textContent).not.toMatch(/looking at/i);
    expect(container.querySelector(".notice")).toBeNull();
  });
});
