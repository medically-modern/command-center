import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { fetchItemAssets } from "@/lib/samantha/mondayApi";
import { toast } from "sonner";

interface Props {
  itemId: string;
}

export function ClinicalsDownloadButton({ itemId }: Props) {
  const [loading, setLoading] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  // Fetch the file count whenever the patient changes so the button can
  // surface how many clinicals are attached without requiring a click.
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
      // Sync the count display with the freshly-fetched truth from Monday
      setFileCount(assets.length);
      if (assets.length === 0) {
        toast.info("No clinicals files found for this patient.");
        return;
      }

      // Download each file via its public_url
      for (const asset of assets) {
        const link = document.createElement("a");
        link.href = asset.public_url;
        link.download = asset.name;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Small delay between downloads to avoid browser blocking
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
      className="gap-2"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Clinicals
      {showCount && (
        <span className="ml-1 inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold leading-none">
          {fileCount}
        </span>
      )}
    </Button>
  );
}
