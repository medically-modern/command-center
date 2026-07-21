/**
 * Drag-and-drop / click-to-browse uploader for the Insurance board's
 * Final Clinicals file column (file_mm25m8c1). EVERY upload surface on the
 * Auth Outstanding page lands in this one column (redesign handoff §5):
 *
 *   - tone "amber" — per-card "Upload the auth docs" zone (Call/Fax
 *     submissions with an Auth Valid / No Auth Needed result)
 *   - tone "rose"  — per-card denial-reason upload (result = Denied;
 *     single file, optional — never gates Complete)
 *   - tone "default" — the original standalone drop-zone look
 *
 * Uploads are additive: Monday appends to the file column.
 */
import { useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { uploadFileToColumn, COL } from "@/lib/samantha/mondayApi";
import { cn } from "@/lib/utils";

interface Props {
  itemId: string;
  /** Optional callback when uploads finish successfully — useful for
   *  refreshing a sibling Clinicals counter. */
  onUploaded?: () => void;
  /** Names of the files that uploaded successfully (per-card chips). */
  onUploadedFiles?: (names: string[]) => void;
  tone?: "default" | "amber" | "rose";
  title?: string;
  subtitle?: string;
  /** Allow multiple files at once (default true; denial upload passes false). */
  multiple?: boolean;
  className?: string;
}

const ACCEPTED_MIME_FALLBACK = "application/octet-stream";

function inferMimeType(file: File): string {
  if (file.type) return file.type;
  // Browsers occasionally hand back an empty type; fall back to
  // extension-based heuristic for the common cases the team uses.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return ACCEPTED_MIME_FALLBACK;
  }
}

const TONE_STYLES = {
  default: {
    idle: "border-border bg-muted/40 hover:border-primary/60 hover:bg-muted/60",
    drag: "border-primary bg-primary/10 ring-2 ring-primary/30",
    iconDrag: "bg-primary text-primary-foreground",
  },
  amber: {
    idle: "border-amber-400/60 bg-amber-50/60 hover:border-amber-500 hover:bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700",
    drag: "border-amber-500 bg-amber-100/80 ring-2 ring-amber-400/40 dark:bg-amber-950/40",
    iconDrag: "bg-amber-500 text-white",
  },
  rose: {
    idle: "border-red-400/50 bg-red-50/50 hover:border-red-500 hover:bg-red-50 dark:bg-red-950/20 dark:border-red-800",
    drag: "border-red-500 bg-red-100/80 ring-2 ring-red-400/40 dark:bg-red-950/40",
    iconDrag: "bg-red-500 text-white",
  },
} as const;

export function FinalClinicalsUpload({
  itemId,
  onUploaded,
  onUploadedFiles,
  tone = "default",
  title,
  subtitle,
  multiple = true,
  className,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const styles = TONE_STYLES[tone];

  const handleFiles = async (files: FileList | File[]) => {
    if (!itemId || uploading) return;
    let list = Array.from(files);
    if (!multiple) list = list.slice(0, 1);
    if (list.length === 0) return;

    setUploading(true);
    const failures: string[] = [];
    const uploaded: string[] = [];
    for (const file of list) {
      try {
        const buf = await file.arrayBuffer();
        await uploadFileToColumn(
          itemId,
          COL.finalClinicals,
          new Uint8Array(buf),
          file.name,
          inferMimeType(file),
        );
        uploaded.push(file.name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[FinalClinicalsUpload] failed for ${file.name}:`, msg);
        failures.push(`${file.name}: ${msg}`);
      }
    }
    setUploading(false);

    if (uploaded.length > 0) {
      toast.success(
        `Uploaded ${uploaded.length} file${uploaded.length > 1 ? "s" : ""} to Final Clinicals`,
      );
      onUploaded?.();
      onUploadedFiles?.(uploaded);
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} file${failures.length > 1 ? "s" : ""} failed`,
        { description: failures[0] },
      );
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading || !itemId) return;
    if (!e.dataTransfer?.files?.length) return;
    void handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (uploading || !itemId) return;
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const onClick = () => {
    if (uploading || !itemId) return;
    inputRef.current?.click();
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-disabled={!itemId || uploading}
      className={cn(
        "rounded-lg border-2 border-dashed px-4 py-3 transition-all cursor-pointer select-none",
        "flex items-center gap-3 text-left",
        dragOver ? styles.drag : styles.idle,
        (!itemId || uploading) && "opacity-60 cursor-not-allowed",
        className,
      )}
      title="Drag files here or click to upload to Final Clinicals on Monday"
    >
      <div
        className={cn(
          "h-10 w-10 rounded-md flex items-center justify-center shrink-0 transition-colors",
          dragOver ? styles.iconDrag : "bg-background border",
        )}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <UploadCloud className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">
          {uploading
            ? "Uploading…"
            : dragOver
              ? "Drop to upload"
              : (title ?? "Upload Auth Docs")}
        </p>
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
          {uploading
            ? "Saving to Final Clinicals on Monday"
            : (subtitle ?? "Drag files here or click to browse")}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (!e.target.files) return;
          void handleFiles(e.target.files);
          // Reset so re-selecting the same file fires onChange again
          e.target.value = "";
        }}
      />
    </div>
  );
}
