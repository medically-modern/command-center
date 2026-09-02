/**
 * The text inbox — RingCentral's conversation list, in the Command Center.
 *
 * Deliberately the same shape as the RingCentral app's Text tab (Josh: "the rc
 * ui is fine"): newest conversation first, an ALL / UNREAD filter, a preview
 * line, and a right-click menu carrying Mark as unread. What the Command
 * Center adds is the third pane beside it — the patient's profile and path.
 *
 * ⚠️ **Read state is RingCentral's, not ours.** Opening a conversation PUTs its
 * unread inbound messages to Read; the context menu PUTs the newest one back to
 * Unread. Reps work this same line in the RingCentral desktop app, so a
 * locally-invented flag would disagree with what they see there within a day.
 * The local override map exists only to cover the seconds between the write and
 * the next poll — see `applyReadOverrides`.
 *
 * ⚠️ Names are RingCentral's caller ID FIRST, and only then our boards — and
 * the board half is a single BATCHED read, never a lookup per row. "One
 * cross-board query per conversation on every poll" is the INCIDENT_2026-08-20
 * shape and is still forbidden; `hooks/commsHub/useDirectoryNames` resolves the
 * whole list in a couple of requests and caches the answers (misses included)
 * for the session. The rule itself is `lib/commsHub/directory.ts`.
 */
import { useMemo } from "react";
import { AlertTriangle, MailOpen, MessageSquare } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Conversation } from "@/lib/commsHub/conversations";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { resolveDisplayName } from "@/lib/commsHub/directory";
import { cn } from "@/lib/utils";
import { HubListHeader, Initials, ListEmpty, ListError, listTime } from "./HubList";

export function TextInbox({
  conversations,
  loading,
  error,
  onReload,
  selectedKey,
  onSelect,
  onMarkUnread,
  onMarkRead,
  query,
  onQuery,
  unreadOnly,
  onUnreadOnly,
  names,
}: {
  conversations: Conversation[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  selectedKey: string | null;
  onSelect: (c: Conversation) => void;
  onMarkUnread: (c: Conversation) => void;
  onMarkRead: (c: Conversation) => void;
  query: string;
  onQuery: (v: string) => void;
  unreadOnly: boolean;
  onUnreadOnly: (v: boolean) => void;
  /** Patient names our boards hold, keyed by last-10 digits — one batched read
   *  for the whole list (`hooks/commsHub/useDirectoryNames`). */
  names: ReadonlyMap<string, string>;
}) {
  const unreadTotal = useMemo(() => conversations.filter((c) => c.unread > 0).length, [conversations]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return conversations
      .map((c) => ({
        c,
        // `source` rides along: the avatar must not take initials from a
        // formatted phone number ("(815) 523-7259" → "(5").
        ...resolveDisplayName({ rcName: c.rcName, directoryName: names.get(c.key), phone: c.phone }, fmtPhone),
      }))
      .filter(({ c, label }) => {
        if (unreadOnly && !c.unread) return false;
        if (!q) return true;
        // Matched on what the row SHOWS, the preview, and the number's digits —
        // a rep searching "555" means the number, not a message containing
        // "555". Searching the label rather than `rcName` is what lets them
        // find a patient by the name they can see (Josh, 2026-09-02).
        return (
          label.toLowerCase().includes(q) ||
          c.preview.toLowerCase().includes(q) ||
          (digits.length >= 3 && c.key.includes(digits))
        );
      });
  }, [conversations, query, unreadOnly, names]);

  return (
    <>
      <HubListHeader
        title="Text"
        count={conversations.length}
        query={query}
        onQuery={onQuery}
        placeholder="Search texts…"
        unreadOnly={unreadOnly}
        onUnreadOnly={onUnreadOnly}
        unreadCount={unreadTotal}
        loading={loading}
        onReload={onReload}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <ListError error={error} />}
        {!error && !shown.length && (
          <ListEmpty>
            {unreadOnly
              ? "Nothing unread — everyone has been answered."
              : query
                ? "No conversations matched."
                : loading
                  ? "Loading conversations…"
                  : "No texts in the last 30 days."}
          </ListEmpty>
        )}

        {shown.map(({ c, label, source }) => {
          const selected = c.key === selectedKey;
          return (
            <ContextMenu key={c.key}>
              <ContextMenuTrigger asChild>
                <button
                  onClick={() => onSelect(c)}
                  className={cn(
                    "flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left hover:bg-muted/40",
                    selected && "bg-muted/70",
                  )}
                >
                  <Initials
                    name={source === "number" ? "" : label}
                    phone={c.phone}
                    tone={c.unread ? "bg-primary/15 text-primary" : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}
                        title={fmtPhone(c.phone)}
                      >
                        {label}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {listTime(c.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span
                        className={cn(
                          "truncate text-[11px]",
                          c.unread ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {c.lastDirection === "Outbound" && "You: "}
                        {c.preview || "—"}
                      </span>
                      {/* A failed text is visible from the LIST, not only once
                          the thread is opened — an accepted text is not a
                          delivered text (§5.5). */}
                      {c.failed && (
                        <span title="RingCentral could not deliver the last message">
                          <AlertTriangle className="h-3 w-3 shrink-0 text-rose-500" />
                        </span>
                      )}
                      {c.unread > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums">
                          {c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                {c.unread > 0 ? (
                  <ContextMenuItem onSelect={() => onMarkRead(c)}>
                    <MailOpen className="mr-2 h-3.5 w-3.5" /> Mark as read
                  </ContextMenuItem>
                ) : (
                  <ContextMenuItem
                    onSelect={() => onMarkUnread(c)}
                    // Nothing to flip back when they have never texted us:
                    // read state lives on INBOUND messages only.
                    disabled={!c.newestInboundId}
                  >
                    <MessageSquare className="mr-2 h-3.5 w-3.5" /> Mark as unread
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </>
  );
}

export default TextInbox;
