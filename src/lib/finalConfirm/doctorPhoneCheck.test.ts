/**
 * C30 — a blank doctor phone is flagged at Final Profile Confirmation.
 *
 * Brandon, 2026-09-10: "blank doctor phone should be flagged in final profile
 * confirmation — right now it's not being flagged and i accidentally advanced
 * a patient with it empty."
 *
 * It was invisible twice over: no check looked at the field, and the Doctor
 * Info block renders every one of its inputs with `suppressWarning`, so the
 * empty box had no ring either. Both halves moved together — the field now
 * passes `emptyTone="amber"` — and the severity is pinned here because the
 * pack's severity language is the thing that keeps it readable (§5.17): red is
 * "we believe this is wrong", amber is "a missing input". A blank number is
 * the latter, and the blank Clinic Address beside it — which Cardinal actually
 * hard-blocks on — is amber too.
 */
import { describe, it, expect } from "vitest";

import { runFinalChecks } from "./checkPack";
import type { Patient } from "./workflow";
import { basePatient } from "./checkPack.test";

const find = (p: Partial<Patient>) =>
  runFinalChecks({ ...basePatient(), ...p }).find((f) => f.id === "C30_DOCTOR_PHONE_MISSING");

describe("C30 — blank doctor phone", () => {
  it("fires when the number is missing", () => {
    expect(find({ doctorPhone: "" })).toBeTruthy();
  });

  it("is AMBER, not red — a missing input, not evidence the profile is wrong", () => {
    expect(find({ doctorPhone: "" })?.severity).toBe("amber");
  });

  it("points at the doctorPhone field, so the finding and the ring agree", () => {
    expect(find({ doctorPhone: "" })?.field).toBe("doctorPhone");
  });

  it("is silent once a number is on file", () => {
    expect(find({ doctorPhone: "5185551234" })).toBeUndefined();
  });

  it("treats whitespace as blank — a space is not a phone number", () => {
    expect(find({ doctorPhone: "   " })).toBeTruthy();
  });

  it("does not judge the FORMAT — any number present clears it", () => {
    // Deliberate scope: C30 answers "is there a number", nothing more. A
    // format rule here would need the same live-board audit C25/C26 got before
    // anyone could pick its severity.
    expect(find({ doctorPhone: "555-1234" })).toBeUndefined();
  });

  it("never blocks Send — Final Confirm is warnings-only by design", () => {
    // The pack has no blocking severity at all; the guard is that C30 stays
    // inside the existing three, so `SendWithChecksButton`'s per-finding ack
    // is what a rep sees rather than a disabled button (§5.17).
    const all = runFinalChecks({ ...basePatient(), doctorPhone: "" });
    expect(all.every((f) => ["red", "amber", "info"].includes(f.severity))).toBe(true);
  });
});
