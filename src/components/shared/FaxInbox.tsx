/**
 * Fax Inbox — view + download inbound faxes from RingCentral without leaving
 * the app. Opened from the FAX bar (openFaxInbox()). Lists sender (office
 * name/number), time, pages and read state; clicking a fax fetches its PDF
 * (with the RC token) and opens it in the shared FileViewer (zoom / rotate /
 * download). The token + RC reads are client-side — RingCentral allows the
 * document endpoint cross-origin from this site (verified).
 *
 * Mount <FaxInboxHost /> once (done in App.tsx).
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Download, FileText, Inbox, Loader2, RefreshCw } from "lucide-react";
import { fetchInboundFaxes, fetchFaxBlobUrl, type InboundFax } from "@/lib/fax/ringcentralApi";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { cn } from "@/lib/utils";

let listener: ((open: boolean) => void) | null = null;
/** Open the fax inbox pop-up from anywhere (e.g. the FAX bar). */
export function openFaxInbox() {
  if (listener) listener(true);
}

export function FaxInboxHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    listener = (o) => setOpen(o);
    return () => {
      listener = null;
    };
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {open && <FaxInboxContent />}
    </Dialog>
  );
}

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

function FaxInboxContent() {
  const [faxes, setFaxes] = useState<InboundFax[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      setFaxes(await fetchInboundFaxes(50));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

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

  return (
    <DialogContent className="sm:max-w-2xl p-0 gap-0 flex flex-col max-h-[85vh]">
      <DialogHeader className="px-4 py-3 border-b">
        <DialogTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-[color:var(--mm-teal)]" />
          Fax Inbox
          <button
            onClick={() => void load()}
            disabled={loading}
            className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </button>
        </DialogTitle>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-[240px]">
        {loading && faxes.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading faxes…
          </div>
        ) : err ? (
          <div className="m-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>{err}</div>
          </div>
        ) : faxes.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No faxes in the inbox.</p>
        ) : (
          <ul className="divide-y">
            {faxes.map((f) => {
              const busy = busyId === f.id;
              return (
                <li key={f.id}>
                  <div
                    role="button"
                    onClick={() => void viewFax(f)}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer"
                  >
                    <div className="relative shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      {!f.read && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("truncate text-sm", f.read ? "font-medium" : "font-bold")}>
                          {f.fromName || fmtPhone(f.fromNumber)}
                        </span>
                        {!f.read && (
                          <span className="shrink-0 rounded-full bg-red-500/10 text-red-600 text-[10px] font-semibold px-1.5 py-0.5">
                            New
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {fmtPhone(f.fromNumber)}
                        {f.fromLocation ? ` · ${f.fromLocation}` : ""} · {f.pages} page{f.pages === 1 ? "" : "s"} ·{" "}
                        {fmtTime(f.creationTime)}
                      </div>
                    </div>
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                    <button
                      onClick={(e) => void download(f, e)}
                      disabled={busy}
                      title="Download PDF"
                      className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DialogContent>
  );
}
