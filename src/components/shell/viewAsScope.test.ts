/**
 * Where a borrowed identity reaches, and where it must not (§5.39h).
 *
 * Josh, 2026-09-19: *"clicking that should show me exactly what the other
 * logins see when they login. the whole ui should be EXACTLY what they see"* ·
 * *"if mashekes view has patient communication assigned and i view her view it
 * should appear"*. So the borrow is the WHOLE chrome, not one pane — which
 * makes exactly where it stops a thing worth pinning, because every one of
 * these failures is silent.
 *
 * ⚠️⚠️ **THE HEADER ANSWERS FOR THE BORROWED PERSON; EVERY WRITE GATE ANSWERS
 * FOR ME.** The header's question is *what does their screen look like*, so a
 * tab they do not have must disappear. `AbilityGate`, `AbilityLock` and the
 * two write guards ask *may I do this*, and borrowing somebody's view must
 * never hand me their access — nor take away my own.
 *
 * ⚠️⚠️ **THE SOFTPHONE IS NEVER BORROWED.** `canAnswerCalls` drives a real SIP
 * registration on a shared RingCentral extension capped at five devices
 * (§5.13b). Borrowing an answerer's view would register THIS browser, take a
 * slot from somebody who is actually on the rota, and ring a phone nobody is
 * sitting at. `CallConnectionBadge` owns that gate and the header must not
 * re-answer it.
 *
 * Source scans (the `listColumns.test.ts` convention): each one is verified to
 * fail when its protection is removed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

describe("⚠️ the borrow reaches the header", () => {
  const header = live(read("components/shell/GlobalHeader.tsx"));

  it("resolves an EFFECTIVE identity from the viewAs store", () => {
    expect(header).toContain("useViewAs()");
    expect(header).toContain("const who = borrowing && mayBorrow ? borrowing : email;");
  });

  it("⚠️ a revoked `viewOthers` ends the borrow rather than stranding somebody", () => {
    // The grant is opt-in and can be taken away while a tab is open; without
    // this the header would keep showing another person's chrome with no
    // dropdown left to leave it.
    expect(header).toContain('hasAbility(email, config, "viewOthers")');
  });

  it("tabs and Users answer for `who`", () => {
    // (The settings menu's manager entry left on 2026-09-25, so `isManagerOf`
    // is no longer read here at all — only the tab gates and the admin-only
    // Users button remain, and both must answer for the borrowed `who`.)
    expect(header).toContain("TABS.filter((t) => !t.ability || hasAbility(who, config, t.ability))");
    expect(header).toContain("isAdmin(who, config)");
  });

  it("⚠️⚠️ and the softphone does NOT — it is the shared component, ungated here", () => {
    expect(header).toContain("<CallConnectionBadge compact />");
    // A second copy of the rota check in the header is how an unassigned
    // person gets a phone icon, or an assigned one silently loses theirs.
    expect(header).not.toContain("canAnswerCalls");
    expect(live(read("components/inboundCalls/CallConnectionBadge.tsx"))).toContain("canAnswerCalls");
  });
});

describe("⚠️⚠️ the borrow does NOT reach anything that writes", () => {
  it("AbilityGate reads the signed-in person", () => {
    const gate = live(read("components/shell/AbilityGate.tsx"));
    expect(gate).toContain("const { email, config } = useAccessContext();");
    expect(gate).toContain("hasAbility(email, config, ability)");
    expect(gate).not.toContain("useViewAs");
  });

  it("AbilityLock reads the signed-in person", () => {
    const lock = live(read("components/shell/AbilityLock.tsx"));
    expect(lock).toContain("const { email, config } = useAccessContext();");
    expect(lock).not.toContain("useViewAs");
  });

  for (const [file, what] of [
    ["pages/OrdersPage.tsx", "the backorder substitution"],
    ["pages/SubscriptionPage.tsx", "the Subscription send"],
    ["pages/UpdateClinicalsPage.tsx", "the visit-date save"],
    // ⚠️ Where that save now lives, and it renders on TWO screens (§5.39c4).
    ["components/updateClinicals/ClinicalsWork.tsx", "the clinicals work pane"],
    ["pages/FaxBarPage.tsx", "the Fax bar's right pane"],
  ] as const) {
    it(`${what} never consults the borrowed identity`, () => {
      expect(live(read(file))).not.toContain("useViewAs");
    });
  }

  it("the viewAs store says all of this in place", () => {
    const store = read("lib/shell/viewAs.ts");
    expect(store).toMatch(/never|NEVER/);
    expect(store).toContain("canAnswerCalls");
  });
});

describe("⚠️ every ability actually gates something", () => {
  it("comms — the Communications page, not just the tab", () => {
    // A gate on the tab is not a gate on the page: the route still answers a
    // typed URL, a bookmark and a Back.
    const app = live(read("App.tsx"));
    expect(app).toContain('<AbilityGate ability="comms">');
  });

  it("inventory — the stock view inside /orders", () => {
    expect(live(read("pages/OrdersPage.tsx"))).toContain('<AbilityGate ability="inventory">');
  });

  it("reports — Operations, which is what the Reports & Metrics tab opens", () => {
    expect(live(read("pages/SystemMgmtPage.tsx"))).toContain('<AbilityGate ability="reports">');
  });

  it("⚠️ adjustOrders — the substitution CARD, not a button that refuses after the press", () => {
    // Picking the replacement IS the send: the column change is what emails
    // Cardinal (§5.35). There is no draft and no undo, so the control cannot
    // be offered to somebody whose press would be refused.
    const orders = live(read("pages/OrdersPage.tsx"));
    expect(orders).toContain('hasAbility(myEmail, accessConfig, "adjustOrders")');
    expect(orders).toContain("canAdjustOrders && (");
  });

  it("⚠️ editProfile — BOTH halves of Brandon's definition, and on the write as well as the button", () => {
    // "Can change the Subscription profile — Order details, visit date, MN
    // docs, address and phone; without it the profile is read-only."
    const sub = live(read("pages/SubscriptionPage.tsx"));
    expect(sub).toContain('useAbility("editProfile")');
    expect(sub).toContain("if (!canEditProfile) return;");
    expect(sub).toContain('<AbilityLockNote ability="editProfile" />');

    // ⚠️ The visit date lives in `ClinicalsWork`, not the page, since
    // 2026-09-21 (§5.39c4) — and that makes this assertion MORE load-bearing,
    // not less: the same card now renders on `/update-clinicals` AND in the Fax
    // bar's right pane, so a gate inside the card holds on both, where a gate
    // on the page would have covered one of them.
    const clin = live(read("components/updateClinicals/ClinicalsWork.tsx"));
    expect(clin).toContain('useAbility("editProfile")');
    expect(clin).toContain("if (!canEditProfile) return;");
    expect(clin).toContain("disabled={!visitDate || saving || !canEditProfile}");
    // And the page no longer carries a second copy of the gate to drift from it.
    expect(live(read("pages/UpdateClinicalsPage.tsx"))).not.toContain('useAbility("editProfile")');
  });

  it("⚠️ and it never hides the patient — the profile still renders", () => {
    // §5.39c, Brandon's own rule: abilities unlock buttons, they never hide
    // information. The read-only path must render the same cards.
    const sub = live(read("pages/SubscriptionPage.tsx"));
    const body = sub.slice(sub.indexOf("{selected && ("));
    expect(body).toContain("<PatientInfoCard");
    expect(body).toContain("<SubscriptionForm");
    // Notes stay writable: a running case history is not the profile.
    expect(body).toContain("onSaveToMonday");
  });
});
