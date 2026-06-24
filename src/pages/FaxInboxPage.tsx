/**
 * Fax Inbox page — view + download inbound faxes from RingCentral without
 * leaving the app, and mark them read/unread. Reached from the FAX bar.
 *
 * All client-side: RingCentral allows the message-store list, document, and
 * mark-read (PUT) endpoints cross-origin from this site (verified). Faxes load
 * in pages (RC defaults to ~the last 24h, so we look back 180 days) and more
 * load as you scroll. Clicking a fax opens its PDF in the shared FileViewer.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, FileText, Inbox, Loader2, Mail, MailOpen, RefreshCw } from "lucide-react";
import { fetchInboundFaxes, fetchFaxBlobUrl, setFaxRead, type InboundFax } from "@/lib/fax/ringcentralApi";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { cn } from "@/lib/utils";

function fmtTime(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
function fmtPhone(num: string): string {
  const d = (num || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return num || "Unknown";
}
function faxName(f: InboundFax): string {
  const who = (f.fromName || fmtPhone(f.fromNumber) || "fax").replace(/[^\w\s().-]/g, "").trim() || "fax";
  const d = f.creationTime ? new Date(f.creationTime).toISOString().slice(0, 10) : "";
  return `Fax — ${who}${d ? " " + d : ""}.pdf`;
}

export default function FaxInboxPage() {
  const navigate = useNavigate();
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  const [faxes, setFaxes] = useState<InboundFax[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadFirst = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetchInboundFaxes({ page: 1, perPage: 50 });
      setFaxes(r.faxes);
      setHasMore(r.hasMore);
      setTotal(r.total);
      setPage(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    setErr(null);
    try {
      const next = page + 1;
      const r = await fetchInboundFaxes({ page: next, perPage: 50 });
      setFaxes((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...r.faxes.filter((f) => !seen.has(f.id))];
      });
      setHasMore(r.hasMore);
      setPage(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadFirst();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) void loadMore();
  };

  const viewFax = async (f: InboundFax) => {
    if (!f.attachmentUri || busyId) return;
    setBusyId(f.id);
    setErr(null);
    try {
      openFileViewer({ url: await fetchFaxBlobUrl(f.attachmentUri), name: faxName(f) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const download = async (f: InboundFax, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!f.attachmentUri || busyId) return;
    setBusyId(f.id);
    setErr(null);
    try {
      const url = await fetchFaxBlobUrl(f.attachmentUri);
      const a = document.createElement("a");
      a.href = url;
      a.download = faxName(f);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusyId(null);
    }
  };

  const toggleRead = async (f: InboundFax, e: React.MouseEvent) => {
    e.stopPropagation();
    if (busyId) return;
    const target = !f.read;
    setBusyId(f.id);
    setErr(null);
    try {
      await setFaxRead(f.id, target);
      setFaxes((prev) => prev.map((x) => (x.id === f.id ? { ...x, read: target } : x)));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-screen bg-gradient-subtle flex flex-col">
      <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border shrink-0">
        <div className="px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={goBack} className="p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-9 w-9 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
            <Inbox className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · RingCentral</p>
            <h1 className="text-xl font-bold flex items-center gap-2">
              Fax Inbox {total > 0 && <span className="text-sm font-normal opacity-80">({total})</span>}
            </h1>
          </div>
          <button
            onClick={() => void loadFirst()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 sm:p-6">
          {loading && faxes.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading faxes…
            </div>
          ) : err && faxes.length === 0 ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{err}</div>
          ) : faxes.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">No faxes in the inbox.</p>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden divide-y">
              {faxes.map((f) => {
                const busy = busyId === f.id;
                return (
                  <div
                    key={f.id}
                    role="button"
                    onClick={() => void viewFax(f)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/40",
                      !f.read && "bg-[oklch(0.98_0.03_95)]",
                    )}
                  >
                    <FileText className={cn("h-5 w-5 shrink-0", f.read ? "text-muted-foreground" : "text-[color:var(--mm-teal)]")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("truncate text-sm", f.read ? "font-medium" : "font-bold")}>
                          {f.fromName || fmtPhone(f.fromNumber)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full text-[10px] font-semibold px-1.5 py-0.5",
                            f.read ? "bg-muted text-muted-foreground" : "bg-red-500/10 text-red-600",
                          )}
                        >
                          {f.read ? "Read" : "Unread"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {fmtPhone(f.fromNumber)}
                        {f.fromLocation ? ` · ${f.fromLocation}` : ""} · {f.pages} page{f.pages === 1 ? "" : "s"} ·{" "}
                        {fmtTime(f.creationTime)}
                      </div>
                    </div>
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                    <button
                      onClick={(e) => void toggleRead(f, e)}
                      disabled={busyId != null}
                      title={f.read ? "Mark unread" : "Mark read"}
                      className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      {f.read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={(e) => void download(f, e)}
                      disabled={busyId != null}
                      title="Download PDF"
                      className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {err && faxes.length > 0 && <p className="py-3 text-center text-xs text-destructive">{err}</p>}

          {hasMore && faxes.length > 0 && (
            <div className="py-4 text-center">
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
          {!hasMore && faxes.length > 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground/70">End of inbox · {faxes.length} shown</p>
          )}
        </div>
      </div>
    </div>
  );
}
