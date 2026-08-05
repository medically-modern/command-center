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
import { ArrowLeft, BellRing, Loader2, MessagesSquare, Phone, Search, User } from "lucide-react";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import CallOverlay from "@/components/assignedPatients/CallOverlay";
import RingPreferencesDialog from "@/components/inboundCalls/RingPreferencesDialog";
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
  // ⚠️ Back is HISTORY-FIRST via the shared hook (CLAUDE.md §9) — do not swap
  // it for a hardcoded route. This page used to navigate() straight to
  // /system-mgmt?tab=oversight, which PUSHES a new entry rather than going
  // back: arriving from Oversight built a stack of oversight → texting →
  // oversight, so Back bounced between the two instead of leaving.
  const { goBack } = useBackNavigation();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientRef[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PatientRef | null>(null);
  // Always-available dialer: type or paste any number and call it, without
  // having to find a patient first. Separate state from the search box so
  // looking someone up doesn't clear a number you were about to dial.
  const [dialInput, setDialInput] = useState("");
  const [ringSettings, setRingSettings] = useState(false);

  const { call: activeCall, error: callError, dismissError, dial, hangup, toggleMute } = useWebPhone();

  const directNumber = useMemo(() => asDirectNumber(query), [query]);
  /** Normalised number from the dialer box, or "" while it isn't callable. */
  const dialTarget = useMemo(() => toE164(dialInput), [dialInput]);

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
          <button onClick={goBack} className="p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-9 w-9 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
            <MessagesSquare className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · RingCentral</p>
            <h1 className="text-xl font-bold truncate">Patient Texting</h1>
          </div>

          {/* Centred and high-contrast on purpose: this sat top-right in
              white/10 on a navy bar and was genuinely hard to find. A solid
              input and a green call button make it the obvious thing in the
              header. `mx-auto` centres it in the bar; the spacer on the right
              keeps it centred against the back button + title on the left. */}
          <div className="mx-auto flex items-center gap-2 rounded-xl bg-white/10 ring-1 ring-white/20 p-1.5">
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
              <input
                value={dialInput}
                onChange={(e) => setDialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && dialTarget) void dial(dialTarget);
                }}
                placeholder="Call any number…"
                aria-label="Call any number"
                className="w-56 rounded-lg bg-white text-foreground placeholder:text-muted-foreground pl-8 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <button
              onClick={() => dialTarget && void dial(dialTarget)}
              // Disabled until the number normalises, so we never hand
              // RingCentral something it will reject (see toE164).
              disabled={!dialTarget || !!activeCall}
              title={dialTarget ? `Call ${fmtPhone(dialTarget)}` : "Enter a full phone number"}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 disabled:hover:bg-emerald-500"
            >
              <Phone className="h-4 w-4" /> Call
            </button>
          </div>

          {/* Also balances the back button + title so the dialer sits truly
              centred — hence w-9, matching the spacer it replaced. */}
          <button
            onClick={() => setRingSettings(true)}
            title="Which calls ring me"
            className="w-9 h-9 shrink-0 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
          >
            <BellRing className="h-4.5 w-4.5" />
          </button>
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
                  {/* toE164 returns "" for a number it cannot normalise, so an
                      unusable Monday value reads as missing rather than being
                      silently turned into something RingCentral will reject. */}
                  {p.phone ? fmtPhone(p.phone) : "unusable phone number"} · {p.boardName}
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

      <RingPreferencesDialog open={ringSettings} onOpenChange={setRingSettings} />

      {activeCall && (
        <CallOverlay
          call={activeCall}
          name={activeCall.phone === selected?.phone ? selected?.name || "" : ""}
          onHangup={() => void hangup()}
          onToggleMute={() => toggleMute()}
        />
      )}
    </div>
  );
}
