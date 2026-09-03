import { describe, it, expect, vi, beforeEach } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

import { refuseLongTextOverflow } from "./longTextGuard";
import { MONDAY_LONG_TEXT_MAX } from "@/lib/shared/longText";

describe("refuseLongTextOverflow", () => {
  beforeEach(() => toastError.mockClear());

  it("lets a body at exactly the cap through, silently", () => {
    expect(refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX), "MN Workflow Notes")).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("refuses one character over and tells the rep how far over, naming the column", () => {
    expect(refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX + 1), "MN Workflow Notes")).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    const [title, opts] = toastError.mock.calls[0] as [string, { description: string }];
    expect(title).toBe("MN Workflow Notes not saved");
    expect(opts.description).toMatch(/1 character over/);
    expect(opts.description).toMatch(/nothing was saved/);
  });

  it("reports the exact overflow so 'trim about N' is actionable", () => {
    refuseLongTextOverflow("x".repeat(MONDAY_LONG_TEXT_MAX + 137), "Reference Notes");
    const [, opts] = toastError.mock.calls[0] as [string, { description: string }];
    expect(opts.description).toMatch(/137 characters over/);
  });
});
