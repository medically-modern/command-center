/**
 * Patient Texting — look up any patient by name or number, read the
 * conversation, text them, call them.
 *
 * There is no assignment model (removed Aug 2026). Nobody owns a patient; any
 * employee can text any patient. What the company tracks instead is **who sent
 * what, to whom, and when** — recorded server-side from the verified token and
 * shown against every outbound message.
 *
 * ⚠️ You can text a number that isn't on any board (Josh, 2026-08-04). Typing a
 * bare phone number is a valid lookup: the patient record is a convenience for
 * FINDING someone, not a precondition for reaching them.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, MessagesSquare, Phone, Search, User } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import CallOverlay from "@/components/assignedPatients/CallOverlay";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import { searchPatientsByName, type PatientRef } from "@/lib/assignedPatients/patientLookup";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { toE164 } from "@/lib/fax/ringcentralApi";
import { cn } from "@/lib/utils";

/** A raw number typed into the search box, rather than a patient record. */
function asDirectNumber(query: string): PatientRef | null {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const phone = toE164(query);
  if (!phone) return null;
  return { itemId: "", name: "", phone, boardId: "", boardName: "" };
}

export default function AssignedPatientsPage() {
  const { goBack } = useBackNavigation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSystemMgmt = params.get("from") === "system-mgmt";
  const back = () => (fromSystemMgmt ? navigate("/system-mgmt?tab=oversight") : goBack());

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRef[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PatientRef | null>(null);

  const { call: activeCall, error: callError, dismissError, dial, hangup, toggleMute } = useWebPhone();

  const directNumber = useMemo(() => asDirectNumber(query), [query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    // Debounced: the search fans out across every pipeline board, so typing
    // must not fire one of those per keystroke.
    const id = setTimeout(async () => {
      try {
        const r = await searchPatientsByName(q);
        if (alive) setResults(r);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  return (
    <div className="h-screen bg-gradient-subtle flex flex-col">
      <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border shrink-0">
        <div className="px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={back} className="p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-9 w-9 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
            <MessagesSquare className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · RingCentral</p>
            <h1 className="text-xl font-bold truncate">Patient Texting</h1>
          </div>
        </div>
      </header>

      {callError && (
        <div className="px-4 py-2 text-sm bg-destructive/10 text-destructive border-b border-destructive/20 shrink-0 flex items-start gap-2">
          <span className="flex-1">{callError}</span>
          <button onClick={dismissError} className="shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <aside className="w-full sm:w-80 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
          <div className="px-3 py-3 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or number…"
                className="w-full rounded-md border border-border bg-background pl-7 pr-7 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              {searching && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {/* A typed number is always offered, matched patient or not —
                reaching someone must not depend on them being on a board. */}
            {directNumber && (
              <button
                onClick={() => setSelected(directNumber)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/40",
                  selected?.phone === directNumber.phone && !selected?.itemId && "bg-muted/60",
                )}
              >
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  {fmtPhone(directNumber.phone)}
                </p>
                <p className="text-[11px] text-muted-foreground">Text this number directly</p>
              </button>
            )}

            {results.map((p) => (
              <button
                key={p.itemId}
                onClick={() => setSelected(p)}
                disabled={!p.phone}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/40 disabled:opacity-50",
                  selected?.itemId === p.itemId && "bg-muted/60",
                )}
              >
                <p className="text-sm font-medium truncate flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {p.name}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {p.phone ? fmtPhone(p.phone) : "no phone on record"} · {p.boardName}
                </p>
              </button>
            ))}

            {query.trim().length >= 2 && !searching && results.length === 0 && !directNumber && (
              <p className="p-6 text-center text-sm text-muted-foreground">No patients matched.</p>
            )}
            {query.trim().length < 2 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Search for a patient by name, or type a phone number.
              </p>
            )}
          </div>
        </aside>

        {selected ? (
          <ConversationThread
            key={selected.phone}
            phone={selected.phone}
            patient={selected.itemId ? selected : null}
            onCall={() => void dial(selected.phone)}
            calling={activeCall?.phone === selected.phone}
          />
        ) : (
          <section className="flex-1 hidden sm:flex flex-col items-center justify-center gap-1 text-center p-8">
            <h2 className="text-lg font-semibold">Text details</h2>
            <p className="text-sm text-muted-foreground">Find a patient on the left to see the conversation.</p>
          </section>
        )}
      </div>

      {activeCall && (
        <CallOverlay
          call={activeCall}
          name={selected?.name || ""}
          onHangup={() => void hangup()}
          onToggleMute={() => toggleMute()}
        />
      )}
    </div>
  );
}
