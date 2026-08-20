/**
 * Test-only stand-in for `google-auth-library`.
 *
 * The gateway's deps live in services/monday-gateway/package.json and are not
 * installed at the repo root, so importing any module that reaches auth.mjs
 * fails to resolve under the root vitest run. That is why the pure rules here
 * are split into their own modules (callRules, rcAllowlist, rcLimiter…).
 *
 * ⚠️ This stub exists so the WIRING can be tested too — rcLimiter.test.mjs
 * proves the rate-limit rules, and rcApiFetch.test.mjs proves they are actually
 * attached to the code path that calls RingCentral. On 2026-08-20 the rules
 * that were missing were not subtle; what was missing was any test that a real
 * request went through anything at all.
 *
 * It is aliased in vitest.config.ts and is never bundled or deployed. Nothing
 * here verifies a token — a test that reached real verification would be
 * testing Google, not us.
 */
export class OAuth2Client {
  constructor(clientId) {
    this.clientId = clientId;
  }
  async verifyIdToken() {
    throw new Error("google-auth-library is stubbed in tests");
  }
}
export default { OAuth2Client };
