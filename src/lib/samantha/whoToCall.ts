/**
 * whoToCall.ts — which party a Benefits rep calls for each check
 * (HANDOFF-Josh-Who-To-Call.md, Brandon 2026-10-01). Display only: nothing
 * here decides how a check is ANSWERED or written — our own in-network rules
 * are unchanged, and nothing is sourced from Stedi's "In Network?" field.
 *
 * UI-free, like `submitAuthRules.ts`; exercised by `whoToCall.test.ts`.
 *
 * ⚠️⚠️ **THE ADDRESS DECIDES THE ROUTE — never the card, the label or the
 * referral source.** CareCentrix runs the DME network AND the auths for
 * Horizon (NJ) and Florida Blue (FL), and for every out-of-state Blue member
 * LIVING in those states. Asking Horizon whether we're in-network is what
 * went wrong with Mark: Horizon answered as if we billed Horizon directly. So
 * a Horizon member referred by their own doctor still routes through
 * CareCentrix, and so does an Anthem card with an NJ address. The claims tool
 * already routes by address (`claims-ui-tool/ANTHEM_SUBMISSION_RULES.md`);
 * this must match it.
 *
 * Pills show only when ALL of: Primary Insurance is in `BCBS_FAMILY`, the
 * patient address resolves to a state (never guessed), and the member is not
 * FEP (`R` + 8 digits — out of scope for v1, handoff §8). Every other payer
 * gets no pills, same as before.
 *
 * `resolveState` and `BCBS_FAMILY` come from `lib/shared/pos.ts`, the single
 * source of truth — never a third state parser.
 */
import { BCBS_FAMILY, resolveState } from "@/lib/shared/pos";
import type { Patient } from "./workflow";

export type CallCheck = "in-network" | "active" | "dme-benefits" | "auth" | "sos";
/** billed = our side (the plan or manager we bill) → mint chip.
 *  member = the member's own plan, when it's a different party → teal chip. */
export type CallSide = "billed" | "member";
export interface CallTarget {
  name: string;
  side: CallSide;
}
export interface WhoToCall {
  route: "carecentrix" | "bluecard";
  byCheck: Record<CallCheck, CallTarget>;
  /** CareCentrix route: show the "in-network benefits only" hint on DME Benefits. */
  dmeInNetworkOnly: boolean;
}

export const CARECENTRIX = "CareCentrix";
/** States whose host Blue plan delegates DME (network + auth) to CareCentrix:
 *  NJ = Horizon BCBS, FL = Florida Blue (BCBS FL). Add a state here, nowhere else. */
export const CARECENTRIX_STATES: ReadonlySet<string> = new Set(["NJ", "FL"]);
/** FEP — out of scope for v1 (handoff §8: who handles FEP network and auth in
 *  NJ is still to be confirmed). */
const FEP_MEMBER_ID = /^R\d{8}$/i;
const firstWord = (s: string) => (s.trim().split(/\s+/)[0] ?? "").toLowerCase();

export function whoToCall(p: Patient): WhoToCall | null {
  const primary = (p.primaryInsurance ?? "").trim();
  if (!BCBS_FAMILY.has(primary)) return null;
  if (FEP_MEMBER_ID.test((p.memberId1 ?? "").trim())) return null;
  const state = resolveState(p.patientAddress ?? "");
  if (!state) return null;

  /** Member's plan = the Stedi Home Plan, else Primary Insurance. */
  const home = (p.homePlan ?? "").trim();

  if (CARECENTRIX_STATES.has(state)) {
    // ⚠️ Never collapses: CareCentrix and the member's plan are always two
    // different parties.
    const member: CallTarget = { name: home || primary, side: "member" };
    const cc: CallTarget = { name: CARECENTRIX, side: "billed" };
    return {
      route: "carecentrix",
      dmeInNetworkOnly: true,
      byCheck: { "in-network": cc, active: member, "dme-benefits": member, auth: cc, sos: cc },
    };
  }

  const billed: CallTarget = { name: primary, side: "billed" };
  // BlueCard collapse: same family by first word, as `authHomePlan` compares
  // ("Horizon BCBSNJ" vs "Horizon BCBS").
  const same = !home || firstWord(home) === firstWord(primary);
  const member: CallTarget = same ? billed : { name: home, side: "member" };
  return {
    route: "bluecard",
    dmeInNetworkOnly: false,
    byCheck: { "in-network": billed, active: member, "dme-benefits": member, auth: member, sos: billed },
  };
}

/**
 * The step-2 header's suggestion chips (handoff §3c): ONE chip when Auth and
 * SoS go to the same party (the CareCentrix route, or a collapsed BlueCard),
 * else two, prefixed "Auth →" and "SoS →".
 */
export function step2Suggestion(w: WhoToCall): Array<{ prefix: string; target: CallTarget }> {
  const { auth, sos } = w.byCheck;
  if (auth.name === sos.name) return [{ prefix: "", target: auth }];
  return [
    { prefix: "Auth →", target: auth },
    { prefix: "SoS →", target: sos },
  ];
}

/**
 * The CareCentrix auth banner on Submit Auth and Auth Outstanding (handoff
 * §2b): *"Auths go through CareCentrix — they manage DME for {host} members —
 * not {member's plan}."* Null off the CareCentrix route.
 */
export function carecentrixAuthNote(p: Patient): { host: string; member: string } | null {
  const w = whoToCall(p);
  if (w?.route !== "carecentrix") return null;
  return { host: (p.primaryInsurance ?? "").trim(), member: w.byCheck.active.name };
}
