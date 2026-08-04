/**
 * Conversation list for Assigned Patients — the left rail, modelled on
 * RingCentral's Text screen: who, the last line, when, and an unread dot.
 *
 * Shows ONLY patients assigned to this rep. There is deliberately no
 * "unassigned" section (Josh, 2026-08-04): the shared number carries every
 * patient conversation in the company, so listing the remainder just reproduced
 * the RingCentral inbox this page exists to replace. Assignment happens through
 * the Assign dialog's patient search.
 *
 * Unread is PER-REP (computed by useAssignedThreads), not RingCentral's own
 * readStatus, which is account-wide and would clear everyone's dot the moment
 * one rep opened a thread.
 */
import { Loader2, MessageSquare, Phone, Search } from "lucide-react";
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
  selected: string | null;
  onSelect: (phone: string) => void;
  /** Start a call without opening the conversation first. */
  onCall: (phone: string) => void;
  callingPhone: string | null;
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  showUnreadOnly: boolean;
  onToggleUnread: (v: boolean) => void;
}

export default function ConversationSidebar({
  threads,
  selected,
  onSelect,
  onCall,
  callingPhone,
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
        {visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {loading
              ? "Loading conversations…"
              : showUnreadOnly
                ? "Nothing unread."
                : "No patients assigned yet. A manager assigns them from Pipeline Oversight."}
          </p>
        ) : null}

        {visible.map((t) => (
          <div
            key={t.phone}
            className={cn(
              "w-full flex items-start gap-2.5 px-3 py-2.5 border-b border-border/60 hover:bg-muted/40 transition-colors",
              selected === t.phone && "bg-muted/60",
            )}
          >
            <button onClick={() => onSelect(t.phone)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
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
                    {t.messageCount === 0 ? (
                      <em>No messages yet</em>
                    ) : (
                      <>
                        {t.lastDirection === "Outbound" ? "You: " : ""}
                        {t.lastText}
                      </>
                    )}
                  </span>
                </span>
              </span>
            </button>
            <button
              onClick={() => onCall(t.phone)}
              disabled={callingPhone === t.phone}
              title={`Call ${t.patient?.name || fmtPhone(t.phone)}`}
              className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
            >
              {callingPhone === t.phone ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Phone className="h-4 w-4" />
              )}
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
