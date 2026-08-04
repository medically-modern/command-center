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
