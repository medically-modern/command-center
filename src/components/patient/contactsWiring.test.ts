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
const SUB_VIEW = src("src/components/patient/SubscriptionView.tsx");

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

  it("⚠️ Recent notes keeps the PRIMARY number", () => {
    // A note is about the patient; the audit line must not name a caregiver's
    // number because the thread happened to be switched.
    expect(COMMS_COLUMN).toContain("<RecentNotes active={active} phone={phone}");
  });

  it("passes Can Text through to the thread", () => {
    expect(COMMS_COLUMN).toContain("canText={contacts?.canText}");
  });
});

describe("the composer block", () => {
  it("⚠️ Can Text is OPT-IN, so the other call sites are byte-identical", () => {
    expect(THREAD).toMatch(/canText\?: "yes" \| "no" \| "unknown";/);
    for (const p of [
      "src/pages/AssignedPatientsPage.tsx",
      "src/components/profile/IntakeMessages.tsx",
    ]) {
      expect(src(p)).not.toContain("canText={");
    }
  });

  it("⚠️⚠️ blocks on an explicit No ONLY, never on truthiness", () => {
    // A blank column is unknown (§5.31d) and reads as `undefined` here; a
    // truthiness test would block texting for every patient on every board.
    expect(THREAD).toContain('const textingOff = canText === "no";');
    expect(THREAD).toContain("if (!text || sending || consent.optedOut || textingOff) return;");
    expect(THREAD).toContain("{consent.optedOut || textingOff ? (");
  });

  it("⚠️ a STOP reply outranks the column", () => {
    // The patient's own words beat a rep's note about the line.
    expect(THREAD).toContain("{textingOff && !consent.optedOut ? (");
  });

  it("⚠️ Can Text never wears the pending look", () => {
    // It is something we know, however the STOP check is going.
    expect(THREAD).toContain("consent.unknown && loading && !textingOff");
  });
});

describe("the profile block", () => {
  it("⚠️ is built from the record and rendered", () => {
    expect(SUB_VIEW).toContain("buildContacts(item.boardId, item.cols)");
    expect(SUB_VIEW).toContain("<ContactsCard contacts={contacts} />");
  });

  it("⚠️ renders Brandon's six facts, in his order", () => {
    const block = SUB_VIEW.slice(SUB_VIEW.indexOf("function ContactsCard"));
    const order = ["Primary contact", "Alternate contact", "Caregiver name", "Caregiver authorized", "Alternate phone", "Last patient contact"];
    let at = -1;
    for (const label of order) {
      const i = block.indexOf(`"${label}"`);
      expect(i, label).toBeGreaterThan(at);
      at = i;
    }
  });

  it("⚠️ an unticked Caregiver authorized is an em dash, never a No", () => {
    // A Monday checkbox has two states, not three, so unticked means nobody
    // recorded an authorisation — not that one was refused.
    expect(SUB_VIEW).toContain('contacts.caregiverAuthorized ? "Yes" : ""');
  });

  it("⚠️ the card is READ-ONLY — these columns are written on the stage page", () => {
    const block = SUB_VIEW.slice(
      SUB_VIEW.indexOf("function ContactsCard"),
      SUB_VIEW.indexOf("function SubscriptionEditor"),
    );
    expect(block).not.toMatch(/onChange|<input|<select/);
  });
});
