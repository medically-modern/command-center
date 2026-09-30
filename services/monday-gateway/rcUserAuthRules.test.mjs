import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STATE_TTL_MS,
  REFRESH_WHEN_LEFT_MS,
  deriveKey,
  sealToken,
  openToken,
  signState,
  verifyState,
  safeReturnTo,
  withOutcome,
  authorizeUrl,
  parseTokenResponse,
  grantIsDead,
  dueForKeepAlive,
} from "./rcUserAuthRules.mjs";

const read = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");
const ORIGINS = ["https://medically-modern.github.io", "http://localhost:5173"];
const NOW = 1_790_000_000_000;

describe("rcUserAuthRules — keys and sealed tokens", () => {
  it("derives distinct 32-byte keys per label from one secret", () => {
    const a = deriveKey("pepper", "mm-rc-user-token-v1");
    const b = deriveKey("pepper", "mm-rc-user-state-v1");
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
    expect(deriveKey("", "x")).toBeNull();
  });

  it("round-trips a refresh token, and never stores it in the clear", () => {
    const key = deriveKey("pepper", "t");
    const sealed = sealToken(key, "refresh-abc");
    expect(sealed).not.toContain("refresh-abc");
    expect(openToken(key, sealed)).toBe("refresh-abc");
  });

  it("⚠️ refuses a shortened authentication tag", () => {
    const key = deriveKey("pepper", "t");
    const [v, iv, tag, ct] = sealToken(key, "refresh-abc").split(".");
    const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(openToken(key, [v, iv, short, ct].join("."))).toBeNull();
  });

  it("refuses a tampered value or the wrong key", () => {
    const key = deriveKey("pepper", "t");
    const sealed = sealToken(key, "refresh-abc");
    const parts = sealed.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(openToken(key, parts.join("."))).toBeNull();
    expect(openToken(deriveKey("other", "t"), sealed)).toBeNull();
    expect(openToken(key, "garbage")).toBeNull();
  });
});

describe("rcUserAuthRules — the signed state", () => {
  const key = deriveKey("pepper", "s");
  it("carries who clicked Connect and where to go back", () => {
    const s = signState(key, { email: "Victor@MedicallyModern.com", returnTo: "https://medically-modern.github.io/x/", now: NOW });
    expect(verifyState(key, s, NOW + 1000)).toEqual({ email: "victor@medicallymodern.com", returnTo: "https://medically-modern.github.io/x/" });
  });

  it("⚠️ cannot be forged or edited to attach a login to somebody else", () => {
    const s = signState(key, { email: "victor@medicallymodern.com", returnTo: "https://medically-modern.github.io/", now: NOW });
    const [payload, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ e: "katie@medicallymodern.com", r: "https://medically-modern.github.io/", x: NOW + 99999 }))
      .toString("base64url");
    expect(verifyState(key, `${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyState(deriveKey("other", "s"), s, NOW)).toBeNull();
    expect(verifyState(key, payload, NOW)).toBeNull();
  });

  it("expires", () => {
    const s = signState(key, { email: "a@medicallymodern.com", returnTo: "https://medically-modern.github.io/", now: NOW });
    expect(verifyState(key, s, NOW + STATE_TTL_MS + 1)).toBeNull();
  });
});

describe("rcUserAuthRules — where the callback may send the browser", () => {
  it("only to a page of the app", () => {
    expect(safeReturnTo("https://medically-modern.github.io/command-center-test/#/", ORIGINS)).toBe(
      "https://medically-modern.github.io/command-center-test/#/",
    );
    expect(safeReturnTo("https://evil.example/", ORIGINS)).toBeNull();
    expect(safeReturnTo("javascript:alert(1)", ORIGINS)).toBeNull();
    expect(safeReturnTo("https://medically-modern.github.io.evil.example/", ORIGINS)).toBeNull();
    expect(safeReturnTo("", ORIGINS)).toBeNull();
  });

  it("puts the outcome in the query, keeping the router's hash and replacing an old outcome", () => {
    const out = withOutcome("https://medically-modern.github.io/cc/?rc=error&rcReason=old#/access", "connected");
    const u = new URL(out);
    expect(u.searchParams.get("rc")).toBe("connected");
    expect(u.searchParams.get("rcReason")).toBeNull();
    expect(u.hash).toBe("#/access");
  });

  it("builds RingCentral's authorize address with the state and redirect", () => {
    const u = new URL(authorizeUrl({ server: "https://platform.ringcentral.com", clientId: "cid", redirectUri: "https://gw/rc/user/callback", state: "st" }));
    expect(u.pathname).toBe("/restapi/oauth/authorize");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://gw/rc/user/callback");
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("rcUserAuthRules — grants", () => {
  it("keeps a whole grant and refuses half of one", () => {
    const g = parseTokenResponse(
      { access_token: "a", expires_in: 3600, refresh_token: "r", refresh_token_expires_in: 604800, owner_id: 63007214012 },
      NOW,
    );
    expect(g.refreshToken).toBe("r");
    expect(g.ownerId).toBe("63007214012");
    expect(g.accessExpiresAt).toBeLessThan(NOW + 3600_000);
    expect(g.refreshExpiresAt).toBe(NOW + 604800_000);
    expect(() => parseTokenResponse({ access_token: "a" }, NOW)).toThrow();
  });

  it("tells a dead grant from a bad moment at RingCentral", () => {
    expect(grantIsDead(400, { error: "invalid_grant" })).toBe(true);
    expect(grantIsDead(401, {})).toBe(true);
    expect(grantIsDead(503, {})).toBe(false);
    expect(grantIsDead(429, {})).toBe(false);
  });

  it("⚠️ keeps a grant alive well before the browser's 7-day credential cache could let it lapse", () => {
    expect(REFRESH_WHEN_LEFT_MS).toBeGreaterThan(24 * 60 * 60_000);
    expect(dueForKeepAlive(new Date(NOW + REFRESH_WHEN_LEFT_MS - 1), NOW)).toBe(true);
    expect(dueForKeepAlive(new Date(NOW + 7 * 24 * 60 * 60_000), NOW)).toBe(false);
  });

});

describe("wiring", () => {
  it("⚠️ /rc/user/* is registered BEFORE the /rc proxy, which would otherwise answer it 403", () => {
    const idx = read("index.mjs");
    const user = idx.indexOf("registerRcUserAuth({");
    const proxy = idx.indexOf("registerRingCentral({ app })");
    expect(user).toBeGreaterThan(0);
    expect(proxy).toBeGreaterThan(user);
  });

  it("⚠️ uses its OWN app credentials — the gateway's JWT app cannot do the authorization-code flow", () => {
    const src = read("rcUserAuth.mjs");
    expect(src).toContain("RC_USER_CLIENT_ID");
    expect(src).toContain("RC_USER_CLIENT_SECRET");
    expect(src).not.toMatch(/process\.env\.RC_CLIENT_ID|process\.env\.RC_JWT/);
  });

  it("⚠️ hands out a person's own line ONLY when the browser asks for it for answering", () => {
    // Outgoing calls, and every browser on an app that predates this (no
    // `line` at all), get the shared line exactly as before (Josh 2026-09-30:
    // only incoming changes).
    const msg = read("messaging.mjs");
    const route = msg.slice(msg.indexOf(`app.get("/messaging/sip-provision"`));
    expect(route).toContain(`const own = req.query?.line === "own" ? await provisionOwnLine(who) : null;`);
  });

  it("provisioning asks for the person's own line first, and a dead grant is NOT put back on the shared line", () => {
    const msg = read("messaging.mjs");
    const route = msg.slice(msg.indexOf(`app.get("/messaging/sip-provision"`));
    const own = route.indexOf("provisionOwnLine(who)");
    const shared = route.indexOf("rcApiFetch(SIP_PROVISION_PATH");
    expect(own).toBeGreaterThan(0);
    expect(shared).toBeGreaterThan(own);
    // provisionOwnLine answers a dead grant itself (409, reconnect) rather than returning null.
    expect(read("rcUserAuth.mjs")).toMatch(/status: 409, body: \{ error: e\.message, reconnect: true \}/);
  });

  it("the incoming-call cards are untouched — self numbers are the main line, as before", () => {
    expect(read("inboundCalls.mjs")).toContain("pickInboundParty(body, SELF_NUMBERS)");
  });

  it("⚠️ everyone on their own line shows on the phone-health board, assigned or not", () => {
    const src = read("inboundCalls.mjs");
    expect(src).toContain("const answerers = [...new Set([...assigned, ...(await connectedEmails())])];");
  });

  it("⚠️ a refresh can never undo a reconnect or disconnect that landed meanwhile", () => {
    const src = read("rcUserAuth.mjs");
    // Both the grant write and the broken mark are conditional on the grant it started from.
    expect(src).toMatch(/WHERE email = \$1 AND refresh_sealed = \$4/);
    expect(src).toMatch(/WHERE email = \$1 AND refresh_sealed = \$2/);
    expect(src).toContain("if (upd.rowCount === 0) return afterLostRace(email);");
  });

  it("⚠️ a missing links table or a failed lookup never takes the SHARED line down", () => {
    const src = read("rcUserAuth.mjs");
    expect(src).toMatch(/_pool && _schemaReady && RC_USER_CLIENT_ID/);
    const own = src.slice(src.indexOf("export async function provisionOwnLine"));
    expect(own.slice(0, own.indexOf("if (!token) return null;"))).toMatch(/console\.warn\(`rc_user own-line lookup failed[^]*return null;/);
  });

  it("⚠️ refresh tokens are sealed before they are written", () => {
    const src = read("rcUserAuth.mjs");
    expect(src).not.toMatch(/refresh_sealed\s*=\s*\$\d.*g\.refreshToken\b(?!\))/);
    expect(src.match(/sealToken\(SEAL_KEY, g\.refreshToken\)/g)?.length).toBe(2);
  });
});
