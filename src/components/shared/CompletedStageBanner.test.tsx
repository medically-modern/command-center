// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CompletedStageBanner } from "./CompletedStageBanner";

const fetchStageCompletedAt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/systemMgmt/mondayApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/systemMgmt/mondayApi")>(
    "@/lib/systemMgmt/mondayApi",
  );
  return { ...actual, fetchStageCompletedAt };
});

function at(url: string, patientId?: string | null) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CompletedStageBanner patientId={patientId} />
    </MemoryRouter>,
  );
}

const MN_URL = "/evaluate?patientId=111&completedStage=18406060017";

describe("CompletedStageBanner", () => {
  // No mock reset between tests, deliberately: clearing a mock whose
  // implementation returns a rejected promise makes Vitest report that
  // (component-handled) rejection as an unhandled one. Each test sets its own
  // implementation instead, and the call-count check below is written to not
  // care what ran before it.
  it("renders nothing on an ordinary role page", () => {
    const callsBefore = fetchStageCompletedAt.mock.calls.length;
    const { container } = at("/evaluate?patientId=111");
    expect(container).toBeEmptyDOMElement();
    expect(fetchStageCompletedAt.mock.calls).toHaveLength(callsBefore);
  });

  it("names the finished board and when it was marked complete", async () => {
    fetchStageCompletedAt.mockResolvedValue("2026-05-04T03:59:19.000Z");
    at(MN_URL, "111");

    expect(fetchStageCompletedAt).toHaveBeenCalledWith(18406060017, "111");
    await waitFor(() =>
      expect(screen.getByText(/May 3, 2026 at 11:59 PM ET/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Medical Evaluation is complete/)).toBeInTheDocument();
    expect(
      screen.getByText(/the data the rep filled out at this stage/),
    ).toBeInTheDocument();
  });

  it("says the date is unavailable rather than guessing one", async () => {
    // Monday prunes activity by plan retention, so an old completion has no
    // timestamp anywhere — the banner still has to explain what the page is.
    fetchStageCompletedAt.mockResolvedValue(null);
    at("/benefits?patientId=222&completedStage=18410601299");

    await waitFor(() =>
      expect(screen.getByText(/completion date unavailable/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Insurance is complete/)).toBeInTheDocument();
  });

  it("goes away when the rep picks a LIVE patient off the sidebar", () => {
    // ?patientId survives the click, so keying only off the URL would leave a
    // "this stage is finished" banner (and a disabled Send) on a patient who
    // still needs working.
    fetchStageCompletedAt.mockResolvedValue("2026-05-04T03:59:19.000Z");
    const { container } = at(MN_URL, "999");
    expect(container).toBeEmptyDOMElement();
  });

  it("holds the review view while the deep-linked patient is still loading", async () => {
    fetchStageCompletedAt.mockResolvedValue("2026-05-04T03:59:19.000Z");
    at(MN_URL, null); // nothing selected yet — injection is one poll away
    await waitFor(() =>
      expect(screen.getByText(/Medical Evaluation is complete/)).toBeInTheDocument(),
    );
  });

  it("still explains the page when the lookup fails outright", async () => {
    fetchStageCompletedAt.mockImplementation(async () => {
      throw new Error("Monday request failed (500)");
    });
    at("/welcome-call?patientId=333&completedStage=18410804557");

    await waitFor(() =>
      expect(screen.getByText(/completion date unavailable/)).toBeInTheDocument(),
    );
  });
});
