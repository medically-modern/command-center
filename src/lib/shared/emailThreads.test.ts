import { describe, expect, it } from "vitest";
import { replyHeadersFor, type EmailThreadMessage } from "./emailThreads";

const msg = (over: Partial<EmailThreadMessage>): EmailThreadMessage => ({
  id: "m1",
  from: "patient@example.com",
  to: "records@medicallymodern.com",
  date: 1,
  subject: "Insurance card",
  body: "",
  messageId: "<id-1@mail.gmail.com>",
  references: "",
  mine: false,
  ...over,
});

describe("replyHeadersFor", () => {
  it("returns empties for an empty thread", () => {
    expect(replyHeadersFor([])).toEqual({ subject: "", inReplyTo: "", references: "" });
  });

  it("prefixes Re: exactly once", () => {
    expect(replyHeadersFor([msg({})]).subject).toBe("Re: Insurance card");
    expect(replyHeadersFor([msg({ subject: "Re: Insurance card" })]).subject).toBe("Re: Insurance card");
    // Case-insensitive — "RE:" must not become "Re: RE: …".
    expect(replyHeadersFor([msg({ subject: "RE: Insurance card" })]).subject).toBe("RE: Insurance card");
  });

  it("keeps a blank subject blank (no bare 'Re:')", () => {
    expect(replyHeadersFor([msg({ subject: "  " })]).subject).toBe("");
  });

  it("answers the LAST message, not the first", () => {
    const h = replyHeadersFor([
      msg({ id: "a", messageId: "<id-a@x>", subject: "Old subject" }),
      msg({ id: "b", messageId: "<id-b@x>", subject: "New subject", references: "<id-a@x>" }),
    ]);
    expect(h.inReplyTo).toBe("<id-b@x>");
    expect(h.subject).toBe("Re: New subject");
  });

  it("chains References: last message's chain + its own Message-ID", () => {
    const h = replyHeadersFor([
      msg({ messageId: "<id-2@x>", references: "<id-0@x> <id-1@x>" }),
    ]);
    expect(h.references).toBe("<id-0@x> <id-1@x> <id-2@x>");
  });

  it("starts the chain from a first message with no References", () => {
    expect(replyHeadersFor([msg({})]).references).toBe("<id-1@mail.gmail.com>");
  });

  it("survives a message with no Message-ID at all", () => {
    const h = replyHeadersFor([msg({ messageId: "", references: "" })]);
    expect(h.inReplyTo).toBe("");
    expect(h.references).toBe("");
  });
});
