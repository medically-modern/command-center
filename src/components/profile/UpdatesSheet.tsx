import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUpdates, createUpdate, type MondayUpdate } from "@/lib/profile/mondayApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { MessageSquare, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  itemId: string;
  patientName: string;
}

export function UpdatesSheet({ itemId, patientName }: Props) {
  const [open, setOpen] = useState(false);
  const [updates, setUpdates] = useState<MondayUpdate[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUpdates(itemId);
      setUpdates(data);
    } catch (e) {
      toast.error("Failed to load updates", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  // Load updates when the sheet opens
  useEffect(() => {
    if (open) {
      load();
      setDraft("");
    }
  }, [open, load]);

  const handlePost = async () => {
    const text = draft.trim();
    if (!text) return;

    setPosting(true);
    try {
      await createUpdate(itemId, text + "<br><br><i>-Profile Checklist</i>");
      setDraft("");
      toast.success("Update posted");
      // Refresh to show the new update
      await load();
    } catch (e) {
      toast.error("Failed to post update", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setPosting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePost();
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs">
          <MessageSquare className="h-3.5 w-3.5" />
          Updates
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="text-base">Updates — {patientName}</SheetTitle>
        </SheetHeader>

        {/* Compose area */}
        <div className="px-6 pb-4 space-y-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write an update…"
            className="min-h-[80px] resize-none text-sm"
            disabled={posting}
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">⌘+Enter to post</p>
            <Button
              size="sm"
              onClick={handlePost}
              disabled={posting || !draft.trim()}
              className="gap-1.5"
            >
              {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Post
            </Button>
          </div>
        </div>

        <Separator />

        {/* Updates list */}
        <ScrollArea className="flex-1 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : updates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No updates yet
            </p>
          ) : (
            <div className="space-y-4 py-4">
              {updates.map((u) => (
                <div key={u.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {u.creator?.name ?? "System"}
                    </span>
                    <span>·</span>
                    <span>{formatDate(u.created_at)}</span>
                  </div>
                  <div
                    className="text-sm leading-relaxed prose prose-sm max-w-none
                      [&_br]:block [&_p]:my-1 [&_img]:hidden"
                    dangerouslySetInnerHTML={{ __html: u.body }}
                  />
                  <Separator className="mt-3" />
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
