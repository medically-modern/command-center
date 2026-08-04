/** Display helpers for the Assigned Patients inbox. Kept out of the component
 *  files so they can be shared without tripping react-refresh. */

/** +15551234567 → (555) 123-4567. Unrecognised input is returned as-is. */
export function fmtPhone(num: string): string {
  const d = (num || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return num || "Unknown";
}

/** Time for today's messages, date for older ones — same shape as the
 *  RingCentral list this replaces. */
export function fmtWhen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
}

/** "janelle@medicallymodern.com" → "Janelle". Falls back to the raw string for
 *  anything that isn't a company address. */
export function senderName(email: string): string {
  const local = String(email || "").split("@")[0];
  if (!local) return "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * A stable colour per sender, so a long thread can be scanned for "who sent
 * what" without reading every label. One person is the same colour everywhere
 * in the app and across reloads.
 *
 * ⚠️ The roster is EXPLICIT rather than hashed. Hashing an email into a palette
 * is stable but not distinct: with ~8 people and 8 colours there is roughly a
 * 90% chance two of them collide, which defeats the entire point — two people
 * sharing a colour is worse than no colours at all, because it reads as one
 * person. Listing the team guarantees each gets their own.
 *
 * Adding someone: append them here. Anyone NOT listed still gets a colour (the
 * hash fallback below), so a new hire is never colourless — they just aren't
 * guaranteed to be unique until they're added. Append rather than insert:
 * reordering this list repaints everyone above the change.
 */
const SENDER_PALETTE = [
  "bg-emerald-600", // josh
  "bg-sky-600",     // katie
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-700",
  "bg-indigo-600",
  "bg-teal-600",
  "bg-fuchsia-600",
  "bg-lime-700",
  "bg-orange-600",
  "bg-pink-600",
] as const;

/** Team roster, in colour order. Append only — see the note above. */
const SENDER_ORDER = [
  "josh@medicallymodern.com",
  "katie@medicallymodern.com",
  "janelle@medicallymodern.com",
  "brandon@medicallymodern.com",
  "corey@medicallymodern.com",
  "masheke@medicallymodern.com",
  "samantha@medicallymodern.com",
  "madeline@medicallymodern.com",
] as const;

export function senderColor(email: string): string {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "bg-primary";
  const known = SENDER_ORDER.indexOf(e as (typeof SENDER_ORDER)[number]);
  if (known >= 0) return SENDER_PALETTE[known % SENDER_PALETTE.length];
  // Not on the roster — still deterministic, just not collision-proof. Starts
  // past the assigned block so a new sender is unlikely to duplicate a
  // teammate's colour before someone adds them above.
  let h = 0;
  for (let i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) >>> 0;
  const spare = SENDER_PALETTE.length - SENDER_ORDER.length;
  return spare > 0
    ? SENDER_PALETTE[SENDER_ORDER.length + (h % spare)]
    : SENDER_PALETTE[h % SENDER_PALETTE.length];
}
