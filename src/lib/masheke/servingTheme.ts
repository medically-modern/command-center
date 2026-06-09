/**
 * Maps a patient's serving type to a UI accent color.
 * Used by StepSection, CollapsiblePanel, and PatientProfileCard
 * to theme the page based on the selected patient.
 */

export type StepAccent = "blue" | "teal" | "violet" | "amber" | "emerald" | "rose";

const SERVING_ACCENT: Record<string, StepAccent> = {
  CGM: "emerald",
  "Insulin Pump": "blue",
  "Insulin Pump + CGM": "violet",
  "Supplies Only": "amber",
  "Supplies + CGM": "rose",
};

/** Return the StepSection / page accent for a patient's serving value. */
export function getServingAccent(serving?: string | null): StepAccent {
  if (serving && serving in SERVING_ACCENT) return SERVING_ACCENT[serving];
  return "blue"; // neutral default
}
