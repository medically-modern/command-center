/**
 * §3.10.1 rule 2: a shared-token (Command Center) event is credited to the person in the gateway's write log —
 * same item, same board, its column among those written, within attributionMatchSeconds, nearest first.
 */
import { describe, it, expect } from "vitest";
import { attachAppActors, appAttributionCoverage, personKeyForEmail, type AppActorRow } from "./appAttribution";
import { attribute } from "../people/owners";
import { OO_CONFIG } from "../config";
import type { RawEvent } from "../types";

const SHARED = 100161122;
const INS = OO_CONFIG.boards.INS as string;
const T = Date.parse("2026-10-01T15:00:00Z");
const ev = (over: Partial<RawEvent>): RawEvent => ({
  eventId: "e1", boardKey: "INS", itemId: "111", columnId: "color_mm2vsh2f", event: "update_column_value",
  toIndex: 2, fromIndex: 0, atMs: T, userId: SHARED, bulk: false, ...over,
});

describe("attachAppActors", () => {
  it("names the person behind a shared-token write", () => {
    const rows: AppActorRow[] = [["111", INS, "katie@medicallymodern.com", T - 3000, ["color_mm2vsh2f", "text_mm6vzc7q"]]];
    const [e] = attachAppActors([ev({})], rows);
    expect(e.actorKey).toBe("katie");
    expect(attribute(e.userId, OO_CONFIG, e.actorKey)).toEqual({ kind: "person", key: "katie" });
  });

  it("needs the same item, the same column, and the time window", () => {
    const far = T + (OO_CONFIG.attributionMatchSeconds + 1) * 1000;
    const rows: AppActorRow[] = [
      ["999", INS, "katie@medicallymodern.com", T, ["color_mm2vsh2f"]], // other item
      ["111", INS, "katie@medicallymodern.com", T, ["text_other"]], // other column
      ["111", INS, "katie@medicallymodern.com", far, ["color_mm2vsh2f"]], // too late
    ];
    expect(attachAppActors([ev({})], rows)[0].actorKey).toBeUndefined();
  });

  it("takes the nearest write when two people touched the item", () => {
    const rows: AppActorRow[] = [
      ["111", INS, "janelle@medicallymodern.com", T - 90_000, ["color_mm2vsh2f"]],
      ["111", INS, "katie@medicallymodern.com", T + 2_000, ["color_mm2vsh2f"]],
    ];
    expect(attachAppActors([ev({})], rows)[0].actorKey).toBe("katie");
  });

  it("never touches a direct monday edit, an automation, or a group move", () => {
    const rows: AppActorRow[] = [["111", INS, "katie@medicallymodern.com", T, ["color_mm2vsh2f", "__group__"]]];
    const out = attachAppActors([ev({ userId: 102869398 }), ev({ eventId: "e2", userId: -4 }), ev({ eventId: "e3", columnId: "__group__" })], rows);
    expect(out.map((e) => e.actorKey)).toEqual([undefined, undefined, undefined]);
  });

  it("an address that is nobody in config, or the shared account itself, names nobody", () => {
    expect(personKeyForEmail("claude-notes-watch")).toBeNull();
    expect(personKeyForEmail("josh@medicallymodern.com")).toBeNull();
    expect(personKeyForEmail("Masheke@MedicallyModern.com")).toBe("masheke");
  });

  it("no rows (gateway down or not signed in) leaves the events exactly as they were", () => {
    const events = [ev({})];
    expect(attachAppActors(events, null)).toBe(events);
  });

  it("counts shared-token events by outcome: named staff, system, neither", () => {
    const rows: AppActorRow[] = [["111", INS, "katie@medicallymodern.com", T, ["color_mm2vsh2f"]]];
    const out = attachAppActors([ev({}), ev({ eventId: "e2", itemId: "222" }), ev({ eventId: "e3", userId: 102869398 })], rows);
    expect(appAttributionCoverage(out)).toEqual({ shared: 2, matched: 1, system: 1 });
  });
});

describe("system writes on the shared token (Josh, 2026-10-02)", () => {
  const rows: AppActorRow[] = [["111", INS, "katie@medicallymodern.com", T, ["color_mm2vsh2f"]]];
  it("a shared-token change with no Command Center write behind it is a system change, treated as automation", () => {
    const [e] = attachAppActors([ev({ itemId: "333", columnId: "text_form", atMs: T + 3_600_000 })], rows);
    expect(e.system).toBe(true);
    expect(attribute(e.userId, OO_CONFIG, e.actorKey, e.system)).toEqual({ kind: "automation" });
  });
  it("older than the log's first row: left as it was (we cannot tell)", () => {
    const [e] = attachAppActors([ev({ itemId: "333", atMs: T - 86_400_000 })], rows);
    expect(e.system).toBeUndefined();
  });
  it("a truncated log marks nothing as system", () => {
    const [e] = attachAppActors([ev({ itemId: "333", atMs: T + 3_600_000 })], rows, OO_CONFIG, { truncated: true });
    expect(e.system).toBeUndefined();
  });
  it("a Command Center write by someone config does not know is unnamed, not system", () => {
    const r2: AppActorRow[] = [...rows, ["444", INS, "newhire@medicallymodern.com", T + 60_000, ["color_mm2vsh2f"]]];
    const [e] = attachAppActors([ev({ itemId: "444", atMs: T + 60_000 })], r2);
    expect(e.system).toBeUndefined();
    expect(e.actorKey).toBeUndefined();
  });
  it("a send whose first attempt changed monday minutes before its log row still matches (queue time to log time)", () => {
    const r2: AppActorRow[] = [["555", INS, "katie@medicallymodern.com", T + 600_000, ["color_mm2vsh2f"], T - 30_000]];
    const [e] = attachAppActors([ev({ itemId: "555", atMs: T + 200_000 })], r2);
    expect(e.actorKey).toBe("katie");
    expect(e.system).toBeUndefined();
  });
  it("a file upload is never system (staff uploads go through the worker, not the gateway)", () => {
    const [e] = attachAppActors([ev({ itemId: "333", columnId: "file_mm1w5vwp", atMs: T + 3_600_000 })], rows);
    expect(e.system).toBeUndefined();
  });
  it("a direct monday edit by a person is never system", () => {
    const [e] = attachAppActors([ev({ itemId: "333", userId: 102869398, atMs: T + 3_600_000 })], rows);
    expect(e.system).toBeUndefined();
  });
});
