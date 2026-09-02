/**
 * "New text" — start a conversation with somebody who hasn't texted us.
 *
 * The list pane already offered this, but only as a "Start a conversation"
 * section that appeared UNDER the conversations once a rep happened to type
 * something into the search box (Josh, 2026-09-02: "right now it's just search
 * texts"). A thing you find by accident is a thing most people never find, so
 * this is the explicit door: one button, one To: field, and it takes either a
 * number or a patient's name.
 *
 * ⚠️ **Names are searched on the BOARDS, not in the conversation list.** The
 * whole point is reaching somebody with no thread yet, so filtering what is on
 * screen would answer the opposite question. `searchPatientsByName` fans out
 * across the pipeline boards, which is why the caller debounces it.
 */
import { useEffect, useRef } from "react";
import { ArrowLeft, Loader2, Phone, Search, User } from "lucide-react";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { ListEmpty } from "./HubList";

export function NewTextPanel({
  query,
  onQuery,
  typedNumber,
  hits,
  searching,
  onPick,
  onClose,
}: {
  query: string;
  onQuery: (v: string) => void;
  /** A full number in the box, offered as-is. Empty when what they typed isn't
   *  one — a partial number must not look dialable. */
  typedNumber: string;
  hits: PatientRef[];
  searching: boolean;
  /** `name` is empty for a typed number: nobody was chosen, so the profile
   *  pane must not be told to open on anyone in particular. */
  onPick: (phone: string, name: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // A compose pane that needs a click before you can type is a compose pane
  // people abandon.
  useEffect(() => inputRef.current?.focus(), []);

  const typed = query.trim();
  const digitsOnly = /^[\d\s()+.-]+$/.test(typed);

  return (
    <>
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <button
            onClick={onClose}
            title="Back to conversations"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-base font-semibold">New text</h2>
        </div>
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends you straight to a fully-typed number, the way a
                // dialler behaves.
                if (e.key === "Enter" && typedNumber) onPick(typedNumber, "");
                if (e.key === "Escape") onClose();
              }}
              placeholder="Name or phone number…"
              aria-label="Name or phone number"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {typedNumber && (
          <button
            onClick={() => onPick(typedNumber, "")}
            className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/40"
          >
            <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{fmtPhone(typedNumber)}</span>
              {/* Reaching somebody must never depend on them being on a board. */}
              <span className="block text-[11px] text-muted-foreground">Text this number</span>
            </span>
          </button>
        )}

        {hits.map((p) => (
          <button
            key={p.itemId}
            onClick={() => onPick(p.phone, p.name)}
            className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/40"
          >
            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {fmtPhone(p.phone)} · {p.boardName}
              </span>
            </span>
          </button>
        ))}

        {!typedNumber && !hits.length && (
          <ListEmpty>
            {!typed ? (
              "Type a patient's name, or a phone number."
            ) : searching ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching patients…
              </span>
            ) : digitsOnly ? (
              // A partial number is not a failed search — say what is missing.
              "Keep going — that isn't a full number yet."
            ) : (
              "No patient matched. You can also type their number."
            )}
          </ListEmpty>
        )}
      </div>
    </>
  );
}

export default NewTextPanel;
