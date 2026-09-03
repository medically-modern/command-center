import { describe, it, expect } from "vitest";
import { rowIsWorkable, searchOpenUrl, workableFirst, type OpenableRow } from "./searchOpen";

const base: OpenableRow = {
  id: "777", boardId: 18410601299, boardName: "Insurance", groupId: "group_mm1xr3q3",
  isCompleted: false, hasPage: true, roleRoute: "/benefits", stageAdvancerText: "Benefits / SoS",
  escalated: false, escalationLevel: null,
};
const params = (url: string | null) => new URLSearchParams(url!.split("?")[1]);

describe("searchOpenUrl", () => {
  it("ordinary live work opens its stage page, plain", () => {
    const url = searchOpenUrl(base);
    expect(url!.startsWith("/benefits?")).toBe(true);
    const q = params(url);
    expect(q.get("patientId")).toBe("777");
    expect(q.get("from")).toBe("system-mgmt");
    expect(q.get("mv")).toBeNull();
    expect(q.get("manager")).toBeNull();
  });

  it("a finished record opens its review page, read-only", () => {
    const url = searchOpenUrl({ ...base, isCompleted: true, hasPage: false, roleRoute: "", groupId: "group_mm2vw3c0" });
    expect(url!.startsWith("/benefits?")).toBe(true);
    expect(params(url).get("completedStage")).toBe("18410601299");
  });

  it("Proposed Stuck opens the stage page as Final Decisions — the Oversight screen", () => {
    const url = searchOpenUrl({ ...base, escalated: true, escalationLevel: "final" });
    expect(url!.startsWith("/benefits?")).toBe(true);
    const q = params(url);
    expect(q.get("mv")).toBe("final-decisions");
    expect(q.get("manager")).toBe("1");
    expect(q.get("escalated")).toBe("1");
  });

  it("an item parked in a Stuck group opens the board's canonical page as Final Decisions", () => {
    const url = searchOpenUrl({ ...base, groupId: "group_mm5g7twt", hasPage: false, roleRoute: "", stageAdvancerText: "Stuck / Don't Proceed" });
    expect(url!.startsWith("/benefits?")).toBe(true);
    expect(params(url).get("mv")).toBe("final-decisions");
    expect(params(url).get("escalated")).toBeNull();
    // Medical Evaluation → Evaluate; Welcome Call → Welcome Call; Profile Send Off → Profile.
    expect(searchOpenUrl({ ...base, boardId: 18406060017, groupId: "group_mm1xyczx", hasPage: false, roleRoute: "", stageAdvancerText: "Stuck" })!.startsWith("/evaluate?")).toBe(true);
    expect(searchOpenUrl({ ...base, boardId: 18410804557, groupId: "group_mm1xyczx", hasPage: false, roleRoute: "", stageAdvancerText: "" })!.startsWith("/welcome-call?")).toBe(true);
    expect(searchOpenUrl({ ...base, boardId: 18406352652, groupId: "group_mm1xyczx", hasPage: false, roleRoute: "", stageAdvancerText: "" })!.startsWith("/profile?")).toBe(true);
  });

  it("Manager Intervention opens the stage page in manager mode", () => {
    const q = params(searchOpenUrl({ ...base, escalated: true, escalationLevel: "manager" }));
    expect(q.get("mv")).toBe("manager-intervention");
    expect(q.get("manager")).toBe("1");
    expect(q.get("escalated")).toBe("1");
  });

  it("boards with no page anywhere open nothing — DTC Intake, Secondary Claims, a stuck DTC row", () => {
    expect(searchOpenUrl({ ...base, boardId: 18392794310, hasPage: false, roleRoute: "", groupId: "group_mkpehq9q", stageAdvancerText: "1. Intake" })).toBeNull();
    expect(searchOpenUrl({ ...base, boardId: 18392794310, hasPage: false, roleRoute: "", groupId: "group_mkyw7wy8", stageAdvancerText: "Stuck Final Review" })).toBeNull();
    expect(searchOpenUrl({ ...base, boardId: 18413019028, hasPage: false, roleRoute: "", groupId: "group_mm3bydwh", stageAdvancerText: "" })).toBeNull();
    expect(searchOpenUrl({ ...base, boardId: 18406352652, hasPage: false, roleRoute: "", groupId: "group_mm4vhqff", stageAdvancerText: "" })).toBeNull();
  });
});

describe("rowIsWorkable / workableFirst", () => {
  it("puts openable rows ahead of the check-Monday notes, keeping order within each", () => {
    const rows = [
      { ...base, id: "a", boardId: 18392794310, hasPage: false, roleRoute: "", groupId: "g" },
      { ...base, id: "b" },
      { ...base, id: "c", boardId: 18413019028, hasPage: false, roleRoute: "", groupId: "g" },
      { ...base, id: "d", boardId: 18406060017, groupId: "group_mm1xyczx", hasPage: false, roleRoute: "", stageAdvancerText: "Stuck" },
    ];
    expect(rows.map(rowIsWorkable)).toEqual([false, true, false, true]);
    expect(workableFirst(rows).map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });
});
