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
 */
import { AlertCircle, FileText, Loader2, Printer, Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
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
          <button
            key={f.id}
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
              </div>
            ) : (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {/* Not an error: plenty of faxes come from offices with no
                    patient of ours, and plenty of doctor records have the fax
                    number missing or typed differently. */}
                No patient on any board lists this number as their doctor's fax.
              </p>
            )}
          </section>

          <section className="px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Their active patients{entry.patients.length ? ` (${entry.patients.length})` : ""}
            </p>
            {!entry.patients.length && (
              <p className="text-xs text-muted-foreground">
                {entry.provider
                  ? "Nobody active — every patient for this office is finished or stuck."
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
