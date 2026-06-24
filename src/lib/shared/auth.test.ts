/**
 * Auth gate persistence — "sign-in is a gate, not a ticking token".
 *
 * The session must survive Google ID-token expiry (tokens always lapse ~1h
 * after issue). Once a valid @domain account has signed in, the user stays
 * signed in until they explicitly sign out. These tests lock that in so a
 * future refactor can't reintroduce the hourly logout.
 */
import { describe, it, expect, vi } from "vitest";

const nowSec = () => Math.floor(Date.now() / 1000);

/** A stored session whose token expires `expInSec` seconds from now
 *  (negative = already expired). */
function storedUser(expInSec: number) {
  return {
    email: "rep@medicallymodern.com",
    name: "Rep Example",
    exp: nowSec() + expInSec,
    token: "header.payload.sig",
  };
}

/** Re-import the auth module with a clean localStorage so module-load state
 *  (`let current = loadStored()`) reflects exactly what we seed. */
async function loadAuth(stored?: unknown) {
  vi.resetModules();
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem("mm-auth", JSON.stringify(stored));
  return import("@/lib/shared/auth");
}

describe("auth gate persistence", () => {
  it("keeps the user signed in even when the ID token expired an hour ago", async () => {
    const auth = await loadAuth(storedUser(-3600));
    expect(auth.isAuthed()).toBe(true);
    expect(auth.getUser()?.email).toBe("rep@medicallymodern.com");
  });

  it("getUser() does not clear an expired session from storage", async () => {
    const auth = await loadAuth(storedUser(-60));
    auth.getUser();
    auth.getUser();
    expect(auth.isAuthed()).toBe(true);
    expect(localStorage.getItem("mm-auth")).not.toBeNull();
  });

  it("tokenIsFresh() reports token validity without ending the session", async () => {
    const expired = await loadAuth(storedUser(-60));
    expect(expired.tokenIsFresh()).toBe(false);
    expect(expired.isAuthed()).toBe(true); // still gated in

    const fresh = await loadAuth(storedUser(1800));
    expect(fresh.tokenIsFresh()).toBe(true);
    expect(fresh.isAuthed()).toBe(true);
  });

  it("ignores a stored blob with no email (nothing to gate on)", async () => {
    const auth = await loadAuth({ token: "x", exp: nowSec() + 1000 });
    expect(auth.isAuthed()).toBe(false);
    expect(auth.getUser()).toBeNull();
  });

  it("signOut() is the only thing that ends the session", async () => {
    const auth = await loadAuth(storedUser(-60));
    expect(auth.isAuthed()).toBe(true);
    auth.signOut();
    expect(auth.isAuthed()).toBe(false);
    expect(localStorage.getItem("mm-auth")).toBeNull();
  });
});
