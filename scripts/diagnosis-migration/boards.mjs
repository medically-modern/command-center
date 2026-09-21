/**
 * The Diagnosis columns, status -> dropdown (CLAUDE.md §5.40, decided 2026-09-21).
 *
 * WHY: monday status columns cap at 39 labels / label-id 160. All three columns
 * the app WRITES (Medical Evaluation, Insurance, Welcome Call) sat at exactly
 * 39/160, so `create_labels_if_missing` had nowhere to put a new ICD-10 code and
 * dropped it at HTTP 200 with no error. Dropdowns have no such ceiling (Clinic
 * Name is at 324 labels), which is what the app already uses for every other
 * open vocabulary.
 *
 * Subscription and New Order are DESTINATIONS of the hop automations rather than
 * app write targets, but they carry the same column at 37 labels and the hops
 * cannot copy dropdown -> status, so they convert with the rest of the chain.
 *
 * DTC Intake (color_mkxqzqdj) and Secondary Claims (color_mky2gpz5) also hold a
 * Diagnosis status column. Both are OUT OF SCOPE: neither is in the app's write
 * path and neither is a destination of these hops. Flagged, not converted.
 */
export const GW = "https://monday-gateway-production.up.railway.app/gql";

export const BOARDS = [
  { board: "18406060017", name: "Medical Evaluation", from: "color_mm1wf7rv", title: "Diagnosis" },
  { board: "18410601299", name: "Insurance",          from: "color_mm1wf7rv", title: "Diagnosis" },
  { board: "18410804557", name: "Welcome Call",       from: "color_mm1wf7rv", title: "Diagnosis" },
  { board: "18407459988", name: "Subscription",       from: "color_mkxrxv9w", title: "Diagnosis" },
  { board: "18405457690", name: "New Order",          from: "color_mm189t0b", title: "Diagnosis Code" },
];

export async function gql(query, variables = {}) {
  const r = await fetch(GW, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  // §10: a 200 with errors[] is this API's most common silent failure. Never
  // let a bulk job report a clean run having written nothing.
  if (j.errors) throw new Error("GQL " + JSON.stringify(j.errors).slice(0, 500));
  return j.data;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
