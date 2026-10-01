import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MODEL,
  LOCATION,
  batchRequestBody,
  fileResult,
  gcsObjectName,
  seconds,
  transcribeEnabled,
  transcriptRecord,
  turnsFrom,
} from "./callTranscribeRules.mjs";

const read = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");
const w = (word, speakerLabel, startOffset) => ({ word, speakerLabel, startOffset });

describe("call transcription rules (§5.47e)", () => {
  it("⚠️ is off unless explicitly switched on, whatever credentials exist (BAA gate)", () => {
    const creds = { GOOGLE_STT_CREDENTIALS: "{}", GOOGLE_STT_BUCKET: "b", GOOGLE_STT_PROJECT: "p" };
    expect(transcribeEnabled(creds)).toBe(false);
    expect(transcribeEnabled({ ...creds, GOOGLE_STT_ENABLED: "1" })).toBe(true);
    expect(transcribeEnabled({ GOOGLE_STT_ENABLED: "1" })).toBe(false);
  });

  it("⚠️ asks for chirp_3 in `us` with two-speaker diarization — the only combination measured to work", () => {
    expect(MODEL).toBe("chirp_3");
    expect(LOCATION).toBe("us");
    const b = batchRequestBody("gs://x/calls/1.mp3");
    expect(b.config.features.diarizationConfig).toEqual({ minSpeakerCount: 2, maxSpeakerCount: 2 });
    expect(b.files).toEqual([{ uri: "gs://x/calls/1.mp3" }]);
    expect(b.recognitionOutputConfig).toEqual({ inlineResponseConfig: {} });
  });

  it("names the drop-box object by call id only", () => {
    expect(gcsObjectName("ALr3yhHknHyl7M1A")).toBe("calls/ALr3yhHknHyl7M1A.mp3");
    expect(gcsObjectName("a/../b")).toBe("calls/a____b.mp3");
  });

  it("reads durations", () => {
    expect(seconds("12.340s")).toBe(12.34);
    expect(seconds("3s")).toBe(3);
    expect(seconds(undefined)).toBe(null);
  });

  it("reads the file result from inlineResult.transcript or the deprecated transcript, and errors", () => {
    const uri = "gs://b/calls/1.mp3";
    const results = [{ alternatives: [{ transcript: "hi" }] }];
    expect(fileResult({ response: { results: { [uri]: { inlineResult: { transcript: { results } } } } } }, uri).results).toEqual(results);
    expect(fileResult({ response: { results: { [uri]: { transcript: { results } } } } }, uri).results).toEqual(results);
    expect(fileResult({ response: { results: { [uri]: { error: { code: 3, message: "bad audio" } } } } }, uri).error).toBe("bad audio");
    expect(fileResult({}, uri)).toEqual({ error: null, results: [] });
  });

  it("groups labelled words into speaker turns across results", () => {
    const turns = turnsFrom([
      { alternatives: [{ transcript: "Hello this is", words: [w("Hello", "1", "0.5s"), w("this", "1", "0.8s"), w("is", "1", "1s")] }] },
      { alternatives: [{ transcript: "Hi there", words: [w("Hi", "2", "2s"), w("there", "2", "2.2s"), w("Okay", "1", "3s")] }] },
    ]);
    expect(turns).toEqual([
      { speaker: "1", start: 0.5, text: "Hello this is" },
      { speaker: "2", start: 2, text: "Hi there" },
      { speaker: "1", start: 3, text: "Okay" },
    ]);
  });

  it("⚠️ v1-style: one result holding every word labelled is used alone, so nothing doubles", () => {
    const turns = turnsFrom([
      { alternatives: [{ transcript: "Hello hi", words: [w("Hello", undefined, "0s"), w("hi", undefined, "1s")] }] },
      { alternatives: [{ transcript: "Hello hi", words: [w("Hello", "1", "0s"), w("hi", "2", "1s")] }] },
    ]);
    expect(turns).toEqual([
      { speaker: "1", start: 0, text: "Hello" },
      { speaker: "2", start: 1, text: "hi" },
    ]);
  });

  it("keeps the text when no speakers came back", () => {
    expect(turnsFrom([{ alternatives: [{ transcript: " One block. " }] }])).toEqual([{ speaker: "", start: null, text: "One block." }]);
    expect(turnsFrom([])).toEqual([]);
  });

  it("records speakers seen", () => {
    expect(transcriptRecord([{ speaker: "1", text: "a" }, { speaker: "2", text: "b" }, { speaker: "1", text: "c" }]).speakers).toEqual(["1", "2"]);
  });

  it("is wired: registered on the messaging pool, timeline flag, authenticated read, no text in the timeline", () => {
    expect(read("messaging.mjs")).toMatch(/registerCallTranscribe\(\{ app, pool, requireCaller \}\)/);
    const t = read("callTranscribe.mjs");
    expect(t).toMatch(/app\.get\("\/calls\/transcript"[\s\S]*requireCaller\(req, res\)/);
    // The public health route reports counts only.
    const health = t.slice(t.indexOf('app.get("/calls/transcribe-health"'), t.indexOf('app.get("/calls/transcript"'));
    expect(health).not.toMatch(/transcript_json/);
    expect(read("commsInboxRules.mjs")).toMatch(/hasTranscript: e\.transcriptState === "done"/);
    expect(read("commsInbox.mjs")).toMatch(/has\.transcribed \? "transcript_state" : "NULL AS transcript_state"/);
    expect(read("commsInbox.mjs")).not.toMatch(/transcript_json/);
  });
});
