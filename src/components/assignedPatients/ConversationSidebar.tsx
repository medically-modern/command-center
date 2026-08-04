/**
 * Conversation list for Assigned Patients — the left rail, modelled on
 * RingCentral's Text screen: who, the last line, when, and an unread dot.
 *
 * Unread is PER-REP (computed by useAssignedThreads), not RingCentral's own
 * readStatus, which is account-wide and would clear everyone's dot the moment
 * one rep opened a thread.
 */
import { Loader2, MessageSquare, Search, UserPlus } from "lucide-react";
import type { InboxThread } from "@/lib/assignedPatients/assignmentsApi";
import type { AssignedThread } from "@/hooks/assignedPatients/useAssignedThreads";
import { fmtPhone, fmtWhen } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";

function initials(name: string, phone: string): string {
  const n = (name || "").trim();
  if (!n) return fmtPhone(phone).replace(/\D/g, "").slice(-2) || "?";
  return n
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

interface Props {
  threads: AssignedThread[];
  unassigned: InboxThread[];
  selected: string | null;
  onSelect: (phone: string) => void;
  onAssign?: (phone: string) => void;
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  showUnreadOnly: boolean;
  onToggleUnread: (v: boolean) => void;
}

export default function ConversationSidebar({
  threads,
  unassigned,
  selected,
  onSelect,
  onAssign,
  loading,
  search,
  onSearch,
  showUnreadOnly,
  onToggleUnread,
}: Props) {
  const q = search.trim().toLowerCase();
  const matches = (name: string, phone: string) =>
    !q || name.toLowerCase().includes(q) || phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""));

  const visible = threads.filter(
    (t) => (!showUnreadOnly || t.unread) && matches(t.patient?.name || "", t.phone),
  );
  const visibleUnassigned = unassigned.filter((t) => !showUnreadOnly && matches("", t.phone));
  const unreadCount = threads.filter((t) => t.unread).length;

  return (
    <aside className="w-full sm:w-80 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
      <div className="px-3 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold">Text</h2>
          {unreadCount > 0 && (
            <span className="rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5">{unreadCount}</span>
          )}
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />}
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search texts…"
            className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1 mt-2 text-xs">
          <button
            onClick={() => onToggleUnread(false)}
            className={cn("px-2 py-1 rounded font-medium", !showUnreadOnly ? "text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            ALL
          </button>
          <button
            onClick={() => onToggleUnread(true)}
            className={cn("px-2 py-1 rounded font-medium", showUnreadOnly ? "text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            UNREAD
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {visible.length === 0 && visibleUnassigned.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {loading ? "Loading conversations…" : showUnreadOnly ? "Nothing unread." : "No assigned conversations yet."}
          </p>
        ) : null}

        {visible.map((t) => (
          <button
            key={t.phone}
            onClick={() => onSelect(t.phone)}
            className={cn(
              "w-full text-left flex items-start gap-2.5 px-3 py-2.5 border-b border-border/60 hover:bg-muted/40 transition-colors",
              selected === t.phone && "bg-muted/60",
            )}
          >
            <span className="relative shrink-0">
              <span className="h-8 w-8 rounded-full bg-gradient-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
                {initials(t.patient?.name || "", t.phone)}
              </span>
              {t.unread && (
                <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-card" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={cn("truncate text-sm", t.unread ? "font-bold" : "font-medium")}>
                  {t.patient?.name || fmtPhone(t.phone)}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtWhen(t.lastTime)}</span>
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MessageSquare className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {t.lastDirection === "Outbound" ? "You: " : ""}
                  {t.lastText}
                </span>
              </span>
            </span>
          </button>
        ))}

        {visibleUnassigned.length > 0 && (
          <>
            <p className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Unassigned · {visibleUnassigned.length}
            </p>
            {visibleUnassigned.map((t) => (
              <div
                key={t.phone}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 border-b border-border/60 hover:bg-muted/40"
              >
                <button onClick={() => onSelect(t.phone)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{fmtPhone(t.phone)}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtWhen(t.lastTime)}</span>
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t.lastDirection === "Outbound" ? "You: " : ""}
                    {t.lastText}
                  </span>
                </button>
                {onAssign && (
                  <button
                    onClick={() => onAssign(t.phone)}
                    title="Assign to a rep"
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <UserPlus className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
