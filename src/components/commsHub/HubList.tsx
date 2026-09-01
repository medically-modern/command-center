/**
 * Shared furniture for the hub's three list panes — the header strip with a
 * search box and an ALL / UNREAD filter, and the row chrome underneath.
 *
 * Written once because the three lists are the same object with different
 * nouns, and RingCentral's own UI treats them that way too: the rep is meant to
 * move between Phone, Text and Fax without relearning the pane.
 */
import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function HubListHeader({
  title,
  count,
  query,
  onQuery,
  placeholder,
  unreadOnly,
  onUnreadOnly,
  unreadLabel = "Unread",
  unreadCount,
  loading,
  onReload,
  extra,
}: {
  title: string;
  count?: number;
  query: string;
  onQuery: (v: string) => void;
  placeholder: string;
  /** Omit the pair to render no filter (a list with nothing to filter by). */
  unreadOnly?: boolean;
  onUnreadOnly?: (v: boolean) => void;
  unreadLabel?: string;
  unreadCount?: number;
  loading: boolean;
  onReload: () => void;
  /** Extra controls on the filter row — the Phone tab's Calls/Voicemail split. */
  extra?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {typeof count === "number" && <span className="text-xs text-muted-foreground tabular-nums">({count})</span>}
        <button
          onClick={onReload}
          title="Refresh"
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {query && (
            <button
              onClick={() => onQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Clear"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {(onUnreadOnly || extra) && (
        <div className="flex items-center gap-1 px-3 pb-2">
          {extra}
          {onUnreadOnly && (
            <div className="ml-auto flex items-center gap-1">
              <FilterPill active={!unreadOnly} onClick={() => onUnreadOnly(false)}>
                All
              </FilterPill>
              <FilterPill active={!!unreadOnly} onClick={() => onUnreadOnly(true)}>
                {unreadLabel}
                {!!unreadCount && <span className="ml-1 tabular-nums">{unreadCount}</span>}
              </FilterPill>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Initials in a circle — the same affordance RingCentral's own list uses, and
 *  what makes a long list scannable without avatars we don't have. */
export function Initials({ name, phone, tone }: { name: string; phone: string; tone?: string }) {
  const src = (name || "").trim();
  const initials = src
    ? src.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("")
    : (phone || "").replace(/\D/g, "").slice(-2);
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        tone || "bg-muted text-muted-foreground",
      )}
    >
      {initials || "?"}
    </span>
  );
}

/** RingCentral's own time convention: a clock for today, a weekday inside the
 *  last week, a date beyond that. A list where every row says "2 days ago" is
 *  harder to scan than one that says "Tue". */
export function listTime(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return "";
  const now = new Date();
  const sameDay = t.toDateString() === now.toDateString();
  if (sameDay) return t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = (now.getTime() - t.getTime()) / 86_400_000;
  if (days < 7) return t.toLocaleDateString(undefined, { weekday: "short" });
  return t.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

export function ListEmpty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function ListError({ error }: { error: string }) {
  return (
    <p className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive break-words">
      {error}
    </p>
  );
}
