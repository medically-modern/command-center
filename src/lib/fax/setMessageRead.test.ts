/**
 * Read-state writes are serialised per message id.
 *
 * ⚠️ Not a nicety. Two writes for one id are one click apart in the UI — mark a
 * fax unread and then open it (Greptile, PR #52), or mark a conversation unread
 * and then read it. Raced, the loser can land LAST at RingCentral, which then
 * holds Unread while the optimistic override says Read: the row is hidden from
 * the Unread filter and the override never retires, because pruning keeps
 * exactly the entries RingCentral disagrees with. A permanent local lie is the
 * one thing reading `readStatus` instead of a local flag exists to prevent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `setMessageRead` goes through the module-private `rcFetch`, so the seam is
// global fetch. Each call is held open until its gate is released, which is how
// two writes are put in flight at once.
const calls: { id: string; read: string }[] = [];
let gates: (() => void)[] = [];

beforeEach(() => {
  calls.length = 0;
  gates = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const id = String(url).split("/message-store/")[1] ?? "";
      const read = JSON.parse(String(init?.body ?? "{}")).readStatus ?? "";
      return new Promise((resolve) => {
        gates.push(() => {
          calls.push({ id, read });
          resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
        });
      });
    }),
  );
});

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe("setMessageRead — same-id serialisation", () => {
  it("does not send a second write for one id until the first has landed", async () => {
    const { setMessageRead } = await import("./ringcentralApi");
    void setMessageRead(101, false).catch(() => {});
    await flush();
    void setMessageRead(101, true).catch(() => {});
    await flush();

    // Only the FIRST request is in flight — the second is queued behind it.
    expect(gates).toHaveLength(1);

    gates[0]();
    await flush();
    expect(gates).toHaveLength(2);
    gates[1]();
    await flush();

    // The rep's LAST intent is what RingCentral ends up holding.
    expect(calls.map((c) => c.read)).toEqual(["Unread", "Read"]);
  });

  it("still sends the next write after one fails — a newer intent must land", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => Promise.resolve({ ok: false, status: 503 } as Response),
    );
    const { setMessageRead } = await import("./ringcentralApi");
    const first = setMessageRead(202, false);
    await expect(first).rejects.toThrow(/503/);
    const second = setMessageRead(202, true);
    await flush();
    expect(gates).toHaveLength(1);
    gates[0]();
    await second;
    expect(calls).toEqual([{ id: "202", read: "Read" }]);
  });

  it("leaves DIFFERENT ids in parallel, so a batch is one round of requests", async () => {
    // `Promise.all(unreadIds.map(...))` marks a whole conversation read; making
    // that sequential would turn one round trip into N.
    const { setMessageRead } = await import("./ringcentralApi");
    for (const id of [1, 2, 3]) void setMessageRead(id, true).catch(() => {});
    await flush();
    expect(gates).toHaveLength(3);
  });
});
