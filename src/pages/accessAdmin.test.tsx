/**
 * User management — Brandon's cards over the same writers (pixel-match Phase 6c,
 * §5.52). The look is his; the test is that every save the page has always made
 * is still made, from the control he draws for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccessConfig } from "@/lib/accessStore";

const w = vi.hoisted(() => ({
  addManager: vi.fn(), setManager: vi.fn(), removeEmail: vi.fn(), addProcessor: vi.fn(),
  setProcessorName: vi.fn(), setProcessorPhone: vi.fn(), toggleProcessorRole: vi.fn(),
  setRoleFilter: vi.fn(), setRoleOrder: vi.fn(), setCallAnswerer: vi.fn(() => true),
  setAbility: vi.fn(), setHomeView: vi.fn(), setAdmin: vi.fn(),
}));
const state = vi.hoisted(() => ({ type: "manager", config: {} as unknown }));

vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({
    access: { type: state.type },
    email: "josh@medicallymodern.com",
    config: state.config,
    ...w,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AccessAdminPage from "./AccessAdminPage";
import { toast } from "sonner";

const ME = "josh@medicallymodern.com";
const MASANI = "masani@medicallymodern.com";
const COREY = "corey@medicallymodern.com";

function cfg(): AccessConfig {
  return {
    managers: [ME, COREY],
    processors: {
      [ME]: { name: "Josh Hoffman", roles: ["evaluate", "welcomeCall"], homeView: ["oversight", "bars"], perms: { viewOthers: true } },
      [MASANI]: { name: "Masani Sample", roles: ["unverifiedReferrals"], phoneNumber: "5555550100", roleFilters: { unverifiedReferrals: "all" }, roleOrder: { unverifiedReferrals: 2 } },
    },
    callAnswerers: [ME],
    admins: [],
  } as AccessConfig;
}

beforeEach(() => {
  state.type = "manager";
  state.config = cfg();
  for (const fn of Object.values(w)) fn.mockClear();
  w.setCallAnswerer.mockReturnValue(true);
});

const mount = () => render(<MemoryRouter><AccessAdminPage /></MemoryRouter>);
const card = (email: string) => document.querySelector(`[data-person="${email}"]`) as HTMLElement;

describe("User management", () => {
  it("is Brandon's page: the header, an Add card, and a card per person — no answering count (§5.13c)", () => {
    mount();
    expect(screen.getByRole("heading", { name: "User management" })).toBeTruthy();
    // Retired 2026-09-30: connecting your own RingCentral line is what rings you.
    expect(screen.queryByText(/call-answering devices in use/)).toBeNull();
    expect(screen.getByText("+ Add a person")).toBeTruthy();
    expect(document.querySelectorAll(".ucard")).toHaveLength(3);
    // The header row: avatar initial, name, email, chips.
    const c = card(MASANI);
    expect(c.querySelector(".avatar")!.textContent).toBe("M");
    expect(within(c).getByText("Masani Sample")).toBeTruthy();
    expect(within(c).getByText(MASANI)).toBeTruthy();
    expect([...c.querySelectorAll(".chips .chip")].map((x) => x.textContent)).toEqual(["Stages"]);
    const mine = card(ME);
    expect([...mine.querySelectorAll(".chips .chip")].map((x) => x.textContent)).toEqual(["Manager", "Oversight | Stages"]);
    expect(within(mine).getByText("(you)")).toBeTruthy();
  });

  it("the Admin chip is explicit only — bootstrap's everyone-is-an-admin does not wear it", () => {
    mount();
    expect(card(ME).querySelector(".chip.navy")).toBeNull();
    (state.config as AccessConfig).admins = [ME];
    mount();
    expect(document.querySelectorAll(`[data-person="${ME}"] .chip.navy`)).toHaveLength(1);
  });

  it("Add makes a processor; Add as manager makes a manager", () => {
    mount();
    // Scoped to the Add card — every person card carries a "Display name" input too.
    const add = within(document.querySelector(".acc-body > section") as HTMLElement);
    fireEvent.change(add.getByLabelText("Email"), { target: { value: "new@medicallymodern.com" } });
    fireEvent.change(add.getByLabelText("Display name"), { target: { value: "New Person" } });
    fireEvent.click(add.getByRole("button", { name: /^Add$/ }));
    expect(w.addProcessor).toHaveBeenCalledWith("new@medicallymodern.com", "New Person");
    fireEvent.change(add.getByLabelText("Email"), { target: { value: "mgr@medicallymodern.com" } });
    fireEvent.click(add.getByRole("button", { name: /Add as manager/ }));
    expect(w.addManager).toHaveBeenCalledWith("mgr@medicallymodern.com");
  });

  it("the name and call-me-at inputs write through the same two writers", () => {
    mount();
    const c = card(MASANI);
    fireEvent.change(within(c).getByLabelText("Display name"), { target: { value: "Masani S" } });
    expect(w.setProcessorName).toHaveBeenCalledWith(MASANI, "Masani S");
    const phone = within(c).getByLabelText("Call-me-at number") as HTMLInputElement;
    expect(phone.value).toBe("5555550100");
    fireEvent.change(phone, { target: { value: "5555550199" } });
    expect(w.setProcessorPhone).toHaveBeenCalledWith(MASANI, "5555550199");
    // A pure manager has no profile to name, and says so instead of drawing dead inputs.
    expect(within(card(COREY)).getByText("manager only")).toBeTruthy();
    expect(within(card(COREY)).queryByLabelText("Display name")).toBeNull();
  });

  it("Remove removes anybody but you", () => {
    mount();
    fireEvent.click(within(card(MASANI)).getByRole("button", { name: /Remove/ }));
    expect(w.removeEmail).toHaveBeenCalledWith(MASANI);
    const mine = within(card(ME)).getByRole("button", { name: /Remove/ }) as HTMLButtonElement;
    expect(mine.disabled).toBe(true);
    fireEvent.click(mine);
    expect(w.removeEmail).toHaveBeenCalledTimes(1);
  });

  it("the custom-view chips: on = blue pill, the last view can't go, a non-landing view promotes", () => {
    mount();
    const c = card(MASANI);
    const bars = within(c).getByRole("button", { name: /Stages \(bars\)/ }) as HTMLButtonElement;
    expect(bars.className).toContain("on");
    expect(bars.disabled).toBe(true); // the only view
    fireEvent.click(within(c).getByRole("button", { name: /Manager oversight/ }));
    expect(w.setHomeView).toHaveBeenCalledWith(MASANI, "oversight", true);
    // Josh lands on Oversight with Stages second: clicking Stages promotes it (on: true), Oversight toggles off.
    const mine = card(ME);
    expect(within(mine).getByText(/Lands on/).textContent).toContain("Oversight");
    fireEvent.click(within(mine).getByRole("button", { name: /Stages \(bars\)/ }));
    expect(w.setHomeView).toHaveBeenCalledWith(ME, "bars", true);
    fireEvent.click(within(mine).getByRole("button", { name: /Manager oversight/ }));
    expect(w.setHomeView).toHaveBeenCalledWith(ME, "oversight", false);
  });

  it("the ability chips read the real stored value and write setAbility", () => {
    mount();
    const c = card(MASANI);
    const comms = within(c).getByRole("button", { name: /Patient communication/ });
    expect(comms.className).toContain("on"); // absent = on
    fireEvent.click(comms);
    expect(w.setAbility).toHaveBeenCalledWith(MASANI, "comms", false);
    const vo = within(c).getByRole("button", { name: /View others' views/ });
    expect(vo.className).not.toContain("on"); // opt-in = off until granted
    fireEvent.click(vo);
    expect(w.setAbility).toHaveBeenCalledWith(MASANI, "viewOthers", true);
    // Josh holds it explicitly.
    expect(within(card(ME)).getByRole("button", { name: /View others' views/ }).className).toContain("on");
  });

  it("Manager and Admin are on the abilities row, in his colours, on their own writers — and Answers calls is gone", () => {
    mount();
    const c = card(MASANI);
    expect(within(c).queryByRole("button", { name: /Answers calls/ })).toBeNull();
    const mgr = within(c).getByRole("button", { name: /^Manager$/ });
    expect(mgr.className).toContain("warn");
    expect(mgr.className).not.toContain("on");
    fireEvent.click(mgr);
    expect(w.setManager).toHaveBeenCalledWith(MASANI, true);
    const adm = within(c).getByRole("button", { name: /Admin/ });
    expect(adm.className).toContain("adm");
    fireEvent.click(adm);
    // Bootstrap (no admins named) makes every MANAGER an admin; Masani is not one, so the click grants it.
    expect(w.setAdmin).toHaveBeenCalledWith(MASANI, true);
    // Your own Manager chip is amber and can't be turned off.
    const mine = within(card(ME)).getByRole("button", { name: /^Manager$/ }) as HTMLButtonElement;
    expect(mine.className).toContain("on");
    expect(mine.disabled).toBe(true);
  });

  it("the bars: his role-cell grid, the filter and the order on a role that is on", () => {
    mount();
    const c = card(MASANI);
    expect(within(c).getByText("1 on the Stages view")).toBeTruthy();
    const cells = c.querySelectorAll(".role-cell");
    expect(cells.length).toBeGreaterThan(20);
    const on = c.querySelector(".role-cell.on") as HTMLElement;
    expect(within(on).getByText("Non-Referral Intake — Info Collection")).toBeTruthy();
    const sel = within(on).getByLabelText("Filter") as HTMLSelectElement;
    expect(sel.value).toBe("all");
    fireEvent.change(sel, { target: { value: "escalated" } });
    expect(w.setRoleFilter).toHaveBeenCalledWith(MASANI, "unverifiedReferrals", "escalated");
    const ord = within(on).getByLabelText("Order") as HTMLInputElement;
    expect(ord.value).toBe("2");
    fireEvent.change(ord, { target: { value: "" } });
    expect(w.setRoleOrder).toHaveBeenCalledWith(MASANI, "unverifiedReferrals", null);
    // An off role has no filter or order, and its checkbox toggles it on.
    const off = [...cells].find((x) => !x.classList.contains("on")) as HTMLElement;
    expect(off.querySelector("select")).toBeNull();
    fireEvent.click(off.querySelector("input[type=checkbox]")!);
    expect(w.toggleProcessorRole).toHaveBeenCalledTimes(1);
    // Welcome Call offers the two cross-sell scopes; nothing else does.
    const wc = [...card(ME).querySelectorAll(".role-cell.on")].find((x) => x.textContent!.includes("Welcome Call")) as HTMLElement;
    expect([...wc.querySelectorAll("option")].map((o) => o.textContent)).toContain("Cross-sells only");
    expect([...on.querySelectorAll("option")].map((o) => o.textContent)).not.toContain("Cross-sells only");
  });

  it("a person whose home is not the bars says where their queues went", () => {
    (state.config as AccessConfig).processors[MASANI].homeView = ["coordinator"];
    mount();
    expect(within(card(MASANI)).getByText(/not shown on the My Patients view — the queues still open/)).toBeTruthy();
  });

  it("managers only — the refusal is a sentence and a way home, not a blank page", () => {
    state.type = "processor";
    mount();
    expect(screen.getByRole("heading", { name: "Managers only." })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Back to home/ })).toBeTruthy();
  });
});

describe("scans", () => {
  const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
  it("⚠️ every writer the page has always called is still called — the look is his, the saves are ours", () => {
    const page = src("AccessAdminPage.tsx").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const fn of [
      "addManager(", "setManager(", "removeEmail(", "addProcessor(", "setProcessorName(", "setProcessorPhone(",
      "toggleProcessorRole(", "setRoleFilter(", "setRoleOrder(", "setAbility(", "setHomeView(", "setAdmin(",
    ]) {
      expect(page, `the page stopped calling ${fn}`).toContain(fn);
    }
    expect(page).toContain("<AbilitiesEditor");
  });
  it("the stylesheet is scoped under .cc-us, reads tokens only, and cancels Tailwind's `outline`", () => {
    const css = src("access/users.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = css.match(/^[^@\s{}][^{}]*(?=\{)/gm) ?? [];
    for (const sel of selectors) {
      for (const part of sel.split(",")) {
        expect(/^(\.cc-us|\.dark \.cc-us|:root\[data-theme="dark"\] \.cc-us)/.test(part.trim()), part).toBe(true);
      }
    }
    expect(css.replace(/#fff\b/g, "")).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(css).toMatch(/\.cc-us \.btn\.outline \{[^}]*outline-style: none/);
  });
});
