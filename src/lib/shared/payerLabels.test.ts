import { describe, it, expect } from "vitest";

import {
  PAYER_BOARD,
  MEDICAL_EVALUATION_PAYER_COLUMN,
  optionsContain,
  payerOptionsOrFallback,
  withCurrentPayer,
} from "./payerLabels";
import { PRIMARY_INSURANCE_OPTIONS as WC_FALLBACK } from "../welcomeCall/workflow";
import { PRIMARY_INSURANCE_OPTIONS as FC_FALLBACK } from "../finalConfirm/workflow";
import { PRIMARY_INSURANCE_OPTIONS as SUB_FALLBACK } from "../subscription/workflow";
import { PRIMARY_INSURANCE_INDEX as INSURANCE_FALLBACK } from "../samantha/hcpcRules";

/**
 * Payer label indexes, read from each board's live `settings_str` on
 * **2026-09-16**. These are the facts the fallback tables are supposed to
 * mirror; re-read the boards before changing any of them.
 */
const LIVE = {
  welcomeCall: { 7: "Health Plans Inc (PHCS)", 108: "Fidelis Medicare" },
  insurance: { 7: "Health Plans Inc (PHCS)", 108: "Fidelis Medicare" },
  medicalEvaluation: { 7: "Fidelis Medicare", 108: "Health Plans Inc (PHCS)" },
  subscription: { 106: "United Low-Cost", 159: "Health Plans Inc (PHCS)" },
} as const;

describe("the payer board registry", () => {
  it("names a distinct board+column per slice", () => {
    const keys = Object.values(PAYER_BOARD).map((b) => `${b.boardId}:${b.columnId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * ⚠️ Medical Evaluation shares `color_mm1x157j` with Insurance and Welcome
   * Call and numbers its labels DIFFERENTLY — 7 and 108 are exactly swapped.
   * Sharing a column id is what makes folding the three into one table look
   * reasonable, and it is the thing that must never happen.
   */
  it("keeps Medical Evaluation OUT, because it shares a column id but not the numbering", () => {
    const registered = Object.values(PAYER_BOARD).map((b) => b.boardId);
    expect(registered).not.toContain(MEDICAL_EVALUATION_PAYER_COLUMN.boardId);

    expect(MEDICAL_EVALUATION_PAYER_COLUMN.columnId).toBe(PAYER_BOARD.insurance.columnId);
    expect(MEDICAL_EVALUATION_PAYER_COLUMN.columnId).toBe(PAYER_BOARD.welcomeCall.columnId);

    expect(LIVE.medicalEvaluation[7]).not.toBe(LIVE.insurance[7]);
    expect(LIVE.medicalEvaluation[108]).not.toBe(LIVE.insurance[108]);
    expect(LIVE.medicalEvaluation[7]).toBe(LIVE.insurance[108]);
    expect(LIVE.medicalEvaluation[108]).toBe(LIVE.insurance[7]);
  });
});

describe("the hardcoded fallbacks mirror their own board", () => {
  const labelAt = (opts: readonly { index: number; label: string }[], index: number) =>
    opts.find((o) => o.index === index)?.label;

  /**
   * ⚠️ THE REGRESSION THIS FILE EXISTS FOR.
   *
   * `United Healthcare Commercial` is a label on NO Monday board. It sat at
   * index 7 in both Welcome Call tables and in the Insurance index map. While
   * slot 7 was empty Monday dropped the write and it looked harmless; when
   * "Health Plans Inc (PHCS)" was created into slot 7 on 2026-09-11 the same
   * click began writing a real, WRONG payer with a green toast.
   *
   * `pos.test.ts` could not catch it — it asserts Welcome Call and Final
   * Confirm agree with EACH OTHER, and both carried the identical wrong row.
   */
  it("carries no label that exists on no board", () => {
    for (const [name, table] of [
      ["welcomeCall", WC_FALLBACK],
      ["finalConfirm", FC_FALLBACK],
      ["subscription", SUB_FALLBACK],
    ] as const) {
      expect(table.map((o) => o.label), name).not.toContain("United Healthcare Commercial");
    }
    expect(Object.keys(INSURANCE_FALLBACK)).not.toContain("United Healthcare Commercial");
  });

  it("puts the board's own label at index 7 on Welcome Call", () => {
    expect(labelAt(WC_FALLBACK, 7)).toBe(LIVE.welcomeCall[7]);
    expect(labelAt(FC_FALLBACK, 7)).toBe(LIVE.welcomeCall[7]);
  });

  it("puts the board's own label at index 108 on Welcome Call", () => {
    expect(labelAt(WC_FALLBACK, 108)).toBe(LIVE.welcomeCall[108]);
    expect(labelAt(FC_FALLBACK, 108)).toBe(LIVE.welcomeCall[108]);
  });

  it("agrees with the Insurance board on the two contested indexes", () => {
    expect(INSURANCE_FALLBACK[LIVE.insurance[108] as never]).toBe(108);
  });

  it("offers the Subscription labels a rep could previously read but never set", () => {
    expect(labelAt(SUB_FALLBACK, 106)).toBe(LIVE.subscription[106]);
    expect(labelAt(SUB_FALLBACK, 159)).toBe(LIVE.subscription[159]);
  });

  /* An index appearing twice means one of the two can never be selected. */
  it("uses each index at most once per board", () => {
    for (const [name, table] of [
      ["welcomeCall", WC_FALLBACK],
      ["finalConfirm", FC_FALLBACK],
      ["subscription", SUB_FALLBACK],
    ] as const) {
      const idx = table.map((o) => o.index);
      expect(new Set(idx).size, name).toBe(idx.length);
    }
  });
});

describe("payerOptionsOrFallback", () => {
  const fallback = [{ index: 1, label: "Fallback Payer" }];

  it("prefers the board's list", () => {
    const live = [{ index: 9, label: "Board Payer" }];
    expect(payerOptionsOrFallback(live, fallback)).toEqual(live);
  });

  /* ⚠️ Never an empty select: a rep who cannot record a payer cannot finish the
     stage, which is worse than a list that is one entry short (§5.33). */
  it("falls back rather than rendering nothing", () => {
    expect(payerOptionsOrFallback([], fallback)).toEqual(fallback);
  });

  it("copies the fallback, so a caller cannot mutate the shared table", () => {
    const out = payerOptionsOrFallback([], fallback);
    out.push({ index: 2, label: "Injected" });
    expect(fallback).toHaveLength(1);
  });
});

describe("withCurrentPayer", () => {
  const options = [{ index: 1, label: "Known" }];

  /**
   * ⚠️ Without this, a patient whose payer is real but absent from the list
   * renders as the empty placeholder — the §5.11 blank-with-no-error — and the
   * rep's next save silently writes whatever they pick instead.
   */
  it("re-admits a value the list does not offer, at the index the ITEM holds", () => {
    expect(withCurrentPayer(options, "Health Plans Inc (PHCS)", 7)).toEqual([
      { index: 1, label: "Known" },
      { index: 7, label: "Health Plans Inc (PHCS)" },
    ]);
  });

  it("leaves a value the list already offers alone", () => {
    expect(withCurrentPayer(options, "Known", 1)).toEqual(options);
  });

  /* A label with no index cannot be written back, so offering it would be a
     control whose selection silently does nothing. */
  it("does not invent an entry when the item carries no index", () => {
    expect(withCurrentPayer(options, "Health Plans Inc (PHCS)", null)).toEqual(options);
    expect(withCurrentPayer(options, "Health Plans Inc (PHCS)", undefined)).toEqual(options);
    expect(withCurrentPayer(options, "Health Plans Inc (PHCS)", NaN)).toEqual(options);
  });

  it("ignores a blank or whitespace-only payer", () => {
    expect(withCurrentPayer(options, "", 7)).toEqual(options);
    expect(withCurrentPayer(options, "   ", 7)).toEqual(options);
    expect(withCurrentPayer(options, null, 7)).toEqual(options);
  });

  /* Index 0 is a real Monday label slot — Subscription's "Medicare A&B". */
  it("treats index 0 as a real index, not as absent", () => {
    expect(withCurrentPayer(options, "Medicare A&B", 0)).toEqual([
      { index: 1, label: "Known" },
      { index: 0, label: "Medicare A&B" },
    ]);
  });
});

describe("optionsContain", () => {
  it("matches exactly — two casings are a genuine board mismatch", () => {
    const options = [{ index: 3, label: "Magnacare" }];
    expect(optionsContain(options, "Magnacare")).toBe(true);
    expect(optionsContain(options, "MagnaCare")).toBe(false);
  });
});
