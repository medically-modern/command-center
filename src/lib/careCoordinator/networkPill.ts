/**
 * The network pill on a Patient Intake card — one pill where the benefits
 * check's verdict used to take a banner and a line.
 *
 * Brandon, 2026-09-24 (Masani dashboard notes): *"Instead of the benefits check
 * failed banner or the benefits check hasn't run banner or the in network:
 * no/yes, let's just replace all of that with a pill where it currently shows
 * in network: yes/no, where it'll either say In-network (green pill) ·
 * Out-of-network (red pill) · And if it hasn't been run yet, it'll just stay
 * blank"*. Josh chose the two states that list did not cover: a check that
 * FAILED is a red "Check failed" pill (the payer's reason on hover), and the
 * board's own `Unknown` is a gray "Network unknown".
 *
 * Measured on the live board 2026-09-24, In Network `text_mm1xehx8` holds:
 * **Yes 485 · Unknown 224 · No 40 · blank 2,034**, and one free-text answer
 * ("Check with patient: lives in NY, NJ, FL or TN?"). §5.20 recorded on
 * 2026-08-25 that no real "No" had ever been written; forty have since.
 *
 * ⚠️ **The rule is `profile/networkVerdict.networkVerdictOf`, never a second
 * copy** — the same one the profile page's readout and
 * `intakeUnlock.networkAnswer` read. They must agree about what counts as a
 * Yes, or a coordinator sees green here and "No" one click in.
 *
 * ⚠️ **The two "Check …" answers are AMBER** (§5.20b). That "free-text" row
 * was the first of the backend's new contract, deployed the same day: after
 * every successful check the column now holds exactly one of `Yes` · `No` ·
 * `Check with patient: lives in NY, NJ, FL or TN?` · `Check manually`. Neither
 * "Check" is a No, and neither is a Yes a coordinator can pass through, so
 * they get the colour that means "somebody has to ask, or look". Check with
 * patient reads in Josh's words (*"only in-network if patient lives in NY, NJ,
 * FL or TN?"*, plus Wyoming), with the backend's own sentence on hover.
 *
 * ⚠️ **Any other answer is shown VERBATIM, gray** — §5.20's `networkLabel`
 * rule: rewording a value we have no rule for throws away what the service
 * said. Only the board's literal `Unknown` is reworded, because that one IS a
 * known answer — Original Medicare has no network — and Josh chose the words.
 * Rows checked before 2026-09-24 keep theirs until the check is re-run.
 *
 * ⚠️ **A failed check outranks whatever the column still says.** A failure
 * means the identifiers did not match, so any network answer beside it is from
 * an EARLIER run and describes a patient we could not just confirm (the same
 * ordering `intakeBlocker` has always used).
 *
 * ⚠️ It blocks nothing — the network answer was removed as an advance gate on
 * 2026-08-25 (§5.20), and a pill is a readout.
 */
import { CHECK_MANUALLY_HINT, NETWORK_CARD_CHECK_TEXT, networkVerdictOf } from "@/lib/profile/networkVerdict";
import { intakeBlockerDetail, type IntakeLead } from "./workflow";

export type NetworkPillTone = "green" | "red" | "amber" | "gray";

export interface NetworkPill {
  label: string;
  tone: NetworkPillTone;
  /** The hover text — for a failed check, the payer's own reason and AAA code. */
  title: string;
}

/** The board's own word for "the payer did not say" (Original Medicare). */
const BOARD_UNKNOWN = "unknown";

/** The pill for one lead, or `null` when the check has not run — Brandon's
 *  "it'll just stay blank". */
export function networkPill(
  lead: Pick<IntakeLead, "stediError" | "stediInNetwork">,
): NetworkPill | null {
  const reason = intakeBlockerDetail(lead);
  if (reason) {
    return {
      label: "Check failed",
      tone: "red",
      title: `Benefits check failed — ${reason}`,
    };
  }
  const raw = (lead.stediInNetwork ?? "").trim();
  switch (networkVerdictOf(raw)) {
    case "none":
      return null;
    case "yes":
      return { label: "In-network", tone: "green", title: "The benefits check says this plan is in network" };
    case "no":
      return { label: "Out-of-network", tone: "red", title: "The benefits check says this plan is out of network" };
    case "checkWithPatient":
      return {
        label: NETWORK_CARD_CHECK_TEXT,
        tone: "amber",
        title: `Anthem BCBS Commercial. The benefits check said "${raw}" — confirm where they live on the profile page.`,
      };
    case "checkManually":
      return { label: "Check manually", tone: "amber", title: CHECK_MANUALLY_HINT };
    default:
      return raw.toLowerCase() === BOARD_UNKNOWN
        ? {
            label: "Network unknown",
            tone: "gray",
            title: "The benefits check did not say — Original Medicare has no network, so it comes back Unknown",
          }
        : { label: raw, tone: "gray", title: `The benefits check said: ${raw}` };
  }
}
