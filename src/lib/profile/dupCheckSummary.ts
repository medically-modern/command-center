/**
 * The duplicate check's conclusion in ONE sentence — what an "Already in
 * System" pill says when hovered (Brandon, 2026-09-29: *"surface one sentence
 * conclusion to the user - this can be pulled from the notes. take a look at
 * how claude breaks it down the same way everytime, we should pull the best
 * sentence from those and display it if you hover over already in system"*).
 *
 * **Where it comes from.** The `duplicate-patient-check` automation
 * (josh-monday-automations, `automations/duplicate-analysis.js`) writes its
 * write-up into **Profile Send Off Notes** (`text_mm389fs`), always in this
 * order — read off every write-up on the board, 2026-09-29:
 *
 *   [8/17/2026, 1:53 PM] Duplicate Check: Duplicate — updated info
 *   ⚠️ DIFFERENT SERVING: <one sentence>            (only when the product differs)
 *   Linked by: … / Confidence: … / Current status: …
 *   Documents: … / New pages in the incoming document: …   (optional)
 *   Re-sent data we already corrected (ignore): …          (optional)
 *   Pipeline history: … / Changes: …
 *   Recommended: <what to do, one paragraph>
 *   <Claude's summary, 3–6 sentences>
 *   Patient UID: <uuid>                                     (optional)
 *   —Claude
 *
 * ⚠️ **Not the Dup Check Analysis column** (`long_text_mm651jfa`): it is a
 * long_text and every value is cut at 2,000 characters — and the summary,
 * which holds the conclusion, is the END of the note.
 *
 * **The pick.** A different-serving line wins outright (it IS the
 * conclusion). Otherwise the summary's first sentence, if it states a verdict;
 * else the LAST sentence of the summary that does (the prompt asks Claude to
 * lead with the conclusion, and about a third of the write-ups lead with the
 * identity match instead); else the first sentence of Recommended. Measured on
 * all 28 write-ups on the board: every one yields a sentence.
 */

export interface DupCheckSummary {
  /** The verdict label — "Duplicate — updated info", "New order — different serving"… */
  label: string;
  /** The one sentence, capped at `MAX_CHARS`; "" when the write-up had none. */
  sentence: string;
}

const MAX_CHARS = 220;
const HEAD = /^\[[^\]]+\]\s*Duplicate Check:\s*(.+?)\s*$/;
const NEXT_STAMP = /^\[[^\]]+\]\s/;
const SIGNOFF = /^—\s*Claude\s*$/;
const SERVING = /^(?:⚠️\s*)?DIFFERENT SERVING:\s*(.+)$/i;
const VERDICT =
  /\b(duplicate|new (?:[\w/]+[ -]){0,2}(?:order|request)|not (?:pure )?noise|nothing new|no new information|work (?:it|this)|route (?:it|this)|treat (?:it|this))\b/i;

/** Words a period can follow without ending the sentence. */
const ABBREV = /(?:^|[\s(])(?:dr|mr|mrs|ms|vs|st|no|p|pp|approx|e\.g|i\.e|[a-z]|\d)$/i;

/** Split prose into sentences without breaking "Dr. Test", "p. 4" or "group 2. Medical". */
export function splitSentences(text: string): string[] {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  const out: string[] = [];
  let start = 0;
  // Terminal punctuation, any closing quote or bracket, then a space before
  // something that can start a sentence.
  const re = /([.!?])(["”')\]]*)\s+(?=["“(]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] === "." && ABBREV.test(s.slice(start, m.index))) continue;
    out.push(s.slice(start, m.index + 1 + m[2].length).trim());
    start = m.index + m[0].length;
  }
  const rest = s.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

function cap(sentence: string): string {
  const s = sentence.trim();
  if (s.length <= MAX_CHARS) return s;
  const cut = s.slice(0, MAX_CHARS - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > MAX_CHARS * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:—–-]+$/, "")}…`;
}

/**
 * The newest duplicate-check write-up in a notes column → its label and one
 * sentence. Null when the column holds no write-up at all.
 */
export function dupCheckSummary(notes: string | null | undefined): DupCheckSummary | null {
  const lines = (notes ?? "").split(/\r?\n/);
  let head = -1;
  let label = "";
  lines.forEach((l, i) => {
    const m = l.trim().match(HEAD);
    if (m) {
      head = i;
      label = m[1];
    }
  });
  if (head < 0) return null;

  const block: string[] = [];
  for (let i = head + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (SIGNOFF.test(l) || NEXT_STAMP.test(l)) break;
    block.push(l);
  }

  for (const l of block) {
    const m = l.match(SERVING);
    if (m) return { label, sentence: cap(splitSentences(m[1])[0] ?? m[1]) };
  }

  const rec = block.findIndex((l) => /^Recommended:/i.test(l));
  if (rec < 0) return { label, sentence: "" };
  const summary = splitSentences(
    block
      .slice(rec + 1)
      .filter((l) => l && !/^Patient UID:/i.test(l))
      .join(" "),
  );
  if (summary.length && VERDICT.test(summary[0])) return { label, sentence: cap(summary[0]) };
  for (let i = summary.length - 1; i > 0; i--) {
    if (VERDICT.test(summary[i])) return { label, sentence: cap(summary[i]) };
  }
  const recommended = splitSentences(block[rec].replace(/^Recommended:\s*/i, ""))[0] ?? "";
  return { label, sentence: cap(recommended || summary[0] || "") };
}

/**
 * The hover text for an "Already in System" pill. Never blank (a pill that
 * says nothing when hovered reads as broken):
 *  · a write-up → "<label>: <sentence>";
 *  · a verdict but no write-up (a partial lead is flagged, never written up) →
 *    what the verdict means;
 *  · neither → where to look.
 * `notes === undefined` means the notes have not been read yet — `fallback`
 * is returned then, rather than claiming there is no write-up.
 */
export function inSystemHover(notes: string | null | undefined, verdict = "", fallback = ""): string {
  const s = notes === undefined ? null : dupCheckSummary(notes);
  if (s?.sentence) return `${s.label}: ${s.sentence}`;
  if (notes === undefined && fallback) return fallback;
  const v = (verdict || s?.label || "").trim();
  if (v) return `Duplicate check: ${v}. No written conclusion on this record — search for the patient before working it.`;
  return "Filed as Already In System — no duplicate-check write-up on this record. See Profile Send Off Notes.";
}
