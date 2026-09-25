/**
 * `useReportsData` — three one-shot reads, each failing on its own (§5.52).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const api = vi.hoisted(() => ({
  fetchSubscriptionRows: vi.fn(),
  fetchFormLeadRows: vi.fn(),
  fetchOrderRows: vi.fn(),
}));
vi.mock("@/lib/reports/reportsApi", () => api);

import { useReportsData } from "./useReportsData";

beforeEach(() => {
  api.fetchSubscriptionRows.mockReset();
  api.fetchFormLeadRows.mockReset();
  api.fetchOrderRows.mockReset();
});

describe("useReportsData", () => {
  it("runs the three reads once on mount and reports each answer", async () => {
    api.fetchSubscriptionRows.mockResolvedValue([{ status: "Active", daysToOrder: "", mr: "" }]);
    api.fetchFormLeadRows.mockResolvedValue([]);
    api.fetchOrderRows.mockResolvedValue([]);
    const { result } = renderHook(() => useReportsData());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subscriptions.data).toHaveLength(1);
    expect(result.current.formLeads.data).toEqual([]);
    expect(result.current.orders.data).toEqual([]);
    expect(api.fetchOrderRows).toHaveBeenCalledTimes(1);
  });

  it("one failed read takes out one tile and leaves the other two", async () => {
    api.fetchSubscriptionRows.mockResolvedValue([]);
    api.fetchFormLeadRows.mockRejectedValue(new Error("HTTP 503"));
    api.fetchOrderRows.mockResolvedValue([]);
    const { result } = renderHook(() => useReportsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.formLeads).toEqual({ data: null, error: "HTTP 503", loading: false });
    expect(result.current.subscriptions.error).toBeNull();
    expect(result.current.orders.error).toBeNull();
  });

  it("a failed REFRESH keeps the previous answer beside its error", async () => {
    api.fetchSubscriptionRows.mockResolvedValueOnce([{ status: "Active", daysToOrder: "", mr: "" }]);
    api.fetchFormLeadRows.mockResolvedValue([]);
    api.fetchOrderRows.mockResolvedValue([]);
    const { result } = renderHook(() => useReportsData());
    await waitFor(() => expect(result.current.subscriptions.data).toHaveLength(1));
    api.fetchSubscriptionRows.mockRejectedValueOnce(new Error("timeout"));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.subscriptions.error).toBe("timeout"));
    expect(result.current.subscriptions.data).toHaveLength(1);
    expect(api.fetchSubscriptionRows).toHaveBeenCalledTimes(2);
  });

  it("⚠️ never polls — no timer anywhere in the hook, the reads or the page", () => {
    const src = (p: string) => readFileSync(join(__dirname, "../../", p), "utf8");
    for (const f of ["hooks/reports/useReportsData.ts", "lib/reports/reportsApi.ts", "pages/OperationsPage.tsx"]) {
      expect(src(f), f).not.toMatch(/setInterval|setTimeout/);
    }
  });
});
