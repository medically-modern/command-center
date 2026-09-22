/**
 * Where the "Log call attempt" control lives, and the two structural rules that
 * make its second placement legal.
 *
 * Josh, 2026-09-22: *"log attempts should be at bottom - press when attempted,
 * and then move next action date (should be available on the list view too,
 * not just the profile view)"*.
 *
 * Both halves are invisible failures if they regress — a control that moved
 * back to the header still works, and a button nested inside the row button
 * still renders — so they are scanned rather than trusted.
 *
 * Run: npx vitest run src/components/welcomeCall/callAttemptPlacement.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

describe("the profile view — at the FOOT of the call form, not in the header", () => {
  it("the navy header no longer carries it", () => {
    const page = read("../../pages/WelcomeCallPage.tsx");
    expect(page).not.toMatch(/<CallAttemptsCounter/);
    expect(page).not.toMatch(/import \{ CallAttemptsCounter \}/);
  });

  it("End of Call mounts it, keyed by patient", () => {
    const form = read("./WelcomeCallForm.tsx");
    expect(form).toMatch(/import \{ CallAttemptsCounter \} from "\.\/CallAttemptsCounter"/);
    const mount = form.slice(form.indexOf("<CallAttemptsCounter"));
    // Keyed, or a saving spinner survives a sidebar click and reports the
    // PREVIOUS patient's write against the open one (§9's notes-box rule).
    expect(mount).toMatch(/key=\{patient\.id\}/);
    expect(mount).toMatch(/itemId=\{patient\.id\}/);
    expect(mount).toMatch(/callAttempts=\{patient\.callAttempts\}/);
  });

  it("it sits INSIDE section 8, after the Advance / Propose Stuck pair", () => {
    const form = read("./WelcomeCallForm.tsx");
    const endOfCall = form.indexOf('title="End of Call"');
    const advance = form.indexOf("ADVANCE_INDEX", endOfCall);
    const counter = form.indexOf("<CallAttemptsCounter", endOfCall);
    expect(endOfCall).toBeGreaterThan(-1);
    expect(counter).toBeGreaterThan(advance);
  });

  it("the page threads the write's two callbacks down", () => {
    const page = read("../../pages/WelcomeCallPage.tsx");
    expect(page).toMatch(/onCallAttemptsChange=\{\(v\) => update\(selected\.id, \{ callAttempts: v \}\)\}/);
    expect(page).toMatch(/onLoggedAttempt=\{refetch\}/);
  });
});

describe("the list view — a SIBLING of the row button, never a child", () => {
  const sidebar = read("./PatientsSidebar.tsx");

  it("Active rows carry the row variant", () => {
    expect(sidebar).toMatch(/import \{ CallAttemptsCounter \} from "\.\/CallAttemptsCounter"/);
    expect(sidebar).toMatch(/variant="row"/);
    expect(sidebar).toMatch(/onFollowUp=\{onRefresh\}/);
  });

  it("⚠️ it is OUTSIDE SidebarMenuButton — a nested <button> is invalid HTML", () => {
    // Find the Active row's item and check the counter falls after the row
    // button closes. A browser is free to re-parent a nested button, and a
    // screen reader cannot announce the inner control at all.
    const item = sidebar.slice(sidebar.indexOf("{activePatients.map("));
    const closeBtn = item.indexOf("</SidebarMenuButton>");
    const counter = item.indexOf("<CallAttemptsCounter");
    const closeItem = item.indexOf("</SidebarMenuItem>");
    expect(closeBtn).toBeGreaterThan(-1);
    expect(counter).toBeGreaterThan(closeBtn);
    expect(counter).toBeLessThan(closeItem);
  });

  it("the subtitle reserves room so a long payer cannot run under the pill", () => {
    expect(sidebar).toMatch(/text-\[11px\] text-muted-foreground truncate pr-12/);
  });
});

describe("the counter itself", () => {
  const src = read("./CallAttemptsCounter.tsx");

  it("the row variant positions itself and swallows its own click", () => {
    const row = src.slice(src.indexOf('if (variant === "row")'));
    // Absolute, because the caller's SidebarMenuItem is the only `relative` box.
    expect(row).toMatch(/absolute bottom-1 right-1/);
    // Without both of these, pressing +1 also selects the patient and
    // navigates the pane out from under the rep.
    expect(row).toMatch(/e\.stopPropagation\(\)/);
    expect(row).toMatch(/e\.preventDefault\(\)/);
  });

  it("⚠️ bottom-right, because ContactStateMarks owns the top-right gutter", () => {
    const marks = read("../shared/ContactStateMarks.tsx");
    expect(marks).toMatch(/absolute right-1 top-1\.5/);
    const row = src.slice(src.indexOf('if (variant === "row")'));
    expect(row).not.toMatch(/top-1\.5/);
  });

  it("writes BOTH columns — the count and the follow-up that moves the patient", () => {
    expect(src).toMatch(/sendCallAttemptsToMonday\(itemId, newCount\)/);
    expect(src).toMatch(/sendFollowUpToMonday\(itemId, tomorrow\)/);
  });

  it("takes its date from the shared helper, so both stages push the same day", () => {
    expect(src).toMatch(/defaultFollowUpDate\(etToday\(\)\)/);
  });

  it("reverts the optimistic count when the write fails", () => {
    expect(src).toMatch(/onUpdate\?\.\(String\(count\)\)/);
  });
});
