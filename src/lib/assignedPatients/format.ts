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
 * A stable colour per sender, so a manager scrolling a long thread can see at a
 * glance who sent what without reading every label.
 *
 * Deterministic from the email rather than assigned in order, so the same
 * person is the same colour in every conversation and across reloads.
 */
const SENDER_COLORS = [
  "bg-sky-600",
  "bg-violet-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-cyan-700",
  "bg-indigo-600",
  "bg-teal-600",
] as const;

export function senderColor(email: string): string {
  const e = String(email || "").toLowerCase();
  if (!e) return "bg-primary";
  let h = 0;
  for (let i = 0; i < e.length; i++) h = (h * 31 + e.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length];
}
