import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasPlayableAudio, recordingSource, type ArchivedAudio } from "./archivedRecordings";
import { withRecordings } from "./recordingDownload";

const stored = (over: Partial<ArchivedAudio> = {}): ArchivedAudio => ({
  hasAudio: true,
  audioState: "stored",
  contentType: "audio/mpeg",
  bytes: 823_000,
  durationSec: 300,
  ...over,
});

const call = (id: string, contentUri?: string) => ({
  id,
  startTime: "2026-09-21T16:30:00.000Z",
  direction: "Inbound" as const,
  durationSec: 300,
  ...(contentUri ? { recording: { id: "r1", contentUri } } : {}),
});

describe("recordingSource", () => {
  // ⚠️ The whole reason this module exists: RingCentral drops the `recording`
  // object and KEEPS the row, so a purged call is indistinguishable from one
  // that was never recorded — unless something asks the archive.
  it("finds audio for a call RingCentral has already purged", () => {
    const src = recordingSource(call("c1"), { c1: stored() });
    expect(src).toEqual({ kind: "archive", callId: "c1" });
  });

  // ⚠️ Ours is free to serve, does not spend the shared RingCentral budget
  // (INCIDENT_2026-08-20), and will still be there next year.
  it("prefers OUR copy when both have it", () => {
    const src = recordingSource(call("c1", "https://media/x/content"), { c1: stored() });
    expect(src).toEqual({ kind: "archive", callId: "c1" });
  });

  // The window the archive structurally cannot cover: recorded since the last run.
  it("falls back to RingCentral for a recording we have not saved yet", () => {
    const src = recordingSource(call("c1", "https://media/x/content"), {
      c1: stored({ hasAudio: false, audioState: "pending" }),
    });
    expect(src).toEqual({ kind: "ringcentral", contentUri: "https://media/x/content" });
  });

  it("is null when neither has it", () => {
    expect(recordingSource(call("c1"), {})).toBeNull();
    expect(recordingSource(call("c1"), { c1: stored({ hasAudio: false, audioState: "gone" }) })).toBeNull();
  });

  it("treats a missing archive map as simply unknown, not as absence of audio", () => {
    expect(recordingSource(call("c1", "https://media/x/content"))).toEqual({
      kind: "ringcentral",
      contentUri: "https://media/x/content",
    });
  });
});

describe("hasPlayableAudio", () => {
  it("is what decides whether a button is drawn at all", () => {
    expect(hasPlayableAudio(call("c1"), { c1: stored() })).toBe(true);
    expect(hasPlayableAudio(call("c1", "https://media/x/content"), {})).toBe(true);
    expect(hasPlayableAudio(call("c1"), {})).toBe(false);
  });
});

describe("withRecordings", () => {
  // ⚠️ This filter runs BEFORE anything else gets a chance to look, so an
  // archive-blind version silently makes every purged recording undownloadable
  // in bulk even though the bytes are in our bucket.
  it("includes calls whose audio only exists in the archive", () => {
    const calls = [call("c1"), call("c2", "https://media/x/content"), call("c3")];
    expect(withRecordings(calls, { c1: stored() }).map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("is unchanged from its old behaviour when no archive map is passed", () => {
    const calls = [call("c1"), call("c2", "https://media/x/content")];
    expect(withRecordings(calls).map((c) => c.id)).toEqual(["c2"]);
  });
});

/* ── Source scans: the wiring whose absence is invisible on screen ─────────── */
const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("CallHistoryButton is wired to the archive", () => {
  const src = read("src/components/shared/CallHistoryButton.tsx");

  // ⚠️⚠️ THE ONE THAT MATTERS. `c.recording` is false for every purged call, so
  // leaving this gate alone means the buttons are never drawn and the fallback
  // below it can never run — the screen looks exactly as it did before the
  // archive existed.
  it("draws the buttons from playable audio, not from RingCentral's recording", () => {
    expect(src).toMatch(/\{hasPlayableAudio\(c, archived\) && \(/);
    expect(src).not.toMatch(/\{c\.recording && \(/);
  });

  it("asks the archive once per list, through the batched hook", () => {
    expect(src).toMatch(/useArchivedAudio\(callIds\)/);
    expect(src).toMatch(/useMemo\(\(\) => calls\.map\(\(c\) => c\.id\), \[calls\]\)/);
  });

  it("routes play, single save and bulk save through the same source rule", () => {
    expect(src).toMatch(/recordingSource\(call, archived\)/);
    expect(src).toMatch(/downloadRecording\(call, \{ who: display, archived \}\)/);
    expect(src).toMatch(/withRecordings\(calls, archived\)/);
  });

  // ⚠️ `summary.recorded` counts what RINGCENTRAL still has, so it falls to
  // zero on a patient whose whole history we saved — and the footer would offer
  // "Download all (0)" over a full archive.
  it("counts what is playable, not what RingCentral still holds", () => {
    expect(src).toMatch(/Download all \(\{playable\}\)/);
    expect(src).not.toMatch(/Download all \(\{summary\.recorded\}\)/);
  });

  // ⚠️ A presigned URL is not a blob URL. Revoking one is a no-op, but tracking
  // it implies we own bytes we never held.
  it("does not track the presigned URL as a blob it must revoke", () => {
    const play = src.slice(src.indexOf("const play = async"), src.indexOf("/** Save one recording"));
    const archiveBranch = play.slice(play.indexOf('source.kind === "archive"'), play.indexOf("fetchRecordingBlobUrl"));
    expect(archiveBranch).not.toMatch(/blobs\.current\.push/);
  });
});

describe("the Comms Hub Phone tab is wired the same way", () => {
  const src = read("src/components/commsHub/PhonePanel.tsx");

  // ⚠️ Half the places a rep reaches a recording is not "wired". This panel has
  // its own per-row and bulk download, so leaving it on `r.recording` means a
  // purged call shows nothing here while showing fine in the Calls pop-up.
  it("draws its download button from playable audio", () => {
    expect(src).toMatch(/\{hasPlayableAudio\(toDownloadable\(r\), archived\) && \(/);
    expect(src).not.toMatch(/\{r\.recording && \(/);
  });

  it("passes the archive through both download paths", () => {
    expect(src).toMatch(/withRecordings\(shownCalls\.map\(toDownloadable\), archived\)/);
    expect(src).toMatch(/archived,/);
  });

  // ⚠️ Keyed on the whole list, not the filtered one: flipping Missed or Today
  // must not re-ask about calls we already have an answer for.
  it("asks about the whole list, not the filtered one", () => {
    expect(src).toMatch(/const allCallIds = useMemo\(\(\) => rows\.map\(\(r\) => r\.id\), \[rows\]\)/);
    expect(src).toMatch(/useArchivedAudio\(allCallIds\)/);
  });
});

describe("the archive client", () => {
  const src = read("src/lib/callHistory/archivedRecordings.ts");

  // ⚠️ A failed lookup recorded as "no audio" hides every Play button for the
  // rest of the session, with nothing retrying and nothing erroring — the
  // lesson fetchDirectoryNames already learned.
  it("separates a failed lookup from a genuine miss", () => {
    expect(src).toMatch(/\{ ok: false, audio: \{\} \}/);
    const hook = read("src/hooks/callHistory/useArchivedAudio.ts");
    expect(hook).toMatch(/if \(!ok\) return;/);
  });

  it("caches a real miss, so a re-render does not re-ask", () => {
    const hook = read("src/hooks/callHistory/useArchivedAudio.ts");
    expect(hook).toMatch(/known\.set\(/);
    expect(hook).toMatch(/hasAudio: false/);
  });

  // Incident rule 2: a hook's return value in a dep array must be memoized, and
  // an effect must not depend on a freshly-built array.
  it("depends on a string and returns a stable snapshot", () => {
    const hook = read("src/hooks/callHistory/useArchivedAudio.ts");
    expect(hook).toMatch(/\.join\(","\)/);
    expect(hook).toMatch(/useSyncExternalStore\(subscribe, getSnapshot, getSnapshot\)/);
    expect(hook).toMatch(/\}, \[key\]\);/);
  });

  // ⚠️ "Still being saved" and "deleted before we got there" send a rep to
  // different places; a bare 404 sends them away from a recording that is about
  // to exist.
  it("turns the gateway's audio state into a sentence a rep can act on", () => {
    expect(src).toMatch(/still being saved/);
    expect(src).toMatch(/deleted this recording before we could save it/);
    expect(src).toMatch(/never recorded/);
  });
});
