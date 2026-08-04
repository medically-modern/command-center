import { describe, expect, it } from "vitest";
import { fmtPhone, senderColor, senderName } from "./format";

const TEAM = [
  "josh@medicallymodern.com",
  "katie@medicallymodern.com",
  "janelle@medicallymodern.com",
  "brandon@medicallymodern.com",
  "corey@medicallymodern.com",
  "masheke@medicallymodern.com",
  "samantha@medicallymodern.com",
  "madeline@medicallymodern.com",
];

describe("senderColor", () => {
  // The whole point of colouring bubbles. Two people sharing a colour is worse
  // than no colours, because the thread reads as one person — which is exactly
  // what hashing 8 people into 8 buckets produced.
  it("gives every listed teammate a DISTINCT colour", () => {
    const colors = TEAM.map(senderColor);
    expect(new Set(colors).size).toBe(TEAM.length);
  });

  it("is stable for the same person across calls", () => {
    for (const e of TEAM) expect(senderColor(e)).toBe(senderColor(e));
  });

  it("ignores case and surrounding whitespace, so one person is one colour", () => {
    expect(senderColor("  JOSH@MedicallyModern.com ")).toBe(senderColor("josh@medicallymodern.com"));
  });

  // A new hire must never render colourless while waiting to be added.
  it("still colours someone who isn't on the roster", () => {
    const c = senderColor("newperson@medicallymodern.com");
    expect(c).toMatch(/^bg-/);
    expect(c).not.toBe("bg-primary");
  });

  it("keeps unlisted senders off the assigned block, so they don't shadow a teammate", () => {
    const teamColors = new Set(TEAM.map(senderColor));
    for (const e of ["a@medicallymodern.com", "zz@medicallymodern.com", "q.t@medicallymodern.com"]) {
      expect(teamColors.has(senderColor(e)), e).toBe(false);
    }
  });

  it("falls back to a neutral colour when there is no sender at all", () => {
    expect(senderColor("")).toBe("bg-primary");
  });
});

describe("senderName", () => {
  it("drops the domain so bubbles read as people", () => {
    expect(senderName("josh@medicallymodern.com")).toBe("Josh");
    expect(senderName("katie@medicallymodern.com")).toBe("Katie");
  });

  it("expands dotted and hyphenated locals into a readable name", () => {
    expect(senderName("mary.jane@medicallymodern.com")).toBe("Mary Jane");
    expect(senderName("anne-marie@medicallymodern.com")).toBe("Anne Marie");
  });

  it("returns empty rather than something odd when there's no address", () => {
    expect(senderName("")).toBe("");
  });
});

describe("fmtPhone", () => {
  it("formats US numbers and leaves anything else recognisable", () => {
    expect(fmtPhone("+13475037148")).toBe("(347) 503-7148");
    expect(fmtPhone("3475037148")).toBe("(347) 503-7148");
    expect(fmtPhone("")).toBe("Unknown");
  });
});
