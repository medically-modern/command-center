/**
 * The Communications hub's right pane once the Inbox is switched on — the
 * patient screen's main column, embedded (COMMS_INBOX_PLAN.md §7, Josh's D3:
 * *"incldue the switcher for shared numbers and the other four jobs"*).
 *
 * Brandon's mockup draws exactly this: the top bar card, the Onboarding |
 * Subscription toggle, the stepper and the snapshot, under a *Patient Profile*
 * header with an *Open Profile Page* button. It is `PatientBody` — the SAME
 * component `/patient/:itemId` renders — so the two can never disagree about a
 * patient; only the host differs.
 *
 * ⚠️⚠️ **THE FIVE JOBS the old pane (`PatientDossierPanel`) did and the patient
 * screen's main column does not all come with it**, each as the old pane's own
 * component rather than a copy (`hubPatientPane.test.tsx` names every one):
 *   1. **The household switcher** — `HouseholdSwitcher`, ABOVE everything,
 *      because it decides whose profile the rest is. The note composer and the
 *      outbound text's attribution follow the selection (§5.28).
 *   2. **A writable notes box** — `LiveNotes` → `NoteComposer` →
 *      `appendNoteToRecord`. The patient screen keeps its Recent notes in the
 *      Texts | Calls column, which the hub replaces with the thread.
 *   3. **Every stage's notes** — `LiveNotes` → `stageNoteTrail`, collapsed.
 *   4. **Find-a-patient** when the number is on no board — `dossierPaneFallback`
 *      (its own module, shared with the old pane) → `DossierSearch` — and the
 *      *Found by search* banner after a pick.
 *   5. **The per-stage call detail** (`stageDetail.ts`, Welcome Call's wide one
 *      included) — the Onboarding view's snapshot cards, drawn BEFORE the
 *      embedded tool here (`embedded`), so they are what a rep on a call sees
 *      first rather than what is left after a whole read-only form.
 *   Plus *Open Profile Page* (`lib/patient/profileHref.ts`) in the pane's header.
 *
 * ⚠️ **Additive first**: the hub renders this only while the Inbox is switched
 * on. Off, the pane is `PatientDossierPanel`, untouched (plan §8).
 *
 * ⚠️ **What it costs, accepted in the plan**: the embedded stage tool reads its
 * record at full width and the Subscription view reads the order board — on
 * open, never polled (INCIDENT_2026-08-20's rule). The hub's own dossier is the
 * record, so this pane asks nothing to find the patient.
 *
 * ⚠️ **Its view state is per PATIENT, and forgotten on leaving.** Which step,
 * record, tool and tab are open is held against the patient it was chosen for,
 * so a click on the next conversation starts from that patient's defaults —
 * the live stage — rather than from the previous patient's step, and a patient
 * the rep comes back to starts fresh too. The patient screen keeps the same
 * state in its URL; the hub has no URL of its own for it.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { PatientBody, type PatientViewParams } from "@/components/patient/PatientBody";
import { FoundBySearchBanner, HouseholdSwitcher, LiveNotes } from "@/components/commsHub/PatientDossierPanel";
import { dossierPaneFallback } from "@/components/commsHub/dossierPaneFallback";
import type { PatientDossier } from "@/lib/commsHub/dossier";
import type { DossierPick } from "@/lib/commsHub/dossierApi";
import { profilePageHref } from "@/lib/patient/profileHref";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import "@/pages/patient/redesign.css";

/** The pane's header — the mockup's *Patient Profile* + *Open Profile Page*. */
export function HubPatientPaneHeader({ dossier }: { dossier: PatientDossier | null }) {
  const href = profilePageHref(dossier);
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Patient Profile</p>
      {href && (
        <Link
          to={href}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
          title="The full patient screen — the profile first, texts and calls on the side"
        >
          Open Profile Page <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

/** Who a set of view choices belongs to — every record id, so a household
 *  switch and a new conversation both start clean. */
function whoKey(dossier: PatientDossier | null): string {
  return dossier ? dossier.items.map((i) => `${i.boardId}:${i.itemId}`).join(",") : "";
}

export function HubPatientPane({
  dossier,
  people = [],
  selected = 0,
  onSelectPerson,
  loading,
  error,
  phone,
  idleHint,
  onPick,
  picked = null,
  onClearPick,
  onReload,
}: {
  dossier: PatientDossier | null;
  people?: PatientDossier[];
  selected?: number;
  onSelectPerson?: (index: number) => void;
  loading: boolean;
  error: string | null;
  phone: string | null;
  idleHint?: string;
  onPick?: (row: SystemPatient) => void;
  picked?: DossierPick | null;
  onClearPick?: () => void;
  /** After a top-bar pencil saves. */
  onReload?: () => void;
}) {
  const who = whoKey(dossier);
  const [chosen, setChosen] = useState<{ who: string; p: Record<string, string> }>({ who, p: {} });
  // A different patient starts from their own defaults — and so does coming
  // BACK to one, so the pane never remembers some patients and not others.
  // Reset during render (React's "previous render" pattern), not in an effect:
  // the first render for a new patient reads nothing of the last one's step,
  // not even for one frame.
  if (chosen.who !== who) setChosen({ who, p: {} });
  const current = chosen.who === who ? chosen.p : null;
  const params: PatientViewParams = useMemo(
    () => ({ get: (name: string) => (current && name in current ? current[name] : null) }),
    [current],
  );
  const setParam = useCallback(
    (patch: Record<string, string>) =>
      setChosen((c) => ({ who, p: { ...(c.who === who ? c.p : {}), ...patch } })),
    [who],
  );

  const fallback = dossierPaneFallback({ phone, loading, error, dossier, idleHint, onPick });
  if (fallback || !dossier || !phone) return fallback;

  const anchor = dossier.active ?? dossier.items[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-hub-patient>
      {picked && <FoundBySearchBanner phone={phone} dossierPhone={dossier.phone} onClear={onClearPick} />}
      {people.length > 1 && (
        <div className="shrink-0 border-b border-border px-3 py-2">
          <HouseholdSwitcher people={people} selected={selected} onSelectPerson={onSelectPerson} />
        </div>
      )}
      <div className="cc-pt embedded">
        <div className="pt-main">
          <PatientBody
            dossier={dossier}
            itemId={anchor?.itemId ?? ""}
            params={params}
            setParam={setParam}
            onSaved={onReload ?? (() => {})}
            embedded
            afterTop={<LiveNotes dossier={dossier} phone={phone} className="card flex flex-col" />}
          />
        </div>
      </div>
    </div>
  );
}

export default HubPatientPane;
