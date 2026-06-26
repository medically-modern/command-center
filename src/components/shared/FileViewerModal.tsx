/**
 * In-app file viewer for Monday-attached clinical files (PDF / JPEG / PNG).
 *
 * Files are fetched as bytes through fetchAssetBytes (direct fetch → worker
 * proxy fallback), so Monday's `Content-Disposition: attachment` S3 headers
 * never trigger a browser download. PDFs render via pdf.js (lazy-loaded);
 * images render as a blob <img>. Both support 90° rotation and zoom.
 *
 * Usage:
 *   - Mount <FileViewerHost /> once (done in App.tsx).
 *   - Call openFileViewer({ url, name }) from any View button.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Download,
  Loader2,
  RotateCcw,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { fetchAssetBytes } from "@/lib/shared/mondayAssets";

// ---------------------------------------------------------------------------
// Tiny pub/sub so any component can open the viewer without prop-drilling.
// ---------------------------------------------------------------------------

export interface ViewerFile {
  url: string;
  name?: string;
}

type Listener = (file: ViewerFile) => void;
let listener: Listener | null = null;

export function openFileViewer(file: ViewerFile) {
  if (listener) {
    listener(file);
  } else {
    // Host not mounted (shouldn't happen) — fall back to the old behavior.
    window.open(file.url, "_blank");
  }
}

// ---------------------------------------------------------------------------
// Type detection — extension first, magic bytes as fallback.
// ---------------------------------------------------------------------------

type FileKind = "pdf" | "image" | "unknown";

function detectKind(name: string | undefined, bytes: Uint8Array): FileKind {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "image";
  // Magic bytes
  if (bytes.length >= 5) {
    const head = String.fromCharCode(...bytes.slice(0, 5));
    if (head.startsWith("%PDF")) return "pdf";
  }
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image"; // PNG
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image"; // JPEG
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image"; // GIF
  }
  return "unknown";
}

function imageMime(name: string | undefined, bytes: Uint8Array): string {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png" || (bytes[0] === 0x89 && bytes[1] === 0x50)) return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/jpeg";
}

// ---------------------------------------------------------------------------
// Host — mount once at app root.
// ---------------------------------------------------------------------------

export function FileViewerHost() {
  const [file, setFile] = useState<ViewerFile | null>(null);

  useEffect(() => {
    listener = (f) => setFile(f);
    return () => {
      listener = null;
    };
  }, []);

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && setFile(null)}>
      {file && <ViewerContent file={file} onClose={() => setFile(null)} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Viewer body
// ---------------------------------------------------------------------------

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function ViewerContent({ file, onClose }: { file: ViewerFile; onClose: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<FileKind>("unknown");
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const [zoomIdx, setZoomIdx] = useState(2); // index into ZOOM_STEPS (1 = 100%)
  const [pageCount, setPageCount] = useState(0);

  const zoom = ZOOM_STEPS[zoomIdx];

  // Fetch bytes once per file
  useEffect(() => {
    let cancelled = false;
    setBytes(null);
    setError(null);
    setRotation(0);
    setZoomIdx(2);
    setPageCount(0);
    fetchAssetBytes(file.url, file.name)
      .then((b) => {
        if (cancelled) return;
        setKind(detectKind(file.name, b));
        setBytes(b);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const rotate = (dir: 1 | -1) => setRotation((r) => (r + dir * 90 + 360) % 360);

  const download = useCallback(() => {
    if (!bytes) return;
    const blob = new Blob([bytes.slice() as unknown as BlobPart]);
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = file.name || "file";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, [bytes, file.name]);

  return (
    <DialogContent
      className="max-w-[92vw] w-[92vw] h-[92vh] flex flex-col gap-0 p-0 overflow-hidden [&>button]:hidden"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b bg-background shrink-0">
        <DialogTitle className="flex-1 min-w-0 truncate text-sm font-semibold">
          {file.name || "File"}
        </DialogTitle>
        {pageCount > 1 && (
          <span className="text-xs text-muted-foreground mr-2 shrink-0">
            {pageCount} pages
          </span>
        )}
        <ToolbarButton title="Rotate left" onClick={() => rotate(-1)} disabled={!bytes}>
          <RotateCcw className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Rotate right" onClick={() => rotate(1)} disabled={!bytes}>
          <RotateCw className="h-4 w-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-border mx-1" />
        <ToolbarButton
          title="Zoom out"
          onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
          disabled={!bytes || zoomIdx === 0}
        >
          <ZoomOut className="h-4 w-4" />
        </ToolbarButton>
        <span className="text-xs text-muted-foreground w-10 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarButton
          title="Zoom in"
          onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
          disabled={!bytes || zoomIdx === ZOOM_STEPS.length - 1}
        >
          <ZoomIn className="h-4 w-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-border mx-1" />
        <ToolbarButton title="Download" onClick={download} disabled={!bytes}>
          <Download className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto bg-muted/60">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm font-medium text-destructive">Couldn't load this file</p>
            <p className="text-xs text-muted-foreground max-w-md">{error}</p>
            <button
              onClick={() => window.open(file.url, "_blank")}
              className="text-sm font-semibold text-[color:var(--mm-teal)] hover:underline"
            >
              Open in new tab instead
            </button>
          </div>
        ) : !bytes ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin" />
            <p className="text-sm">Loading {file.name || "file"}…</p>
          </div>
        ) : kind === "pdf" ? (
          <PdfView bytes={bytes} rotation={rotation} zoom={zoom} onPageCount={setPageCount} />
        ) : kind === "image" ? (
          <ImageView bytes={bytes} name={file.name} rotation={rotation} zoom={zoom} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Preview not supported for this file type.
            </p>
            <button
              onClick={download}
              className="text-sm font-semibold text-[color:var(--mm-teal)] hover:underline"
            >
              Download instead
            </button>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

function ToolbarButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Image view — blob <img> with CSS rotation/zoom.
// ---------------------------------------------------------------------------

function ImageView({
  bytes,
  name,
  rotation,
  zoom,
}: {
  bytes: Uint8Array;
  name?: string;
  rotation: number;
  zoom: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([bytes.slice() as unknown as BlobPart], {
      type: imageMime(name, bytes),
    });
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes, name]);

  if (!src) return null;
  const sideways = rotation === 90 || rotation === 270;
  return (
    <div className="min-h-full min-w-full flex items-center justify-center p-6">
      <img
        src={src}
        alt={name || "attachment"}
        style={{
          transform: `rotate(${rotation}deg) scale(${zoom})`,
          transformOrigin: "center center",
          maxWidth: sideways ? "85vh" : "85vw",
          maxHeight: sideways ? "85vw" : "78vh",
          transition: "transform 0.15s ease",
        }}
        className="select-none shadow-lg bg-white"
        draggable={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PDF view — pdf.js canvases, rotation handled natively by the viewport.
// ---------------------------------------------------------------------------

interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(opts: { scale: number; rotation: number }): {
      width: number;
      height: number;
      rotation: number;
    };
    render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
      promise: Promise<void>;
      cancel(): void;
    };
  }>;
}

/** Where pdf.js fetches its standard-14 fonts + CMaps. Defaults to a
 *  version-pinned jsDelivr path (kept in lockstep with the bundled worker via
 *  pdfjs.version below); set VITE_PDFJS_ASSETS_URL to a self-hosted copy of
 *  pdfjs-dist's `standard_fonts/` + `cmaps/` dirs to avoid the CDN. */
const PDFJS_ASSET_BASE =
  (import.meta.env.VITE_PDFJS_ASSETS_URL as string | undefined)?.replace(/\/+$/, "") || "";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Lazy-load pdf.js + its worker so the main bundle stays small. */
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

function PdfView({
  bytes,
  rotation,
  zoom,
  onPageCount,
}: {
  bytes: Uint8Array;
  rotation: number;
  zoom: number;
  onPageCount: (n: number) => void;
}) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<PdfDocLike | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  // Load the document once per bytes
  useEffect(() => {
    let cancelled = false;
    let task: { destroy(): Promise<void> } | null = null;
    setDoc(null);
    setLoadError(null);
    loadPdfjs()
      .then((pdfjs) => {
        if (cancelled) return null;
        // pdf.js needs the standard-14 fonts + CMaps to render PDFs whose fonts
        // aren't embedded (common in faxed clinicals). Without them the page
        // draws with invisible glyphs — a "blank" page — and only logs a console
        // warning, so the error UI never fires. Pin the assets to the loaded
        // pdf.js version so worker/API/assets always match.
        const assetBase =
          PDFJS_ASSET_BASE || `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;
        // pdf.js transfers the buffer to its worker — hand it a copy
        const loadingTask = pdfjs.getDocument({
          data: bytes.slice(),
          cMapUrl: `${assetBase}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assetBase}/standard_fonts/`,
        });
        task = loadingTask;
        return loadingTask.promise;
      })
      .then((d) => {
        if (!d || cancelled) return;
        onPageCount(d.numPages);
        setDoc(d as unknown as PdfDocLike);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
      task?.destroy().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  // (Re-)render all pages when doc / rotation / zoom changes
  useEffect(() => {
    // Depend on the container *element* (via a callback ref → state) so this
    // re-runs once the portaled+animated Dialog actually mounts the node. With
    // a plain ref the effect could fire before mount, bail, and never re-run —
    // leaving a stuck "Rendering…" pill over a blank area on slower machines.
    if (!doc || !containerEl) return;
    let cancelled = false;
    const container = containerEl;
    setRendering(true);

    (async () => {
      container.innerHTML = "";
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i);
        // viewport rotation is absolute — stack user rotation on the page's own /Rotate
        const viewport = page.getViewport({
          scale: zoom * 1.25,
          rotation: (getDefaultRotation(page) + rotation) % 360,
        });
        const canvas = document.createElement("canvas");
        // Clamp to ≥1px: a degenerate page (0-width MediaBox) would floor to a
        // 0×0 canvas that renders as blank with no error.
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.max(1, Math.floor(viewport.width))}px`;
        canvas.style.height = `${Math.max(1, Math.floor(viewport.height))}px`;
        canvas.className = "shadow-lg bg-white mx-auto block";
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.scale(dpr, dpr);
        if (cancelled) return;
        container.appendChild(canvas);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
      if (!cancelled) setRendering(false);
    })().catch((e) => {
      if (!cancelled) {
        setLoadError(e instanceof Error ? e.message : String(e));
        setRendering(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [doc, rotation, zoom, containerEl]);

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <p className="text-sm text-destructive">PDF failed to render: {loadError}</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-full">
      {rendering && (
        <div className="absolute inset-x-0 top-4 flex justify-center pointer-events-none z-10">
          <span className="inline-flex items-center gap-2 rounded-full bg-background/90 border px-3 py-1.5 text-xs text-muted-foreground shadow">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rendering…
          </span>
        </div>
      )}
      <div ref={setContainerEl} className="flex flex-col items-center gap-4 p-6" />
    </div>
  );
}

/** A page's intrinsic /Rotate value (0/90/180/270), so user rotation stacks on top. */
function getDefaultRotation(page: unknown): number {
  const r = (page as { rotate?: number }).rotate;
  return typeof r === "number" ? ((r % 360) + 360) % 360 : 0;
}
