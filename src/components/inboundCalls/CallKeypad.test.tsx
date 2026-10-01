import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import CallKeypad from "./CallKeypad";
import { isDtmf, isTabMessage } from "@/lib/softphone/tabProtocol";

describe("CallKeypad — phone trees from a browser call (Josh, 2026-10-01)", () => {
  it("each key sends its tone and shows what was pressed", () => {
    const onDigit = vi.fn();
    render(<CallKeypad onDigit={onDigit} />);
    fireEvent.click(screen.getByLabelText("Key 1"));
    fireEvent.click(screen.getByLabelText("Key #"));
    expect(onDigit.mock.calls.map((c) => c[0])).toEqual(["1", "#"]);
    expect(screen.getByTestId("call-keypad").textContent).toContain("1#");
  });

  it("the keyboard's digits work too — but never while typing in a field", () => {
    const onDigit = vi.fn();
    render(
      <>
        <input aria-label="note" />
        <CallKeypad onDigit={onDigit} />
      </>,
    );
    fireEvent.keyDown(window, { key: "5" });
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "7" });
    fireEvent.keyDown(window, { key: "a" });
    expect(onDigit.mock.calls.map((c) => c[0])).toEqual(["5"]);
  });

  it("sends nothing until the call is connected", () => {
    const onDigit = vi.fn();
    render(<CallKeypad onDigit={onDigit} disabled />);
    fireEvent.click(screen.getByLabelText("Key 1"));
    fireEvent.keyDown(window, { key: "2" });
    expect(onDigit).not.toHaveBeenCalled();
  });

  it("the tab protocol carries only real keypad tones to the leader", () => {
    expect(isDtmf("1")).toBe(true);
    expect(isDtmf("12#*0")).toBe(true);
    expect(isDtmf("")).toBe(false);
    expect(isDtmf("1a")).toBe(false);
    expect(isTabMessage({ type: "cmd", cmd: "dtmf", digits: "3" })).toBe(true);
    expect(isTabMessage({ type: "cmd", cmd: "dtmf", digits: "x" })).toBe(false);
  });

  it("is wired on both live-call surfaces and through the leader tab", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(read("src/components/inboundCalls/IncomingCallHost.tsx")).toMatch(/onSendDtmf=\{phone\.sendDtmf\}/);
    expect(read("src/components/comms/CommunicationsView.tsx")).toMatch(/onSendDtmf=\{phoneCtl\.sendDtmf\}/);
    const sp = read("src/lib/softphone/softphone.ts");
    expect(sp).toMatch(/cmd: "dtmf", digits/);
    expect(sp).toMatch(/case "dtmf":\s*return this\.doSendDtmf\(c\.digits\);/);
  });
});
