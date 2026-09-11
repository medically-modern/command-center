/**
 * The "whose number is this" dropdown must be a CONTROLLED select.
 *
 * Brandon, 2026-09-11: *"the UI can show a selection, but the backend doesn't
 * register it — I have Patient selected, but at the bottom it's saying select
 * patient/caregiver; I have to change selection and change it back for it to
 * register."* The same defect made the caregiver panel need a toggle to Patient
 * and back before it would open.
 *
 * Cause: `value={slot.owner || undefined}`. Radix reads `undefined` as
 * "uncontrolled" and keeps its own internal answer, so the trigger can display
 * a choice the page never kept. The first test below reproduces exactly that
 * divergence against a component written the old way, so the regression cannot
 * come back looking like a style preference; the second pins the real one.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect } from "vitest";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* jsdom has neither, and Radix Select calls both. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).scrollIntoView = () => {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Element.prototype as any).hasPointerCapture = () => false;

async function pick(label: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(await screen.findByText(label));
  });
}

/** `swallow` stands in for anything that drops the parent's update. */
function Harness({ uncontrolled, swallow }: { uncontrolled: boolean; swallow: boolean }) {
  const [owner, setOwner] = useState("");
  return (
    <div>
      <Select
        value={uncontrolled ? owner || undefined : owner}
        onValueChange={(v) => setOwner(swallow ? "" : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Patient or caregiver" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="patient">Patient</SelectItem>
          <SelectItem value="caregiver">Caregiver</SelectItem>
        </SelectContent>
      </Select>
      <div data-testid="state">{owner === "" ? "EMPTY" : owner}</div>
    </div>
  );
}

describe("the owner dropdown", () => {
  it("REPRODUCES the reported bug when written the old way", () => {
    render(<Harness uncontrolled swallow />);
    return pick("Patient").then(() => {
      // The screen says Patient; the page holds nothing. That gap is what the
      // send gate was reading, and why the reason under the button persisted.
      expect(screen.getByRole("combobox").textContent).toContain("Patient");
      expect(screen.getByTestId("state").textContent).toBe("EMPTY");
    });
  });

  it("cannot diverge once controlled — the box shows what the page holds", async () => {
    render(<Harness uncontrolled={false} swallow />);
    await pick("Patient");
    expect(screen.getByTestId("state").textContent).toBe("EMPTY");
    // Controlled: with the parent holding "", the trigger falls back to the
    // placeholder rather than inventing an answer.
    // ⚠️ Compared exactly — the placeholder itself contains the word "Patient",
    // so a `not.toContain("Patient")` would fail on the correct behaviour.
    expect(screen.getByRole("combobox").textContent).toBe("Patient or caregiver");
  });

  it("still shows the placeholder while the answer is blank", () => {
    render(<Harness uncontrolled={false} swallow={false} />);
    // Radix's own `shouldShowPlaceholder` treats "" and undefined alike, so
    // fixing the control costs nothing on screen.
    expect(screen.getByRole("combobox").textContent).toContain("Patient or caregiver");
  });

  it("registers the very first pick", async () => {
    render(<Harness uncontrolled={false} swallow={false} />);
    await pick("Caregiver");
    expect(screen.getByTestId("state").textContent).toBe("caregiver");
  });
});

describe("PhoneSlotsSection source", () => {
  it("never hands the owner select an undefined value", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync("src/components/welcomeCall/PhoneSlotsSection.tsx", "utf8"),
    );
    expect(src).toContain("<Select value={slot.owner}");
    // ⚠️ The JSX attribute form specifically — the comment above that line
    // quotes the bad pattern on purpose, and must not fail its own test.
    expect(src).not.toContain("value={slot.owner || undefined}");
  });
});
