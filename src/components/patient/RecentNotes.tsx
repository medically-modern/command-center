/**
 * The patient screen's Recent notes strip (§5.39c3) — Brandon's `notes-mini`,
 * at the foot of the right-hand column.
 *
 * His handoff: *"Under both tabs: Recent notes — the notes column of the board
 * the patient is currently on (Subscription board notes once subscribed),
 * newest first, with an All notes expander and an add-a-note box."*
 *
 * ⚠️ **UNDER both tabs, not inside either.** It is a fact about the PATIENT,
 * not about texts or calls, so it sits below the tab body and survives a switch
 * between them — which is also why it is here rather than duplicated into two
 * panes that would drift.
 *
 * ⚠️ **The LIVE board's notes, never the snapshot's.** The Onboarding view's
 * "Notes from this stage" card shows whichever historical record the stepper
 * has open; this shows `dossier.active`, i.e. wherever the patient is being
 * worked right now. Two different questions, deliberately two components.
 *
 * ⚠️⚠️ **ONE WRITER — `dossierApi.appendNoteToRecord`, the Comms Hub's.** Two
 * writers for one column is the failure this codebase records over and over
 * (§5.31c's Secondary Insurance select, §5.31d's phone editor); calling the
 * existing one from a second screen is the opposite of that and is what keeps
 * there being one. It carries three rules a second implementation would lose:
 * it RE-READS the column immediately before appending (Monday has no
 * compare-and-set, so appending onto a cached copy silently deletes whatever
 * another rep added in between), it asks the LIVE board about the 2,000-char
 * cap rather than trusting a declared type (§10), and it writes a bare string
 * through `change_multiple_column_values`, which is accepted for both column
 * types. `recentNotes.test.ts` scans for it.
 *
 * ⚠️ **The stamp is the SUB-STAGE** (`noteStageLabel`), shared with that
 * composer: several roles write one notes column and the label is what makes a
 * line traceable (§9).
 */
import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { appendNoteToRecord } from "@/lib/commsHub/dossierApi";
import { noteEntries, noteStageLabel } from "@/lib/patient/recentNotes";

/** Brandon's strip shows three; the expander shows the rest. */
const PREVIEW = 3;

export function RecentNotes({
  active,
  phone,
  onAppended,
}: {
  /** The board the patient is on NOW — `dossier.active`. */
  active: DossierItem | null;
  /** The number the dossier was looked up by, so its cache can be updated. */
  phone: string;
  /** Hands back the new full body, so the pane repaints without a re-read. */
  onAppended: (next: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const entries = useMemo(() => noteEntries(active?.notes), [active?.notes]);
  const stage = active ? noteStageLabel(active) : "";

  const save = useCallback(async () => {
    const body = text.trim();
    if (!active || !body || saving) return;
    setSaving(true);
    try {
      const next = await appendNoteToRecord({
        boardId: active.boardId,
        itemId: active.itemId,
        columnId: active.notesColId,
        columnType: active.notesColType,
        text: body,
        stage,
        phone,
      });
      onAppended(next);
      setText("");
      toast.success(`Note added to ${stage}`);
    } catch (e) {
      // ⚠️ Includes the 2,000-character refusal, which is the one error a rep
      // must actually read — the alternative is Monday silently eating the
      // note (§10). The draft is deliberately KEPT so they can shorten it.
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [active, text, saving, stage, phone, onAppended]);

  if (!active) return null;

  const shown = all ? entries : entries.slice(0, PREVIEW);
  const more = entries.length - shown.length;

  return (
    <div className="notes-mini">
      <div className="nm-h">
        <b className="xs">Recent notes</b>
        <span className="xs muted nm-where">{stage}</span>
        {entries.length > PREVIEW && (
          <button type="button" className="nm-all" onClick={() => setAll((v) => !v)}>
            {all ? "Show less" : `All notes (${entries.length})`}
          </button>
        )}
      </div>

      {/* ⚠️ Only this scrolls — see the CSS. The composer below must stay in
          view, or a rep has to scroll a 190px panel to find it. */}
      <div className="nm-list">
      {shown.length === 0 ? (
        <div className="xs muted">No notes yet.</div>
      ) : (
        shown.map((e, i) => (
          // ⚠️ Keyed by position: two identical lines are legitimate (the same
          // rep writing the same thing twice), and a content key would collapse
          // them into one.
          <div className="note xs" key={i}>
            {(e.when || e.who || e.stage) && (
              <div className="who">
                {[e.who, e.stage, e.when].filter(Boolean).join(" · ")}
              </div>
            )}
            {/* `pre-wrap`, because a multi-line note is one note and its own
                line breaks are the rep's. */}
            <div className="nm-body">{e.text}</div>
          </div>
        ))
      )}

        {more > 0 && !all && <div className="xs muted nm-more">{more} older</div>}
      </div>

      {/* ⚠️ Hidden rather than disabled when the board has no notes column: a
          composer with nowhere to write is not a permission problem, it is a
          board that has no such column, and there is no action that fixes it. */}
      {active.notesColId && (
        <div className="nm-add">
          <input
            className="nm-in"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            onKeyDown={(ev) => {
              // Enter sends — the convention of every composer in this app.
              if (ev.key === "Enter") {
                ev.preventDefault();
                void save();
              }
            }}
            placeholder="Add a note (stamped with your initials)"
            aria-label="Add a note"
            disabled={saving}
          />
          <button type="button" className="nm-btn" onClick={() => void save()} disabled={!text.trim() || saving}>
            <Plus style={{ width: 11, height: 11 }} /> {saving ? "Adding…" : "Add"}
          </button>
        </div>
      )}
    </div>
  );
}
