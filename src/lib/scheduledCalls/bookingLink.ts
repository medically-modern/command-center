/**
 * The Calendly link a rep texts or emails a patient.
 *
 * ⚠️ The prefill is not a convenience — it is what lets the booking come BACK.
 * Calendly is the system of record for the appointment, and the dtc-mm-form
 * webhook mirrors it onto the patient's Monday row by matching the invitee's
 * **email** against the row's own Email column (`text_mm1xc140`) — that is the
 * only join there is, and `reconcileDay` repairs with the same one. So a
 * patient who books with a different address than the form has on file gets a
 * real appointment that exists in Calendly and nowhere else: the intake page
 * keeps reading "Not booked", the Scheduled Calls grid never lists them, no
 * reminder fires, and nothing errors anywhere.
 *
 * The intake form already does this for its own embed
 * (`?hide_gdpr_banner=1&name=…&email=…`), which is why bookings made at the end
 * of the form mirror reliably. This is the same two parameters on the link a
 * rep sends by hand.
 *
 * It narrows the failure rather than closing it: Calendly lets the invitee edit
 * a prefilled field, and a patient with no email on the board has nothing to
 * prefill. `BookingLinkDialog` says so on screen in that second case.
 */

/** Split on the FIRST `#` only — everything after it is the fragment. */
function splitFragment(url: string): [string, string] {
  const at = url.indexOf("#");
  return at === -1 ? [url, ""] : [url.slice(0, at), url.slice(at + 1)];
}

/**
 * `url` with Calendly's `name` / `email` prefill applied.
 *
 * Blank values are omitted rather than sent empty — a bare `&email=` is noise
 * in a link the patient reads on a phone, and it prefills nothing either way.
 * Returns the URL untouched when there is nothing to add, so a link sent with
 * no patient in hand is exactly what it was before.
 */
export function bookingLinkFor(
  url: string | undefined,
  patient: { name?: string; email?: string },
): string {
  const base = (url ?? "").trim();
  if (!base) return "";

  const name = (patient.name ?? "").trim();
  const email = (patient.email ?? "").trim();

  const params: string[] = [];
  // encodeURIComponent, not URLSearchParams: the latter serialises a space as
  // `+`, and this has to match what the form's embed sends (`%20`) so the two
  // paths can't behave differently on a name with a space in it.
  if (name) params.push(`name=${encodeURIComponent(name)}`);
  if (email) params.push(`email=${encodeURIComponent(email)}`);
  if (!params.length) return base;

  // Append to the QUERY, never after the fragment — `…#x?name=` is part of the
  // fragment and Calendly never sees it. Today's scheduling URL has neither,
  // but it comes from the Calendly event type at runtime, so a console change
  // could add one.
  const [head, fragment] = splitFragment(base);
  const sep = head.includes("?") ? "&" : "?";
  const withPrefill = `${head}${sep}${params.join("&")}`;
  return fragment ? `${withPrefill}#${fragment}` : withPrefill;
}
