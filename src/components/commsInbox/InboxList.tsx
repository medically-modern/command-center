/**
 * The Inbox — the Communications hub's work queue (COMMS_INBOX_PLAN.md §1.2).
 *
 * Every inbound text, missed call and voicemail opens (or reopens) an item for
 * that patient, and it stays here until a person marks it resolved. Tabs
 * `Unresolved n` · `Over 24h n` (red) · `All`; a search for name or number; a
 * sort; and type chips. Each row: the name, the stage pill, the wait (red over
 * 24 counted hours) or `✓ how · who` once resolved, a preview, and a coloured
 * edge for what opened it.
 *
 * ⚠️ Presentational only. The rules — what is open, how long it has waited,
 * what the tab counts are — are the gateway's (`commsInboxRules.mjs`); this
 * shows what it is given, so the header badge and these tabs cannot disagree.
 *
 * ⚠️ The row just resolved stays, greyed with its ✓, until the rep opens
 * another item ("sticky") — that is where Undo lives, and it is also when the
 * note is copied to Monday (plan §5.4).
 *
 * The STAGE filter (Josh, 2026-09-23: "a small filter button to the right of
 * voicemails hugging that right side of the box") sits at the end of the type
 * chips and narrows exactly like one: the gateway filters, so the tab counts
 * say how many are waiting in that stage. It says which stage it is on in the
 * button itself, and an empty list names it — a filter nobody can see is how a
 * rep decides the inbox is empty when it isn't.
 */
import { Check, ListFilter, Loader2, RefreshCw, Search, X } from "lucide-react";
import type { InboxList as InboxListData, InboxRow } from "@/lib/commsInbox/rules";
import {
  KIND_LABEL,
  STAGE_FILTERS,
  formatShort,
  formatWait,
  formatWhen,
  HOW_LABEL,
  rowNameParts,
  whoShort,
} from "@/lib/commsInbox/rules";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InboxQuery } from "@/lib/commsInbox/api";
import { StagePill } from "./pills";
import { KIND_EDGE } from "./kinds";
import { ListError } from "@/components/commsHub/HubList";
import { cn } from "@/lib/utils";

const VIEWS: { id: InboxQuery["view"]; label: string }[] = [
  { id: "open", label: "Unresolved" },
  { id: "over", label: "Over 24h" },
  { id: "all", label: "All" },
];

const TYPES: { id: InboxQuery["type"]; label: string }[] = [
  { id: "", label: "All" },
  { id: "text", label: "Texts" },
  { id: "missed", label: "Missed calls" },
  { id: "voicemail", label: "Voicemails" },
];

export default function InboxList({
  data,
  stale,
  loading,
  error,
  onReload,
  query,
  onQuery,
  search,
  onSearch,
  selectedKey,
  stickyKey,
  onSelect,
}: {
  data: InboxListData | null;
  /** The rows are the previous query's while this one loads. */
  stale: boolean;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  query: Omit<InboxQuery, "q">;
  onQuery: (patch: Partial<Omit<InboxQuery, "q">>) => void;
  /** The search box's own text — debounced by the page before it is a query. */
  search: string;
  onSearch: (v: string) => void;
  selectedKey: string | null;
  /** The row just resolved — greyed with its ✓ until the rep opens another. */
  stickyKey: string;
  onSelect: (row: InboxRow) => void;
}) {
  const counts = data?.counts ?? { open: 0, over: 0 };
  const rows = data?.rows ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border px-3 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Inbox</h2>
          <button
            onClick={onReload}
            title="Refresh"
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* One tab strip — the manager strip was removed in v2.1; everyone works the same list. */}
        <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Which items">
          {VIEWS.map((v) => {
            const n = v.id === "open" ? counts.open : v.id === "over" ? counts.over : null;
            const on = query.view === v.id;
            return (
              <button
                key={v.id}
                role="tab"
                aria-selected={on}
                onClick={() => onQuery({ view: v.id })}
                className={cn(
                  "flex-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold transition-colors",
                  on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v.label}
                {n !== null && (
                  <span
                    className={cn(
                      "ml-1.5 tabular-nums",
                      v.id === "over" && n > 0 ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search name or number…"
              aria-label="Search the inbox"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-7 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => onSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                title="Clear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <select
            value={query.sort}
            onChange={(e) => onQuery({ sort: e.target.value === "recent" ? "recent" : "wait" })}
            aria-label="Sort"
            className="h-[30px] shrink-0 rounded-md border border-border bg-card px-1.5 text-xs text-foreground"
          >
            <option value="wait">Longest waiting</option>
            <option value="recent">Newest</option>
          </select>
        </div>

        {/* One wrapping row, the stage button pushed to its right-hand end.
            ⚠️ Not the chips in a shrinking group beside a fixed button: at the
            320px list (≤1300px screens) the four chips alone nearly fill the
            row, and that shape broke THEM into three lines. This way the chips
            never move; when the button has no room it drops to the next line,
            still hugging the right edge (measured 1024–1440). */}
        <div className="flex flex-wrap items-center gap-1">
          <div role="group" aria-label="Type" className="contents">
            {TYPES.map((t) => {
              const on = query.type === t.id;
              return (
                <button
                  key={t.id || "all"}
                  onClick={() => onQuery({ type: t.id })}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    !on && t.id === "text" && "hover:border-sky-400",
                    !on && t.id === "missed" && "hover:border-orange-400",
                    !on && t.id === "voicemail" && "hover:border-violet-400",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <StageFilter stage={query.stage} onStage={(stage) => onQuery({ stage })} />
        </div>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto", stale && "opacity-60")} aria-busy={loading}>
        {error && <ListError error={error} />}
        {!data && loading && (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the inbox…
          </div>
        )}
        {data && !rows.length && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm text-muted-foreground">
              {search.trim()
                ? "Nothing matches that search."
                : query.stage
                  ? query.view === "all"
                    ? `Nothing in ${query.stage}.`
                    : query.view === "over"
                      ? `Nothing in ${query.stage} over 24 hours.`
                      : `Nothing unresolved in ${query.stage}.`
                  : query.view === "all"
                    ? "Nothing here."
                    : query.view === "over"
                      ? "Nothing over 24 hours."
                      : "Nothing unresolved. Nice."}
            </p>
            {query.stage && (
              <button
                onClick={() => onQuery({ stage: "" })}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Show every stage
              </button>
            )}
          </div>
        )}
        {rows.map((r) => (
          <InboxRowButton
            key={r.key}
            row={r}
            selected={r.key === selectedKey}
            just={!r.open && r.key === stickyKey}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/** The menu's "every stage" entry. A Radix radio item needs a non-empty value,
 *  and "" is what the query means by it. */
const ALL_STAGES = "all";

/**
 * The stage filter: a chip-sized button at the right end of the type chips.
 * Idle it reads "Stage"; on, it is filled like an active chip and carries the
 * stage's name, so the filter is never on without saying so.
 */
function StageFilter({
  stage,
  onStage,
}: {
  stage: InboxQuery["stage"];
  onStage: (stage: InboxQuery["stage"]) => void;
}) {
  const on = !!stage;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={on ? `Stage filter: ${stage}` : "Filter by stage"}
          title={on ? `Showing ${stage} only — click to change` : "Filter by stage"}
          className={cn(
            "ml-auto inline-flex max-w-[9rem] shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors",
            on
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <ListFilter className="h-3 w-3 shrink-0" />
          <span className="truncate">{on ? stage : "Stage"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs">Filter by stage</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={stage || ALL_STAGES}
          onValueChange={(v) => {
            const next = STAGE_FILTERS.find((s) => s === v);
            onStage(next ?? "");
          }}
        >
          <DropdownMenuRadioItem value={ALL_STAGES} className="text-xs">
            Every stage
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {STAGE_FILTERS.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              <StagePill stage={s} />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InboxRowButton({
  row,
  selected,
  just,
  onSelect,
}: {
  row: InboxRow;
  selected: boolean;
  just: boolean;
  onSelect: (r: InboxRow) => void;
}) {
  const kind = row.previewKind || "text";
  const res = row.lastResolution;
  const nameParts = rowNameParts(row);
  const title = row.openedBy
    ? `Opened by ${KIND_LABEL[row.openedBy.kind].toLowerCase()} · ${formatWhen(row.openedBy.at)}${row.reopened ? " · reopened after being resolved" : ""}`
    : undefined;
  return (
    <button
      data-inbox-row=""
      onClick={() => onSelect(row)}
      title={title}
      className={cn(
        "block w-full border-b border-l-[3px] border-b-border px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60",
        row.open ? KIND_EDGE[kind] : "border-l-border",
        selected && "bg-primary/10 hover:bg-primary/10",
        just && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("min-w-0 truncate text-[13px]", row.open && "font-bold")}>{nameParts.name}</span>
        {nameParts.tail && (
          <span className={cn("-ml-1 shrink-0 text-[13px] tabular-nums", row.open && "font-bold")}>{nameParts.tail}</span>
        )}
        <StagePill stage={row.stage} />
        {row.open ? (
          <span
            className={cn(
              "ml-auto shrink-0 whitespace-nowrap text-[11px] font-semibold tabular-nums",
              row.over ? "font-bold text-destructive" : "text-muted-foreground",
            )}
          >
            {formatWait(row.waitMs)}
          </span>
        ) : res ? (
          <span
            className={cn(
              "ml-auto inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] text-emerald-700 dark:text-emerald-400",
              just && "font-semibold",
            )}
            title={`${HOW_LABEL[res.how] ?? res.label} · ${whoShort(res.by)} · ${formatWhen(res.at)}`}
          >
            <Check className="h-2.5 w-2.5" /> {HOW_LABEL[res.how] ?? res.label} · {whoShort(res.by)}
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{formatShort(row.lastAt)}</span>
        )}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">
        {row.previewKind === "missed" ? "Missed call" : row.preview || KIND_LABEL[kind]}
      </div>
    </button>
  );
}
