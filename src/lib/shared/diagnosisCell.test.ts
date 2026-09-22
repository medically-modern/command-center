import { describe, it, expect } from "vitest";
import {
  readDiagnosis,
  hasMultipleDiagnoses,
  diagnosisWriteValue,
  diagnosisExpectedText,
} from "./diagnosisCell";

describe("readDiagnosis", () => {
  it("returns a single code unchanged", () => {
    expect(readDiagnosis("E11.65")).toBe("E11.65");
  });
  it("takes the FIRST of several — a dropdown can hold more than one label, and every consumer treats diagnosis as one string", () => {
    expect(readDiagnosis("E11.65, E10.9")).toBe("E11.65");
  });
  it("is blank for blank, null and undefined", () => {
    expect(readDiagnosis("")).toBe("");
    expect(readDiagnosis(null)).toBe("");
    expect(readDiagnosis(undefined)).toBe("");
  });
  it("trims monday's spacing", () => {
    expect(readDiagnosis("  E11.65 ,E10.9 ")).toBe("E11.65");
  });
});

describe("hasMultipleDiagnoses", () => {
  it("flags a multi-label cell without changing it", () => {
    expect(hasMultipleDiagnoses("E11.65, E10.9")).toBe(true);
    expect(hasMultipleDiagnoses("E11.65")).toBe(false);
    expect(hasMultipleDiagnoses("")).toBe(false);
  });
});

describe("diagnosisWriteValue", () => {
  it("is {labels:[code]} — NOT the status column's {label: code}", () => {
    expect(diagnosisWriteValue("Z83.3")).toEqual({ labels: ["Z83.3"] });
  });
  it("clears with an empty array", () => {
    expect(diagnosisWriteValue("")).toEqual({ labels: [] });
    expect(diagnosisWriteValue(null)).toEqual({ labels: [] });
  });
  it("round-trips against what monday reads back", () => {
    const code = "Z83.3";
    expect(readDiagnosis(diagnosisExpectedText(code))).toBe(code);
  });
});
