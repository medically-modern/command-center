/**
 * The combined fax bar (§5.39c) — Brandon's `/fax`: the inbound fax list on the
 * left, and on the right who sent it, their patients, and the Update Clinicals
 * action a fax usually exists to trigger.
 *
 * ⚠️⚠️ **ADDED BESIDE THE TWO FAX SCREENS WE HAVE, REMOVING NEITHER** (Josh,
 * 2026-09-18). Brandon's feature audit says the Fax Inbox bar and the
 * Communications Fax rail *"should be one"*, and he is right — but merging them
 * deletes a page, and the standing rule on this build is additive first, trim
 * together after. `/fax-inbox` and the Comms hub's Fax tab are untouched.
 *
 * ⚠️ **Every piece here already existed.** The list is `fetchInboundFaxesAll`,
 * the office join is `fetchFaxMatches` + `fetchDoctorDbByFax` + the tested
 * `buildFaxDirectory`, and the document opens through `fetchFaxBlobUrl` into the
 * shared viewer. Nothing re-derives a rule: the `@rcfax.com` strip in particular
 * lives in `faxDigits` and is the reason that join works at all (§5.28).
 *
 * ⚠️⚠️ **The right pane IS Update Clinicals from 2026-09-21 (§5.39c4)**, not a
 * link to it — Brandon's handoff: *"Pick a fax on the left, find the patient it
 * belongs to, then attach it, set the visit date, record what the office said,
 * or send the patient back to Evaluate."* It renders `ClinicalsWorkPane`, the
 * body of `/update-clinicals` itself, so the three write paths that flow
 * carries (the visit date + MR rung §5.36, the records reply, the Stage
 * Advancer that Submit moves) exist in exactly one place. `/update-clinicals`
 * keeps its own door — the `updateClinicals` role bar — so nothing was removed.
 *
 * ⚠️ **Its two board reads are inside `FaxPane`, which exists only once a rep
 * has picked a fax.** Glancing at the inbox costs what it always did; the
 * Subscription + Medical Necessity reads land when somebody starts working one.
 *
 * ⚠️ **The fax bytes are fetched, THEN handed to the viewer as a blob URL.**
 * Passing a RingCentral attachment URI straight in sends it down
 * `fetchAssetBytes`, which tries a direct CORS fetch with no RC credential and
 * then the worker's `/asset` proxy, which allowlists MONDAY hosts and refuses.
 * That shipped broken once and was reported as "view fax is broken" (§5.28).
 * The previous blob is revoked on each open, because the viewer only revokes
 * the ones it creates itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, FileText, Inbox, RefreshCw, Stethoscope } from "lucide-react";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { fetchInboundFaxesAll, fetchFaxBlobUrl, type InboundFax } from "@/lib/fax/ringcentralApi";
import { fetchDoctorDbByFax, fetchFaxMatches } from "@/lib/commsHub/dossierApi";
import { buildFaxDirectory, type FaxDirectoryEntry } from "@/lib/commsHub/faxDirectory";
import { ClinicalsWorkPane, useClinicalsPatients } from "@/components/updateClinicals/ClinicalsWork";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
import { cn } from "@/lib/utils";

/** Same window RingCentral actually keeps — asking for more spends requests and
 *  returns nothing (§5.27: the message store is a rolling ~30 days). */
const DAYS = 30;

export default function FaxBarPage() {
  const { goBack } = useBackNavigation();
  const [faxes, setFaxes] = useState<InboundFax[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<InboundFax | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const blobRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchInboundFaxesAll({ sinceDays: DAYS });
      setFaxes(rows);
      setSelected((cur) => cur ?? rows[0] ?? null);
    } catch (e) {
      // ⚠️ A failed read is NOT an empty inbox. Saying so is the §9 rule: a rep
      // must be able to tell "no faxes" from "we couldn't ask".
      setError(e instanceof Error ? e.message : "Couldn't reach RingCentral");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    [],
  );

  const shown = useMemo(() => (unreadOnly ? faxes.filter((f) => !f.read) : faxes), [faxes, unreadOnly]);
  const unread = useMemo(() => faxes.filter((f) => !f.read).length, [faxes]);

  const openFax = async (fax: InboundFax) => {
    try {
      const url = await fetchFaxBlobUrl(fax.attachmentUri);
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = url;
      openFileViewer({ url, name: `Fax from ${fax.fromNumber} · ${fax.pages} page${fax.pages === 1 ? "" : "s"}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that fax");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b bg-gradient-navy px-4 py-3 text-white">
        <button onClick={goBack} className="rounded p-1.5 hover:bg-white/10" title="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold leading-tight">Faxes</h1>
          <p className="text-[11px] text-white/60">
            Inbound faxes, who sent them, and their patients · last {DAYS} days
          </p>
        </div>
        <button onClick={() => void load()} className="rounded p-1.5 hover:bg-white/10" title="Refresh">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </header>

      {error && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/20">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        {/* ── The list ─────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col border-r bg-card">
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <b className="text-sm">{shown.length} fax{shown.length === 1 ? "" : "es"}</b>
            <button
              onClick={() => setUnreadOnly((v) => !v)}
              className={cn(
                "ml-auto rounded-md border px-2 py-1 text-xs font-medium",
                unreadOnly ? "border-primary/40 bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              Unread{unread ? ` (${unread})` : ""}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !faxes.length && <p className="p-4 text-sm text-muted-foreground">Reading RingCentral…</p>}
            {!loading && !shown.length && !error && (
              <p className="p-4 text-sm text-muted-foreground">
                {unreadOnly ? "Nothing unread." : `No faxes in the last ${DAYS} days.`}
              </p>
            )}
            {shown.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelected(f)}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-muted/50",
                  selected?.id === f.id && "bg-primary/5 shadow-[inset_3px_0_0_hsl(var(--primary))]",
                )}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-sm", !f.read && "font-semibold")}>
                    {f.fromName || f.fromNumber}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {new Date(f.creationTime).toLocaleString()} · {f.pages} page{f.pages === 1 ? "" : "s"}
                  </div>
                </div>
                {!f.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        </div>

        {/* ── Who sent it, and what to do ──────────────────────── */}
        <div className="min-h-0 overflow-y-auto p-4">
          {selected ? <FaxPane fax={selected} onView={() => void openFax(selected)} /> : (
            <p className="text-sm text-muted-foreground">Pick a fax to see who sent it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FaxPane({ fax, onView }: { fax: InboundFax; onView: () => void }) {
  const [dir, setDir] = useState<FaxDirectoryEntry | null>(null);
  const [looking, setLooking] = useState(true);
  // ⚠️ Mounted HERE rather than on the page, so the two board reads land only
  // once a rep has picked a fax — glancing at the inbox costs what it always
  // did. Same "on open, never on render" posture as every heavy read on these
  // screens.
  const clinicals = useClinicalsPatients();
  // ⚠️ Keyed to the FAX and cleared with it: a patient picked while reading one
  // fax must not still be selected under the next, one Save from the wrong
  // chart (§9's notes-box rule, at the level of a whole pane).
  const [workId, setWorkId] = useState<string | null>(null);
  useEffect(() => setWorkId(null), [fax.id]);

  /**
   * ⚠️ **Only a patient this pane can actually work gets a button.** The fax
   * directory knows a patient by board item; the clinicals flow needs the
   * merged row, which exists only for Subscription and live Medical Necessity.
   * A patient of this office sitting in Insurance is still LISTED — they are
   * genuinely with the office — they just have nothing to update here, and a
   * button that selected nobody would read as broken.
   */
  const workable = useMemo(
    () => new Set(clinicals.patients.map((p) => p.id)),
    [clinicals.patients],
  );

  useEffect(() => {
    let dead = false;
    setLooking(true);
    setDir(null);
    // ⚠️ Both halves, always: the patient boards say who WE are chasing, the
    // Doctor Database (2,290 offices) says who the number belongs to at all.
    // Searching only the boards reads a real, known office as "unmatched" —
    // a dead end that looks like a broken lookup (§5.28).
    Promise.all([fetchFaxMatches(fax.fromNumber), fetchDoctorDbByFax(fax.fromNumber)])
      .then(([rows, db]) => {
        if (dead) return;
        setDir(buildFaxDirectory(fax.fromNumber, rows, db));
      })
      .catch(() => {
        /* A failed join leaves the fax readable — the document is the point. */
      })
      .finally(() => !dead && setLooking(false));
    return () => {
      dead = true;
    };
  }, [fax.fromNumber]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold leading-tight">{fax.fromName || fax.fromNumber}</div>
            <div className="text-xs text-muted-foreground">
              {fax.fromNumber}
              {fax.fromLocation ? ` · ${fax.fromLocation}` : ""} ·{" "}
              {new Date(fax.creationTime).toLocaleString()}
            </div>
          </div>
          <button onClick={onView} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
            View fax
          </button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Stethoscope className="h-4 w-4" /> Sending office
        </h2>

        {looking && <p className="text-sm text-muted-foreground">Looking this number up…</p>}

        {!looking && dir?.provider && (
          <div className="text-sm">
            <div className="font-medium">{dir.provider.doctorName || dir.provider.clinicName || "—"}</div>
            <div className="text-xs text-muted-foreground">
              {[dir.provider.clinicName, dir.provider.npi && `NPI ${dir.provider.npi}`, dir.provider.phone]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Found on {dir.provider.source === "doctorDb" ? "the MM Doctor Database" : "a patient's record"}
            </div>
          </div>
        )}

        {/* ⚠️ Says what the empty answer MEANS. The ordinary cause is an office
            sending from a different line than the one we fax to, and a bare "no
            match" reads as the lookup being broken (§5.28). */}
        {!looking && !dir?.provider && (
          <p className="text-sm text-muted-foreground">
            No doctor on any board or in the Doctor Database lists this number. Offices often send
            from a different line than the one we fax to — worth adding this number to the doctor's
            record.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Their patients</h2>
          {dir && dir.inactiveCount > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {dir.inactiveCount} finished or stuck, not listed
            </span>
          )}
        </div>

        {!looking && !dir?.patients.length && (
          <p className="text-sm text-muted-foreground">Nobody of ours is with this office right now.</p>
        )}

        <ul className="space-y-1.5">
          {dir?.patients.map((p) => (
            <li
              key={`${p.boardId}:${p.itemId}`}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                /chase/i.test(p.stage) && "border-primary/40 bg-primary/5",
              )}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="text-[11px] text-muted-foreground">{p.stage || p.groupTitle}</span>
              <Link
                to={`/patient/${encodeURIComponent(p.itemId)}?board=${p.boardId}&from=fax`}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
              >
                Profile <ArrowUpRight className="h-3 w-3" />
              </Link>
              {/* ⚠️ The action a clinicals fax usually exists to trigger — and
                  from 2026-09-21 it happens HERE, in the pane below, rather
                  than on another page (§5.39c4). Only offered when the patient
                  resolves to a workable row; otherwise the row says why, so a
                  rep is never left pressing something that selects nobody. */}
              {workable.has(p.itemId) ? (
                <button
                  onClick={() => setWorkId(p.itemId)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted",
                    workId === p.itemId && "border-primary bg-primary/10 text-primary",
                  )}
                >
                  {workId === p.itemId ? "Open below" : "Update clinicals"}
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground" title="Only Subscription and live Medical Necessity patients have clinicals to update">
                  nothing to update
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Update Clinicals, in place (§5.39c4) ───────────────────────────── */}
      <section className="space-y-4">
        <StaleDataNotice
          error={clinicals.error}
          scope="The patient list"
          onRetry={() => clinicals.refetch()}
        />
        {clinicals.initialLoading ? (
          <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            Loading patients…
          </div>
        ) : (
          <ClinicalsWorkPane
            patients={clinicals.patients}
            selectedId={workId}
            onSelect={setWorkId}
            onRefresh={clinicals.refetch}
            /* ⚠️ No autofocus: this pane is the SECOND thing on the screen and
               stealing the caret would scroll a rep away from the fax they
               just opened. The page keeps it, where the search IS the screen. */
            autoFocusSearch={false}
            context={
              <p className="text-xs text-muted-foreground">
                Attach this fax, set a visit date or record the reply — this fax came from{" "}
                <b className="text-foreground">{fax.fromName || fax.fromNumber}</b> ({fax.fromNumber}).
              </p>
            }
          />
        )}
      </section>
    </div>
  );
}
