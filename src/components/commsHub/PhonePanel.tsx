/**
 * The Phone tab — recent calls and voicemails on the shared MM line.
 *
 * Clicking either opens that caller's Command Center profile in the third pane,
 * which is the whole point: a missed call is a phone number until you know
 * whose it is and what stage they are stuck at.
 *
 * ⚠️ **`result` cannot be read literally — read the LEGS** (CLAUDE.md §5.16).
 * Claiming an inbound call forwards it, which tears down the original leg, so a
 * call a rep actually TOOK can arrive stamped with a terminal-looking result.
 * `callConnected` is the shared rule; reading `result` by eye here is what once
 * flashed "Missed" at the person who had just answered.
 */
import { useMemo } from "react";
import { Loader2, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Voicemail } from "lucide-react";
import { callConnected, isVoicemail, type RcCallLogRecord } from "@/lib/callHistory/callHistory";
import { contactKey } from "@/lib/contactState/contactState";
import type { VoicemailRecord } from "@/lib/fax/ringcentralApi";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { resolveDisplayName, type NameSource } from "@/lib/commsHub/directory";
import { cn } from "@/lib/utils";
import { FilterPill, HubListHeader, Initials, ListEmpty, ListError, NamingProgress, listTime } from "./HubList";

export type PhoneMode = "calls" | "voicemail";

/** One row of the call list, already judged. */
interface CallRow {
  id: string;
  key: string;
  phone: string;
  name: string;
  at: string;
  inbound: boolean;
  connected: boolean;
  voicemail: boolean;
  durationSec: number;
}

function toRows(records: RcCallLogRecord[]): CallRow[] {
  return records
    .map((r, i) => {
      const inbound = String(r.direction) !== "Outbound";
      const party = inbound ? r.from : r.to;
      return {
        id: String(r.id ?? r.sessionId ?? i),
        key: contactKey(party?.phoneNumber),
        phone: party?.phoneNumber ?? "",
        // RingCentral's own name for the party. It was dropped on the floor
        // here until 2026-09-02 (`name: ""`), so every call row read as a bare
        // number even for the offices a rep has in their RC contacts.
        name: (party?.name ?? "").trim(),
        at: r.startTime ?? "",
        inbound,
        connected: callConnected(r),
        voicemail: isVoicemail(r),
        durationSec: Number(r.duration ?? 0),
      };
    })
    .filter((r) => r.key.length === 10)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function mmss(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Attach the display label to each row. Split out of the component so the
 *  rule is applied in exactly one place for calls.
 *
 *  ⚠️ `source` is carried, not just the label. Two things downstream need to
 *  know whether the label IS the number: the avatar (initials taken from
 *  "(815) 523-7259" come out as "(5") and the subline, which would otherwise
 *  print the same number twice. */
function shownRows(rows: CallRow[], names: ReadonlyMap<string, string>): (CallRow & { label: string; source: NameSource })[] {
  return rows.map((r) => ({
    ...r,
    ...resolveDisplayName({ rcName: r.name, directoryName: names.get(r.key), phone: r.phone }, fmtPhone),
  }));
}

export function PhonePanel({
  mode,
  onMode,
  calls,
  voicemails,
  loading,
  error,
  onReload,
  selectedKey,
  onSelect,
  query,
  onQuery,
  missedOnly,
  onMissedOnly,
  names,
  naming,
}: {
  mode: PhoneMode;
  onMode: (m: PhoneMode) => void;
  calls: RcCallLogRecord[] | null;
  voicemails: VoicemailRecord[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  selectedKey: string | null;
  onSelect: (phone: string) => void;
  query: string;
  onQuery: (v: string) => void;
  missedOnly: boolean;
  onMissedOnly: (v: boolean) => void;
  /** Patient names our boards hold, keyed by last-10 digits. One batched read
   *  for the whole list — see `hooks/commsHub/useDirectoryNames`. */
  names: ReadonlyMap<string, string>;
  /** Name-resolution progress, so a long list says how far along it is rather
   *  than filling in silently (Josh, 2026-09-02). */
  naming?: { done: number; total: number };
}) {
  const rows = useMemo(() => toRows(calls ?? []), [calls]);
  const missedCount = useMemo(() => rows.filter((r) => r.inbound && !r.connected).length, [rows]);
  const unheardCount = useMemo(() => (voicemails ?? []).filter((v) => !v.read).length, [voicemails]);

  const digits = query.replace(/\D/g, "");
  const q = query.trim().toLowerCase();

  /** The label each row shows: RingCentral's contact, else our boards, else the
   *  number (`resolveDisplayName`). Computed once per row rather than in the
   *  JSX so the search below can match what the rep can actually SEE — a list
   *  that shows "Tonasila Gray" and then can't find her by that name is worse
   *  than one that never showed it. */
  const labelled = useMemo(
    () => shownRows(rows, names),
    [rows, names],
  );

  const shownCalls = useMemo(
    () =>
      labelled.filter((r) => {
        // "Missed" is an INBOUND call nobody answered. An outbound call that
        // went unanswered is not a missed call — nobody was trying to reach us.
        if (missedOnly && !(r.inbound && !r.connected)) return false;
        if (!q) return true;
        return r.label.toLowerCase().includes(q) || (digits.length >= 3 && r.key.includes(digits));
      }),
    [labelled, missedOnly, q, digits],
  );

  const shownVoicemails = useMemo(
    () =>
      (voicemails ?? []).map((v) => ({
        vm: v,
        ...resolveDisplayName(
          { rcName: v.fromName, directoryName: names.get(contactKey(v.fromNumber)), phone: v.fromNumber },
          fmtPhone,
        ),
      })).filter(({ vm, label }) => {
        if (missedOnly && vm.read) return false;
        if (!q) return true;
        return label.toLowerCase().includes(q) || (digits.length >= 3 && contactKey(vm.fromNumber).includes(digits));
      }),
    [voicemails, missedOnly, q, digits, names],
  );

  return (
    <>
      <HubListHeader
        title="Phone"
        count={mode === "calls" ? rows.length : (voicemails ?? []).length}
        query={query}
        onQuery={onQuery}
        // Both lists match the NAME the row shows as well as the digits, so the
        // placeholder has to say so — a capability the rep can't see is one
        // they don't have (the §5.15 fix-the-copy rule).
        placeholder={mode === "calls" ? "Search calls by name or number…" : "Search voicemail by name or number…"}
        unreadOnly={missedOnly}
        onUnreadOnly={onMissedOnly}
        unreadLabel={mode === "calls" ? "Missed" : "Unheard"}
        unreadCount={mode === "calls" ? missedCount : unheardCount}
        loading={loading}
        onReload={onReload}
        note={naming && <NamingProgress done={naming.done} total={naming.total} />}
        extra={
          <div className="flex items-center gap-1">
            <FilterPill active={mode === "calls"} onClick={() => onMode("calls")}>
              Calls
            </FilterPill>
            <FilterPill active={mode === "voicemail"} onClick={() => onMode("voicemail")}>
              Voicemail
              {!!unheardCount && <span className="ml-1 tabular-nums">{unheardCount}</span>}
            </FilterPill>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <ListError error={error} />}

        {mode === "calls" && (
          <>
            {!error && !shownCalls.length && (
              <ListEmpty>
                {loading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading calls…
                  </span>
                ) : missedOnly ? (
                  "No missed calls — everybody got through."
                ) : (
                  "No calls in the last 14 days."
                )}
              </ListEmpty>
            )}
            {shownCalls.map((r) => {
              const missed = r.inbound && !r.connected;
              const Icon = missed ? PhoneMissed : r.inbound ? PhoneIncoming : PhoneOutgoing;
              return (
                <button
                  key={r.id}
                  onClick={() => onSelect(r.phone)}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/40",
                    r.key === selectedKey && "bg-muted/70",
                  )}
                >
                  <Initials
                    // "" when the label is the number itself — `Initials` then
                    // falls back to the last two digits rather than reading
                    // "(5" out of "(815) 523-7259".
                    name={r.source === "number" ? "" : r.label}
                    phone={r.phone}
                    tone={missed ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={fmtPhone(r.phone)}>
                      {r.label}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Icon className={cn("h-3 w-3 shrink-0", missed && "text-rose-500")} />
                      {/* The number moves down here rather than disappearing:
                          a rep reads back the number they are about to dial,
                          and a list of names alone can't be checked. */}
                      {r.source !== "number" && <span className="tabular-nums">{fmtPhone(r.phone)} ·</span>}
                      {r.voicemail ? "Voicemail" : missed ? "Missed" : r.inbound ? "Incoming" : "Outgoing"}
                      {r.connected && r.durationSec > 0 && <span className="tabular-nums">· {mmss(r.durationSec)}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{listTime(r.at)}</span>
                </button>
              );
            })}
          </>
        )}

        {mode === "voicemail" && (
          <>
            {!error && !shownVoicemails.length && (
              <ListEmpty>
                {loading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading voicemail…
                  </span>
                ) : missedOnly ? (
                  "Nothing unheard."
                ) : (
                  "No voicemail in the last 30 days."
                )}
              </ListEmpty>
            )}
            {shownVoicemails.map(({ vm: v, label, source }) => (
              <button
                key={v.id}
                onClick={() => onSelect(v.fromNumber)}
                className={cn(
                  "flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/40",
                  contactKey(v.fromNumber) === selectedKey && "bg-muted/70",
                )}
              >
                <Initials
                  name={source === "number" ? "" : label}
                  phone={v.fromNumber}
                  tone={!v.read ? "bg-primary/15 text-primary" : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("truncate text-sm", v.read ? "font-medium" : "font-semibold")}>
                      {label}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {listTime(v.creationTime)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Voicemail className="h-3 w-3 shrink-0" />
                    {source !== "number" && <span className="tabular-nums">{fmtPhone(v.fromNumber)} ·</span>}
                    {v.durationSec ? mmss(v.durationSec) : "Voicemail"}
                    {!v.read && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}

/** The Call button's phone glyph, re-exported so the page's empty state can use
 *  the same one the rail does. */
export { Phone as PhoneGlyph };
export default PhonePanel;
