import { describe, it, expect } from "vitest";
import {
  MAX_CALL_ANSWERERS,
  canAnswerCalls,
  configWithoutEmail,
  resolveAccess,
  withCallAnswerer,
  type AccessConfig,
} from "./accessStore";

const cfg: AccessConfig = {
  managers: ["josh@medicallymodern.com"],
  processors: {
    // Dual: also a manager, with a processor profile (roles + filters + order)
    "josh@medicallymodern.com": {
      name: "Josh",
      roles: ["evaluate"],
      roleFilters: { evaluate: "all" },
      roleOrder: { evaluate: 1 },
    },
    "madd@medicallymodern.com": { name: "Madd", roles: ["chaseFax"] },
  },
  callAnswerers: ["madd@medicallymodern.com"],
};

describe("resolveAccess (dual manager + processor)", () => {
  it("a dual person logs into the MANAGER view", () => {
    expect(resolveAccess("josh@medicallymodern.com", cfg).type).toBe("manager");
  });

  it("a pure processor resolves to processor with their profile", () => {
    const a = resolveAccess("madd@medicallymodern.com", cfg);
    expect(a.type).toBe("processor");
    if (a.type === "processor") expect(a.profile.roles).toEqual(["chaseFax"]);
  });

  it("an unlisted email gets no access", () => {
    expect(resolveAccess("nobody@medicallymodern.com", cfg).type).toBe("none");
  });

  it("bootstrap: while there are no managers, everyone is a manager", () => {
    expect(resolveAccess("anyone@x.com", { managers: [], processors: {}, callAnswerers: [] }).type).toBe("manager");
  });

  it("is case-insensitive on the email", () => {
    expect(resolveAccess("JOSH@medicallymodern.com", cfg).type).toBe("manager");
    expect(resolveAccess("Madd@MedicallyModern.com", cfg).type).toBe("processor");
  });
});

describe("browser-answering slots (§5.13b) — assigned by a manager, capped at RingCentral's five", () => {
  it("canAnswerCalls is membership, case-insensitive, and never true for nobody", () => {
    expect(canAnswerCalls("Madd@MedicallyModern.com", cfg)).toBe(true);
    expect(canAnswerCalls("josh@medicallymodern.com", cfg)).toBe(false);
    expect(canAnswerCalls("", cfg)).toBe(false);
    expect(canAnswerCalls("madd@medicallymodern.com", { ...cfg, callAnswerers: undefined as unknown as string[] })).toBe(false);
  });

  it("adds and removes without touching anything else", () => {
    const added = withCallAnswerer(cfg, "Josh@medicallymodern.com", true)!;
    expect(added.callAnswerers).toEqual(["madd@medicallymodern.com", "josh@medicallymodern.com"]);
    expect(added.managers).toBe(cfg.managers);
    expect(added.processors).toBe(cfg.processors);
    const removed = withCallAnswerer(added, "madd@medicallymodern.com", false)!;
    expect(removed.callAnswerers).toEqual(["josh@medicallymodern.com"]);
  });

  it("is a no-op when nothing changes", () => {
    expect(withCallAnswerer(cfg, "madd@medicallymodern.com", true)).toBe(cfg);
    expect(withCallAnswerer(cfg, "nobody@medicallymodern.com", false)).toBe(cfg);
    expect(withCallAnswerer(cfg, "   ", true)).toBe(cfg);
  });

  it("refuses the sixth — null, and nothing written", () => {
    let c: AccessConfig = { ...cfg, callAnswerers: [] };
    for (let i = 0; i < MAX_CALL_ANSWERERS; i++) c = withCallAnswerer(c, `p${i}@medicallymodern.com`, true)!;
    expect(c.callAnswerers).toHaveLength(MAX_CALL_ANSWERERS);
    expect(withCallAnswerer(c, "sixth@medicallymodern.com", true)).toBeNull();
    // Someone already in stays in — re-adding is not an add.
    expect(withCallAnswerer(c, "p0@medicallymodern.com", true)).toBe(c);
    // And a removal always works, however full.
    expect(withCallAnswerer(c, "p0@medicallymodern.com", false)!.callAnswerers).toHaveLength(MAX_CALL_ANSWERERS - 1);
  });

  it("the cap is RingCentral's five, not a number somebody can drift", () => {
    expect(MAX_CALL_ANSWERERS).toBe(5);
  });

  it("removing a person frees their slot along with their roles", () => {
    const c = configWithoutEmail(cfg, "MADD@medicallymodern.com");
    expect(c.callAnswerers).toEqual([]);
    expect(c.processors["madd@medicallymodern.com"]).toBeUndefined();
    expect(c.managers).toEqual(cfg.managers);
  });
});
