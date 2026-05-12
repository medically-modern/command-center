import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderDown, Loader2 } from "lucide-react";
import { fetchItemAssets } from "@/lib/finalConfirm/mondayApi";
import { toast } from "sonner";

interface Props {
  itemId: string;
}

export function ClinicalsDownloadButton({ itemId }: Props) {
  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!itemId) {
      setFileCount(null);
      return;
    }
    setCountLoading(true);
    setFileCount(null);
    fetchItemAssets(itemId)
      .then((assets) => {
        if (cancelled) return;
        setFileCount(assets.length);
      })
      .catch(() => {
        if (cancelled) return;
        setFileCount(null);
      })
      .finally(() => {
        if (cancelled) return;
        setCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const assets = await fetchItemAssets(itemId);
      setFileCount(assets.length);
      if (assets.length === 0) {
        toast.info("No clinicals files found for this patient.");
        return;
      }

      for (const asset of assets) {
        const link = document.createElement("a");
        link.href = asset.public_url;
        link.download = asset.name;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (assets.length > 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      toast.success(`Downloaded ${assets.length} file${assets.length > 1 ? "s" : ""}`);
    } catch (e) {
      console.error("Clinicals download failed", e);
      toast.error("Failed to download clinicals", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  };

  const showCount = fileCount !== null;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={loading || countLoading}
      className="gap-2 h-9 bg-sky-50 hover:bg-sky-100 border-sky-300 !text-sky-800 hover:!text-sky-900 dark:bg-sky-950/40 dark:hover:bg-sky-950/60 dark:border-sky-800 dark:!text-sky-200 dark:hover:!text-sky-100"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderDown className="h-4 w-4" />}
      Download Clinicals
      {showCount && (
        <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0.5 rounded-full bg-sky-200/70 dark:bg-sky-800/70 text-sky-900 dark:text-sky-100 text-[10px] font-semibold leading-none">
          {fileCount}
        </span>
      )}
    </Button>
  );
}
