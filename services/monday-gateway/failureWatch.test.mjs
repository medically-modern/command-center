import { describe, it, expect, vi } from "vitest";
import {
  createFailureSweep,
  shapeSignature,
  SWEEP_MS,
  WINDOW_HOURS,
  REPEAT_MS,
} from "./failureWatch.mjs";

/** A pool stand-in. The sweep fires two queries in one Promise.all — the groups
 *  query then the totals query — and tells them apart by nothing but order, so
 *  this answers in that order too. */
function poolWith({ groups = [], requests = 0, failures = 0, writes = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, args) {
      calls.push({ sql, args });
      if (/jsonb_array_elements/.test(sql)) return { rows: groups };
      return { rows: [{ requests, failures, writes }] };
    },
  };
}

const row = (message, n = 1) => ({
  raw_message: message,
  n,
  first_seen: "2026-08-31T10:00:00Z",
  last_seen: "2026-08-31T10:05:00Z",
});

describe("a quiet window", () => {
  it("says nothing at all when nothing failed", async () => {
    const send = vi.fn();
    const sweep = createFailureSweep({ pool: poolWith({ requests: 4000 }), send });
    expect(await sweep()).toBe("quiet");
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet even when gql_log has error rows but no failures counted", async () => {
    // The two queries can disagree: monday_errors may hold a warning on a call
    // that still returned ok. `failures` is the one that decides.
    const send = vi.fn();
    const sweep = createFailureSweep({
      pool: poolWith({ groups: [row("some notice", 3)], requests: 100, failures: 0 }),
      send,
    });
    expect(await sweep()).toBe("quiet");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("a failing window", () => {
  it("pages once, naming the shapes and the denominator", async () => {
    const send = vi.fn();
    const sweep = createFailureSweep({
      pool: poolWith({
        groups: [row("Item link max locks exceeded", 801), row("Board not found", 2)],
        requests: 5000,
        failures: 803,
        writes: 900,
      }),
      send,
    });
    expect(await sweep()).toBe("sent");
    const msg = send.mock.calls[0][0];
    expect(msg.body).toContain("803 failed Monday calls in the last 60 min");
    expect(msg.body).toContain("of 900 writes");
    expect(msg.body).toContain("801× Item link max locks exceeded");
    expect(msg.priority).toBe("default"); // not a wake-someone-up alert
  });

  it("asks the database for the window it actually reports on", async () => {
    const pool = poolWith({ groups: [row("boom", 1)], failures: 1 });
    await createFailureSweep({ pool, send: vi.fn() })();
    // Both queries take hours as a string arg; WINDOW_HOURS is what goes down.
    expect(pool.calls.map((c) => c.args[0])).toEqual([String(WINDOW_HOURS), String(WINDOW_HOURS)]);
  });
});

describe("throttling — the point is to stay readable", () => {
  it("does not re-page while the same shapes are still the story", async () => {
    const send = vi.fn();
    let clock = 0;
    const sweep = createFailureSweep({
      pool: poolWith({ groups: [row("Item link max locks exceeded", 40)], failures: 40 }),
      send,
      now: () => clock,
    });
    expect(await sweep()).toBe("sent");
    // Four sweeps an hour, each seeing the same overlapping hour of failures.
    for (let i = 1; i < 4; i += 1) {
      clock += SWEEP_MS;
      expect(await sweep()).toBe("throttled");
    }
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("repeats once the window is up — an ongoing outage still gets a reminder", async () => {
    const send = vi.fn();
    let clock = 0;
    const sweep = createFailureSweep({
      pool: poolWith({ groups: [row("boom", 5)], failures: 5 }),
      send,
      now: () => clock,
    });
    await sweep();
    clock = REPEAT_MS;
    expect(await sweep()).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("pages immediately when a NEW failure shape appears", async () => {
    const send = vi.fn();
    let clock = 0;
    let groups = [row("Item link max locks exceeded", 40)];
    const pool = {
      async query(sql) {
        if (/jsonb_array_elements/.test(sql)) return { rows: groups };
        return { rows: [{ requests: 100, failures: 40, writes: 40 }] };
      },
    };
    const sweep = createFailureSweep({ pool, send, now: () => clock });
    expect(await sweep()).toBe("sent");

    clock += SWEEP_MS;
    expect(await sweep()).toBe("throttled");

    // Something else starts failing — that is new information, inside the window.
    groups = [row("Item link max locks exceeded", 60), row("Board not found", 3)];
    clock += SWEEP_MS;
    expect(await sweep()).toBe("sent");
    expect(send.mock.calls[1][0].body).toContain("Board not found");
  });

  it("says how many alerts it swallowed when it finally speaks", async () => {
    const send = vi.fn();
    let clock = 0;
    const sweep = createFailureSweep({
      pool: poolWith({ groups: [row("boom", 5)], failures: 5 }),
      send,
      now: () => clock,
    });
    await sweep();
    clock += SWEEP_MS;
    await sweep(); // throttled — counted
    clock = REPEAT_MS;
    await sweep();
    expect(send.mock.calls[1][0].body).toContain("(+1 earlier alerts suppressed)");
  });
});

describe("what leaves the process", () => {
  it("redacts values Monday echoed back — a patient name must not reach a phone", async () => {
    const send = vi.fn();
    const sweep = createFailureSweep({
      pool: poolWith({
        groups: [row("The label 'Beverly Danyluk' does not exist on item 12937566870", 4)],
        failures: 4,
      }),
      send,
    });
    await sweep();
    const body = send.mock.calls[0][0].body;
    expect(body).not.toContain("Beverly");
    expect(body).not.toContain("12937566870");
    expect(body).toContain("does not exist on item #");
  });

  it("groups two messages that differ only by an echoed value", async () => {
    const send = vi.fn();
    const sweep = createFailureSweep({
      pool: poolWith({
        groups: [row("The label 'A Clinic' does not exist", 3), row("The label 'B Clinic' does not exist", 2)],
        failures: 5,
      }),
      send,
    });
    await sweep();
    expect(send.mock.calls[0][0].body).toContain("5× The label '…' does not exist");
  });
});

describe("a sweep must never take the gateway down with it", () => {
  it("swallows a dead database", async () => {
    const send = vi.fn();
    const pool = {
      async query() {
        throw new Error("connection terminated unexpectedly");
      },
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await createFailureSweep({ pool, send })()).toBe("error");
    expect(send).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("swallows a failed push", async () => {
    const send = vi.fn().mockRejectedValue(new Error("ntfy unreachable"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const sweep = createFailureSweep({
      pool: poolWith({ groups: [row("boom", 1)], failures: 1 }),
      send,
    });
    expect(await sweep()).toBe("error");
    err.mockRestore();
  });
});

describe("shapeSignature", () => {
  it("ignores counts — they climb every sweep during one outage", () => {
    expect(shapeSignature([{ message: "a", count: 1 }])).toBe(
      shapeSignature([{ message: "a", count: 900 }]),
    );
  });

  it("ignores order, so a change in ranking is not a new story", () => {
    expect(shapeSignature([{ message: "a" }, { message: "b" }])).toBe(
      shapeSignature([{ message: "b" }, { message: "a" }]),
    );
  });

  it("distinguishes a set that gained a shape", () => {
    expect(shapeSignature([{ message: "a" }])).not.toBe(
      shapeSignature([{ message: "a" }, { message: "b" }]),
    );
  });
});
