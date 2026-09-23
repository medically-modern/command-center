/**
 * The inbox's browser stores and the Monday copy of resolve notes
 * (COMMS_INBOX_PLAN.md §4.6, §5.2–§5.4).
 *
 * The Monday copy is the one thing here that WRITES, and every assertion about
 * it is about ordering: claim before writing, write only to the patient's live
 * record, and never let a failed copy un-resolve anything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";

const { api, dossierApi, toastError } = vi.hoisted(() => ({
  api: {
    inboxConfigured: vi.fn(() => true),
    fetchCommsConfig: vi.fn(),
    fetchInbox: vi.fn(),
    fetchInboxCount: vi.fn(),
    fetchInboxItem: vi.fn(),
    fetchCommsState: vi.fn(),
    reportDialed: vi.fn(),
    fetchOutbox: vi.fn(),
    claimMirror: vi.fn(),
    reportMirrorDone: vi.fn(async () => {}),
    reportMirrorError: vi.fn(async () => {}),
  },
  dossierApi: {
    fetchDossierItemsForPick: vi.fn(),
    appendNoteToRecord: vi.fn(async (_opts: Record<string, unknown>) => {}),
  },
  toastError: vi.fn(),
}));
vi.mock("@/lib/commsInbox/api", () => api);
vi.mock("@/lib/commsHub/dossierApi", () => dossierApi);
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

import {
  __resetInboxStoresForTest,
  copyOne,
  flushCommsOutbox,
  reportDial,
  useCommsConfig,
  useInboxBadge,
  useInboxItem,
  useInboxList,
  useItemKeyForNumber,
} from "./useInbox";
import type { InboxQuery } from "@/lib/commsInbox/api";

const RID = "11111111-2222-3333-4444-555555555555";
const T = Date.parse("2026-09-23T18:10:00Z");

function liveItem(over: Record<string, unknown> = {}) {
  return {
    itemId: "900",
    boardId: 18410804557,
    boardName: "Welcome Call",
    name: "Jane Doe",
    phone: "+15550001111",
    isCompleted: false,
    isStuck: false,
    notesColId: "text_mm6vqq2k",
    notesColType: "text",
    groupTitle: "Welcome Call",
    ...over,
  };
}

function claimed(over: Record<string, unknown> = {}) {
  return {
    resolutionId: RID,
    how: "called",
    label: "Called",
    note: "told her it ships Friday",
    resolvedAt: T,
    itemBoard: 18410804557,
    itemId: "900",
    ...over,
  };
}

beforeEach(() => {
  __resetInboxStoresForTest();
  vi.clearAllMocks();
  api.inboxConfigured.mockReturnValue(true);
});

describe("⚠️⚠️ the Monday copy (plan §5.2–§5.4)", () => {
  it("CLAIMS first — a note somebody else holds is never written", async () => {
    api.claimMirror.mockResolvedValueOnce(null);
    expect(await copyOne(RID)).toBe("not-claimed");
    expect(dossierApi.appendNoteToRecord).not.toHaveBeenCalled();
    expect(api.reportMirrorDone).not.toHaveBeenCalled();
  });

  it("writes the note to the patient's LIVE record, stamped Communications, then reports where", async () => {
    api.claimMirror.mockResolvedValueOnce(claimed());
    dossierApi.fetchDossierItemsForPick.mockResolvedValueOnce([
      liveItem({ itemId: "100", boardId: 18406060017, isCompleted: true, notesColId: "text_mm6vevjf" }),
      liveItem(),
    ]);
    expect(await copyOne(RID)).toBe("copied");
    expect(dossierApi.appendNoteToRecord).toHaveBeenCalledTimes(1);
    const arg = dossierApi.appendNoteToRecord.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toMatchObject({ boardId: 18410804557, itemId: "900", columnId: "text_mm6vqq2k", stage: "Communications" });
    expect(String(arg.text)).toMatch(/^Called( \([^)]+\))? — told her it ships Friday$/);
    expect(api.reportMirrorDone).toHaveBeenCalledWith(RID, "18410804557:900");
    // The claim happened before the write.
    expect(api.claimMirror.mock.invocationCallOrder[0]).toBeLessThan(
      dossierApi.appendNoteToRecord.mock.invocationCallOrder[0],
    );
  });

  it("an unmatched number keeps its note in the log only", async () => {
    api.claimMirror.mockResolvedValueOnce(claimed({ itemId: "", itemBoard: null }));
    expect(await copyOne(RID)).toBe("skipped");
    expect(dossierApi.appendNoteToRecord).not.toHaveBeenCalled();
    expect(api.reportMirrorDone).toHaveBeenCalledWith(RID, "none:unmatched");
  });

  it("⚠️ a patient whose every record is completed gets the log only (§5.38)", async () => {
    api.claimMirror.mockResolvedValueOnce(claimed());
    dossierApi.fetchDossierItemsForPick.mockResolvedValueOnce([liveItem({ isCompleted: true })]);
    expect(await copyOne(RID)).toBe("skipped");
    expect(dossierApi.appendNoteToRecord).not.toHaveBeenCalled();
    expect(api.reportMirrorDone).toHaveBeenCalledWith(RID, "none:no-live-record");
  });

  it("⚠️ a failed copy reports the error and names the patient — it never un-resolves", async () => {
    api.claimMirror.mockResolvedValueOnce(claimed());
    dossierApi.fetchDossierItemsForPick.mockResolvedValueOnce([liveItem()]);
    dossierApi.appendNoteToRecord.mockRejectedValueOnce(new Error("Monday 503"));
    expect(await copyOne(RID)).toBe("failed");
    expect(api.reportMirrorError).toHaveBeenCalledWith(RID, "Monday 503");
    expect(api.reportMirrorDone).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Jane Doe"));
  });

  it("flushing is coalesced — two triggers at once run one pass", async () => {
    let release: (v: unknown) => void = () => {};
    api.fetchOutbox.mockReturnValueOnce(new Promise((r) => (release = r)));
    const a = flushCommsOutbox();
    const b = flushCommsOutbox();
    expect(a).toBe(b);
    release([]);
    await a;
    expect(api.fetchOutbox).toHaveBeenCalledTimes(1);
  });

  it("a flush copies each pending note in turn", async () => {
    api.fetchOutbox.mockResolvedValueOnce([claimed(), claimed({ resolutionId: "22222222-2222-3333-4444-555555555555" })]);
    api.claimMirror.mockResolvedValue(null);
    await flushCommsOutbox();
    expect(api.claimMirror).toHaveBeenCalledTimes(2);
  });

  it("no gateway → nothing to flush, and nothing is asked", async () => {
    api.inboxConfigured.mockReturnValue(false);
    await flushCommsOutbox();
    expect(api.fetchOutbox).not.toHaveBeenCalled();
  });
});

describe("the switch", () => {
  function Probe() {
    const c = useCommsConfig();
    return <span data-testid="cfg">{`${c.loaded}:${c.enabled}:${c.ui}`}</span>;
  }

  it("a build with no gateway reads as off, without asking", async () => {
    api.inboxConfigured.mockReturnValue(false);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("cfg").textContent).toBe("true:false:false"));
    expect(api.fetchCommsConfig).not.toHaveBeenCalled();
  });

  it("⚠️ a failed read is OFF, never a half-built Inbox", async () => {
    api.fetchCommsConfig.mockRejectedValueOnce(new Error("503"));
    render(<Probe />);
    await waitFor(() => expect(api.fetchCommsConfig).toHaveBeenCalled());
    expect(screen.getByTestId("cfg").textContent).toBe("false:false:false");
  });

  it("reads the gateway's two booleans", async () => {
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: true, ui: true });
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("cfg").textContent).toBe("true:true:true"));
  });
});

describe("the list and the badge", () => {
  const Q: InboxQuery = { view: "open", type: "", q: "", sort: "wait", sticky: "" };
  const list = (open: number, over: number) => ({
    rows: [],
    counts: { open, over },
    total: 0,
    badge: { open, over },
    computedAt: T,
    epoch: 0,
  });

  function ListProbe({ q }: { q: InboxQuery }) {
    const l = useInboxList(q, true);
    const b = useInboxBadge(true);
    return (
      <>
        <span data-testid="counts">{l.data ? `${l.data.counts.open}/${l.data.counts.over}` : "-"}</span>
        <span data-testid="badge">{b ? `${b.open}/${b.over}` : "-"}</span>
        <span data-testid="stale">{String(l.stale)}</span>
      </>
    );
  }

  it("⚠️ a list load feeds the header badge — the two can never disagree", async () => {
    api.fetchInbox.mockResolvedValueOnce(list(7, 2));
    // The badge's own read hangs, so what it shows comes from the list.
    api.fetchInboxCount.mockReturnValue(new Promise(() => {}));
    render(<ListProbe q={Q} />);
    await waitFor(() => expect(screen.getByTestId("counts").textContent).toBe("7/2"));
    expect(screen.getByTestId("badge").textContent).toBe("7/2");
  });

  it("⚠️ a slow answer to a query the rep has since changed does not paint over the new one", async () => {
    let slow: (v: unknown) => void = () => {};
    api.fetchInbox.mockImplementationOnce(() => new Promise((r) => (slow = r)));
    api.fetchInbox.mockResolvedValueOnce(list(3, 0));
    api.fetchInboxCount.mockReturnValue(new Promise(() => {}));
    const { rerender } = render(<ListProbe q={Q} />);
    rerender(<ListProbe q={{ ...Q, type: "missed" }} />);
    await waitFor(() => expect(screen.getByTestId("counts").textContent).toBe("3/0"));
    await act(async () => {
      slow(list(99, 99));
    });
    expect(screen.getByTestId("counts").textContent).toBe("3/0");
  });
});

describe("a log row opens its number's item (plan §1.2)", () => {
  beforeEach(() => {
    __resetInboxStoresForTest();
    vi.clearAllMocks();
  });

  it("⚠️ a slow answer for the previous row never opens under the next one", async () => {
    let slow: (v: unknown) => void = () => {};
    api.fetchCommsState.mockReturnValueOnce(new Promise((r) => (slow = r)));
    api.fetchCommsState.mockResolvedValueOnce({ key: "p:18410804557:2", state: null });
    const { result, rerender } = renderHook(({ phone }) => useItemKeyForNumber(phone), {
      initialProps: { phone: "+15550001111" },
    });
    expect(result.current.key).toBeNull();
    expect(result.current.loading).toBe(true);
    rerender({ phone: "+15550002222" });
    await waitFor(() => expect(result.current.key).toBe("p:18410804557:2"));
    await act(async () => slow({ key: "p:18410804557:1", state: null }));
    expect(result.current.key).toBe("p:18410804557:2");
    // A blank number asks nothing and opens nothing.
    rerender({ phone: "" });
    expect(result.current.key).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(api.fetchCommsState).toHaveBeenCalledTimes(2);
  });

  it("a failed lookup is an ERROR the page can fall back from, never a silent nothing", async () => {
    api.fetchCommsState.mockRejectedValueOnce(new Error("gateway 503"));
    const { result } = renderHook(() => useItemKeyForNumber("+15550003333"));
    await waitFor(() => expect(result.current.error).toBe("gateway 503"));
    expect(result.current.key).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("⚠️ the item hook only ever returns the item for the key asked for", async () => {
    api.fetchInboxItem.mockImplementation(async (k: string) => ({ key: k, state: {}, timeline: [], numbers: [] }));
    // Every render is recorded: `result.current` only shows the LAST one, and the
    // hazard is the single render in which the key has changed and the effect
    // clearing the old item has not run yet.
    const renders: string[] = [];
    const { result, rerender } = renderHook(
      ({ k }) => {
        const r = useInboxItem(k);
        renders.push(`${k}→${r.item?.key ?? "none"}`);
        return r;
      },
      { initialProps: { k: "p:1:1" as string | null } },
    );
    await waitFor(() => expect(result.current.item?.key).toBe("p:1:1"));
    rerender({ k: "p:1:2" });
    await waitFor(() => expect(result.current.item?.key).toBe("p:1:2"));
    expect(renders).not.toContain("p:1:2→p:1:1");
    expect(renders).toContain("p:1:2→none");
  });
});

describe("reportDial — who dialed (plan §4.6)", () => {
  beforeEach(() => {
    __resetInboxStoresForTest();
    vi.clearAllMocks();
  });

  it("⚠️ never guesses: a dial before the switch is read waits for it, and reports only if ON", async () => {
    let answer: (v: unknown) => void = () => {};
    api.fetchCommsConfig.mockReturnValueOnce(new Promise((r) => (answer = r)));
    reportDial("+15550004444");
    expect(api.reportDialed).not.toHaveBeenCalled();
    await act(async () => answer({ enabled: true, ui: false }));
    expect(api.reportDialed).toHaveBeenCalledWith("+15550004444");
  });

  it("with the module off, nothing is sent", async () => {
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: false, ui: false });
    reportDial("+15550005555");
    await act(async () => {});
    reportDial("+15550005555");
    expect(api.reportDialed).not.toHaveBeenCalled();
  });
});
