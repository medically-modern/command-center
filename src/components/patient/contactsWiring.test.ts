/**
 * ⚠️ **The contacts block is WIRED** (§5.46e).
 *
 * §5.31b's rule: *"a module nobody calls does not fail; it is absent, and its
 * green tests say otherwise."* Every assertion here is a source scan, because
 * each failure is silent on screen — a column that is not fetched reads blank
 * on every patient, a `canText` prop that is not passed blocks nobody, and a
 * truthiness test where an explicit `"no"` is meant would block texting for the
 * whole board.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const DOSSIER_API = src("src/lib/commsHub/dossierApi.ts");
const PATIENT_PAGE = src("src/pages/PatientPage.tsx");
const COMMS_COLUMN = src("src/components/patient/PatientCommsColumn.tsx");
const THREAD = src("src/components/assignedPatients/ConversationThread.tsx");
// The guards moved into the shared composer (COMMS_INBOX_PLAN.md §4.6) so the
// inbox's timeline renders the same one — scanned there now.
const COMPOSER = src("src/components/assignedPatients/Composer.tsx");
const SUB_VIEW = src("src/components/patient/SubscriptionView.tsx");
/** Since 2026-09-24 the block is inside Brandon's Demographics card (his item
 *  7), not a card of its own — and it is EDITABLE there (Josh, "1. YES"). */
const CARDS = src("src/components/patient/SubscriptionCards.tsx");
const DEMOGRAPHICS = CARDS.slice(
  CARDS.indexOf("export function DemographicsCard"),
  CARDS.indexOf("export function InsuranceCard"),
);

describe("the read", () => {
  it("⚠️ dossierCols asks for the contacts columns", () => {
    // Without this every field reads "" on every patient, with nothing
    // erroring — the §5.11 trap.
    expect(DOSSIER_API).toContain('import { contactsColumns } from "../patient/contacts"');
    expect(DOSSIER_API).toContain("...contactsColumns(board.boardId),");
  });

  it("⚠️ the id list is still de-duplicated", () => {
    // The three patient-screen modules declare what they need rather than
    // trusting another to fetch it, so the lists overlap on purpose.
    expect(DOSSIER_API).toContain(".filter((c, i, all) => all.indexOf(c) === i)");
  });
});

describe("the right column", () => {
  it("⚠️ the page resolves the block and passes it", () => {
    expect(PATIENT_PAGE).toContain("contactsFor(dossier.items");
    expect(PATIENT_PAGE).toMatch(/contacts=\{contacts\}/);
  });

  it("⚠️ the column is keyed on the record", () => {
    // Without it the alternate-number switch follows a patient change and
    // points the composer at the PREVIOUS patient's caregiver — §9's
    // notes-box rule.
    expect(PATIENT_PAGE).toMatch(/key=\{active\?\.itemId \?\? itemId\}/);
  });

  it("⚠️ the alternate selection falls back BY CONSTRUCTION", () => {
    // A selection must not outlive the number it named.
    expect(COMMS_COLUMN).toContain("const onAlt = useAlt && !!alt;");
    expect(COMMS_COLUMN).toContain("const activePhone = onAlt ? alt : phone;");
  });

  it("⚠️ the Recent notes strip stays gone from this column (Josh, 2026-09-25)", () => {
    // The notes live at the foot of the main column now; a strip returning
    // here would be the drift §5.39c3 warned about, in reverse.
    expect(COMMS_COLUMN).not.toContain("<RecentNotes");
  });

  it("passes Can Text through to the thread", () => {
    expect(COMMS_COLUMN).toContain("canText={contacts?.canText}");
  });
});

describe("the composer block", () => {
  it("⚠️ Can Text is OPT-IN, so the other call sites are byte-identical", () => {
    expect(THREAD).toMatch(/canText\?: "yes" \| "no" \| "unknown";/);
    expect(COMPOSER).toMatch(/canText\?: "yes" \| "no" \| "unknown";/);
    // The thread hands it straight to the one composer.
    expect(THREAD).toMatch(/<Composer\s+conversation=\{conversation\}\s+canText=\{canText\}/);
    expect(src("src/components/profile/IntakeMessages.tsx")).not.toContain("canText={");
    // The hub's own threads stay as they were. (Its Inbox passes Can Text to
    // its timeline on purpose — the next test pins how.)
    const hub = src("src/pages/AssignedPatientsPage.tsx");
    const threads = hub.split("<ConversationThread").slice(1).map((b) => b.slice(0, b.indexOf("/>")));
    expect(threads.length).toBeGreaterThan(0);
    for (const t of threads) expect(t).not.toContain("canText=");
  });

  it("⚠️ the Inbox applies Can Text to the PRIMARY line only (§5.31d)", () => {
    // Can Text is the starred slot's answer — this very number's — so it must
    // never block a text to the patient's OTHER number.
    const hub = src("src/pages/AssignedPatientsPage.tsx");
    expect(hub).toContain("if (contactKey(d.active?.phone || d.phone) !== contactKey(inboxActive.e164)) return undefined;");
    expect(hub).toContain("canText={inboxCanText}");
  });

  it("⚠️⚠️ blocks on an explicit No ONLY, never on truthiness", () => {
    // A blank column is unknown (§5.31d) and reads as `undefined` here; a
    // truthiness test would block texting for every patient on every board.
    expect(COMPOSER).toContain('const textingOff = canText === "no";');
    expect(COMPOSER).toContain("if (!text || sending || consent.optedOut || textingOff) return;");
    expect(COMPOSER).toContain("{consent.optedOut || textingOff ? (");
  });

  it("⚠️ a STOP reply outranks the column", () => {
    // The patient's own words beat a rep's note about the line.
    expect(COMPOSER).toContain("{textingOff && !consent.optedOut ? (");
  });

  it("⚠️ Can Text never wears the pending look", () => {
    // It is something we know, however the STOP check is going.
    expect(COMPOSER).toContain("consent.unknown && loading && !textingOff");
  });
});

describe("the profile block", () => {
  it("⚠️ the scan found the card — a slice that matched nothing passes everything below it", () => {
    // The old ContactsCard was deleted on 2026-09-24 and this describe went on
    // passing its read-only assertion against an EMPTY slice. Never again.
    expect(DEMOGRAPHICS.length).toBeGreaterThan(500);
    expect(DEMOGRAPHICS).toContain('className="eyebrow contacts-h">Contacts</div>');
  });

  it("⚠️ is read from the record and handed to the card", () => {
    // `useSubscriptionRecord` reads the six columns at FULL width (the same
    // read the send is built on), and the tab hands them to Demographics.
    expect(SUB_VIEW).toMatch(/<DemographicsCard\s[^]*?extras=\{extras\}/);
    expect(SUB_VIEW).not.toContain("<ContactsCard");
  });

  it("⚠️ renders Brandon's six facts, in his order", () => {
    // In BOTH branches — the controls and the plain facts a record whose
    // extras did not arrive falls back to.
    const order = ["Primary contact", "Alternate contact", "Caregiver name", "Caregiver authorized", "Alternate phone", "Last patient contact"];
    const live = DEMOGRAPHICS.slice(0, DEMOGRAPHICS.indexOf(") : ("));
    const facts = DEMOGRAPHICS.slice(DEMOGRAPHICS.indexOf(") : ("));
    for (const [name, block] of [["controls", live], ["facts", facts]] as const) {
      let at = -1;
      for (const label of order) {
        const i = block.indexOf(label);
        expect(i, `${name}: ${label}`).toBeGreaterThan(at);
        at = i;
      }
    }
  });

  it("⚠️ an unticked Caregiver authorized is an em dash, never a No", () => {
    // A Monday checkbox has two states, not three, so unticked means nobody
    // recorded an authorisation — not that one was refused. The select offers
    // "—" and "Yes" and nothing else.
    expect(DEMOGRAPHICS).toContain('<option value="">{"—"}</option>');
    expect(DEMOGRAPHICS).toContain('<option value="yes">Yes</option>');
    expect(DEMOGRAPHICS).not.toMatch(/<option[^>]*>\s*No\s*</);
    expect(DEMOGRAPHICS).toContain('x?.caregiverAuthorized ? <span className="good">Yes</span> : ""');
  });

  it("⚠️ every Contacts control is disabled for somebody who may not edit", () => {
    // Brandon's read-only mechanism ("disabled controls + notes"); the page's
    // writer is a no-op as well. `subscriptionSendBottom.test.tsx` renders it.
    const live = DEMOGRAPHICS.slice(DEMOGRAPHICS.indexOf("{contactsLive ? ("), DEMOGRAPHICS.indexOf(") : ("));
    const controls = live.match(/<(Sel|Inp|select)\b/g) ?? [];
    expect(controls.length).toBe(5);
    expect(live.match(/disabled=\{!canEdit( \|\| optsOff)?\}/g) ?? []).toHaveLength(5);
  });

  it("⚠️ Can Text is SHOWN here and answered on the Welcome Call page", () => {
    // It is the starred number's answer (§5.31d), and the top bar's phone
    // pencil clears it when the number changes (§5.46g) — no control for it here.
    expect(DEMOGRAPHICS).toContain('<F k="Can text" v={yn(x?.canText ?? "")} />');
    expect(DEMOGRAPHICS).not.toMatch(/onExtras\(\{\s*canText/);
  });
});
