import { describe, it, expect } from "vitest";
import { BOARDS } from "@/lib/systemMgmt/mondayApi";
import {
  COMPLETED_GROUP_IDS,
  ESCALATION_INDEX,
  PROFILE_STATUS_LABEL,
  PROFILE_STATUS_ORDER,
  STUCK_GROUP_IDS,
  insuranceProfileStatus,
  intakeProfileStatus,
  mashekeProfileStatus,
  profileStatus,
  subscriptionProfileStatus,
  systemProfileStatus,
  welcomeCallProfileStatus,
  type ProfileStatus,
} from "./profileStatus";

const TODAY = "2026-08-19";
const TOMORROW = "2026-08-20";
const YESTERDAY = "2026-08-18";

const ME_STUCK = "group_mm1xyczx";
const ME_COMPLETED = "group_mm1x5q4e";
const ME_ACTIVE = "group_mm1xf2jb";

const at = (input: Parameters<typeof profileStatus>[0]) => profileStatus(input, TODAY);

describe("profileStatus — precedence", () => {
  it("orders Stuck > Proposed Stuck > Escalated > Paused > Waiting > Active", () => {
    // One patient who qualifies for EVERY status at once, peeled one layer at a
    // time. This is the whole rule in a single test: drop the top signal and the
    // next one down takes over, all the way to Active.
    const everything = {
      groupId: ME_STUCK,
      escalationIndex: ESCALATION_INDEX.final,
      subStage: "Doctor Appointment",
      nextActionDate: TOMORROW,
    };
    expect(at(everything)).toBe("stuck");
    expect(at({ ...everything, groupId: ME_ACTIVE })).toBe("proposedStuck");
    expect(at({ ...everything, groupId: ME_ACTIVE, escalationIndex: ESCALATION_INDEX.manager }))
      .toBe("escalated");
    expect(at({ ...everything, groupId: ME_ACTIVE, escalationIndex: null })).toBe("paused");
    expect(at({ ...everything, groupId: ME_ACTIVE, escalationIndex: null, subStage: "Chase Clinicals" }))
      .toBe("waiting");
    expect(at({ groupId: ME_ACTIVE, subStage: "Chase Clinicals", nextActionDate: TODAY }))
      .toBe("active");
  });

  it("keeps an escalated patient Escalated even while snoozed", () => {
    // The reason precedence exists at all: a manager flag is the fact somebody
    // has to act on, and a future date must not hide it behind "Waiting".
    expect(at({ escalationIndex: ESCALATION_INDEX.manager, nextActionDate: TOMORROW }))
      .toBe("escalated");
  });

  it("treats escalation index 1 (Done) as not escalated", () => {
    expect(at({ escalationIndex: ESCALATION_INDEX.done })).toBe("active");
  });

  it("falls back to the label when no index is available", () => {
    expect(at({ escalationLabel: "Final Escalation Required" })).toBe("proposedStuck");
    expect(at({ escalationLabel: "Manager Escalation Required" })).toBe("escalated");
    expect(at({ escalationLabel: "Done" })).toBe("active");
    expect(at({ escalationLabel: "" })).toBe("active");
  });

  it('lets index 1 ("Done") beat a stale label', () => {
    // Index 1 is a positive statement that the patient is NOT escalated, so it
    // stops the search rather than falling through.
    expect(at({ escalationIndex: ESCALATION_INDEX.done, escalationLabel: "Manager Escalation Required" }))
      .toBe("active");
  });

  it("falls back to the label when the INDEX is one we don't recognise", () => {
    // ⚠️ Monday assigns a status index when the label is created and takes the
    // lowest free slot, not display order (§5.12's Sub-Stage landed on 0 while
    // its siblings start at 8). A board whose escalation labels were created in
    // another order must not read Active — that is the one failure mode this
    // badge exists to prevent.
    expect(at({ escalationIndex: 7, escalationLabel: "Manager Escalation Required" })).toBe("escalated");
    expect(at({ escalationIndex: 7, escalationLabel: "Final Escalation Required" })).toBe("proposedStuck");
    expect(at({ escalationIndex: 7, escalationLabel: "Done" })).toBe("active");
    expect(at({ escalationIndex: 7 })).toBe("active");
  });

  it("reads the Welcome Call board's flat label, which has no manager/final split", () => {
    // §10: that board's labels are "Escalation Required · Done" — one rung.
    expect(welcomeCallProfileStatus({ escalation: "Escalation Required" }, { todayYmd: TODAY }))
      .toBe("escalated");
    expect(welcomeCallProfileStatus({ escalation: "Done" }, { todayYmd: TODAY })).toBe("active");
  });

  it("reads Subscription's single Escalate label, which has no Done to clear it", () => {
    expect(subscriptionProfileStatus({ escalation: "Escalate" }, { todayYmd: TODAY })).toBe("escalated");
  });
});

describe("profileStatus — Stuck is a group, not a column", () => {
  it("reports Stuck for every board's Stuck group", () => {
    for (const groupId of STUCK_GROUP_IDS) {
      expect(profileStatus({ groupId }, TODAY)).toBe("stuck");
    }
  });

  it("does not report Stuck for a working group", () => {
    expect(at({ groupId: ME_ACTIVE })).toBe("active");
  });
});

describe("profileStatus — no status at all", () => {
  it("returns null for a completed item, outranking even a stale escalation", () => {
    // Search's completion badges deep-link into finished stages (§7), so role
    // pages really do render these. A live-looking badge there would be a lie.
    expect(at({ groupId: ME_COMPLETED })).toBeNull();
    expect(at({ groupId: ME_COMPLETED, escalationIndex: ESCALATION_INDEX.manager })).toBeNull();
    expect(at({ completed: true, groupId: ME_ACTIVE })).toBeNull();
  });

  it("returns null for every board's Completed group", () => {
    for (const groupId of COMPLETED_GROUP_IDS) {
      expect(profileStatus({ groupId }, TODAY)).toBeNull();
    }
  });

  it("returns null for an un-escalated Auth Denied patient", () => {
    expect(at({ stage: "Auth Denied" })).toBeNull();
  });

  it("STILL reports the rung for an ESCALATED Auth Denied patient", () => {
    // §7: any denial escalates, and the Auth Outstanding send writes Manager on
    // one. Those patients are live manager work — suppressing the badge would
    // hide them on the one page a manager can still reach them from.
    expect(at({ stage: "Auth Denied", escalationLabel: "Manager Escalation Required" }))
      .toBe("escalated");
    expect(at({ stage: "Auth Denied", escalationLabel: "Final Escalation Required" }))
      .toBe("proposedStuck");
    expect(at({ stage: "Auth Denied", groupId: ME_STUCK })).toBe("stuck");
  });

  it("does not suppress any other stage", () => {
    expect(at({ stage: "Auth. Outstanding" })).toBe("active");
    expect(at({ stage: "Benefits / SoS" })).toBe("active");
    expect(at({ stage: "DVS" })).toBe("active");
  });
});

describe("profileStatus — Paused", () => {
  it("pauses the Doctor Appointments outreach queue", () => {
    expect(at({ subStage: "Doctor Appointment" })).toBe("paused");
  });

  it("pauses a booked visit that hasn't happened yet, today included", () => {
    expect(at({ appointmentDate: TOMORROW })).toBe("paused");
    expect(at({ appointmentDate: TODAY })).toBe("paused");
  });

  it("does NOT pause a visit that has already happened", () => {
    // Josh, 2026-08-19: "appointment date is in past - active". The chase is
    // live again, and snoozeUntilAfterAppointment floors those patients at
    // today precisely so they are due now.
    expect(at({ appointmentDate: YESTERDAY })).toBe("active");
  });

  it("lets a past visit fall through to Waiting when a future date remains", () => {
    expect(at({ appointmentDate: YESTERDAY, nextActionDate: TOMORROW })).toBe("waiting");
  });

  it("pauses Already In System", () => {
    expect(at({ alreadyInSystem: "Yes" })).toBe("paused");
    expect(at({ alreadyInSystem: "yes" })).toBe("paused");
  });

  it("treats a blank or No Already-In-System flag as not paused", () => {
    // §5.10: the column isn't always set, and blank counts as NOT in system.
    expect(at({ alreadyInSystem: "" })).toBe("active");
    expect(at({ alreadyInSystem: "No" })).toBe("active");
  });

  describe("dateless sleeps (Josh, 2026-08-19 — Paused, not Waiting)", () => {
    it('pauses a "Done" follow-up on the boards that use that vocabulary', () => {
      expect(at({ followUp: "Done", followUpRule: "done" })).toBe("paused");
    });

    it("pauses an Insurance Follow Up with a BLANK date", () => {
      // samantha/sidebarList: "a dateless Follow Up stays snoozed until cleared".
      expect(at({ followUp: "Follow Up", followUpRule: "followUp" })).toBe("paused");
    });

    it("leaves an Insurance Follow Up WITH a future date as Waiting", () => {
      expect(at({ followUp: "Follow Up", followUpRule: "followUp", nextActionDate: TOMORROW }))
        .toBe("waiting");
    });

    it("leaves an Insurance Follow Up whose date has arrived as Active", () => {
      expect(at({ followUp: "Follow Up", followUpRule: "followUp", nextActionDate: TODAY }))
        .toBe("active");
    });

    it("ignores the column entirely under followUpRule none", () => {
      expect(at({ followUp: "Done", followUpRule: "none" })).toBe("active");
      expect(at({ followUp: "Follow Up", followUpRule: "none" })).toBe("active");
    });

    it("defaults to ignoring the column when no rule is given", () => {
      expect(at({ followUp: "Done" })).toBe("active");
    });
  });
});

describe("profileStatus — Waiting", () => {
  it("waits only on a date strictly in the future", () => {
    expect(at({ nextActionDate: TOMORROW })).toBe("waiting");
    expect(at({ nextActionDate: TODAY })).toBe("active");
    expect(at({ nextActionDate: YESTERDAY })).toBe("active");
  });

  it("treats a blank date as due now", () => {
    expect(at({ nextActionDate: "" })).toBe("active");
    expect(at({})).toBe("active");
  });

  it("tolerates a datetime cell", () => {
    // Monday hands some date columns back as "YYYY-MM-DD HH:mm:ss".
    expect(at({ nextActionDate: `${TOMORROW} 09:00:00` })).toBe("waiting");
    expect(at({ nextActionDate: `${TODAY} 23:59:00` })).toBe("active");
  });
});

describe("adapters", () => {
  it("masheke: index, sub-stage, appointment and NAD", () => {
    expect(mashekeProfileStatus({ groupId: ME_STUCK }, { todayYmd: TODAY })).toBe("stuck");
    expect(mashekeProfileStatus({ escalationIndex: 2 }, { todayYmd: TODAY })).toBe("proposedStuck");
    expect(mashekeProfileStatus({ subStage: "Doctor Appointment" }, { todayYmd: TODAY })).toBe("paused");
    expect(mashekeProfileStatus({ appointmentDate: TOMORROW }, { todayYmd: TODAY })).toBe("paused");
    expect(mashekeProfileStatus({ nextActionDate: TOMORROW }, { todayYmd: TODAY })).toBe("waiting");
    expect(mashekeProfileStatus({ subStage: "Evaluate MN" }, { todayYmd: TODAY })).toBe("active");
  });

  it("masheke: ignores its Follow Up column, as its queues do", () => {
    expect(mashekeProfileStatus({ subStage: "Chase Clinicals" }, { todayYmd: TODAY })).toBe("active");
  });

  it("insurance: splits the two rungs by LABEL, since `escalated` merges them", () => {
    expect(insuranceProfileStatus({ escalationLabel: "Manager Escalation Required" }, { todayYmd: TODAY }))
      .toBe("escalated");
    expect(insuranceProfileStatus({ escalationLabel: "Final Escalation Required" }, { todayYmd: TODAY }))
      .toBe("proposedStuck");
  });

  it("insurance: Auth Denied reports nothing unless escalated", () => {
    expect(insuranceProfileStatus({ stageAdvancerText: "Auth Denied" }, { todayYmd: TODAY })).toBeNull();
    expect(insuranceProfileStatus(
      { stageAdvancerText: "Auth Denied", escalationLabel: "Manager Escalation Required" },
      { todayYmd: TODAY },
    )).toBe("escalated");
  });

  it("insurance: blank-date Follow Up is Paused, dated Follow Up is Waiting", () => {
    expect(insuranceProfileStatus({ followUp: "Follow Up" }, { todayYmd: TODAY })).toBe("paused");
    expect(insuranceProfileStatus({ followUp: "Follow Up", followUpDate: TOMORROW }, { todayYmd: TODAY }))
      .toBe("waiting");
  });

  it("intake: Already In System is Paused", () => {
    expect(intakeProfileStatus({ alreadyInSystem: "Yes" }, { todayYmd: TODAY })).toBe("paused");
  });

  it("intake: the New Form groups are Active", () => {
    // Josh: "new form partial leads and new form completed is active".
    expect(intakeProfileStatus({ groupId: "group_mm5z87zt" }, { todayYmd: TODAY })).toBe("active");
    expect(intakeProfileStatus({ groupId: "group_mm5zgeak" }, { todayYmd: TODAY })).toBe("active");
  });

  it("intake: Profile Send Off's Stuck group is Stuck", () => {
    expect(intakeProfileStatus({ groupId: "group_mm1xyczx" }, { todayYmd: TODAY })).toBe("stuck");
  });

  it("intake: Patient Intake ignores Follow Up, exactly as its sidebar does", () => {
    // §5.10 — that queue's Follow Up pair is a one-way door nothing reads, so
    // honouring it would report Paused for a patient sitting in everyone's queue.
    expect(intakeProfileStatus({ followUp: "Done" }, { todayYmd: TODAY })).toBe("paused");
    expect(intakeProfileStatus({ followUp: "Done" }, { ignoreFollowUp: true, todayYmd: TODAY }))
      .toBe("active");
  });

  it("welcomeCall: reads the escalation index the stage's own mapping hardcodes away", () => {
    // §10: welcomeCall/finalConfirm hardcode `escalated: false`. The adapter is
    // handed the raw column so the badge can't inherit that bug.
    expect(welcomeCallProfileStatus({ escalationIndex: 0 }, { todayYmd: TODAY })).toBe("escalated");
    expect(welcomeCallProfileStatus({ followUp: "Done" }, { todayYmd: TODAY })).toBe("paused");
    expect(welcomeCallProfileStatus({ followUpDate: TOMORROW }, { todayYmd: TODAY })).toBe("waiting");
    expect(welcomeCallProfileStatus({}, { todayYmd: TODAY })).toBe("active");
  });

  it("subscription: Active, or Escalated for the items carrying the flag", () => {
    expect(subscriptionProfileStatus({}, { todayYmd: TODAY })).toBe("active");
    expect(subscriptionProfileStatus({ escalationIndex: 0 }, { todayYmd: TODAY })).toBe("escalated");
  });
});

describe("systemMgmt adapter (Search · Escalations)", () => {
  const sys = (p: Parameters<typeof systemProfileStatus>[0]) => systemProfileStatus(p, TODAY);

  it("maps the escalation rung across all seven boards", () => {
    expect(sys({ escalationLevel: "final" })).toBe("proposedStuck");
    expect(sys({ escalationLevel: "manager" })).toBe("escalated");
    // Welcome Call's column never split — one "Escalation Required" label,
    // which is a manager escalation.
    expect(sys({ escalationLevel: "flat" })).toBe("escalated");
    expect(sys({ escalationLevel: null })).toBe("active");
  });

  it("honours isCompleted, which Search computes from the board's own group", () => {
    expect(sys({ isCompleted: true })).toBeNull();
    expect(sys({ isCompleted: true, escalationLevel: "manager" })).toBeNull();
  });

  it("reports Stuck from the group, on every board", () => {
    expect(sys({ groupId: "group_mm5g7twt" })).toBe("stuck");
    expect(sys({ groupId: "group_mkzcc2wg" })).toBe("stuck");
  });

  it("waits on a future Next Action Date", () => {
    expect(sys({ nextActionDate: TOMORROW })).toBe("waiting");
    expect(sys({ nextActionDate: YESTERDAY })).toBe("active");
  });

  it("suppresses Active for Auth Denied but not the rungs above it", () => {
    expect(sys({ stageAdvancerText: "Auth Denied" })).toBeNull();
    expect(sys({ stageAdvancerText: "Auth Denied", escalationLevel: "final" })).toBe("proposedStuck");
  });

  it("falls back to the raw label only when no rung was derived", () => {
    expect(sys({ escalationLevel: null, escalationText: "Manager Escalation Required" }))
      .toBe("escalated");
    // A stale text on a row escalationDetail decided is NOT escalated must not
    // override it — the two are derived from the same inputs and must agree.
    expect(sys({ escalationLevel: null, escalationText: "Done" })).toBe("active");
  });

  it("agrees with the role page on every rung it can see", () => {
    // The projection is narrower, never contradictory. Same board facts in,
    // same status out.
    for (const [level, expected] of [["manager", "escalated"], ["final", "proposedStuck"]] as const) {
      expect(sys({ escalationLevel: level })).toBe(
        insuranceProfileStatus(
          {
            escalationLabel:
              level === "manager" ? "Manager Escalation Required" : "Final Escalation Required",
          },
          { todayYmd: TODAY },
        ),
      );
    }
    expect(sys({ groupId: "group_mm1xyczx" })).toBe(
      mashekeProfileStatus({ groupId: "group_mm1xyczx" }, { todayYmd: TODAY }),
    );
  });
});

describe("keep-in-agreement with the BOARDS registry", () => {
  // The §5.10 bug class: a hand-maintained list of group ids will not be
  // updated when a board changes. These two assertions are what catches it.
  const allGroups = BOARDS.flatMap((b) =>
    b.groupRoutes.map((g) => ({ ...g, boardName: b.boardName })),
  );

  it("lists every Stuck group on every board", () => {
    const stuckByTitle = allGroups.filter((g) => /stuck|can't proceed/i.test(g.title));
    expect(stuckByTitle.length).toBeGreaterThan(0);
    for (const g of stuckByTitle) {
      expect(
        STUCK_GROUP_IDS,
        `${g.boardName} · "${g.title}" (${g.id}) is a Stuck group but is missing from STUCK_GROUP_IDS`,
      ).toContain(g.id);
    }
  });

  it("lists no id that isn't a Stuck group on some board", () => {
    for (const id of STUCK_GROUP_IDS) {
      const matches = allGroups.filter((g) => g.id === id);
      expect(matches.length, `${id} is in STUCK_GROUP_IDS but on no board`).toBeGreaterThan(0);
      // Group ids are reused across boards, so a Stuck id must not ALSO name a
      // working group somewhere — that would mark live patients Stuck.
      for (const g of matches) {
        expect(
          /stuck|can't proceed/i.test(g.title),
          `${id} is a Stuck id but is "${g.title}" on ${g.boardName}`,
        ).toBe(true);
      }
    }
  });

  it("mirrors every isCompleted group, and nothing else", () => {
    const completed = allGroups.filter((g) => g.isCompleted);
    expect(completed.length).toBeGreaterThan(0);
    for (const g of completed) {
      expect(
        COMPLETED_GROUP_IDS,
        `${g.boardName} · "${g.title}" (${g.id}) is completed but is missing from COMPLETED_GROUP_IDS`,
      ).toContain(g.id);
    }
    for (const id of COMPLETED_GROUP_IDS) {
      const matches = allGroups.filter((g) => g.id === id);
      expect(matches.length, `${id} is in COMPLETED_GROUP_IDS but on no board`).toBeGreaterThan(0);
      for (const g of matches) {
        expect(g.isCompleted, `${id} is "${g.title}" on ${g.boardName}, which is not completed`).toBe(true);
      }
    }
  });

  it("keeps Stuck and Completed disjoint", () => {
    for (const id of STUCK_GROUP_IDS) expect(COMPLETED_GROUP_IDS).not.toContain(id);
  });
});

describe("the vocabulary itself", () => {
  it("labels and orders every status exactly once", () => {
    const all: ProfileStatus[] = ["stuck", "proposedStuck", "escalated", "paused", "waiting", "active"];
    expect([...PROFILE_STATUS_ORDER].sort()).toEqual([...all].sort());
    for (const s of all) expect(PROFILE_STATUS_LABEL[s]).toBeTruthy();
  });

  it("orders worst-first", () => {
    expect(PROFILE_STATUS_ORDER[0]).toBe("stuck");
    expect(PROFILE_STATUS_ORDER[PROFILE_STATUS_ORDER.length - 1]).toBe("active");
  });
});
