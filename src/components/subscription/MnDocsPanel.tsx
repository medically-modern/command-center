/**
 * Medical Necessity Documents — view, download individual files, and
 * upload new files to the mnDocs file column on Monday.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, UploadCloud, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  COL,
  fetchItemFileColumns,
  uploadFileToColumn,
  type MondayFileEntry,
} from "@/lib/subscription/mondayApi";

interface Props {
  itemId: string;
}

const ACCEPTED_MIME_FALLBACK = "application/octet-stream";

function inferMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "doc": return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return ACCEPTED_MIME_FALLBACK;
  }
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "text-red-500";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "text-blue-500";
  if (["doc", "docx"].includes(ext)) return "text-indigo-500";
  return "text-muted-foreground";
}

export function MnDocsPanel({ itemId }: Props) {
  const [files, setFiles] = useState<MondayFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const fetchFiles = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    try {
      const cols = await fetchItemFileColumns(itemId, [COL.mnDocs]);
      setFiles(cols[COL.mnDocs] ?? []);
    } catch (e) {
      console.error("[MnDocsPanel] fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // ── Download a single file ──
  // ── FIX (2026-06-01): Cross-origin blob download ──────────────────
  // BEFORE: Used link.href = url with link.download attribute directly on
  // Monday CDN URLs. Browsers ignore `download` on cross-origin URLs, so
  // files would open in a new tab instead of downloading.
  // FIX: Fetch as blob first to create a same-origin blob URL, then trigger
  // download from that. Falls back to window.open on fetch failure.
  // ──────────────────────────────────────────────────────────────────────
  const handleDownload = async (file: MondayFileEntry) => {
    const url = file.public_url || file.url;
    if (!url) {
      toast.error(`No download URL for "${file.name}"`);
      return;
    }
    try {
      const resp = await fetch(url, { mode: "cors" });
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      toast.success(`Downloading "${file.name}"`);
    } catch {
      // fallback: open in new tab
      window.open(url, "_blank");
      toast.success(`Opening "${file.name}" in new tab`);
    }
  };

  // ── Upload files ──
  const handleUpload = async (fileList: FileList | File[]) => {
    if (!itemId || uploading) return;
    const list = Array.from(fileList);
    if (list.length === 0) return;

    setUploading(true);
    const failures: string[] = [];
    for (const file of list) {
      try {
        const buf = await file.arrayBuffer();
        await uploadFileToColumn(
          itemId,
          COL.mnDocs,
          new Uint8Array(buf),
          file.name,
          inferMimeType(file),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[MnDocsPanel] upload failed for ${file.name}:`, msg);
        failures.push(`${file.name}: ${msg}`);
      }
    }
    setUploading(false);

    const succeeded = list.length - failures.length;
    if (succeeded > 0) {
      toast.success(`Uploaded ${succeeded} file${succeeded > 1 ? "s" : ""}`);
      fetchFiles(); // refresh list
    }
    if (failures.length > 0) {
      toast.error(`${failures.length} file${failures.length > 1 ? "s" : ""} failed`, {
        description: failures[0],
      });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading || !itemId) return;
    if (!e.dataTransfer?.files?.length) return;
    void handleUpload(e.dataTransfer.files);
  };

  return (
    <div className="mt-3 pt-3 border-t">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
        Medical Necessity Documents
      </p>

      {/* File list */}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
        </div>
      ) : files.length > 0 ? (
        <ul className="space-y-1.5 mb-3">
          {files.map((f) => (
            <li key={f.assetId} className="flex items-center gap-2 group">
              <FileText className={cn("h-4 w-4 shrink-0", fileIcon(f.name))} />
              <span className="text-sm truncate flex-1" title={f.name}>{f.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDownload(f)}
                title={`Download ${f.name}`}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground mb-3">No files uploaded yet.</p>
      )}

      {/* Upload drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); if (!uploading && itemId) setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onClick={() => { if (!uploading && itemId) inputRef.current?.click(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        className={cn(
          "rounded-lg border-2 border-dashed px-4 py-3 transition-all cursor-pointer select-none",
          "flex items-center gap-3",
          dragOver
            ? "border-primary bg-primary/10 ring-2 ring-primary/30"
            : "border-border bg-muted/40 hover:border-primary/60 hover:bg-muted/60",
          (!itemId || uploading) && "opacity-60 cursor-not-allowed",
        )}
      >
        <div className={cn(
          "h-9 w-9 rounded-md flex items-center justify-center shrink-0 transition-colors",
          dragOver ? "bg-primary text-primary-foreground" : "bg-background border",
        )}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">
            {uploading ? "Uploading…" : dragOver ? "Drop to upload" : "Upload MN Docs"}
          </p>
          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
            {uploading ? "Saving to Monday" : "Drag files here or click to browse"}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (!e.target.files) return;
            void handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
