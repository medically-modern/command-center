import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  durationSlug,
  estimateMinutes,
  etStamp,
  extensionFor,
  isEtToday,
  recordingFilename,
  slug,
  withRecordings,
  type DownloadableCall,
} from "./recordingDownload";

const call = (over: Partial<DownloadableCall> = {}): DownloadableCall => ({
  id: "c1",
  startTime: "2026-09-16T16:26:00.000Z", // 12:26 PM ET
  direction: "Outbound",
  durationSec: 393,
  otherNumber: "+15855550142",
  recording: { id: "r1", contentUri: "https://media.ringcentral.com/restapi/v1.0/account/1/recording/9/content" },
  ...over,
});

describe("naming a saved recording", () => {
  it("leads with the ET date and time so a download folder sorts chronologically", () => {
    expect(recordingFilename(call(), { who: "Charmaine Brooks" })).toBe(
      "2026-09-16_1226ET_Charmaine-Brooks_outbound_6m33s.mp3",
    );
  });

  it("falls back to the number when no name is known — never 'unknown'", () => {
    expect(recordingFilename(call({ otherNumber: "+15855550142" }))).toContain("15855550142");
  });

  it("takes the extension from what RingCentral actually sent", () => {
    // Recordings are MP3 on most accounts and WAV on some; assuming one
    // produces a file that won't open on the accounts where it's wrong.
    expect(recordingFilename(call(), { ext: "wav" })).toMatch(/\.wav$/);
    expect(extensionFor("audio/wav")).toBe("wav");
    expect(extensionFor("audio/mpeg")).toBe("mp3");
    expect(extensionFor("audio/mpeg; charset=binary")).toBe("mp3");
    expect(extensionFor(undefined)).toBe("mp3");
  });

  it("cannot smuggle a path separator into the save dialog", () => {
    const name = recordingFilename(call(), { who: "../../etc/passwd" });
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });

  it("renders duration the same way everywhere", () => {
    expect(durationSlug(393)).toBe("6m33s");
    expect(durationSlug(47)).toBe("47s");
    expect(durationSlug(0)).toBe("0s");
    expect(durationSlug(60)).toBe("1m00s");
  });

  it("slugs a name without leaving stray hyphens", () => {
    expect(slug("  Charmaine  Brooks!! ")).toBe("Charmaine-Brooks");
    expect(slug("")).toBe("");
  });
});

describe("the office clock, not the browser's", () => {
  it("names a late-evening UTC call by its EASTERN day", () => {
    // 01:30 UTC on the 17th is 9:30 PM ET on the 16th. Letting the browser's
    // zone decide would file this call under tomorrow for half the company.
    const { date, time } = etStamp("2026-09-17T01:30:00.000Z");
    expect(date).toBe("2026-09-16");
    expect(time).toBe("2130");
  });

  it("handles ET midnight without rolling to hour 24", () => {
    expect(etStamp("2026-09-17T04:00:00.000Z").time).toBe("0000");
  });

  it("survives a start time it cannot parse", () => {
    expect(etStamp("").date).toBe("undated");
    expect(etStamp("nonsense").date).toBe("undated");
  });

  it("decides 'today' on the same clock the filename uses", () => {
    const now = new Date("2026-09-16T20:00:00.000Z"); // 4pm ET
    expect(isEtToday("2026-09-16T16:26:00.000Z", now)).toBe(true);
    // 11pm ET the previous day — yesterday, though it shares a UTC date with
    // nothing useful.
    expect(isEtToday("2026-09-16T03:00:00.000Z", now)).toBe(false);
    expect(isEtToday("", now)).toBe(false);
  });
});

describe("what a bulk run will actually fetch", () => {
  it("skips calls with no audio rather than failing on them", () => {
    const list = [call(), call({ id: "c2", recording: undefined }), call({ id: "c3" })];
    expect(withRecordings(list).map((c) => c.id)).toEqual(["c1", "c3"]);
  });

  it("tells the rep roughly how long it will take", () => {
    expect(estimateMinutes(1)).toBe(1);
    expect(estimateMinutes(60)).toBeGreaterThan(2);
  });
});

describe("downloading a run", () => {
  let saved: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Without this the FIRST dynamic import below returns the copy the static
    // import at the top of this file already bound to the real api module, and
    // the mock silently does nothing.
    vi.resetModules();
    vi.useFakeTimers();
    saved = [];
    fetchMock = vi.fn(async () => new Blob(["x"], { type: "audio/mpeg" }));
    vi.doMock("../fax/ringcentralApi", () => ({ fetchRecordingBlob: fetchMock }));
    // jsdom has no object-URL implementation.
    Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      value(this: HTMLAnchorElement) {
        saved.push(this.download);
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("../fax/ringcentralApi");
    vi.resetModules();
  });

  /** Drive the paced loop to completion under fake timers. */
  async function run<T>(p: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return p;
  }

  it("saves every recording, one at a time", async () => {
    const { downloadRecordings } = await import("./recordingDownload");
    const list = [call({ id: "a" }), call({ id: "b" }), call({ id: "c" })];
    const res = await run(downloadRecordings(list, { nameFor: () => "Charmaine Brooks" }));
    expect(res.ok).toBe(3);
    expect(res.failures).toEqual([]);
    expect(saved).toHaveLength(3);
  });

  it("retries a throttled recording once, then carries on past a real failure", async () => {
    // A batch abandoned because one file was refused is the worse outcome: the
    // rep believes they have the other sixty calls and they do not.
    fetchMock
      .mockRejectedValueOnce(new Error("rate-limited"))
      .mockResolvedValueOnce(new Blob(["x"], { type: "audio/mpeg" })) // the retry
      .mockRejectedValueOnce(new Error("gone"))
      .mockRejectedValueOnce(new Error("gone")) // its retry also fails
      .mockResolvedValue(new Blob(["x"], { type: "audio/mpeg" }));
    const { downloadRecordings } = await import("./recordingDownload");
    const res = await run(downloadRecordings([call({ id: "a" }), call({ id: "b" }), call({ id: "c" })]));
    expect(res.ok).toBe(2);
    expect(res.failures).toEqual([{ id: "b", error: "gone" }]);
  });

  it("stops when cancelled, and keeps what already saved", async () => {
    const ctl = new AbortController();
    const { downloadRecordings } = await import("./recordingDownload");
    const res = await run(
      downloadRecordings([call({ id: "a" }), call({ id: "b" }), call({ id: "c" })], {
        signal: ctl.signal,
        // Between files, which is where a rep pressing Stop actually lands. A
        // download already in flight is allowed to finish and be kept.
        onProgress: () => ctl.abort(),
      }),
    );
    expect(res.cancelled).toBe(true);
    expect(res.ok).toBe(1);
  });

  it("reports progress as it goes, so a long run isn't a frozen button", async () => {
    const seen: number[] = [];
    const { downloadRecordings } = await import("./recordingDownload");
    await run(
      downloadRecordings([call({ id: "a" }), call({ id: "b" })], {
        onProgress: (p) => seen.push(p.done),
      }),
    );
    expect(seen).toEqual([1, 2]);
  });
});
