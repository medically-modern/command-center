/**
 * Reading and writing the Diagnosis column, which is a DROPDOWN (2026-09-21).
 *
 * ⚠️ It was a `status` column until 2026-09-21, and the reason it moved is the
 * whole point of this file: monday status columns cap at **39 labels / label-id
 * 160**, and all three Diagnosis columns the app writes were sitting at exactly
 * that. `create_labels_if_missing` then has nowhere to put a new ICD-10 code, so
 * monday drops the write at **HTTP 200 with no `errors[]`** — the silent-drop
 * class CLAUDE.md §5.12/§5.20/§5.31c/§5.31d/§5.33/§5.36 records. The verified
 * write caught it (verify timeout, stage NOT advanced) and Carol Robinson sat in
 * Evaluate MN with everything saved but her diagnosis. Dropdowns have no such
 * ceiling — Clinic Name is at 324 labels — which is what the app already uses
 * for every other open vocabulary. ICD-10 has ~70k codes; it never belonged in
 * a 39-slot column.
 *
 * Two shape differences the callers must not re-derive per slice:
 *   · WRITE is `{labels: [code]}`, not `{label: code}`.
 *   · READ can come back "A, B" — a dropdown accepts several labels where a
 *     status could hold one. Diagnosis is conceptually single-valued and every
 *     consumer (the MN request letter, the check pack, the OOP rules) treats it
 *     as one string, so a rep who picks two in the monday UI must not silently
 *     turn the whole "E11.65, E10.9" into the diagnosis. We take the first and
 *     leave the column alone — narrowing a read is safe, rewriting a rep's board
 *     value from a display path is not.
 */

/** The diagnosis a single-valued consumer should use, from a dropdown's text. */
export function readDiagnosis(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  const first = raw.split(",")[0]?.trim() ?? "";
  return first;
}

/** True when the column holds more than one code — worth surfacing, never worth
 *  silently fixing. */
export function hasMultipleDiagnoses(text: string | null | undefined): boolean {
  return (text ?? "").split(",").filter((s) => s.trim()).length > 1;
}

/** The write value for a dropdown Diagnosis. An empty code CLEARS the column. */
export function diagnosisWriteValue(code: string | null | undefined): { labels: string[] } {
  const c = (code ?? "").trim();
  return { labels: c ? [c] : [] };
}

/** What monday reads back for that write — the `expectedText` a verified write
 *  polls against. */
export function diagnosisExpectedText(code: string | null | undefined): string {
  return (code ?? "").trim();
}
