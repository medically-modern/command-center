/**
 * THE configuration for the Onboarding Oversight dashboard (BUILD-SPEC Appendix A, copied literally).
 * Every monday board/column/label ID, threshold, owner mapping and rule lives here, not in logic.
 * Values marked PROPOSED await CEO confirmation (BUILD-SPEC §3.14.4).
 */
export const OO_CONFIG = {
  schemaVersion: 2, // bump on ANY change to parseEvent, RawEvent or span semantics (forces every browser cache to reload) // bump to force every browser cache to reload (cache key includes it, §5.2)
  boards: { INT: "18406352652", MN: "18406060017", INS: "18410601299", WC: "18410804557",
            SUB: "18407459988", FAX: "18398061249" },
  mondayItemUrl: "https://medicallymodern-force.monday.com/boards/{boardId}/pulses/{itemId}",

  groups: {
    INT: { inPipeline: ["group_mm1xf2jb","group_mm5zgeak","group_mm6c3rhb","group_mm1xyczx","group_mm1y57sz"],
           excludedCountOnly: ["group_mm5z87zt","group_mm64b83h"], ignored: ["group_mm1wvq8p","group_mm4vhqff"],
           stuck: ["group_mm1xyczx"], escalations: [], exit: ["group_mm1y57sz"] },
    MN:  { inPipeline: ["group_mm1xf2jb","group_mm1x5q4e","group_mm1xyczx","group_mm33pdpm"], excludedCountOnly: [], ignored: [],
           stuck: ["group_mm1xyczx"], escalations: ["group_mm33pdpm"], exit: ["group_mm1x5q4e"] },
    INS: { inPipeline: ["group_mm1xr3q3","group_mm5gp2r2","group_mm1x1416","group_mm2v6d1z","group_mm316hg2","group_mm2vg9gn","group_mm5g7twt","group_mm2vw3c0"],
           excludedCountOnly: [], ignored: [], stuck: ["group_mm5g7twt"], escalations: ["group_mm2vg9gn"], exit: ["group_mm2vw3c0"] },
    WC:  { inPipeline: ["group_mm1wvq8p","group_mm2x8jtj","group_mm1xyczx","group_mm1x5c0","group_mm1x5s5d"], excludedCountOnly: [], ignored: [],
           stuck: ["group_mm1xyczx"], escalations: ["group_mm1x5c0"], exit: ["group_mm1x5s5d"] },
  },
  // Group-filtered activity query (§3.2.2) to catch group-only moves into Stuck/Escalations.
  // Group moves (VERIFY-2 V1): group_ids returns moves OUT of the listed groups, so list every in-pipeline SOURCE group.
  groupMoveSourceGroups: {
    INT: ["group_mm1xf2jb","group_mm5zgeak","group_mm6c3rhb","group_mm1xyczx","group_mm1y57sz"],
    MN:  ["group_mm1xf2jb","group_mm1x5q4e","group_mm1xyczx","group_mm33pdpm"],
    INS: ["group_mm1xr3q3","group_mm5gp2r2","group_mm1x1416","group_mm2v6d1z","group_mm316hg2","group_mm2vg9gn","group_mm5g7twt","group_mm2vw3c0"],
    WC:  ["group_mm1wvq8p","group_mm2x8jtj","group_mm1xyczx","group_mm1x5c0","group_mm1x5s5d"] },
  groupMoves: { enabled: true, lookbackDays: 45 }, // a group_ids query returns ALL events in those groups (VERIFY-2: ~2.8k rows per WC group per 60 d), so keep the cold window short; warm loads are incremental
  // DH-12: stage label -> groups an item with that label may be in (from the §2.5 group-move automations).
  // Escalated items (esc 0/2) may also be in the board's escalations group; byGroup items are flagged separately.
  expectedGroups: {
    INT: { null: ["group_mm1xf2jb","group_mm5zgeak","group_mm6c3rhb","group_mm1xyczx"], 3: ["group_mm1xf2jb","group_mm5zgeak","group_mm6c3rhb","group_mm1xyczx"],
           1: ["group_mm1y57sz"], 6: ["group_mm1y57sz"], 0: ["group_mm1y57sz","group_mm64b83h"], 2: ["group_mm1y57sz","group_mm1xyczx"] },
    MN:  { 8: ["group_mm1xf2jb"], 9: ["group_mm1xf2jb"], 10: ["group_mm1xf2jb"], 11: ["group_mm1xf2jb"], 0: ["group_mm1xf2jb"],
           15: ["group_mm1xyczx"], 14: ["group_mm1x5q4e"] },
    INS: { 3: ["group_mm1xr3q3"], 1: ["group_mm5gp2r2"], 4: ["group_mm1x1416"], 6: ["group_mm2v6d1z"], 0: ["group_mm316hg2"],
           2: ["group_mm5g7twt"], 7: ["group_mm2vw3c0"] },
    WC:  { 7: ["group_mm1wvq8p"], 0: ["group_mm2x8jtj"], 2: ["group_mm1xyczx"], 4: ["group_mm1x5s5d"] },
  },
  // Gap-fix columns: null until the gap ships (§4.2). Setting them activates the feature with no code change.
  columns: { INT: { itemIdCol: null as string | null }, MN: { intakeItemIdCol: null as string | null, stuckCategory: null as string | null },
             INS: { intakeItemIdCol: null as string | null, denialCategory: null as string | null, stuckCategory: null as string | null },
             WC: { intakeItemIdCol: null as string | null, stuckCategory: null as string | null },
             SUB: { intakeItemIdCol: null as string | null } },

  stageColumn: { INT: "color_mm1zmeb3", MN: "color_mm1wyr92", INS: "color_mm1ws96t", WC: "color_mm1ws96t" },
  intSubStageColumn: "color_mm6ct431",
  escalationColumn: { INT: "color_mm5zww42", MN: "color_mm1x7997", INS: "color_mm2vsh2f", WC: "color_mm1x7997" },
  exitLabels: { INT: [1, 6], MN: [14], INS: [7], WC: [4] },          // on stageColumn
  intTerminalLabels: [0, 2],                                          // Already Serving, Send Back To Referral
  stuckLabels: { MN: [15], INS: [2], WC: [2] },
  escalation: { managerLabel: 0, doneLabel: 1, finalLabel: 2 },

  activityColumns: {
    // CR-17 parity with the verified export: the v2 rules need these live too (attempts, Next Action Dates, follow-ups, scheduled column).
    INT: ["color_mm1zmeb3","color_mm6ct431","color_mm5zww42","color_mm3822qq","date_mm3874an","numeric_mm5ze82q","numeric_mm67822b"],
    MN:  ["color_mm1wyr92","color_mm1x7997","color_mm1xw7y5","color_mm1wz0vg","color_mm1y8rv8","color_mm35v6a0","date_mm1wadgs","date_mm35kbkj",
          "text_mm2yd068","text_mm2y9h4a","text_mm2ymtsk","text_mm2yhpjt","text_mm2yb3rv","text_mm2ybk06","color_mm35v6a0","date_mm35kbkj","color_mm1wz0vg","numeric_mm4bhjc8"],
    INS: ["color_mm1ws96t","color_mm2vsh2f","color_mm2vt8xg","color_mm34jz1x","date_mm34m2dz","numeric_mm5f5ars"],
    WC:  ["color_mm1ws96t","color_mm1x7997","color_mm1xtqvv","color_mm38w2tk","date_mm38a7k7","text_mm322fg9"],
  },
  itemColumns: {
    INT: ["color_mm1zmeb3","color_mm6ct431","color_mm5zww42","text_mm65xbm0","color_mm1w5wxr","color_mm7pywyh","color_mm3822qq","date_mm3874an","numeric_mm5ze82q","numeric_mm67822b"],
    MN:  ["color_mm1wyr92","color_mm1x7997","color_mm1xw7y5","color_mm1y6qrf","color_mm1y8rv8","text_mm3ac5a0","date_mm1wf43j",
          "date_mm1wadgs","color_mm1w5wxr","color_mm7pkb92","color_mm1wwm05",
          "text_mm2yd068","text_mm2y9h4a","text_mm2ymtsk","text_mm2yhpjt","text_mm2yb3rv","text_mm2ybk06"],
    INS: ["color_mm1ws96t","color_mm2vsh2f","color_mm2vt8xg","text_mm3a2b3n","color_mm1wgjd1","color_mm1x5c99","color_mm1xnzmn",
          "color_mm1xr2j1","color_mm1xybvt","color_mm34jz1x","date_mm34m2dz","color_mm1w5wxr","color_mm7ppqbn","color_mm1wwm05"],
    WC:  ["color_mm1ws96t","color_mm1x7997","text_mm3av5nt","date_mm1wf43j","date_mm38a7k7","color_mm1xtqvv","color_mm1w5wxr",
          "color_mm7p9hm0","color_mm1wwm05","text_mm322fg9","color_mm38w2tk"],
    SUB: ["text_mm3af3zt"],
    FAX: [],                                                            // id, created_at, group only; never names
  },
  // Text columns whose TEXT is discarded at parse time; only nonEmpty is kept (§5.2).
  countOnlyColumns: ["text_mm2yd068","text_mm2y9h4a","text_mm2ymtsk","text_mm2yhpjt","text_mm2yb3rv","text_mm2ybk06","text_mm322fg9"],
  uidColumn: { INT: "text_mm65xbm0", MN: "text_mm3ac5a0", INS: "text_mm3a2b3n", WC: "text_mm3av5nt", SUB: "text_mm3af3zt" },
  expeditedColumn: { INT: "color_mm7pywyh", MN: "color_mm7pkb92", INS: "color_mm7ppqbn", WC: "color_mm7p9hm0" }, // label 2 = Expedited
  expeditedLabel: 2,
  referralSourceColumn: "color_mm1w5wxr", // same ID on INT, MN, INS, WC; label indexes differ per board:
  referralSourceLabels: {
    INT: { 0:"patient",1:"tandem",2:"betaBionics",3:"careCentrix",4:"doctor",6:"wellstart",7:"solace",8:"snj",9:"districtEndo",10:"snj2" },
    MN:  { 0:"patient",1:"tandem",2:"betaBionics",3:"careCentrix",4:"doctor",6:"solace",7:"wellstart",8:"snj",9:"districtEndo",10:"snj2" },
    INS: { 0:"patient",1:"tandem",2:"betaBionics",3:"careCentrix",4:"doctor",6:"solace",7:"wellstart",8:"snj",9:"districtEndo",10:"snj2" },
    WC:  { 0:"patient",1:"tandem",2:"betaBionics",3:"careCentrix",4:"doctor",6:"solace",7:"snj",8:"wellstart",9:"districtEndo",10:"snj2" },
  },
  // CC queue snooze rules (VERIFY-1 V13), keyed by STAGE LABEL; "today" = ET date. Rule enum:
  // "dateAfterToday" = snoozed iff date > today; "followUpAndDate" = status==followUpLabel && (date blank || date > today); "never".
  snooze: {
    MN:  { dateCol: "date_mm1wadgs", byLabel: { 8:"dateAfterToday", 9:"dateAfterToday", 10:"dateAfterToday", 11:"dateAfterToday", 0:"dateAfterToday" } },
    INS: { dateCol: "date_mm34m2dz", statusCol: "color_mm34jz1x", followUpLabel: 1, // 1 = "Follow Up" (BOARDS.md)
           byLabel: { 1:"dateAfterToday", 6:"dateAfterToday", 3:"followUpAndDate", 4:"followUpAndDate", 0:"never" } },
    WC:  { dateCol: "date_mm38a7k7", byLabel: { 7:"dateAfterToday", 0:"never" } },
  },
  // Chase channel split = CC isParachuteRoleMethod (VERIFY-1 V4). Clinicals Method color_mm1xw7y5.
  clinicalsMethodColumn: "color_mm1xw7y5",
  parachuteRoleMethodLabels: [1, 2, 3],   // Parachute, Email, Dashboard -> 1.1.2.4P; everything else incl. blank -> 1.1.2.4F
  splitChaseClinicals: true,              // PROPOSED (D-04, needs Corey)

  // Stage label -> code, consumed only by codeResolver.ts; special cases in §3.2.3.
  labelToCode: {
    MN:  { 8:"1.1.2.1", 9:"1.1.2.2", 10:"1.1.2.3", 11:"CHASE", 0:"MN-DA" },
    INS: { 1:"1.1.3.1", 3:"BENEFITS_SOS", 4:"1.1.3.3", 6:"1.1.3.4", 0:"1.1.3.5" },
    WC:  { 7:"1.1.4.1", 0:"1.1.5.1" },
  },
  insBenefitsMarkerColumn: "color_mm2vt8xg",
  remediationAfterLabel: { INS: 0 },      // label 4/6 spans after a label-0 span -> 1.1.3.6
  intSubStageCleanupLabel: 1,
  intNeedMoreInfoLabel: 3,
  intSubStageHistoryStart: "2026-08-19T00:00:00Z", // before this, INT time is code "1.1.1" (KL-05)
  // Label text -> index, for matching gql_log rows that store {"label": "..."} (Stage Advancer writes text; VERIFY-1 V7).
  labelText: {
    MN:  { "Doctor Appointment":0,"Evaluate MN":8,"Send Request":9,"Confirm Receipt":10,"Chase Clinicals":11,"Completed":14,"Stuck":15 },
    INS: { "Auth Denied":0,"DVS":1,"Stuck / Don't Proceed":2,"Benefits / SoS":3,"Submit Auth.":4,"Auth. Outstanding":6,"Complete":7 },
    WC:  { "Review Profile":0,"Stuck / Don't Proceed":2,"Completed":4,"Welcome Call":7 },
  },
  // Named labels used by metric formulas (no index literals in metric code).
  metricLabels: {
    MN:  { confirmReceipt: 10, chase: 11, mrReceived: { col: "color_mm1y8rv8", index: 1 }, mnEstablished: { col: "color_mm1y6qrf", index: 1 },
           attempts: { col: "color_mm1wz0vg", map: { 2: 1, 3: 2, 1: 3, 0: "escalated" } } },
    INS: { authOutstanding: 6, approved: 7, denied: 0, authResultDenied: 2,
           authResultCols: { cgm: "color_mm1wgjd1", sensors: "color_mm1x5c99", ip: "color_mm1xnzmn", infusionSet: "color_mm1xr2j1", cartridge: "color_mm1xybvt" } },
    WC:  { welcomeCall: 7, reviewProfile: 0, released: 4, stuck: 2, welcomeText: { col: "color_mm1xtqvv", index: 0 }, callAttemptsText: "text_mm322fg9" },
    INT: { advanceMN: 1, advanceWC: 6, sendBack: 2, needMoreInfo: 3, cleanup: { col: "color_mm6ct431", index: 1 } },
    MN_attemptTextCols: ["text_mm2yd068","text_mm2y9h4a","text_mm2ymtsk","text_mm2yhpjt","text_mm2yb3rv","text_mm2ybk06"],
  },

  codes: [ // the 20 taxonomy rows + emitted non-taxonomy codes; views iterate this list in order
    { code:"1.1.1.1", name:"Information Collection", stage:"1.1.1", kind:"pipeline" },
    { code:"1.1.1.2", name:"Profile Clean-Up", stage:"1.1.1", kind:"pipeline" },
    { code:"1.1.1",   name:"Intake (unsplit, before 2026-08-19)", stage:"1.1.1", kind:"derived" },
    { code:"1.1.2.1", name:"Evaluate Medical Necessity", stage:"1.1.2", kind:"pipeline" },
    { code:"1.1.2.2", name:"Send Request", stage:"1.1.2", kind:"pipeline" },
    { code:"1.1.2.3", name:"Confirm Receipt (Fax)", stage:"1.1.2", kind:"pipeline" },
    { code:"1.1.2.4F", name:"Chase Clinicals (Fax)", stage:"1.1.2", kind:"pipeline" },
    { code:"1.1.2.4P", name:"Chase Clinicals (Parachute, Email, Dashboard)", stage:"1.1.2", kind:"pipeline" },
    { code:"1.1.2.4", name:"Chase Clinicals (merged)", stage:"1.1.2", kind:"mergedOnly" },
    { code:"MN-DA",   name:"Doctor Appointment (not a taxonomy code)", stage:"1.1.2", kind:"nonTaxonomy" },
    { code:"1.1.3.1", name:"Benefits Check", stage:"1.1.3", kind:"pipeline" },
    { code:"1.1.3.2", name:"Auth Check / SoS", stage:"1.1.3", kind:"pipeline" },
    { code:"1.1.3.1+2", name:"Benefits + SoS (not separable)", stage:"1.1.3", kind:"derived" },
    { code:"1.1.3.3", name:"Submit Auth", stage:"1.1.3", kind:"pipeline" },
    { code:"1.1.3.4", name:"Review Auths Outstanding", stage:"1.1.3", kind:"pipeline" },
    { code:"1.1.3.5", name:"Auth Denial", stage:"1.1.3", kind:"pipeline" },
    { code:"1.1.3.6", name:"Auth Remediation", stage:"1.1.3", kind:"pipeline" },
    { code:"1.1.4.1", name:"Confirm Patient Information & Order", stage:"1.1.4", kind:"pipeline" },
    { code:"1.1.5.1", name:"Final Profile Confirmation", stage:"1.1.5", kind:"pipeline" },
    { code:"1.2.1", name:"Patient text updates", stage:"1.2", kind:"byproduct" },
    { code:"1.2.2", name:"Patient call updates", stage:"1.2", kind:"byproduct" },
    { code:"1.2.3", name:"Provider / referral emails", stage:"1.2", kind:"byproduct" },
    { code:"1.2.4", name:"Provider / referral calls", stage:"1.2", kind:"byproduct" },
    { code:"1.2.5", name:"Review inbound updated clinicals", stage:"1.2", kind:"byproduct" },
  ],
  // Q-01 ordering (lower = earlier). Non-taxonomy codes sit with their stage.
  codeOrder: { "1.1.1.1":1,"1.1.1.2":2,"1.1.1":2,"1.1.2.1":3,"1.1.2.2":4,"1.1.2.3":5,"1.1.2.4F":6,"1.1.2.4P":6,"1.1.2.4":6,"MN-DA":6,
               "1.1.3.1":7,"1.1.3.2":8,"1.1.3.1+2":8,"1.1.3.3":9,"1.1.3.4":10,"1.1.3.5":11,"1.1.3.6":12,"1.1.4.1":13,"1.1.5.1":14 },
  reworkExclusions: [["1.1.3.5","1.1.3.6"]],

  // Thresholds in business days. Every entry: PROPOSED until confirmed:true (§3.14.3).
  thresholds: {
    "1.1.1.1":{y:1,r:3,confirmed:false}, "1.1.1.2":{y:1,r:2,confirmed:false}, "1.1.1":{y:2,r:4,confirmed:false},
    "1.1.2.1":{y:0.5,r:1,confirmed:false}, "1.1.2.2":{y:0.5,r:1,confirmed:false}, "1.1.2.3":{y:1,r:3,confirmed:false},
    "1.1.2.4F":{y:5,r:10,confirmed:false}, "1.1.2.4P":{y:5,r:10,confirmed:false}, "1.1.2.4":{y:5,r:10,confirmed:false},
    "MN-DA":{y:10,r:20,confirmed:false},
    "1.1.3.1":{y:0.5,r:1,confirmed:false}, "1.1.3.2":{y:0.5,r:1,confirmed:false}, "1.1.3.1+2":{y:1,r:2,confirmed:false},
    "1.1.3.3":{y:0.5,r:1,confirmed:false}, "1.1.3.4":{y:5,r:10,confirmed:false}, "1.1.3.5":{y:1,r:3,confirmed:false},
    "1.1.3.6":{y:5,r:10,confirmed:false}, "1.1.4.1":{y:2,r:4,confirmed:false}, "1.1.5.1":{y:0.5,r:1,confirmed:false},
    "UNMAPPED":{y:2,r:5,confirmed:false},
    "stage:1.1.1":{y:2,r:4,confirmed:false}, "stage:1.1.2":{y:5,r:10,confirmed:false}, "stage:1.1.3":{y:5,r:10,confirmed:false},
    "stage:1.1.4":{y:2,r:4,confirmed:false}, "stage:1.1.5":{y:0.5,r:1,confirmed:false},
    "S-01:p50":{y:10,r:15,confirmed:false}, "S-01:p90":{y:20,r:30,confirmed:false},
    "F-04:ratio":{y:0.2,r:0.4,confirmed:false}, "W-03":{y:5,r:10,confirmed:false},
    "B-02:withinPct":{y:0.9,r:0.75,confirmed:false, lowerIsWorse:true},
    "L-01a":{y:1,r:10,confirmed:false}, "L-02:item":{y:2,r:5,confirmed:false},
  },
  // Escalation buckets: Brandon-set (CR B): green <= 1 bd, yellow > 1 to 2 bd, red > 2 bd ("in limbo"). STUCK = dead lead: no alarm.
  // CR-10 falling-behind flags on the manager patient list. PROPOSED (ASSUMPTIONS AS-12); business days.
  patientFlags: { minReleasedN: 10, untouchedBd: 3, mnFollowUpsNoProgress: 3, insDenialsRepeat: 2, unusedBucketBd: 10, minJudgeN: 5, snapshotStaleHours: 6, dataCheckMinAgeBd: 1, confirmed: false,
    // Backward moves that are a normal part of the workflow, so not "doesn't add up" (from -> to). PROPOSED (AS-12).
    plannedBackward: [["1.1.2.2","1.1.2.1"],["1.1.2.3","1.1.2.1"],["1.1.2.4F","1.1.2.1"],["1.1.2.4P","1.1.2.1"],["1.1.3.5","1.1.3.6"],["1.1.3.5","1.1.3.3"],["1.1.3.6","1.1.3.3"],["1.1.3.4","1.1.3.3"]] as [string, string][] },
  // CR-11 cause tag and tile colour rules (bench debate, coo-ops). PROPOSED (AS-14).
  causeRule: { decisionShare: 0.3, waitingShare: 0.4, noOwnerShare: 0.25, redShare: 0.5, redMin: 20, amberShare: 0.2, redDaysRatio: 2,
    trendPts: 0.05, amberLateShare: 0.5, decisionMajority: 0.5, confirmed: false }, // level-1: arrow/amber at +trendPts over 4 weeks; amber at amberLateShare late; Decision when ≥ decisionMajority of 'us' are escalated
  // CR-12 normal time per sub-stage (business days) and attempt norms. PROPOSED (ASSUMPTIONS AS-15), derived from real dwell
  // (export 2026-10-01: p50 / p75 / p90 of finished visits) and anchored to Brandon's examples. Approaching = approachShare of normal.
  // Attempt kinds: "providerFollowUps" (MN follow-up counter), "authDenials" (INS entries into Auth Denied), "calls" (WC call attempts count),
  // "intakeAttempts" (Intake attempt counter). Over = count >= normal; approaching = normal - 1.
  norms: {
    approachShare: 0.75,
    newLateBd: 2, // "New late" = crossed its normal within this many business days
    // No grace (consult C2): late = the displayed days (rounded to 0.1 business day) exceed the normal, for every step.
    time: { "1.1.1.1": 2, "1.1.1.2": 2, "1.1.1": 1, "1.1.2.1": 1, "1.1.2.2": 1, "1.1.2.3": 6, "1.1.2.4F": 10, "1.1.2.4P": 10, "1.1.2.4": 10, "MN-DA": 10,
            "1.1.3.1": 1, "1.1.3.2": 1, "1.1.3.1+2": 1, "1.1.3.3": 1, "1.1.3.4": 5, "1.1.3.5": 1, "1.1.3.6": 5, "1.1.4.1": 5, "1.1.5.1": 2,
            MGR: 2, FINAL: 2, UNMAPPED: 5 } as Record<string, number>,
    attempts: { "1.1.1.1": { kind: "intakeAttempts", normal: 3 }, "1.1.2.3": { kind: "providerFollowUps", normal: 3 }, "1.1.2.4F": { kind: "providerFollowUps", normal: 3 },
                "1.1.2.4P": { kind: "providerFollowUps", normal: 3 }, "1.1.3.4": { kind: "authDenials", normal: 2 }, "1.1.3.5": { kind: "authDenials", normal: 2 },
                "1.1.3.6": { kind: "authDenials", normal: 2 }, "1.1.4.1": { kind: "calls", normal: 5 } } as Record<string, { kind: string; normal: number }>,
    confirmed: false,
  },
  // CR-12 ball in court: our follow-up counts as "on cadence" if our last action is within this many business days. PROPOSED (AS-16).
  ball: { providerCadenceBd: 3, payerCadenceBd: 5, patientCadenceBd: 2, callsMeanPatient: 5, maxDateAheadBd: 10, confirmed: false }, // a set follow-up date counts only if in the future and ≤ maxDateAheadBd ahead (round 8)
  // Columns that record our own actions (CR-12 evidence; read by the scout's evidence export). Automation edits do not count.
  evidenceColumns: { INT: ["numeric_mm5ze82q","numeric_mm67822b","color_mm3822qq","date_mm3874an"],
    MN: ["text_mm2yd068","text_mm2y9h4a","text_mm2ymtsk","text_mm2yhpjt","text_mm2yb3rv","text_mm2ybk06","color_mm35v6a0","date_mm35kbkj","color_mm1wz0vg"],
    INS: ["color_mm34jz1x","date_mm34m2dz"], WC: ["text_mm322fg9","color_mm38w2tk","date_mm38a7k7","color_mm1xtqvv"] } as Record<string, string[]>,
  holderThresholds: { MGR:{y:1,r:2,confirmed:true}, FINAL:{y:1,r:2,confirmed:true} },
  // Dead leads (STUCK) are counted and trended, never coloured or counted as "need action" (Brandon CR B).
  health: { yellowShare: 0.25, redShare: 0.15, minSample: 5, maxUnknownShare: 0.25, maxUnknownShareEscalation: 0 }, // maxUnknownShare PROPOSED
  // "Our-step queue" (§3.19 item 9, D-61) = a code whose waitingOn value starts with "us"; there the ball is always Us, and the Team week-ago arrow uses only these (TM-2).
  waitingOn: { // PROPOSED; † = Janelle/Emily to confirm
    "1.1.1.1":"us: processor", /*†*/ "1.1.1.2":"us: processor", "1.1.1":"us: processor",
    "1.1.2.1":"us: processor", "1.1.2.2":"us: processor", "1.1.2.3":"provider", "1.1.2.4F":"provider", "1.1.2.4P":"provider",
    "1.1.2.4":"provider", "MN-DA":"provider",
    "1.1.3.1":"us: processor", "1.1.3.2":"us: processor", "1.1.3.1+2":"us: processor", "1.1.3.3":"us: processor",
    "1.1.3.4":"payer", "1.1.3.5":"us: processor", /*†*/ "1.1.3.6":"payer", /*†*/
    "1.1.4.1":"patient", "1.1.5.1":"us: processor", "UNMAPPED":"unclassified (stuck)",
    holder: { MGR:"us: manager decision", FINAL:"us: manager decision", STUCK:"dead lead (closed)" },
    intNeedMoreInfo: "patient or referral source",
  },
  clock: "business" as "business" | "calendar",   // PROPOSED
  holidays: [ // PROPOSED: US federal (observed dates). Corey to confirm which days the company is closed.
    "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25",
    "2027-01-01","2027-01-18","2027-02-15","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-10-11","2027-11-11","2027-11-25","2027-12-24" ],
  importWindows: [ // VERIFY-1 V10: >20 items created in one UTC hour (bulk imports)
    { board:"INT", from:"2026-07-21T14:00:00Z", to:"2026-07-21T15:00:00Z" },
    { board:"INT", from:"2026-08-25T18:00:00Z", to:"2026-08-25T20:00:00Z" },
    { board:"INS", from:"2026-08-26T14:00:00Z", to:"2026-08-26T15:00:00Z" },
    { board:"WC",  from:"2026-04-29T13:00:00Z", to:"2026-04-29T14:00:00Z" },
    { board:"WC",  from:"2026-08-24T23:00:00Z", to:"2026-08-25T01:00:00Z" },
    { board:"WC",  from:"2026-08-26T16:00:00Z", to:"2026-08-26T17:00:00Z" },
  ],
  ignoreEventWindows: [] as { board: string; from: string; to: string }[], // events inside are marked bulk=true (§3.1); listed in DH-17
  bulk: { minItems: 10, windowSeconds: 5 },
  firstEventToleranceSeconds: 60, // R2: infer the pre-first-event stage only when the first event is at creation // VERIFY-2 V2: all 7 real bulks spread 1.5-3.2 s; 60 s also caught paced automation runs
  loops: { minRevisits: 2, windowBd: 28, minSpanMinutes: 2 },   // minRevisits PROPOSED

  people: [ // tier from TAXONOMY; accessKey = access.json processors key; emails are read at runtime from access.json, never stored here
    { key:"victor",   name:"Victor",   tier:"processor",  accessKey:"victor",   mondayUserIds:[] },
    { key:"masani",   name:"Masani",   tier:"processor",  accessKey:"masani",   mondayUserIds:[114240955] },
    { key:"masheke",  name:"Masheke",  tier:"processor",  accessKey:"masheke",  mondayUserIds:[98938576] },
    { key:"samantha", name:"Samantha", tier:"processor",  accessKey:"samantha", mondayUserIds:[101662208] },
    { key:"madeline", name:"Madeline", tier:"processor",  accessKey:"madeline", mondayUserIds:[103745379], outsideTaxonomy:true },
    { key:"janelle",  name:"Janelle",  tier:"manager",    accessKey:"janelle",  mondayUserIds:[102869398] },
    { key:"emily",    name:"Emily",    tier:"manager",    accessKey:null,       mondayUserIds:[] },
    { key:"corey",    name:"Corey",    tier:"leadership", accessKey:"corey",    mondayUserIds:[72781341,115091148] },
    { key:"brandon",  name:"Brandon",  tier:"leadership", accessKey:"brandon",  mondayUserIds:[75450505] },
    { key:"katie",    name:"Katie",    tier:"leadership", accessKey:"katie",    mondayUserIds:[109186258] },
    { key:"josh",     name:"Josh",     tier:"engineering",accessKey:"josh",     mondayUserIds:[100161122], sharedToken:true, excludeFromOwnership:true },
  ],
  automationUserId: -4,
  documentedOwners: { // TAXONOMY §3 (person keys); [] = no processor
    "1.1.1.1":["masani"], "1.1.1.2":[], "1.1.2.1":["masheke"], "1.1.2.2":["masheke"], "1.1.2.3":[], "1.1.2.4F":[], "1.1.2.4P":["masheke"],
    "1.1.3.1":["samantha"], "1.1.3.2":["samantha"], "1.1.3.3":["samantha"], "1.1.3.4":["samantha"], "1.1.3.5":[], "1.1.3.6":[],
    "1.1.4.1":["masani"], "1.1.5.1":[], "1.2.1":["victor"], "1.2.2":[], "1.2.3":["victor"], "1.2.4":[], "1.2.5":["masheke"],
  },
  stageManagers: { "1.1.1":"emily", "1.1.2":"janelle", "1.1.3":"janelle", "1.1.4":"emily", "1.1.5":"emily", "1.2":null },
  holderOwners: { MGR: "janelle", FINAL: "katie" }, // Brandon CR B; ASSUMPTIONS AS-04/AS-09 (same on every board)
  roleToCodes: { // access.json role key -> codes (VERIFY-0b/VERIFY-1 V12 queue definitions)
    profile:["1.1.1.1"], unverifiedReferrals:["1.1.1.1"], intakeCleanup:["1.1.1.2"],
    evaluate:["1.1.2.1"], sendRequest:["1.1.2.2"], confirmReceipt:["1.1.2.3"], chaseFax:["1.1.2.4F"], chaseParachute:["1.1.2.4P"],
    doctorAppointments:["MN-DA"], benefits:["1.1.3.1","1.1.3.2","1.1.3.1+2"], dvs:["1.1.3.1"], submitAuth:["1.1.3.3"],
    authOutstanding:["1.1.3.4"], authDenied:["1.1.3.5","1.1.3.6"], welcomeCall:["1.1.4.1"], finalConfirm:["1.1.5.1"],
    fax:["1.2.5"], updateClinicals:["1.2.5"],
    // ignored (not onboarding codes or duplicate views): subscription, patientQuestions, systemMgmt, orders,
    // assignedPatients, scheduledCalls, inSystemReferrals, chaseBenefits
  },
  callAnswererCodes: ["1.2.2"],  // access.json callAnswerers -> live owners of 1.2.2
  capacityPerWeek: {} as Record<string, number>, // optional, items/week per person key; PROPOSED none
  dataHealthBaseline: [] as { id: string; acceptedValue: number; acceptedOn: string; note: string }[],
  refreshMs: 300000, faxRefreshMs: 3600000, historyStart: "2026-03-01T00:00:00Z",
  periodDays: 28, clinicalsWindowBd: 10, attributionMatchSeconds: 120,
  complexityFloor: 1000000,   // pause fetching when monday reports less remaining budget (§5.2)
  activityPageLimit: 1000, maxConcurrentBoards: 3,
} as const;

export type OoConfig = typeof OO_CONFIG;
