/**
 * Fax / Parachute `color_mm25t5q` must round-trip through a Subscription save.
 *
 * The send wrote `faxVal === "Parachute" ? 1 : 0`, so saving a patient whose
 * method read Email or Dashboard rewrote it to Fax — silently, with a green
 * toast — from /subscription and the patient screen's Profile tab alike, which
 * share the one `sendPatientToMonday` (10 patients held Email or Dashboard on
 * 2026-09-24). Nothing on screen shows the flip, so these tests are the catch.
 *
 * The send is driven for real; only the verified writer (to capture the task
 * list), the board write and the live-label read are replaced. The live
 * options are the column's REAL `settings_str`, read 2026-09-24 and parsed by
 * the real `parseStatusSettings` — exactly what the send gets in production.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseStatusSettings, type StatusOption } from "../shared/statusOptions";
import { COL, type MondayItem } from "./mondayApi";
import { mondayItemToPatient } from "./mondayMapping";
import { FAX_PARACHUTE_OPTIONS, type Patient } from "./workflow";
import { planFaxParachuteWrite } from "./faxParachute";
import { sendPatientToMonday } from "./mondayWrite";

/** `boards(ids: 18407459988) { columns(ids: ["color_mm25t5q"]) { settings_str } }`, 2026-09-24. */
const LIVE_SETTINGS =
  '{"done_colors":[1],"labels_descriptions":{},"deactivated_labels":[],"color_mapping":{},' +
  '"labels":{"0":"Fax","1":"Parachute","2":"Email","3":"Dashboard"},' +
  '"labels_positions_v2":{"0":0,"1":1,"2":2,"3":3},' +
  '"labels_colors":{"0":{"color":"#fdab3d","border":"#e99729","var_name":"orange"},' +
  '"1":{"color":"#00c875","border":"#00b461","var_name":"green-shadow"},' +
  '"2":{"color":"#df2f4a","border":"#ce3048","var_name":"red-shadow"},' +
  '"3":{"color":"#007eb5","border":"#3db0df","var_name":"blue-links"}}}';
const LIVE: StatusOption[] = parseStatusSettings(LIVE_SETTINGS);

type Captured = { tasks: Array<{ label: string; columnId: string; value?: unknown; fn: () => Promise<unknown> }> };

const h = vi.hoisted(() => ({
  captured: [] as Captured[],
  statusWrites: [] as Array<{ columnId: string; index: number }>,
  /** What the live-label read answers: options, or `null` for "Monday is down". */
  live: null as StatusOption[] | null,
  reads: 0,
}));

vi.mock("../shared/verifiedWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/verifiedWrite")>();
  return {
    ...actual,
    executeWritesWithVerification: async (opts: Captured) => {
      h.captured.push(opts);
      return [] as string[];
    },
  };
});

vi.mock("../shared/statusOptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/statusOptions")>();
  return {
    ...actual,
    fetchStatusOptions: async (_boardId: unknown, cols: string[]) => {
      h.reads++;
      if (h.live === null) throw new Error("Monday 503");
      return Object.fromEntries(cols.map((c) => [c, h.live]));
    },
  };
});

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    writeStatusIndex: async (_itemId: string, columnId: string, index: number) => {
      h.statusWrites.push({ columnId, index });
    },
  };
});

/** A board item carrying only the Fax / Parachute cell, read through the REAL mapping. */
function patientWith(text: string | null, index: number | null, edited: string | null = null): Patient {
  const item = {
    id: "9100",
    name: "Round Trip",
    column_values: [
      { id: COL.faxParachute, text, value: index === null ? null : JSON.stringify({ index }) },
    ],
  } as unknown as MondayItem;
  return { ...mondayItemToPatient(item), faxParachuteEdited: edited };
}

/** Send it, and return the one Fax/Parachute task (or undefined when none was built). */
async function faxTaskFor(p: Patient) {
  await sendPatientToMonday(p);
  expect(h.captured.length, "the send handed exactly one batch to the writer").toBe(1);
  const tasks = h.captured[0].tasks.filter((t) => t.columnId === COL.faxParachute);
  expect(tasks.length, "Fax/Parachute written at most once").toBeLessThanOrEqual(1);
  return tasks[0];
}

beforeEach(() => {
  h.captured.length = 0;
  h.statusWrites.length = 0;
  h.live = LIVE;
  h.reads = 0;
});

describe("the column", () => {
  it("is color_mm25t5q", () => {
    expect(COL.faxParachute).toBe("color_mm25t5q");
  });

  // The pickers render this list, and it is the send's fallback when the
  // board cannot be read — so it must be the board's own four, same ids.
  it("FAX_PARACHUTE_OPTIONS is exactly the live column's labels and ids", () => {
    expect(FAX_PARACHUTE_OPTIONS).toEqual(LIVE);
    expect(LIVE).toEqual([
      { index: 0, label: "Fax" },
      { index: 1, label: "Parachute" },
      { index: 2, label: "Email" },
      { index: 3, label: "Dashboard" },
    ]);
  });
});

describe("a save round-trips every label the board carries", () => {
  it.each<[string, number]>([
    ["Fax", 0],
    ["Parachute", 1],
    ["Email", 2],
    ["Dashboard", 3],
  ])("%s is written back as index %i — never flipped to Fax", async (label, index) => {
    const task = await faxTaskFor(patientWith(label, index));
    expect(task, `${label}: a task is built`).toBeDefined();
    expect(task!.value).toEqual({ index });

    // Its fn writes the same index it declares: the gateway sends `value`,
    // the client path runs `fn` (§5.2) — they must never disagree.
    await task!.fn();
    expect(h.statusWrites).toEqual([{ columnId: COL.faxParachute, index }]);
  });

  it("…and still does when the board can't be read, from FAX_PARACHUTE_OPTIONS", async () => {
    h.live = null;
    for (const { label, index } of FAX_PARACHUTE_OPTIONS) {
      h.captured.length = 0;
      const task = await faxTaskFor(patientWith(label, index));
      expect(task?.value, `${label} with the board unreadable`).toEqual({ index });
    }
  });
});

describe("a value the board cannot name is left alone", () => {
  it("an unknown label builds NO Fax/Parachute task", async () => {
    expect(await faxTaskFor(patientWith("Portal", 7))).toBeUndefined();
  });

  it("…with the board unreadable too — never a guess", async () => {
    h.live = null;
    expect(await faxTaskFor(patientWith("Portal", 7))).toBeUndefined();
  });

  it("a phantom index (Monday answers text: null) builds no task", async () => {
    expect(await faxTaskFor(patientWith(null, 5))).toBeUndefined();
  });

  it("a blank cell builds no task, and doesn't even read the board", async () => {
    expect(await faxTaskFor(patientWith("", null))).toBeUndefined();
    expect(h.reads).toBe(0);
  });

  // The board we READ is the authority. A label it doesn't have is not
  // written from the hardcoded list: that list is only for a board we could
  // not read at all.
  it("a label the live board no longer has is not written from the hardcoded list", async () => {
    h.live = LIVE.filter((o) => o.label !== "Dashboard");
    expect(await faxTaskFor(patientWith("Dashboard", 3))).toBeUndefined();
  });
});

describe("a rep's change", () => {
  it("is written by the index the LIVE board gives that label", async () => {
    const task = await faxTaskFor(patientWith("Fax", 0, "Dashboard"));
    expect(task?.value).toEqual({ index: 3 });
  });

  it("the live index wins over the hardcoded one", async () => {
    // A board whose Email label sits at a different id than the list says.
    h.live = [...LIVE.filter((o) => o.label !== "Email"), { index: 7, label: "Email" }];
    const task = await faxTaskFor(patientWith("Fax", 0, "Email"));
    expect(task?.value).toEqual({ index: 7 });
  });

  it("the board can't hold REFUSES the whole send — nothing is handed to the writer", async () => {
    h.live = LIVE.filter((o) => o.label !== "Dashboard");
    await expect(sendPatientToMonday(patientWith("Fax", 0, "Dashboard"))).rejects.toThrow(
      /Fax \/ Parachute.*no "Dashboard" option.*nothing was written/,
    );
    expect(h.captured.length).toBe(0);
    expect(h.statusWrites.length).toBe(0);
  });

  it("re-picking the value the board already shows is not a change, so it is never refused", () => {
    expect(planFaxParachuteWrite({ faxParachute: "Portal", faxParachuteEdited: "Portal" }, LIVE)).toEqual({
      action: "skip",
    });
  });

  it("a blank edit writes nothing — it never clears the column", () => {
    expect(planFaxParachuteWrite({ faxParachute: "Email", faxParachuteEdited: "" }, LIVE)).toEqual({
      action: "skip",
    });
  });

  // Every option the picker can hand the send resolves to its own index,
  // whether the board answers or not — so the picker and the send cannot drift.
  it("every option the picker offers resolves to its own index, board up or down", () => {
    for (const live of [LIVE, []]) {
      for (const { label, index } of FAX_PARACHUTE_OPTIONS) {
        expect(planFaxParachuteWrite({ faxParachute: "", faxParachuteEdited: label }, live)).toEqual({
          action: "write",
          index,
        });
      }
    }
  });
});
