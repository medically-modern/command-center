// The prefill on a rep-sent booking link is what lets the booking mirror back
// onto the patient's Monday row — the webhook joins on the invitee's EMAIL and
// nothing else. Run: npx vitest run src/lib/scheduledCalls/bookingLink.test.ts
import { describe, it, expect } from "vitest";
import { bookingLinkFor, bookingMessage, BOOKING_URLS } from "./bookingLink";

const URL_ = "https://calendly.com/records-medicallymodern/medically-modern-intake-call";

describe("bookingLinkFor", () => {
  it("adds the two parameters the mirror depends on", () => {
    expect(bookingLinkFor(URL_, { name: "Jane Doe", email: "jane@example.com" }))
      .toBe(`${URL_}?name=Jane%20Doe&email=jane%40example.com`);
  });

  it("encodes a space as %20, exactly like the form's own embed", () => {
    // URLSearchParams would write `Jane+Doe`. The form uses encodeURIComponent,
    // and the two paths must not differ on the same patient.
    expect(bookingLinkFor(URL_, { name: "Jane Doe", email: "" }))
      .toBe(`${URL_}?name=Jane%20Doe`);
  });

  it("omits a blank rather than sending an empty parameter", () => {
    expect(bookingLinkFor(URL_, { name: "", email: "jane@example.com" }))
      .toBe(`${URL_}?email=jane%40example.com`);
    expect(bookingLinkFor(URL_, { name: "   ", email: "  " })).toBe(URL_);
  });

  it("returns the link untouched when there is no patient in hand", () => {
    // Scheduled Calls opens the dialog with nobody selected; that link must be
    // exactly what it was before this existed.
    expect(bookingLinkFor(URL_, {})).toBe(URL_);
  });

  it("keeps an existing query string instead of starting a second one", () => {
    expect(bookingLinkFor(`${URL_}?hide_gdpr_banner=1`, { email: "j@x.com" }))
      .toBe(`${URL_}?hide_gdpr_banner=1&email=j%40x.com`);
  });

  it("appends to the query, not to the fragment", () => {
    // `…#book?email=` is all fragment — Calendly would never see it.
    expect(bookingLinkFor(`${URL_}#book`, { email: "j@x.com" }))
      .toBe(`${URL_}?email=j%40x.com#book`);
  });

  it("survives a missing or blank url", () => {
    expect(bookingLinkFor(undefined, { email: "j@x.com" })).toBe("");
    expect(bookingLinkFor("   ", { email: "j@x.com" })).toBe("");
  });

  it("encodes a + address rather than letting it read as a space", () => {
    expect(bookingLinkFor(URL_, { email: "jane+mm@example.com" }))
      .toBe(`${URL_}?email=jane%2Bmm%40example.com`);
  });
});

describe("the two calls (Brandon, 2026-09-14)", () => {
  it("the welcome link is the Calendly console's, verified live 2026-09-14", () => {
    expect(BOOKING_URLS.welcome).toBe("https://calendly.com/records-medicallymodern/welcome-call");
    expect(BOOKING_URLS.intake).toBe("https://calendly.com/records-medicallymodern/medically-modern-intake-call");
  });
  it("the message carries the chosen link and names the call", () => {
    const w = bookingMessage("welcome", BOOKING_URLS.welcome, "Jane Doe");
    expect(w).toMatch(/^Hi Jane, /);
    expect(w).toContain("welcome call");
    expect(w).toContain(BOOKING_URLS.welcome);
    const i = bookingMessage("intake", BOOKING_URLS.intake, "");
    expect(i).toMatch(/^Hi, /);
    expect(i).toContain(BOOKING_URLS.intake);
    expect(i).not.toContain("welcome");
  });
});
