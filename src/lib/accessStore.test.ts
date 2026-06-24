import { describe, it, expect } from "vitest";
import { resolveAccess, type AccessConfig } from "./accessStore";

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
    expect(resolveAccess("anyone@x.com", { managers: [], processors: {} }).type).toBe("manager");
  });

  it("is case-insensitive on the email", () => {
    expect(resolveAccess("JOSH@medicallymodern.com", cfg).type).toBe("manager");
    expect(resolveAccess("Madd@MedicallyModern.com", cfg).type).toBe("processor");
  });
});
