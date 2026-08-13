import { describe, expect, it } from "vitest";
import { fetchUrlAllowed, pathAllowed } from "./rcAllowlist.mjs";

// These two predicates are the /rc proxy's whole security boundary: without
// them it is an open proxy to the account's RingCentral API (path) and to
// arbitrary hosts (url). They are tested here because both were widened for
// call history — call-log reads, and recording audio downloads.

describe("pathAllowed", () => {
  const base = "/restapi/v1.0/account/~/extension/~";

  it("allows exactly the endpoints the SPA uses", () => {
    expect(pathAllowed(`${base}/message-store?messageType=Fax`)).toBe(true);
    expect(pathAllowed(`${base}/sms`)).toBe(true);
    expect(pathAllowed(`${base}/ring-out`)).toBe(true);
    // Added for patient call history.
    expect(pathAllowed(`${base}/call-log?phoneNumber=%2B13475550101&view=Detailed`)).toBe(true);
    expect(pathAllowed(`${base}/message-store/123`)).toBe(true);
  });

  it("refuses the rest of the RingCentral API", () => {
    // The proxy holds an account-wide JWT, so anything not on the list is a
    // capability the browser must not borrow.
    expect(pathAllowed(`${base}/presence`)).toBe(false);
    expect(pathAllowed(`${base}/call-log-sync`)).toBe(false);
    expect(pathAllowed("/restapi/v1.0/account/~/call-log")).toBe(false); // company-wide log
    expect(pathAllowed("/restapi/v1.0/account/~/extension")).toBe(false);
    expect(pathAllowed("/restapi/oauth/token")).toBe(false);
    expect(pathAllowed("")).toBe(false);
  });

  it("does not let a prefix match smuggle a different endpoint in", () => {
    expect(pathAllowed(`${base}/smsomething`)).toBe(false);
    expect(pathAllowed(`${base}/message-storage`)).toBe(false);
  });
});

describe("fetchUrlAllowed", () => {
  it("allows fax attachment content (trailing attachment id)", () => {
    expect(
      fetchUrlAllowed("https://media.ringcentral.com/restapi/v1.0/account/1/extension/2/message-store/33/content/44"),
    ).toBe(true);
  });

  it("allows call recording content, which ends AT /content", () => {
    // The regression this guards: reusing the fax pattern (which requires a
    // trailing slash + id) silently 403s every recording download.
    expect(fetchUrlAllowed("https://media.ringcentral.com/restapi/v1.0/account/1/recording/99/content")).toBe(true);
    expect(fetchUrlAllowed("https://media.ringcentral.com/restapi/v1.0/account/1/recording/99/content/")).toBe(true);
  });

  it("refuses non-RingCentral hosts", () => {
    expect(fetchUrlAllowed("https://evil.com/restapi/v1.0/account/1/recording/99/content")).toBe(false);
    // Suffix smuggling — "notringcentral.com" must not satisfy the host rule.
    expect(fetchUrlAllowed("https://notringcentral.com/restapi/v1.0/account/1/recording/9/content")).toBe(false);
    expect(fetchUrlAllowed("https://ringcentral.com.evil.com/restapi/v1.0/account/1/recording/9/content")).toBe(false);
  });

  it("refuses non-https and unparseable input", () => {
    expect(fetchUrlAllowed("http://media.ringcentral.com/restapi/v1.0/account/1/recording/9/content")).toBe(false);
    expect(fetchUrlAllowed("file:///etc/passwd")).toBe(false);
    expect(fetchUrlAllowed("not a url")).toBe(false);
    expect(fetchUrlAllowed("")).toBe(false);
    expect(fetchUrlAllowed(undefined)).toBe(false);
  });

  it("refuses a RingCentral URL that isn't media content", () => {
    // Right host, wrong capability — the bearer token must not be lent to it.
    expect(fetchUrlAllowed("https://platform.ringcentral.com/restapi/v1.0/account/~/extension")).toBe(false);
    expect(fetchUrlAllowed("https://media.ringcentral.com/restapi/v1.0/account/1/recording/99")).toBe(false);
  });

  it("accepts an already-parsed URL as well as a string", () => {
    const u = new URL("https://media.ringcentral.com/restapi/v1.0/account/1/recording/99/content");
    expect(fetchUrlAllowed(u)).toBe(true);
  });
});
