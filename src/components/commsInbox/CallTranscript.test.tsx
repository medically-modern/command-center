import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fetchCallTranscript = vi.fn();
vi.mock("@/lib/commsInbox/api", () => ({ fetchCallTranscript: (id: string) => fetchCallTranscript(id) }));

import CallTranscript from "./CallTranscript";
import { speakerNames } from "@/lib/commsInbox/transcript";

describe("CallTranscript (§5.47e)", () => {
  it("fetches only when opened, and shows speakers in order of first appearance", async () => {
    fetchCallTranscript.mockResolvedValue({
      state: "done",
      turns: [
        { speaker: "2", start: 1, text: "Hello" },
        { speaker: "1", start: 65, text: "Hi" },
      ],
    });
    render(<CallTranscript callId="c1" />);
    expect(fetchCallTranscript).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Transcript"));
    await waitFor(() => expect(screen.getByTestId("call-transcript").textContent).toContain("Hello"));
    expect(fetchCallTranscript).toHaveBeenCalledWith("c1");
    const text = screen.getByTestId("call-transcript").textContent || "";
    expect(text.indexOf("Speaker 1")).toBeLessThan(text.indexOf("Speaker 2"));
    expect(text).toContain("1:05");
  });

  it("says so when the load fails", async () => {
    fetchCallTranscript.mockRejectedValue(new Error("nope"));
    render(<CallTranscript callId="c2" />);
    fireEvent.click(screen.getByText("Transcript"));
    await waitFor(() => expect(screen.getByTestId("call-transcript").textContent).toContain("Couldn't load the transcript"));
  });

  it("numbers speakers by first appearance", () => {
    expect([...speakerNames([{ speaker: "7", start: 0, text: "" }, { speaker: "3", start: 0, text: "" }]).values()]).toEqual(["Speaker 1", "Speaker 2"]);
  });

  it("is shown under a call's recording in the timeline, only when one exists", () => {
    const src = readFileSync(join(process.cwd(), "src/components/commsInbox/ItemTimeline.tsx"), "utf8");
    expect(src).toMatch(/e\.hasTranscript && \(\s*<CallTranscript key=\{e\.id\} callId=\{e\.id\} answeredBy=\{e\.dir === "in" \? e\.answeredName \?\? "" : ""\} \/>/);
  });
});

describe("naming the voices on inbound calls (Josh, 2026-10-01)", () => {
  const turns = [
    { speaker: "1", start: 0, text: "Medically Modern, how can I help?" },
    { speaker: "2", start: 3, text: "Hi" },
    { speaker: "1", start: 5, text: "Sure" },
  ];
  it("⚠️ the first voice is the person who picked up, the second is the caller", () => {
    expect([...speakerNames(turns, "Victor Guerra").values()]).toEqual(["Victor", "Caller"]);
  });
  it("without an answerer (outbound, unknown) it stays Speaker 1/2", () => {
    expect([...speakerNames(turns, "").values()]).toEqual(["Speaker 1", "Speaker 2"]);
  });
  it("says the names are a guess", async () => {
    fetchCallTranscript.mockResolvedValue({ state: "done", turns });
    render(<CallTranscript callId="c9" answeredBy="Victor Guerra" />);
    fireEvent.click(screen.getByText("Transcript"));
    await waitFor(() => expect(screen.getByTestId("call-transcript").textContent).toContain("Victor"));
    expect(screen.getByTestId("call-transcript").textContent).toContain("best guess from who spoke first");
    expect(screen.getByTestId("call-transcript").textContent).toContain("Caller");
  });
});

