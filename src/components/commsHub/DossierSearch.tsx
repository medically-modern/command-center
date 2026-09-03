/**
 * "Find this patient" — the search that appears in the Communications Hub's
 * profile pane when the number on the line matches nobody on the boards.
 *
 * The case it exists for (Josh, 2026-09-03): James McDowell rang from
 * (202) 867-4525; every board holds him at (202) 867-5900. The pane correctly
 * said the number was on no board, and the rep had no way to get his profile up
 * beside the call. This is the SAME search as System Management → Search — the
 * same live hook (`useLiveSearch`, one Monday request per debounced query), the
 * same Active / Completed / Stuck folders and the same stage-first row — so a
 * rep learns one search, not two.
 *
 * Picking a row is an EXPLICIT identity choice by the rep, which is what lets
 * the pane show that patient against a number their record does not carry.
 * Nothing is written: the number is not added to the record from here.
 */
import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ProfileStatusBadge } from "@/components/shared/ProfileStatusBadge";
import { systemProfileStatus } from "@/lib/shared/profileStatus";
import { useLiveSearch } from "@/hooks/systemMgmt/useLiveSearch";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import {
  SEARCH_BUCKETS,
  SEARCH_BUCKET_LABEL,
  bucketResults,
  type SearchBucket,
} from "@/lib/systemMgmt/searchBuckets";
import { boardStageLabel, boardTone } from "@/lib/systemMgmt/boardTone";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";

const BUCKET_ON: Record<SearchBucket, string> = {
  active: "bg-primary text-primary-foreground border-primary",
  completed: "bg-green-600 text-white border-green-600",
  stuck: "bg-red-600 text-white border-red-600",
};

export default function DossierSearch({ onPick }: { onPick: (row: SystemPatient) => void }) {
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<SearchBucket>("active");
  const live = useLiveSearch(query);
  const bucketed = bucketResults(live.results);
  const rows = bucketed[bucket];
  const settled = !live.searching && live.searchedQuery === query.trim();

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find the patient by name or phone…"
          className="h-9 pl-8 text-sm"
          autoFocus
        />
        {live.searching && (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
        )}
      </div>

      {live.tooShort && (
        <p className="text-[11px] text-muted-foreground">At least 2 letters, or 3 digits.</p>
      )}
      {live.error && (
        <p className="text-[11px] text-destructive">Search failed: {live.error}</p>
      )}

      {query.trim() && !live.tooShort && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Result folders">
          {SEARCH_BUCKETS.map((b) => (
            <button
              key={b}
              role="tab"
              aria-selected={b === bucket}
              onClick={() => setBucket(b)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                b === bucket ? BUCKET_ON[b] : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {SEARCH_BUCKET_LABEL[b]}
              <span className={cn("rounded-full px-1 text-[10px]", b === bucket ? "bg-white/25" : "bg-muted")}>
                {bucketed[b].length}
              </span>
            </button>
          ))}
        </div>
      )}

      {query.trim() && !live.tooShort && settled && rows.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No {SEARCH_BUCKET_LABEL[bucket].toLowerCase()} patients match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {rows.slice(0, 25).map((p) => {
            const tone = boardTone(p.boardId);
            return (
              <li key={`${p.boardId}-${p.id}`}>
                <button
                  onClick={() => onPick(p)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md border border-l-4 bg-card px-3 py-2 text-left hover:border-primary/40 hover:shadow-sm",
                    tone.bar,
                  )}
                  title={`${p.boardName} · ${p.groupTitle}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    {p.isCompleted ? (
                      <span className="shrink-0 rounded bg-green-600 px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
                        COMPLETED
                      </span>
                    ) : (
                      <ProfileStatusBadge status={systemProfileStatus(p)} size="sm" showIcon={false} />
                    )}
                  </span>
                  <span className={cn("text-[10px] font-semibold uppercase tracking-[0.12em]", tone.label)}>
                    {boardStageLabel(p.boardId, p.boardName)}
                  </span>
                  <span className={cn("text-[13px] font-bold leading-tight", tone.stage)}>
                    {p.isCompleted ? "Completed" : p.pipelineStage || p.groupTitle}
                  </span>
                  {p.phone && (
                    <span className="text-[11px] text-muted-foreground">{fmtPhone(p.phone)}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
