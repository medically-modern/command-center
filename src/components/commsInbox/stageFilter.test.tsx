/**
 * The Inbox's stage filter (Josh, 2026-09-23: "add a small filter button to
 * the right of voicemails hugging that right side of the box that allows you
 * to filter by stage").
 *
 * ⚠️ Two things it must never do: be ON without saying so on the button (a rep
 * reads a filtered list as the whole inbox), and offer a stage the gateway does
 * not know — the gateway IGNORES an unknown value, so the button would say
 * "Insurance" over an unfiltered list.
 */
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import InboxList from "./InboxList";
import { STAGE_FILTERS, type InboxList as InboxListData } from "@/lib/commsInbox/rules";
import type { InboxQuery } from "@/lib/commsInbox/api";

// Radix menus reach for these, and jsdom has neither.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).scrollIntoView = () => {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).hasPointerCapture = () => false;

/** Radix opens a menu from the keyboard as well as the pointer; the keyboard is
 *  the one jsdom can drive without a PointerEvent. */
const openMenu = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });

const EMPTY: InboxListData = {
  rows: [],
  counts: { open: 0, over: 0 },
  total: 0,
  badge: { open: 0, over: 0 },
  computedAt: 0,
  epoch: 0,
};

function renderList(stage: InboxQuery["stage"], onQuery = vi.fn()) {
  render(
    <InboxList
      data={EMPTY}
      stale={false}
      loading={false}
      error={null}
      onReload={() => {}}
      query={{ view: "open", type: "", stage, sort: "wait", sticky: "" }}
      onQuery={onQuery}
      search=""
      onSearch={() => {}}
      selectedKey={null}
      stickyKey=""
      onSelect={() => {}}
    />,
  );
  return onQuery;
}

describe("the stage filter button", () => {
  it("sits at the end of the type chips, after Voicemails, in the same row", () => {
    renderList("");
    const button = screen.getByRole("button", { name: "Filter by stage" });
    const voicemails = screen.getByRole("button", { name: "Voicemails" });
    // Same row container; the chips wrap inside their own group, the button
    // keeps the right-hand end.
    const row = button.parentElement as HTMLElement;
    expect(row.contains(voicemails)).toBe(true);
    expect(row.lastElementChild).toBe(button);
    expect(button.textContent).toBe("Stage");
  });

  it("offers every stage, and picking one asks for it", async () => {
    const onQuery = renderList("");
    openMenu(screen.getByRole("button", { name: "Filter by stage" }));
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitemradio").map((i) => i.textContent);
    expect(items).toEqual(["Every stage", ...STAGE_FILTERS]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Insurance" }));
    expect(onQuery).toHaveBeenCalledWith({ stage: "Insurance" });
  });

  it("⚠️ on, the button SAYS which stage — and Every stage turns it off", async () => {
    const onQuery = renderList("Welcome Call");
    const button = screen.getByRole("button", { name: "Stage filter: Welcome Call" });
    expect(button.textContent).toBe("Welcome Call");
    openMenu(button);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: "Welcome Call" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Every stage" }));
    expect(onQuery).toHaveBeenCalledWith({ stage: "" });
  });

  it("⚠️ an empty filtered list names the stage and offers the way back", () => {
    const onQuery = renderList("Insurance");
    expect(screen.getByText("Nothing unresolved in Insurance.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show every stage" }));
    expect(onQuery).toHaveBeenCalledWith({ stage: "" });
  });

  it("unfiltered, the empty list reads as it always did", () => {
    renderList("");
    expect(screen.getByText("Nothing unresolved. Nice.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show every stage" })).toBeNull();
  });
});

describe("⚠️ the menu offers exactly the stages the gateway filters on", () => {
  it("STAGE_FILTERS ⇄ commsInboxRules STAGE_PILLS", async () => {
    const gw = (await import(resolve(process.cwd(), "services/monday-gateway/commsInboxRules.mjs"))) as {
      STAGE_PILLS: readonly string[];
    };
    expect([...STAGE_FILTERS].sort()).toEqual([...gw.STAGE_PILLS].sort());
    expect(new Set(STAGE_FILTERS).size).toBe(STAGE_FILTERS.length);
  });
});
