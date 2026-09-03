import { describe, it, expect, vi, beforeEach } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
const capped = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/shared/columnType", () => ({ isCappedColumn: (...a: unknown[]) => capped(...a) }));

import { refuseLongTextOverflow } from "./longTextGuard";
import { MONDAY_LONG_TEXT_MAX } from "@/lib/shared/longText";

describe("refuseLongTextOverflow", () => {
  beforeEach(() => { toastError.mockClear(); capped.mockClear(); capped.mockResolvedValue(true); });

  it("lets a body at exactly the cap through, silently", async () => {
    expect(await refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX), "MN Workflow Notes")).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("refuses one character over and tells the rep how far over, naming the column", async () => {
    expect(await refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX + 1), "MN Workflow Notes")).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [title, opts] = toastError.mock.calls[0] as [string, { description: string }];
    expect(title).toBe("MN Workflow Notes not saved");
    expect(opts.description).toMatch(/1 character over/);
    expect(opts.description).toMatch(/nothing was saved/);
  });

  it("reports the exact overflow so 'trim about N' is actionable", async () => {
    await refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX + 137), "Reference Notes");
    const [, opts] = toastError.mock.calls[0] as [string, { description: string }];
    expect(opts.description).toMatch(/137 characters over/);
  });

  it("with a column ref: refuses on a capped column, asks the board once", async () => {
    const ref = { boardId: 18406060017, columnId: "long_text_mm27zjt2" };
    expect(await refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX + 5), "MN Workflow Notes", ref)).toBe(true);
    expect(capped).toHaveBeenCalledWith(18406060017, "long_text_mm27zjt2");
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("with a column ref the board reports as plain text: no refusal, no toast, whatever the length", async () => {
    capped.mockResolvedValue(false);
    expect(await refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX * 3), "MN Workflow Notes", { boardId: 1, columnId: "long_text_kept_id" })).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("without a ref the cap is assumed — the safe default", async () => {
    capped.mockResolvedValue(false); // would be exempt IF asked; it must not be asked
    expect(await refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX + 1), "Notes")).toBe(true);
    expect(capped).not.toHaveBeenCalled();
  });
});
