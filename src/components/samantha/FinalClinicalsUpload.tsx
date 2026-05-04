/**
 * Drag-and-drop / click-to-browse uploader for the Insurance board's
 * Final Clinicals file column. Used on the Auth Outstanding page next
 * to the Clinicals download button.
 *
 * Accepts multiple files at once. Each file is uploaded sequentially —
 * Monday's add_file_to_column mutation only takes one file per call —
 * and progress is surfaced via toast.
 */
import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { uploadFileToColumn, COL } from "@/lib/samantha/mondayApi";
import { cn } from "@/lib/utils";

interface Props {
  itemId: string;
  /** Optional callback when uploads finish successfully — useful for
   *  refreshing a sibling Clinicals counter. */
  onUploaded?: () => void;
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

export function FinalClinicalsUpload({ itemId, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    if (!itemId || uploading) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    setUploading(true);
    const failures: string[] = [];
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[FinalClinicalsUpload] failed for ${file.name}:`, msg);
        failures.push(`${file.name}: ${msg}`);
      }
    }
    setUploading(false);

    const succeeded = list.length - failures.length;
    if (succeeded > 0) {
      toast.success(
        `Uploaded ${succeeded} file${succeeded > 1 ? "s" : ""} to Final Clinicals`,
      );
      onUploaded?.();
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
    if (!e.dataTransfer?.files?.length) return;
    void handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={cn(
        "rounded-md border border-dashed transition-colors",
        dragOver
          ? "border-primary bg-primary/10"
          : "border-border bg-background",
      )}
    >
      <Button
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={!itemId || uploading}
        className="gap-2 border-0 bg-transparent hover:bg-transparent"
        title="Drag files here or click to upload to Final Clinicals"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {uploading ? "Uploading…" : dragOver ? "Drop to upload" : "Upload Clinicals"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
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
