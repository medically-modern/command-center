// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * ⚠️ `discardEdits` — what every stage page's Reset calls — must put the
 * BOARD's values back on screen, synchronously, on all five role hooks.
 *
 * `patients` holds the MERGED patient (the board row with the rep's overlay
 * applied), so dropping the overlay entry alone changes nothing that is
 * rendered: the discarded edits stay up until a refetch lands, a Send in that
 * window writes them, and a failed refetch makes them permanent. And the older
 * Reset was worse — it wrote BLANKS into the overlay, which every refetch then
 * merged back over the board, so Reset → Send wiped the column on Monday:
 *   · Insurance — `notes: ""` replaced Call Reference Notes (§5.28's shared
 *     column), because that send writes the notes whenever they are a string.
 *   · Final Confirm — the five Last Bill dates, which that send writes
 *     unconditionally (a blank clears; §5.32e).
 * `src/pages/resetDiscardsEdits.test.ts` holds the pages to calling this; this
 * file holds each hook to doing what the pages rely on.
 */

// Everything the vi.mock factories touch has to exist before they run, and
// they are hoisted above every other statement — so it all lives in here.
const m = vi.hoisted(() => {
  const mk = () => ({ fetch: vi.fn(), byId: vi.fn() });
  const mocks = { sam: mk(), fc: mk(), mash: mk(), sub: mk(), wc: mk() };
  type K = ReturnType<typeof mk>;
  const readMocks = (k: K) => ({
    hasToken: () => true,
    fetchGroupItems: (...a: unknown[]) => k.fetch(...a),
    fetchItemById: (...a: unknown[]) => k.byId(...a),
  });
  /** The read-time backfills (Next Action Date, Follow Up Date, escalation
   *  self-heal) write to Monday; nothing here may reach the network. */
  const noWrites = {
    writeDate: () => Promise.resolve(),
    writeStatusIndex: () => Promise.resolve(),
  };
  return { ...mocks, readMocks, noWrites };
});
type Mock = typeof m.sam;

vi.mock("@/lib/samantha/mondayApi", async () => ({
  ...(await vi.importActual<object>("@/lib/samantha/mondayApi")),
  ...m.readMocks(m.sam),
}));
vi.mock("@/lib/finalConfirm/mondayApi", async () => ({
  ...(await vi.importActual<object>("@/lib/finalConfirm/mondayApi")),
  ...m.readMocks(m.fc),
}));
vi.mock("@/lib/masheke/mondayApi", async () => ({
  ...(await vi.importActual<object>("@/lib/masheke/mondayApi")),
  ...m.readMocks(m.mash),
  ...m.noWrites,
}));
vi.mock("@/lib/subscription/mondayApi", async () => ({
  ...(await vi.importActual<object>("@/lib/subscription/mondayApi")),
  ...m.readMocks(m.sub),
}));
vi.mock("@/lib/welcomeCall/mondayApi", async () => ({
  ...(await vi.importActual<object>("@/lib/welcomeCall/mondayApi")),
  ...m.readMocks(m.wc),
  ...m.noWrites,
}));

import { useMondayPatients as useSamantha } from "./samantha/useMondayPatients";
import { useMondayPatients as useFinalConfirm } from "./finalConfirm/useMondayPatients";
import { useMondayPatients as useMasheke } from "./masheke/useMondayPatients";
import { useMondayPatients as useSubscription } from "./subscription/useMondayPatients";
import { useMondayPatients as useWelcomeCall } from "./welcomeCall/useMondayPatients";
import { COL as SAM_COL } from "@/lib/samantha/mondayApi";
import { COL as FC_COL } from "@/lib/finalConfirm/mondayApi";
import { COL as SUB_COL } from "@/lib/subscription/mondayApi";
import { COL as WC_COL } from "@/lib/welcomeCall/mondayApi";

type Row = { id: string; [k: string]: unknown };
type HookResult = {
  patients: Row[];
  update: (id: string, patch: Record<string, unknown>) => void;
  discardEdits: (id: string) => void;
  saveOverlay: (id: string) => void;
  hasOverlay: (id: string) => boolean;
};

const col = (id: string, text: string) => ({ id, text, value: JSON.stringify(text) });
const item = (id: string, cols: ReturnType<typeof col>[]) => ({
  id,
  name: "Test Patient",
  group: { id: "g" },
  column_values: cols,
});

/** One row per hook: the board value a Reset must bring back, and the edit it
 *  must throw away. The Insurance and Final Confirm edits are the BLANKS the
 *  old Reset wrote — the ones that reached Monday. */
const CASES: {
  name: string;
  mock: Mock;
  use: () => HookResult;
  field: string;
  board: string;
  edit: string;
  items: () => unknown[];
}[] = [
  {
    name: "Insurance (Benefits · Submit Auth · Auth Outstanding)",
    mock: m.sam,
    use: () => useSamantha("benefits", null) as unknown as HookResult,
    field: "notes",
    board: "[9/22/26] Benefits: called payer —JH",
    edit: "",
    items: () => [item("p1", [col(SAM_COL.callReferenceNotes, "[9/22/26] Benefits: called payer —JH")])],
  },
  {
    name: "Final Confirm",
    mock: m.fc,
    use: () => useFinalConfirm(null) as unknown as HookResult,
    field: "lastBillDateSensors",
    board: "2026-04-27",
    edit: "",
    items: () => [item("p1", [col(FC_COL.lastBillDate.sensors, "2026-04-27")])],
  },
  {
    name: "Medical Evaluation (the five masheke stages)",
    mock: m.mash,
    use: () => useMasheke("evaluate", null) as unknown as HookResult,
    field: "mnEvalNotes",
    board: "MN history",
    edit: "rep typed this",
    items: () => [
      item("p1", [
        col("color_mm1wyr92", "Evaluate MN"),
        col("date_mm1wadgs", "2026-09-01"),
        col("text_mm6vevjf", "MN history"),
      ]),
    ],
  },
  {
    name: "Subscription",
    mock: m.sub,
    use: () => useSubscription(null) as unknown as HookResult,
    field: "notes",
    board: "subscription history",
    edit: "rep typed this",
    items: () => [item("p1", [col(SUB_COL.subscriptionNotes, "subscription history")])],
  },
  {
    name: "Welcome Call",
    mock: m.wc,
    use: () => useWelcomeCall(null) as unknown as HookResult,
    field: "qtyInf1",
    board: "3",
    edit: "9",
    items: () => [
      item("p1", [col(WC_COL.qtyInf1, "3"), col(WC_COL.followUpDate, "2026-09-01")]),
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  for (const c of CASES) {
    c.mock.fetch.mockResolvedValue(c.items());
    c.mock.byId.mockResolvedValue(null);
  }
});

const shown = (r: { current: HookResult }, field: string) =>
  r.current.patients.find((p) => p.id === "p1")?.[field];

for (const c of CASES) {
  describe(`${c.name} — discardEdits`, () => {
    it("puts the board's value back on screen while the refetch hangs", async () => {
      const { result, unmount } = renderHook(c.use);
      await waitFor(() => expect(shown(result, c.field)).toBe(c.board));

      act(() => result.current.update("p1", { [c.field]: c.edit }));
      expect(shown(result, c.field)).toBe(c.edit);
      expect(result.current.hasOverlay("p1")).toBe(true);

      // Reset. No refetch is allowed to land before we look.
      c.mock.fetch.mockImplementation(() => new Promise(() => {}));
      act(() => result.current.discardEdits("p1"));

      expect(
        shown(result, c.field),
        "the discarded edit is still on screen — a Send now writes it to Monday",
      ).toBe(c.board);
      expect(result.current.hasOverlay("p1")).toBe(false);
      unmount();
    });

    it("still restores when the refetch fails outright", async () => {
      const { result, unmount } = renderHook(c.use);
      await waitFor(() => expect(shown(result, c.field)).toBe(c.board));

      act(() => result.current.update("p1", { [c.field]: c.edit }));
      c.mock.fetch.mockRejectedValue(new Error("Monday 503"));
      act(() => result.current.discardEdits("p1"));

      expect(shown(result, c.field)).toBe(c.board);
      unmount();
    });

    /* Save Progress persists the overlay; Reset must forget it there too, or
       the next page load merges the discarded edit straight back. */
    it("a SAVED edit does not come back on the next page load", async () => {
      const first = renderHook(c.use);
      await waitFor(() => expect(shown(first.result, c.field)).toBe(c.board));
      act(() => first.result.current.update("p1", { [c.field]: c.edit }));
      act(() => first.result.current.saveOverlay("p1"));
      act(() => first.result.current.discardEdits("p1"));
      first.unmount();

      const second = renderHook(c.use);
      await waitFor(() => expect(shown(second.result, c.field)).toBe(c.board));
      expect(second.result.current.hasOverlay("p1")).toBe(false);
      second.unmount();
    });

    /* Nothing truer exists for a patient we have never fetched, and blanking
       would invent data. */
    it("leaves a patient with no board copy alone", async () => {
      const { result, unmount } = renderHook(c.use);
      await waitFor(() => expect(shown(result, c.field)).toBe(c.board));
      act(() => result.current.discardEdits("never-seen"));
      expect(shown(result, c.field)).toBe(c.board);
      unmount();
    });
  });
}

/* Evaluate edits chase-stage patients opened from its read-only "Chase
   Clinicals" folder, and `update` writes that list too — so Reset has to
   revert it as well, or the folder keeps the discarded edit. */
describe("Medical Evaluation — discardEdits reverts the chase viewer list", () => {
  it("restores a chase-stage patient opened from the Evaluate sidebar", async () => {
    m.mash.fetch.mockResolvedValue([
      item("c1", [
        col("color_mm1wyr92", "Chase Clinicals"),
        col("date_mm1wadgs", "2026-09-01"),
        col("text_mm6vevjf", "chase history"),
      ]),
    ]);
    const { result, unmount } = renderHook(() => useMasheke("evaluate", null));
    const viewer = () =>
      result.current.chaseViewerPatients.find((p) => p.id === "c1")?.mnEvalNotes;
    await waitFor(() => expect(viewer()).toBe("chase history"));

    act(() => result.current.update("c1", { mnEvalNotes: "rep typed this" }));
    expect(viewer()).toBe("rep typed this");

    m.mash.fetch.mockImplementation(() => new Promise(() => {}));
    act(() => result.current.discardEdits("c1"));
    expect(viewer()).toBe("chase history");
    unmount();
  });
});
