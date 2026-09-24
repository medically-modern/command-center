/**
 * The inbox's browser stores and the Monday copy of resolve notes
 * (COMMS_INBOX_PLAN.md §4.6, §5.2–§5.4).
 *
 * The Monday copy is the one thing here that WRITES, and every assertion about
 * it is about ordering: claim before writing, write only to the patient's live
 * record, and never let a failed copy un-resolve anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  CONFIG_RECHECK_MS,
  COPY_RETRY_MS,
  COPY_UNCLAIMED_AFTER_MS,
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

  it("⚠️ flushes are coalesced — and a trigger DURING a pass gets one more pass, not the next trigger", async () => {
    let release: (v: unknown) => void = () => {};
    api.fetchOutbox.mockReturnValueOnce(new Promise((r) => (release = r)));
    api.fetchOutbox.mockResolvedValue([]);
    const a = flushCommsOutbox();
    const b = flushCommsOutbox(RID); // released while the first pass is reading
    expect(a).toBe(b);
    release([]);
    await a;
    // The first pass read its list before the release; the second one sees it.
    expect(api.fetchOutbox).toHaveBeenCalledTimes(2);
  });

  it("a flush copies each note whose Undo window has closed", async () => {
    const old = Date.now() - 30 * 60_000;
    api.fetchOutbox.mockResolvedValueOnce([
      claimed({ resolvedAt: old }),
      claimed({ resolutionId: "22222222-2222-3333-4444-555555555555", resolvedAt: old }),
    ]);
    api.claimMirror.mockResolvedValue(null);
    await flushCommsOutbox();
    expect(api.claimMirror).toHaveBeenCalledTimes(2);
  });

  it("⚠️⚠️ a FRESH note is not copied by a catch-up — another tab may still be offering its Undo", async () => {
    api.fetchOutbox.mockResolvedValue([claimed({ resolvedAt: Date.now() - 60_000 })]);
    await flushCommsOutbox();
    expect(api.claimMirror).not.toHaveBeenCalled();
    // …but the tab that MOVED ON from it copies it at once.
    api.claimMirror.mockResolvedValueOnce(null);
    await flushCommsOutbox(RID);
    expect(api.claimMirror).toHaveBeenCalledWith(RID);
  });

  it("a fresh note left behind is copied once its window closes, without waiting for a click", async () => {
    vi.useFakeTimers();
    try {
      api.fetchOutbox.mockResolvedValue([claimed({ resolvedAt: Date.now() - 60_000 })]);
      api.claimMirror.mockResolvedValue(null);
      await flushCommsOutbox();
      expect(api.claimMirror).not.toHaveBeenCalled();
      api.fetchOutbox.mockResolvedValue([claimed({ resolvedAt: Date.now() - 60 * 60_000 })]);
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      expect(api.claimMirror).toHaveBeenCalledWith(RID);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠️⚠️ a failed read at the TIMER's moment is tried again on its own — nothing else would ask (Greptile, PR #58)", async () => {
    vi.useFakeTimers();
    try {
      // A note inside its Undo window arms the timer…
      api.fetchOutbox.mockResolvedValueOnce([claimed({ resolvedAt: Date.now() - 60_000 })]);
      await flushCommsOutbox();
      expect(api.claimMirror).not.toHaveBeenCalled();
      // …the gateway blips exactly when it fires (C − 55s from now)…
      api.fetchOutbox.mockRejectedValueOnce(new Error("503"));
      api.fetchOutbox.mockResolvedValue([claimed({ resolvedAt: Date.now() - 60 * 60_000 })]);
      api.claimMirror.mockResolvedValue(null);
      await vi.advanceTimersByTimeAsync(COPY_UNCLAIMED_AFTER_MS - 50_000);
      // ⚠️ …and the retry is NOT immediate: the due time that fired is past,
      // and retrying on it would spend the ladder in a few seconds.
      expect(api.fetchOutbox).toHaveBeenCalledTimes(2);
      expect(api.claimMirror).not.toHaveBeenCalled();
      // The first rung copies it, with nobody clicking anything.
      await vi.advanceTimersByTimeAsync(COPY_RETRY_MS[0] + 10_000);
      expect(api.claimMirror).toHaveBeenCalledWith(RID);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a claim that could not be ASKED keeps the note moved-on, and the retry copies it", async () => {
    vi.useFakeTimers();
    try {
      localStorage.clear();
      // Still inside its window — but moved on from, so it is copied now.
      api.fetchOutbox.mockResolvedValue([claimed({ resolvedAt: Date.now() - 60_000 })]);
      api.claimMirror.mockRejectedValueOnce(new Error("gateway blip"));
      api.claimMirror.mockResolvedValueOnce(claimed());
      dossierApi.fetchDossierItemsForPick.mockResolvedValueOnce([liveItem()]);
      await flushCommsOutbox(RID);
      expect(dossierApi.appendNoteToRecord).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(COPY_RETRY_MS[0] + 10_000);
      expect(dossierApi.appendNoteToRecord).toHaveBeenCalledTimes(1);
      expect(api.reportMirrorDone).toHaveBeenCalledWith(RID, "18410804557:900");
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠️ the retries have an END — a lasting failure is left to the next trigger", async () => {
    vi.useFakeTimers();
    try {
      api.fetchOutbox.mockResolvedValue([claimed({ resolvedAt: Date.now() - 60 * 60_000 })]);
      api.claimMirror.mockRejectedValue(new Error("gateway blip"));
      await flushCommsOutbox();
      expect(api.claimMirror).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
      // One try, then one per rung.
      expect(api.claimMirror).toHaveBeenCalledTimes(1 + COPY_RETRY_MS.length);
    } finally {
      vi.useRealTimers();
      api.claimMirror.mockReset();
    }
  });

  it("a tab with nothing to copy does not keep asking a gateway that is down", async () => {
    vi.useFakeTimers();
    try {
      api.fetchOutbox.mockRejectedValue(new Error("503"));
      await flushCommsOutbox();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(api.fetchOutbox).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a note moved on from but no longer offered is let go — it is not known work for ever", async () => {
    vi.useFakeTimers();
    try {
      api.fetchOutbox.mockResolvedValueOnce([]); // another tab copied it, or it was undone
      await flushCommsOutbox(RID);
      api.fetchOutbox.mockRejectedValue(new Error("503"));
      await flushCommsOutbox();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(api.fetchOutbox).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("⚠️ the patient lookup is STRICT — a board that didn't answer is a failure, never 'no live record'", async () => {
    api.claimMirror.mockResolvedValueOnce(claimed());
    dossierApi.fetchDossierItemsForPick.mockRejectedValueOnce(new Error("Monday didn't answer for every board"));
    expect(await copyOne(RID)).toBe("failed");
    expect(dossierApi.fetchDossierItemsForPick).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "900", boardId: 18410804557 }),
      { strict: true },
    );
    expect(api.reportMirrorDone).not.toHaveBeenCalled();
    expect(api.reportMirrorError).toHaveBeenCalled();
  });

  it("⚠️⚠️ a lost 'done' never writes the note twice", async () => {
    vi.useFakeTimers();
    try {
      localStorage.clear();
      api.claimMirror.mockResolvedValueOnce(claimed());
      dossierApi.fetchDossierItemsForPick.mockResolvedValueOnce([liveItem()]);
      api.reportMirrorDone.mockRejectedValue(new Error("gateway blip"));
      const first = copyOne(RID);
      await vi.advanceTimersByTimeAsync(10_000);
      // The note IS on Monday: not a failure, and the claim is not released.
      expect(await first).toBe("copied");
      expect(api.reportMirrorDone).toHaveBeenCalledTimes(3);
      expect(api.reportMirrorError).not.toHaveBeenCalled();
      expect(dossierApi.appendNoteToRecord).toHaveBeenCalledTimes(1);

      // The claim times out and the note is offered again: recorded, not re-written.
      api.reportMirrorDone.mockReset();
      api.reportMirrorDone.mockResolvedValue(undefined);
      api.claimMirror.mockResolvedValueOnce(claimed());
      expect(await copyOne(RID)).toBe("copied");
      expect(dossierApi.appendNoteToRecord).toHaveBeenCalledTimes(1);
      expect(api.reportMirrorDone).toHaveBeenCalledWith(RID, "18410804557:900");
      expect(localStorage.getItem(`mm-comms-copied:${RID}`)).toBeNull();
    } finally {
      vi.useRealTimers();
      api.reportMirrorDone.mockReset();
      api.reportMirrorDone.mockResolvedValue(undefined);
    }
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

describe("⚠️ the switch is RE-READ while a tab is open (Josh, 2026-09-23)", () => {
  function Probe({ id = "cfg" }: { id?: string }) {
    const c = useCommsConfig();
    return <span data-testid={id}>{`${c.loaded}:${c.enabled}:${c.ui}`}</span>;
  }
  const shown = (id = "cfg") => screen.getByTestId(id).textContent;
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const setHidden = (v: boolean) => Object.defineProperty(document, "hidden", { configurable: true, get: () => v });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    // Back to jsdom's own getter on Document.prototype.
    delete (document as unknown as { hidden?: boolean }).hidden;
  });

  it("a tab left open picks the Inbox up when the switch comes ON — no reload", async () => {
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: false, ui: false });
    render(<Probe />);
    await advance(0);
    expect(shown()).toBe("true:false:false");
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: true, ui: true });
    await advance(CONFIG_RECHECK_MS + 60_000);
    expect(shown()).toBe("true:true:true");
  });

  it("…and takes it away again when the switch goes OFF", async () => {
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: true, ui: true });
    render(<Probe />);
    await advance(0);
    expect(shown()).toBe("true:true:true");
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: true, ui: false });
    await advance(CONFIG_RECHECK_MS + 60_000);
    expect(shown()).toBe("true:true:false");
  });

  it("every few minutes — never faster, and never drifting to twice the period", async () => {
    // ⚠️ A real read takes a moment, so the "last read" stamp lands just AFTER
    // the tick that asked. A timer ticking at the full period would then find
    // it a few hundred ms too fresh every other time and run at 6 minutes.
    api.fetchCommsConfig.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ enabled: true, ui: true }), 300)),
    );
    render(<Probe />);
    await advance(300);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(1);
    await advance(CONFIG_RECHECK_MS - 1_000);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(1);
    // The ticks run every minute, so the re-check lands inside the next one.
    await advance(61_000);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(2);
  });

  it("⚠️ a failed RE-check keeps what the tab had — a blip never pulls the Inbox away", async () => {
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: true, ui: true });
    render(<Probe />);
    await advance(0);
    api.fetchCommsConfig.mockRejectedValueOnce(new Error("503"));
    await advance(CONFIG_RECHECK_MS + 60_000);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(2);
    expect(shown()).toBe("true:true:true");
  });

  it("a failed FIRST read is retried by the timer, not only when another page opens", async () => {
    api.fetchCommsConfig.mockRejectedValueOnce(new Error("503"));
    render(<Probe />);
    await advance(0);
    expect(shown()).toBe("false:false:false");
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: true, ui: true });
    await advance(61_000);
    expect(shown()).toBe("true:true:true");
  });

  it("an answer that changes nothing keeps the snapshot's identity — nothing re-renders (rule 2)", async () => {
    api.fetchCommsConfig.mockResolvedValue({ enabled: true, ui: true });
    const { result } = renderHook(() => useCommsConfig());
    await advance(0);
    const first = result.current;
    await advance(CONFIG_RECHECK_MS + 60_000);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(first);
  });

  it("⚠️ a hidden tab does not ask — and asks the moment somebody looks at it again", async () => {
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: false, ui: false });
    render(<Probe />);
    await advance(0);
    setHidden(true);
    await advance(20 * 60_000);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(1);
    api.fetchCommsConfig.mockResolvedValueOnce({ enabled: true, ui: true });
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(2);
    expect(shown()).toBe("true:true:true");
  });

  it("one read per period however many components read the switch — and none once they are gone", async () => {
    api.fetchCommsConfig.mockResolvedValue({ enabled: true, ui: true });
    const { unmount } = render(
      <>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="c" />
      </>,
    );
    await advance(0);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(1);
    await advance(CONFIG_RECHECK_MS + 60_000);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(2);
    unmount();
    await advance(30 * 60_000);
    expect(api.fetchCommsConfig).toHaveBeenCalledTimes(2);
  });
});

describe("the list and the badge", () => {
  const Q: InboxQuery = { view: "open", type: "", stage: "", q: "", sort: "wait", sticky: "" };
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

  it("a stage pick is a new list — asked of the gateway, with the stage", async () => {
    api.fetchInbox.mockResolvedValueOnce(list(5, 1));
    api.fetchInbox.mockResolvedValueOnce(list(1, 0));
    api.fetchInboxCount.mockReturnValue(new Promise(() => {}));
    const { rerender } = render(<ListProbe q={Q} />);
    await waitFor(() => expect(screen.getByTestId("counts").textContent).toBe("5/1"));
    rerender(<ListProbe q={{ ...Q, stage: "Insurance" }} />);
    await waitFor(() => expect(screen.getByTestId("counts").textContent).toBe("1/0"));
    expect(api.fetchInbox).toHaveBeenLastCalledWith(expect.objectContaining({ stage: "Insurance" }));
  });
});

describe("⚠️ the list and the badge poll at the rate they state — not twice it", () => {
  // A real read takes a moment, and its "last read" stamp lands just AFTER the
  // tick that asked. Gated on exactly one period, the next tick found it too
  // fresh, so the list ran at ~60s and the badge at ~120s (measured 2026-09-23).
  const Q: InboxQuery = { view: "open", type: "", stage: "", q: "", sort: "wait", sticky: "" };
  const slow = <T,>(v: T) => () => new Promise<T>((r) => setTimeout(() => r(v), 300));
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the list: about every 30 seconds", async () => {
    api.fetchInbox.mockImplementation(
      slow({ rows: [], counts: { open: 1, over: 0 }, total: 0, badge: { open: 1, over: 0 }, computedAt: T, epoch: 0 }),
    );
    function P() {
      useInboxList(Q, true);
      return null;
    }
    render(<P />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    });
    // 1 on mount + 20 ticks.
    expect(api.fetchInbox.mock.calls.length).toBeGreaterThanOrEqual(19);
    expect(api.fetchInbox.mock.calls.length).toBeLessThanOrEqual(21);
  });

  it("the badge: about every minute", async () => {
    api.fetchInboxCount.mockImplementation(slow({ open: 1, over: 0 }));
    function P() {
      useInboxBadge(true);
      return null;
    }
    render(<P />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1_000);
    });
    expect(api.fetchInboxCount.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(api.fetchInboxCount.mock.calls.length).toBeLessThanOrEqual(11);
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
