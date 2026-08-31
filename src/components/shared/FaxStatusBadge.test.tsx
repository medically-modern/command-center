/**
 * The badge's two jobs: appear only for a real failure, and actually SAY why.
 *
 * The second one is not decoration. It shipped with a `title` attribute and the
 * reason was reported as "not showing on hover" — the native tooltip is slow and
 * easy to miss, so the fix-the-number vs. just-re-send distinction never reached
 * anyone. These pin that the reason is in the DOM and reachable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildFaxOutcomes, type RcFaxRecord } from "@/lib/fax/faxOutcome";

const outcomesRef: { current: ReturnType<typeof buildFaxOutcomes> | null } = { current: null };
vi.mock("@/hooks/useFaxOutcomes", () => ({
  useFaxOutcomes: () => ({ outcomes: outcomesRef.current, loading: false, error: null }),
}));

import { FaxStatusBadge } from "./FaxStatusBadge";

/** Denise Schermerhorn's doctor (Jennifer Guess) — the real reported record. */
const lineBusy: RcFaxRecord = {
  messageStatus: "SendingFailed",
  creationTime: "2026-08-28T20:06:17.000Z",
  lastModifiedTime: "2026-08-28T20:12:00.000Z",
  to: [{ phoneNumber: "+16026333841", messageStatus: "SendingFailed", faxErrorCode: "LineBusy" }],
};
const wrongNumber: RcFaxRecord = {
  messageStatus: "SendingFailed",
  creationTime: "2026-08-28T18:00:00.000Z",
  lastModifiedTime: "2026-08-28T18:05:00.000Z",
  to: [{ phoneNumber: "+19724066715", messageStatus: "SendingFailed", faxErrorCode: "WrongNumber" }],
};
const sent: RcFaxRecord = {
  messageStatus: "Sent",
  creationTime: "2026-08-28T14:00:00.000Z",
  lastModifiedTime: "2026-08-28T14:04:00.000Z",
  to: [{ phoneNumber: "+17186136948", messageStatus: "Sent" }],
};

describe("FaxStatusBadge", () => {
  beforeEach(() => {
    outcomesRef.current = buildFaxOutcomes([lineBusy, wrongNumber, sent]);
  });

  it("shows for a doctor whose last fax failed", () => {
    render(<FaxStatusBadge doctorFax="6026333841@rcfax.com" />);
    expect(screen.getByText("Fax Bad")).toBeInTheDocument();
  });

  it("stays silent for a fax that went through, a doctor with no fax, and no data", () => {
    const { container, rerender } = render(<FaxStatusBadge doctorFax="7186136948@rcfax.com" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<FaxStatusBadge doctorFax="" />);
    expect(container).toBeEmptyDOMElement();
    outcomesRef.current = null;
    rerender(<FaxStatusBadge doctorFax="6026333841@rcfax.com" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reveals the reason and what to do about it", async () => {
    render(<FaxStatusBadge doctorFax="6026333841@rcfax.com" />);
    fireEvent.focus(screen.getByText("Fax Bad"));
    await waitFor(() => expect(screen.getAllByText("Line busy").length).toBeGreaterThan(0));
    // A busy line is the phone being the phone — re-send, don't edit the record.
    expect(screen.getAllByText(/The line was busy/)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/^Re-send it\.$/)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/\(602\) 633-3841/)[0]).toBeInTheDocument();
  });

  it("tells a wrong number apart from a busy one — fix the record, not a re-send", async () => {
    render(<FaxStatusBadge doctorFax="9724066715@rcfax.com" />);
    fireEvent.focus(screen.getByText("Fax Bad"));
    await waitFor(() => expect(screen.getAllByText("Wrong number").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Check the fax number on the doctor record/)[0]).toBeInTheDocument();
  });
});
