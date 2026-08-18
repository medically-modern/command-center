/**
 * The inline note under an address input: what Cardinal will do with this
 * address, and — when it will refuse it — the shape it has to be retyped in.
 *
 * ONE renderer, used by both stages that can still fix an address:
 *  - Final Profile Confirmation (`finalConfirm/PatientInfoCard`, patient + clinic)
 *  - Welcome Call (`welcomeCall/WelcomeCallForm`, patient address on file + the
 *    edit box; that board has no clinic address column at all)
 * The rule and the wording both live in `lib/shared/cardinalAddress.ts`
 * (§5.17), so the two pages cannot tell a rep different things — and neither
 * can the field and the Final Confirm findings panel, which renders the same
 * `CARDINAL_FORMAT_HINT` string off the check-pack finding.
 *
 * Renders nothing for a blank or clean address; see `cardinalAddressNote`.
 */
import { cn } from "@/lib/utils";
import { cardinalAddressNote } from "@/lib/shared/cardinalAddress";

interface Props {
  /** The EFFECTIVE address — whatever would be written to Monday. */
  address: string;
  className?: string;
}

export function CardinalAddressNote({ address, className }: Props) {
  const note = cardinalAddressNote(address);
  if (!note) return null;
  return (
    <div
      className={cn(
        "mt-1.5 text-[11px] leading-snug",
        note.tone === "red"
          ? "text-red-600 dark:text-red-400"
          : "text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      <p className="font-semibold">{note.reason}</p>
      {note.hint && <p className="font-mono mt-0.5">{note.hint}</p>}
    </div>
  );
}
