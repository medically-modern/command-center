import { describe, it, expect } from "vitest";
import { PORTAL_METHODS, isPortalMethod } from "./requestDelivery";
import { PARACHUTE_ROLE_METHODS, isParachuteRoleMethod } from "./chaseMethods";

/** The four live labels on `color_mm1xw7y5`, plus the blank the board allows. */
const LIVE_METHODS = ["Fax", "Parachute", "Email", "Dashboard", ""] as const;

describe("which requests a portal carries", () => {
  it("is Parachute and Dashboard", () => {
    expect(isPortalMethod("Parachute")).toBe(true);
    expect(isPortalMethod("Dashboard")).toBe(true);
  });

  it("is not Fax, blank, or a method we do not recognise", () => {
    expect(isPortalMethod("Fax")).toBe(false);
    expect(isPortalMethod("")).toBe(false);
    expect(isPortalMethod(null)).toBe(false);
    expect(isPortalMethod(undefined)).toBe(false);
    expect(isPortalMethod("Carrier pigeon")).toBe(false);
  });

  it("trims, like the queue rule beside it", () => {
    expect(isPortalMethod("  Dashboard  ")).toBe(true);
  });
});

/**
 * ⚠️ The whole reason this module is separate from `chaseMethods.ts`. If these
 * two assertions ever fail together, somebody has merged the sets — and the
 * cost is silent: Email patients would stop passing through Confirm Receipt.
 */
describe("it is NOT the chase-queue set", () => {
  it("Email is in the queue and not in the portal set", () => {
    expect(isParachuteRoleMethod("Email")).toBe(true);
    expect(isPortalMethod("Email")).toBe(false);
  });

  it("the two lists are genuinely different", () => {
    expect([...PORTAL_METHODS].sort()).not.toEqual([...PARACHUTE_ROLE_METHODS].sort());
  });

  it("every portal method is worked in the parachute role — the portal set is the narrower one", () => {
    for (const m of PORTAL_METHODS) expect(isParachuteRoleMethod(m)).toBe(true);
  });
});

describe("every live board label gets an answer", () => {
  it.each(LIVE_METHODS)("%s", (m) => {
    expect(typeof isPortalMethod(m)).toBe("boolean");
    // A portal method never goes through Confirm Receipt; everything else does.
    if (isPortalMethod(m)) expect(isParachuteRoleMethod(m)).toBe(true);
  });
});
