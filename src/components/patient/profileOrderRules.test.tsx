/**
 * The Subscription profile's order rules (§5.59; Josh, 2026-10-01): the payer
 * cap on infusion sets and cartridges, the payer's max Frequency, and the
 * Cardinal stock flag on a newly picked infusion set — rendered in the REAL
 * `OrderDetailsCard`. FAKE patients only; the stock read is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const stock = vi.hoisted(() => ({ state: { index: null as Map<string, unknown> | null, loading: true, error: null as string | null } }));
vi.mock("@/hooks/welcomeCall/useInfusionStock", () => ({ useInfusionStock: () => stock.state }));

import { OrderDetailsCard, type LiveOptions } from "./SubscriptionCards";
import { EMPTY_EXTRAS, EXTRA_COL, type ExtrasEdit, type ProfileExtras } from "@/lib/subscription/profileExtras";
import { COL } from "@/lib/subscription/mondayApi";
import { indexStock } from "@/lib/welcomeCall/infusionStock";
import { etTodayYmd } from "@/lib/shared/monitorSale";
import type { Patient as SubPatient } from "@/lib/subscription/workflow";

/** The Order Frequency column's live labels and ids (settings_str, 2026-10-01). */
const FREQ = [
  { index: 6, label: "30-Days" },
  { index: 4, label: "60-Days" },
  { index: 0, label: "75-Days" },
  { index: 3, label: "90-Days" },
];
const SETS = [
  { index: 1, label: "AutoSoft 90 6 mm 23\"" },
  { index: 2, label: "TruSteel 6 mm 23\"" },
];
const live = (options: LiveOptions["options"]): LiveOptions => ({ options, ready: true, loading: false, error: null, reload: () => {} });

function Harness({ patient: start, extras }: { patient: Partial<SubPatient>; extras: Partial<ProfileExtras> }) {
  const base = { infusionSet1: "AutoSoft 90 6 mm 23\"", infusionSet1Index: 1, infusionSet2: "", infusionSet2Index: null, infQty1: "3", infQty2: "", ...start } as SubPatient;
  const [p, setP] = useState(base);
  const [edit, setEdit] = useState<ExtrasEdit>({});
  return (
    <div className="cc-pt">
      <OrderDetailsCard
        patient={p}
        saved={{ infusionSet1: base.infusionSet1, infusionSet2: base.infusionSet2 }}
        extras={{ ...EMPTY_EXTRAS, ...extras }}
        extrasEdit={edit}
        onExtras={(patch) => setEdit((e) => ({ ...e, ...patch }))}
        canEdit
        onFieldChange={(f, v) => setP((x) => ({ ...x, [f]: v }))}
        infusionOpts={live({ [COL.infusionSet1]: SETS, [COL.infusionSet2]: SETS })}
        frequencyOpts={live({ [EXTRA_COL.orderFrequency]: FREQ })}
        reorder={null}
        readOnlyName="Rep"
      />
    </div>
  );
}

const freqOptions = () =>
  [...(screen.getByLabelText("Frequency") as HTMLSelectElement).options]
    .filter((o) => o.value !== "") // the blank "—" placeholder of an empty column
    .map((o) => o.textContent);

beforeEach(() => {
  stock.state = { index: null, loading: true, error: null };
});

describe("the payer cap on the quantities", () => {
  it("Aetna Commercial: up to 4 — a 5 is refused and says why", () => {
    render(<Harness patient={{ primaryInsurance: "Aetna Commercial" }} extras={{}} />);
    const q1 = screen.getByLabelText("Inf. qty 1 · max 4") as HTMLInputElement;
    fireEvent.change(q1, { target: { value: "4" } });
    expect(q1.value).toBe("4");
    fireEvent.change(q1, { target: { value: "5" } });
    expect(q1.value).toBe("4");
    expect(screen.getByText(/Over the cap — Aetna Commercial caps infusion sets and cartridges at 4/)).toBeTruthy();
  });

  it("⚠️ Aetna MEDICARE is 3 now; Anthem Commercial and Horizon are 9", () => {
    const { unmount } = render(<Harness patient={{ primaryInsurance: "Aetna Medicare" }} extras={{}} />);
    expect(screen.getByLabelText("Inf. qty 1 · max 3")).toBeTruthy();
    unmount();
    render(<Harness patient={{ primaryInsurance: "Horizon BCBS" }} extras={{}} />);
    expect(screen.getByLabelText("Cartridges qty · max 9")).toBeTruthy();
  });

  it("flags a TOTAL over the cap, including one the board already holds", () => {
    render(<Harness patient={{ primaryInsurance: "Aetna Commercial", infQty1: "6" }} extras={{}} />);
    expect(screen.getByText(/Infusion sets add up to/).textContent).toMatch(/6 — over Aetna Commercial's 4 per order/);
  });
});

describe("the payer's max Frequency", () => {
  it("Medicaid and Fidelis Low-Cost: 30 or 60", () => {
    render(<Harness patient={{ primaryInsurance: "Fidelis Low-Cost" }} extras={{ orderFrequency: "60-Days", orderFrequencyIndex: 4 }} />);
    expect(freqOptions()).toEqual(["30-Days", "60-Days"]);
  });

  it("⚠️ a saved 90 above the max is KEPT and explained, not rewritten", () => {
    render(<Harness patient={{ primaryInsurance: "Fidelis Low-Cost" }} extras={{ orderFrequency: "90-Days", orderFrequencyIndex: 3 }} />);
    expect((screen.getByLabelText("Frequency") as HTMLSelectElement).value).toBe("3");
    expect(freqOptions()).toEqual(["30-Days", "60-Days", "90-Days"]);
    expect(screen.getByText(/Fidelis Low-Cost goes up to 60 days\. Saved before this rule/)).toBeTruthy();
  });

  it("Aetna Commercial: 30, 60 or 75 — no 90; everyone else 30, 60 or 90 — no 75", () => {
    const { unmount } = render(<Harness patient={{ primaryInsurance: "Aetna Commercial" }} extras={{}} />);
    expect(freqOptions()).toEqual(["30-Days", "60-Days", "75-Days"]);
    unmount();
    render(<Harness patient={{ primaryInsurance: "Fidelis Medicaid" }} extras={{}} />);
    expect(freqOptions()).toEqual(["30-Days", "60-Days", "90-Days"]);
  });
});

describe("the Cardinal stock flag on a newly picked set", () => {
  const rows = (status: string, qty: number | null) =>
    indexStock([{ name: "TruSteel 6 mm 23\"", qtyAvail: qty, status, lastChanged: `${etTodayYmd()} 09:05 ET` }]);

  it("no flag on the saved set — the tracker isn't even read", () => {
    render(<Harness patient={{ primaryInsurance: "Humana" }} extras={{}} />);
    expect(screen.queryByText(/Cardinal/)).toBeNull();
  });

  it("a backordered pick says it is not in stock", () => {
    stock.state = { index: rows("Backordered", 220), loading: false, error: null };
    render(<Harness patient={{ primaryInsurance: "Humana" }} extras={{}} />);
    fireEvent.change(screen.getByLabelText("Infusion set 1"), { target: { value: "2" } });
    expect(screen.getByRole("alert").textContent).toMatch(/^Not in stock — TruSteel 6 mm 23" is on backorder at Cardinal/);
  });

  it("an available pick says so, quietly", () => {
    stock.state = { index: rows("Available", 1715), loading: false, error: null };
    render(<Harness patient={{ primaryInsurance: "Humana" }} extras={{}} />);
    fireEvent.change(screen.getByLabelText("Infusion set 1"), { target: { value: "2" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/In stock at Cardinal/)).toBeTruthy();
  });
});
