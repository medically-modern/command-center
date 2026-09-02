/**
 * The Fax tab — inbound faxes, and whose office each one came from.
 *
 * A fax arrives as a number and nothing else, so answering "whose clinicals are
 * these?" today means leaving the inbox and searching patients one at a time.
 * The doctor's fax number is already on every patient's board record, so
 * selecting a fax joins on it: the office, then every ACTIVE patient that
 * office looks after, with anyone currently in Chase Clinicals called out —
 * because an arriving fax is most likely the answer to that chase.
 *
 * The join rule is `lib/commsHub/faxDirectory.ts`; the query is `dossierApi`.
 *
 * ⚠️ **Read state is RingCentral's own `readStatus`, not a local flag** — the
 * same rule the Text tab documents, and for the same reason: reps work this
 * line in the RingCentral desktop app too, so an invented read state would
 * disagree with what they see there within a day. Opening a fax PUTs it Read;
 * the right-click menu PUTs it back to Unread (Josh, 2026-09-02). Both are the
 * one `message-store/{id}` write `setMessageRead` makes.
 */
import { AlertCircle, FileText, Loader2, MailOpen, Printer, Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { InboundFax } from "@/lib/fax/ringcentralApi";
import type { FaxDirectoryEntry } from "@/lib/commsHub/faxDirectory";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";
import { HubListHeader, Initials, ListEmpty, ListError, listTime } from "./HubList";

export function FaxPanel({
  faxes,
  loading,
  error,
  onReload,
  selectedId,
  onSelect,
  query,
  onQuery,
  unreadOnly,
  onUnreadOnly,
  onSetRead,
}: {
  faxes: InboundFax[] | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  selectedId: number | null;
  onSelect: (f: InboundFax) => void;
  query: string;
  onQuery: (v: string) => void;
  unreadOnly: boolean;
  onUnreadOnly: (v: boolean) => void;
  /** Right-click → Mark as unread / Mark as read. Writes RingCentral's own
   *  `readStatus`; the page holds the optimistic override. */
  onSetRead: (f: InboundFax, read: boolean) => void;
}) {
  const list = faxes ?? [];
  const unread = list.filter((f) => !f.read).length;
  const q = query.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");
  const shown = list.filter((f) => {
    if (unreadOnly && f.read) return false;
    if (!q) return true;
    return (
      f.fromName.toLowerCase().includes(q) ||
      f.fromLocation.toLowerCase().includes(q) ||
      (digits.length >= 3 && f.fromNumber.replace(/\D/g, "").includes(digits))
    );
  });

  return (
    <>
      <HubListHeader
        title="Fax"
        count={list.length}
        query={query}
        onQuery={onQuery}
        placeholder="Search faxes…"
        unreadOnly={unreadOnly}
        onUnreadOnly={onUnreadOnly}
        unreadCount={unread}
        loading={loading}
        onReload={onReload}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <ListError error={error} />}
        {!error && !shown.length && (
          <ListEmpty>
            {loading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading faxes…
              </span>
            ) : unreadOnly ? (
              "Nothing unread."
            ) : (
              "No inbound faxes in the last 30 days."
            )}
          </ListEmpty>
        )}
        {shown.map((f) => (
          <ContextMenu key={f.id}>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => onSelect(f)}
                className={cn(
                  "flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/40",
                  f.id === selectedId && "bg-muted/70",
                )}
              >
                <Initials
                  name={f.fromName}
                  phone={f.fromNumber}
                  tone={!f.read ? "bg-primary/15 text-primary" : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("truncate text-sm", f.read ? "font-medium" : "font-semibold")}>
                      {f.fromName || fmtPhone(f.fromNumber)}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {listTime(f.creationTime)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Printer className="h-3 w-3 shrink-0" />
                    Received {f.pages} {f.pages === 1 ? "page" : "pages"}
                    {!f.read && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                </span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-48">
              {f.read ? (
                <ContextMenuItem onSelect={() => onSetRead(f, false)}>
                  <Printer className="mr-2 h-3.5 w-3.5" /> Mark as unread
                </ContextMenuItem>
              ) : (
                <ContextMenuItem onSelect={() => onSetRead(f, true)}>
                  <MailOpen className="mr-2 h-3.5 w-3.5" /> Mark as read
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
    </>
  );
}

/**
 * The middle pane for a selected fax: the office it came from, and their
 * patients. Chase Clinicals patients lead and are highlighted.
 */
export function FaxProviderDetail({
  fax,
  entry,
  loading,
  error,
  onOpenFax,
  opening,
}: {
  fax: InboundFax;
  entry: FaxDirectoryEntry | null;
  loading: boolean;
  error: string | null;
  onOpenFax: () => void;
  /** The document is being fetched through the gateway — it is a real network
   *  round trip for a multi-page scan, so the button has to say so. */
  opening?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{fax.fromName || fmtPhone(fax.fromNumber)}</p>
          <p className="text-[11px] text-muted-foreground">
            {fmtPhone(fax.fromNumber)}
            {fax.fromLocation && ` · ${fax.fromLocation}`} · {fax.pages}{" "}
            {fax.pages === 1 ? "page" : "pages"}
          </p>
        </div>
        <button
          onClick={onOpenFax}
          disabled={opening || !fax.attachmentUri}
          title={fax.attachmentUri ? "Open the fax document" : "This fax has no document attached"}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          View fax
        </button>
      </div>

      {loading && (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Matching this number to a provider…
        </p>
      )}
      {error && <ListError error={error} />}

      {!loading && !error && entry && (
        <>
          <section className="border-b border-border px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Stethoscope className="h-3.5 w-3.5" /> Sending office
            </p>
            {entry.provider ? (
              <div className="space-y-0.5 text-xs">
                {entry.provider.doctorName && <p className="font-semibold">{entry.provider.doctorName}</p>}
                {entry.provider.clinicName && <p>{entry.provider.clinicName}</p>}
                {entry.provider.npi && <p className="text-muted-foreground">NPI {entry.provider.npi}</p>}
                {entry.provider.phone && (
                  <p className="text-muted-foreground">Office {fmtPhone(entry.provider.phone)}</p>
                )}
                {/* "We know this office but nobody of ours is with them" is a
                    different answer from "this came off a patient's record",
                    and the rep's next move differs. */}
                {entry.provider.source === "doctorDb" && (
                  <p className="pt-0.5 text-[11px] text-muted-foreground">
                    Matched in the MM Doctor Database — no patient of ours currently lists them.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="flex items-start gap-1.5">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {/* Not an error: plenty of faxes come from offices we have no
                      record of. Saying exactly WHAT was checked is what stops
                      this reading as a broken lookup — the `@rcfax.com` join
                      was the first suspect when it was just a plain "no match"
                      (Josh, 2026-09-02). */}
                  This number isn't on any patient's doctor record or in the MM Doctor Database.
                </p>
                <p className="pl-5 text-[11px]">
                  {/* The genuinely common cause, and the one a rep can act on:
                      an office's outbound fax line is often not the number we
                      send TO, so there is nothing wrong to fix — the fax just
                      has to be read to find out whose it is. */}
                  Offices often send from a different line than the one we fax. Open the document to see
                  whose it is, then add the number to their doctor record so the next one matches.
                </p>
              </div>
            )}
          </section>

          <section className="px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Their active patients{entry.patients.length ? ` (${entry.patients.length})` : ""}
            </p>
            {!entry.patients.length && (
              <p className="text-xs text-muted-foreground">
                {entry.provider
                  ? entry.provider.source === "doctorDb"
                    ? "We have this office on file, but no patient of ours lists them as their doctor."
                    : "Nobody active — every patient for this office is finished or stuck."
                  : "Nothing to show until the number matches a doctor record."}
              </p>
            )}
            <ul className="space-y-1.5">
              {entry.patients.map((p) => (
                <li key={`${p.boardId}:${p.itemId}`}>
                  <Link
                    to={
                      p.route
                        ? `${p.route}?patientId=${encodeURIComponent(p.itemId)}&from=system-mgmt`
                        : "#"
                    }
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors",
                      p.inChase
                        ? "border-amber-400 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/60 dark:hover:bg-amber-950"
                        : "border-border hover:bg-muted/50",
                      !p.route && "pointer-events-none opacity-60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {p.stage || p.groupTitle} · {p.boardName}
                        {p.inChase && p.clinicalsMethod && ` · ${p.clinicalsMethod}`}
                      </span>
                    </span>
                    {p.inChase && (
                      <span className="shrink-0 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Chasing
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            {entry.inactiveCount > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {entry.inactiveCount} more {entry.inactiveCount === 1 ? "patient is" : "patients are"} finished or
                stuck.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default FaxPanel;
