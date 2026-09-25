/**
 * The Fax Inbox — Brandon's 50/50 screen (pixel-match Phase 5, 2026-09-24): the
 * inbound faxes on the left; on the right the fax that was picked, the office
 * it came from, and Update Clinicals.
 *
 * ⚠️⚠️ **THIS IS THE FAX BAR'S PAGE NOW.** `/fax-inbox` — what the FAX role bar
 * opens from both burndowns (§4) — renders it, and `/fax` redirects here. It is
 * the §5.39c combined bar rebuilt to his `viewFaxInbox`, with the classic
 * list's function folded in so nothing is lost: pages of 50 with Load more,
 * Mark read / unread, View, Download, the total in the title. The classic list
 * survives at `/fax-inbox/classic` — no door in the chrome, every one of its
 * functions is here — until Josh says (PIXEL_MATCH_PLAN.md, Phase 5).
 *
 * ⚠️ **Every piece already existed.** The list is `fetchInboundFaxes` (the
 * classic page's paged read), the office join is `fetchFaxMatches` +
 * `fetchDoctorDbByFax` + the tested `buildFaxDirectory`, and the document opens
 * through `fetchFaxBlobUrl` into the shared viewer. Nothing re-derives a rule:
 * the `@rcfax.com` strip in particular lives in `faxDigits` and is the reason
 * that join works at all (§5.28).
 *
 * ⚠️⚠️ **The right pane IS Update Clinicals (§5.39c4)**, not a link to it —
 * Brandon's handoff: *"Pick a fax on the left, find the patient it belongs to,
 * then attach it, set the visit date, record what the office said, or send the
 * patient back to Evaluate."* It renders `ClinicalsWorkPane`, the body of
 * `/update-clinicals` itself, so the three write paths that flow carries (the
 * visit date + MR rung §5.36, the records reply, the Stage Advancer that Submit
 * moves) exist in exactly one place. `/update-clinicals` keeps its own door.
 *
 * ⚠️ **The two board reads are inside `FaxPane`, which exists only once a rep
 * has picked a fax — and NOTHING is picked on open.** The bar used to
 * auto-select the first fax, which mounted the pane and its Subscription +
 * Medical Necessity reads on every open, against its own "glancing at the
 * inbox costs what it always did". His mockup opens on the blue notice instead,
 * and so does this: the inbox costs one RingCentral page until a fax is picked.
 *
 * ⚠️ **His `.fx-pv` "page preview" is an ICON, not a rendered page.** A real
 * thumbnail would be a RingCentral fetch of every fax's PDF, per row, per load
 * — INCIDENT_2026-08-20's shape on the shared account. The page itself renders
 * in the shared viewer on View, which is the preview the plan means.
 *
 * ⚠️ **The fax bytes are fetched, THEN handed to the viewer as a blob URL.**
 * Passing a RingCentral attachment URI straight in sends it down
 * `fetchAssetBytes`, which tries a direct CORS fetch with no RC credential and
 * then the worker's `/asset` proxy, which allowlists MONDAY hosts and refuses.
 * That shipped broken once and was reported as "view fax is broken" (§5.28).
 * The previous blob is revoked on each open, because the viewer only revokes
 * the ones it creates itself.
 *
 * ⚠️ Opening a fax does NOT mark it read here (the classic page never did; the
 * Communications hub's Fax rail does). Mark read / unread is the explicit
 * button on the selected fax, both directions.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Download,
  Eye,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  Stethoscope,
  Upload,
  User,
} from "lucide-react";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { fetchInboundFaxes, fetchFaxBlobUrl, setFaxRead, type InboundFax } from "@/lib/fax/ringcentralApi";
import { fetchDoctorDbByFax, fetchFaxMatches } from "@/lib/commsHub/dossierApi";
import { buildFaxDirectory, type FaxDirectoryEntry } from "@/lib/commsHub/faxDirectory";
import { ClinicalsWorkPane, useClinicalsPatients } from "@/components/updateClinicals/ClinicalsWork";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
import { formatPhoneParen } from "@/lib/shared/phoneDisplay";
import { faxFileName, faxFrom, faxPatientChip } from "@/lib/fax/faxInbox";
import { cn } from "@/lib/utils";
import "./fax/faxInbox.css";

/** The classic list's page size, kept: the first read is one request. */
const PER_PAGE = 50;

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function FaxBarPage() {
  const { goBack } = useBackNavigation();
  const [faxes, setFaxes] = useState<InboundFax[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const blobRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchInboundFaxes({ page: 1, perPage: PER_PAGE });
      setFaxes(r.faxes);
      setHasMore(r.hasMore);
      setTotal(r.total);
      setPage(1);
      // A refresh keeps the pick if the fax is still on the first page — and
      // drops it otherwise, rather than holding a pane for a fax not on screen.
      setSelectedId((cur) => (cur != null && r.faxes.some((f) => f.id === cur) ? cur : null));
    } catch (e) {
      // ⚠️ A failed read is NOT an empty inbox. Saying so is the §9 rule: a rep
      // must be able to tell "no faxes" from "we couldn't ask".
      setError(e instanceof Error ? e.message : "Couldn't reach RingCentral");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = page + 1;
      const r = await fetchInboundFaxes({ page: next, perPage: PER_PAGE });
      setFaxes((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...r.faxes.filter((f) => !seen.has(f.id))];
      });
      setHasMore(r.hasMore);
      setPage(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach RingCentral");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore, page]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  useEffect(
    () => () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    [],
  );

  // The classic page loaded the next page as the list neared its end; the
  // button below is his, and both stay.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) void loadMore();
  };

  const shown = useMemo(() => (unreadOnly ? faxes.filter((f) => !f.read) : faxes), [faxes, unreadOnly]);
  const unread = useMemo(() => faxes.filter((f) => !f.read).length, [faxes]);
  const selected = useMemo(() => faxes.find((f) => f.id === selectedId) ?? null, [faxes, selectedId]);

  const viewFax = async (f: InboundFax) => {
    if (!f.attachmentUri || busyId) return;
    setBusyId(f.id);
    setError(null);
    try {
      const url = await fetchFaxBlobUrl(f.attachmentUri);
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = url;
      openFileViewer({ url, name: faxFileName(f) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open that fax");
    } finally {
      setBusyId(null);
    }
  };

  const download = async (f: InboundFax) => {
    if (!f.attachmentUri || busyId) return;
    setBusyId(f.id);
    setError(null);
    try {
      const url = await fetchFaxBlobUrl(f.attachmentUri);
      const a = document.createElement("a");
      a.href = url;
      a.download = faxFileName(f);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't download that fax");
    } finally {
      setBusyId(null);
    }
  };

  const toggleRead = async (f: InboundFax) => {
    if (busyId) return;
    const target = !f.read;
    setBusyId(f.id);
    setError(null);
    try {
      await setFaxRead(f.id, target);
      setFaxes((prev) => prev.map((x) => (x.id === f.id ? { ...x, read: target } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update that fax");
    } finally {
      setBusyId(null);
    }
  };

  const stop = (e: MouseEvent) => e.stopPropagation();
  const rowKey = (e: KeyboardEvent<HTMLDivElement>, id: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedId(id);
    }
  };

  return (
    <div className="cc-fx flex h-screen flex-col bg-gradient-subtle">
      {/* His navyHeader: eyebrow · title with the count · a white Refresh. */}
      <header className="shrink-0 border-b border-sidebar-border bg-gradient-navy text-navy-foreground">
        <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
          <button onClick={goBack} className="rounded-md p-1.5 transition-colors hover:bg-white/10" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-elevate">
            <Inbox className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · RingCentral</p>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              Fax Inbox {total > 0 && <span className="text-sm font-normal opacity-80">({total})</span>}
            </h1>
          </div>
          <button onClick={() => void loadFirst()} disabled={loading} className="btn white sm ml-auto">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="notice amber mx-4 mt-3 sm:mx-6">
          <AlertCircle className="h-4 w-4" />
          <div>{error}</div>
        </div>
      )}

      <div className="fx">
        {/* ── The list ─────────────────────────────────────────── */}
        <div className="fx-list">
          <div className="fx-list-h">
            <b className="small">Faxes</b>
            <span className="row">
              <span className="xs muted">
                {unread} unread{hasMore ? ` of ${faxes.length} loaded` : ""} · newest first
              </span>
              {/* The combined bar's Unread filter, kept — as a pill, which is
                  the one control his header row has room for. */}
              <button
                type="button"
                onClick={() => setUnreadOnly((v) => !v)}
                className={cn("pill", unreadOnly ? "blue" : "grey")}
                aria-pressed={unreadOnly}
                title={unreadOnly ? "Show every fax" : "Show unread faxes only"}
              >
                Unread
              </button>
            </span>
          </div>

          <div className="fx-scroll" ref={scrollRef} onScroll={onScroll}>
            {loading && !faxes.length && (
              <p className="row small muted" style={{ padding: 16 }}>
                <Loader2 className="h-4 w-4 animate-spin" /> Reading RingCentral…
              </p>
            )}
            {!loading && !shown.length && !error && (
              <p className="small muted" style={{ padding: 16 }}>
                {unreadOnly ? "Nothing unread." : "No faxes in the inbox."}
              </p>
            )}
            {shown.map((f) => {
              const busy = busyId === f.id;
              return (
                <div
                  key={f.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(f.id)}
                  onKeyDown={(e) => rowKey(e, f.id)}
                  className={cn("fx-row", selectedId === f.id && "sel")}
                  aria-pressed={selectedId === f.id}
                >
                  <span className="fx-pv" aria-hidden="true">
                    <FileText style={{ width: 18, height: 18 }} />
                  </span>
                  <div className="grow min0">
                    <div className="row wrap">
                      <b className="nm truncate">{faxFrom(f)}</b>
                      <span className={cn("pill", f.read ? "grey" : "blue")} style={{ fontSize: 10 }}>
                        {f.read ? "Read" : "Unread"}
                      </span>
                    </div>
                    <div className="fx-meta">
                      <span>{formatPhoneParen(f.fromNumber) || f.fromNumber}</span>
                      {f.fromLocation && <span>{f.fromLocation}</span>}
                      <span>
                        {f.pages} page{f.pages === 1 ? "" : "s"}
                      </span>
                      <span>{fmtTime(f.creationTime)}</span>
                    </div>
                  </div>
                  <span className="row" style={{ gap: 4 }}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin muted" />}
                    <button
                      type="button"
                      className="btn ghost xs"
                      title="Open the PDF"
                      aria-label="Open the PDF"
                      disabled={busyId != null}
                      onClick={(e) => {
                        stop(e);
                        void viewFax(f);
                      }}
                    >
                      <Eye style={{ width: 14, height: 14 }} />
                    </button>
                    <button
                      type="button"
                      className="btn ghost xs"
                      title="Download PDF"
                      aria-label="Download PDF"
                      disabled={busyId != null}
                      onClick={(e) => {
                        stop(e);
                        void download(f);
                      }}
                    >
                      <Download style={{ width: 14, height: 14 }} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          <div className="fx-foot">
            {hasMore ? (
              <button type="button" className="btn outline xs" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : faxes.length > 0 ? (
              <span className="xs muted">End of inbox · {faxes.length} shown</span>
            ) : null}
          </div>
        </div>

        {/* ── The fax that was picked, and what to do with it ──────── */}
        <div className="fx-pane">
          {selected ? (
            <FaxPane
              fax={selected}
              busy={busyId === selected.id}
              anyBusy={busyId != null}
              onView={() => void viewFax(selected)}
              onDownload={() => void download(selected)}
              onToggleRead={() => void toggleRead(selected)}
            />
          ) : (
            <>
              <div className="notice blue">
                <AlertCircle className="h-4 w-4" />
                <div>
                  <b>Update Clinicals lives here now.</b> Pick a fax on the left, find the patient it belongs to,
                  then attach it, set the visit date, record what the office said, or send the patient back to
                  Evaluate.
                </div>
              </div>
              <div className="fx-uc">
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  <Upload style={{ width: 12, height: 12, display: "inline", verticalAlign: -2, marginRight: 4 }} />
                  Update Clinicals
                </div>
                {/* ⚠️ Not the search itself: the patient list behind it is two
                    board reads, mounted only once a fax is picked (header). */}
                <div className="card pad">
                  <b className="small">Find a patient</b>
                  <div className="xs muted" style={{ marginTop: 2 }}>
                    Pick a fax on the left — the office it came from and their patients are looked up, and the
                    patient search opens here.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FaxPane({
  fax,
  busy,
  anyBusy,
  onView,
  onDownload,
  onToggleRead,
}: {
  fax: InboundFax;
  busy: boolean;
  anyBusy: boolean;
  onView: () => void;
  onDownload: () => void;
  onToggleRead: () => void;
}) {
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
   * ⚠️ **Only a patient this pane can actually work is a pick.** The fax
   * directory knows a patient by board item; the clinicals flow needs the
   * merged row, which exists only for Subscription and live Medical Necessity.
   * A patient of this office sitting in Insurance is still LISTED — they are
   * genuinely with the office — they just have nothing to update here, and a
   * row that selected nobody would read as broken.
   */
  const workable = useMemo(() => new Set(clinicals.patients.map((p) => p.id)), [clinicals.patients]);

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

  const from = faxFrom(fax);
  const number = formatPhoneParen(fax.fromNumber) || fax.fromNumber;
  const provider = dir?.provider ?? null;

  /**
   * His "Likely matches — patients whose doctor faxes from this number", inside
   * the find card. The combined bar drew these as their own *Their patients*
   * card; the rows, the Profile link, the "nothing to update" reason and the
   * finished-or-stuck count all come with them.
   */
  const likely = (
    <div className="fx-likely">
      <div className="xs muted" style={{ margin: "12px 0 6px" }}>
        Likely matches — patients whose doctor faxes from this number
        {dir && dir.inactiveCount > 0 ? ` · ${dir.inactiveCount} finished or stuck, not listed` : ""}
      </div>
      {looking && <div className="xs muted">Looking this number up…</div>}
      {!looking && !dir?.patients.length && (
        <div className="xs muted">Nobody of ours is with this office right now.</div>
      )}
      {!!dir?.patients.length && (
        <div className="uc-results">
          {dir.patients.map((p) => {
            const chip = faxPatientChip(p);
            const can = workable.has(p.itemId);
            return (
              <div
                key={`${p.boardId}:${p.itemId}`}
                className={cn("uc-row", can && "pick", p.inChase && "chase")}
                role={can ? "button" : undefined}
                tabIndex={can ? 0 : undefined}
                onClick={can ? () => setWorkId(p.itemId) : undefined}
                onKeyDown={
                  can
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setWorkId(p.itemId);
                        }
                      }
                    : undefined
                }
                title={can ? "Update this patient's clinicals below" : undefined}
              >
                <User style={{ width: 14, height: 14 }} />
                <span className="grow truncate">{p.name}</span>
                <span className={cn("chip", chip.cls)}>{chip.text}</span>
                {!can && (
                  <span
                    className="xs muted"
                    title="Only Subscription and live Medical Necessity patients have clinicals to update"
                  >
                    nothing to update
                  </span>
                )}
                <Link
                  to={`/patient/${encodeURIComponent(p.itemId)}?board=${p.boardId}&from=fax`}
                  className="btn ghost xs"
                  onClick={(e) => e.stopPropagation()}
                  title="Open the patient screen"
                >
                  Profile <ArrowUpRight style={{ width: 12, height: 12 }} />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* His `.fx-fax` card — the fax, and (ours) the office it resolves to. */}
      <div className="fx-fax card pad">
        <div className="row wrap" style={{ gap: 10, justifyContent: "space-between", alignItems: "flex-start" }}>
          <div className="min0">
            <div className="eyebrow">Selected fax</div>
            <b className="nm">{from}</b>
            <div className="xs muted">
              {number}
              {fax.fromLocation ? ` · ${fax.fromLocation}` : ""} · {fax.pages} page{fax.pages === 1 ? "" : "s"} ·{" "}
              {fmtTime(fax.creationTime)}
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {busy && <Loader2 className="h-4 w-4 animate-spin muted" />}
            <button type="button" className="btn ghost xs" onClick={onToggleRead} disabled={anyBusy}>
              {fax.read ? "Mark unread" : "Mark read"}
            </button>
            <button type="button" className="btn ghost xs" onClick={onView} disabled={anyBusy} title="Open the PDF">
              <Eye style={{ width: 14, height: 14 }} /> View
            </button>
            <button
              type="button"
              className="btn ghost xs"
              onClick={onDownload}
              disabled={anyBusy}
              title="Download PDF"
              aria-label="Download PDF"
            >
              <Download style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>
        <div className="fx-office">
          <Stethoscope style={{ width: 14, height: 14 }} />
          {looking ? (
            <span className="muted">Looking this number up…</span>
          ) : provider ? (
            <span className="min0">
              <b>{provider.doctorName || provider.clinicName || "—"}</b>
              <span className="muted">
                {[provider.clinicName, provider.npi && `NPI ${provider.npi}`, provider.phone]
                  .filter(Boolean)
                  .map((s) => ` · ${s}`)
                  .join("")}
                {` · found on ${provider.source === "doctorDb" ? "the MM Doctor Database" : "a patient's record"}`}
              </span>
            </span>
          ) : (
            // ⚠️ Says what the empty answer MEANS. The ordinary cause is an
            // office sending from a different line than the one we fax to, and
            // a bare "no match" reads as the lookup being broken (§5.28).
            <span className="muted">
              No doctor on any board or in the Doctor Database lists this number. Offices often send from a
              different line than the one we fax to — worth adding this number to the doctor's record.
            </span>
          )}
        </div>
      </div>

      {/* ── Update Clinicals, in place (§5.39c4) ───────────────────────────── */}
      <div className="fx-uc stack">
        <div className="eyebrow">
          <Upload style={{ width: 12, height: 12, display: "inline", verticalAlign: -2, marginRight: 4 }} />
          Update Clinicals
        </div>
        <StaleDataNotice error={clinicals.error} scope="The patient list" onRetry={() => clinicals.refetch()} />
        {clinicals.initialLoading ? (
          <div className="card pad small muted">Loading patients…</div>
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
            findExtra={
              <>
                {" "}
                — this fax came from <b style={{ color: "inherit" }}>{from}</b> ({number}).
              </>
            }
            findSlot={likely}
            context={
              workId ? (
                <p className="xs muted">
                  This fax came from <b>{from}</b> ({number}) — attach it under the clinicals below.
                </p>
              ) : undefined
            }
          />
        )}
      </div>
    </>
  );
}
