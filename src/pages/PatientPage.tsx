/**
 * The patient screen — `/patient/:itemId?board=<boardId>` (§5.39).
 *
 * ONE screen holding a patient's whole record: the onboarding trail on the left,
 * their texts and calls on the right, and a link into the Subscription profile.
 * It is the keystone of the Sept-2026 redesign — every other screen in that
 * handoff is either a tab on this one or a link into it.
 *
 * ⚠️⚠️ **READ-ONLY, AND THAT IS THE DESIGN OF THIS SLICE, not an omission.**
 * It adds no writer and no mutation: every action deep-links to the stage page
 * whose verified write path already does the work (§5.2). Two writers for one
 * column is how they disagree — the reason `PhoneField` left the Welcome Call
 * banner (§5.31d) and the Secondary Insurance select left `PatientInfoCard`
 * (§5.31c). The one thing on screen that writes is `ConversationThread`'s
 * composer, which is the existing component and the existing write.
 *
 * ⚠️ **Purely additive.** Nothing was removed to make room for it: every page it
 * links to still works exactly as it did, the role bars are untouched, and no
 * queue rule, role count or baseline generator was changed. A screen that reads
 * cannot move a patient (§5.8's counting contract is safe by construction).
 *
 * ⚠️ **`?board=` is required and that is deliberate.** A Monday item id does not
 * say which board it is on, and `fetchDossierItemsForPick` needs both. Every
 * caller has it — a Search row, a Comms Hub match, a stage page — so requiring
 * it costs nothing and guessing would mean a board scan per open.
 */
import { useCallback, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingView } from "@/components/patient/OnboardingView";
import { PatientCommsColumn } from "@/components/patient/PatientCommsColumn";
import { usePatientRecord } from "@/hooks/patient/usePatientRecord";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { clearDossierCaches, type DossierPick } from "@/lib/commsHub/dossierApi";
import {
  BOARD_PARAM,
  SIDE_PARAM,
  VIEW_PARAM,
  parseSide,
  parseView,
  pathSummary,
  subscriptionItem,
  type PatientSide,
} from "@/lib/patient/patientScreen";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import { cn } from "@/lib/utils";

export default function PatientPage() {
  const { itemId = "" } = useParams<{ itemId: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();

  const boardId = Number(params.get(BOARD_PARAM) || 0);
  const view = parseView(params.get(VIEW_PARAM));
  const side = parseSide(params.get(SIDE_PARAM));

  /** ⚠️ Rebuilt each render, which is why `usePatientRecord` depends on a KEY
   *  string rather than on this object — incident rule 2. */
  const pick: DossierPick | null = useMemo(
    () => (itemId && boardId ? { itemId, boardId, name: "", phone: "" } : null),
    [itemId, boardId],
  );

  const { dossier, loading, error, configured, reload } = usePatientRecord(pick);

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const hardReload = useCallback(() => {
    clearDossierCaches();
    reload();
  }, [reload]);

  const active = dossier?.active ?? null;
  const phone = dossier?.phone || active?.phone || "";
  const subItem = subscriptionItem(dossier);

  /** What an outbound text is attributed to. Null when there is no live record —
   *  deliberately, because a text filed against a finished item is a note in the
   *  wrong place (§5.28's `threadPatient` rule). */
  const threadPatient: PatientRef | null = active
    ? {
        itemId: active.itemId,
        name: dossier?.name || active.name,
        phone: active.phone,
        boardId: String(active.boardId),
        boardName: active.boardName,
      }
    : null;

  if (!itemId || !boardId) {
    return (
      <Shell onBack={goBack}>
        <p className="text-sm text-muted-foreground">
          This link is missing the board it belongs to, so the patient can't be looked up. Open the
          patient from Search or the Communications hub.
        </p>
      </Shell>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-[hsl(var(--mm-navy,222_47%_11%))] text-white">
        <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-3">
          <button onClick={goBack} className="rounded p-1.5 hover:bg-white/10" title="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-bold leading-tight">
              {dossier?.name || (loading ? "Loading…" : "Patient")}
            </div>
            <div className="truncate text-xs text-white/70">{pathSummary(dossier)}</div>
          </div>
          <button
            onClick={hardReload}
            className="rounded p-1.5 hover:bg-white/10"
            title="Re-read this patient from Monday"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-4">
        {!configured ? (
          <p className="text-sm text-muted-foreground">
            This build has no Monday connection, so a patient record can't be read.
          </p>
        ) : error ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
            <p className="font-medium">Couldn't load this patient.</p>
            <p className="mt-1 text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={hardReload}>
              Try again
            </Button>
          </div>
        ) : loading && !dossier ? (
          <p className="text-sm text-muted-foreground">Reading this patient's record…</p>
        ) : !dossier ? (
          <p className="text-sm text-muted-foreground">
            No board record was found for this item. It may have been deleted on Monday.
          </p>
        ) : (
          <>
            {/* ── view toggle ─────────────────────────────────────────── */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <ViewTab active={view === "onboarding"} onClick={() => setParam(VIEW_PARAM, "onboarding")}>
                Onboarding
              </ViewTab>
              {/* ⚠️ Disabled by the ROW'S EXISTENCE, never by a status — the row
                  is created at Final Profile Confirmation, so a patient stuck in
                  Insurance with an early row can still open it. */}
              <ViewTab
                active={view === "subscription"}
                disabled={!subItem}
                title={
                  subItem
                    ? undefined
                    : "Not on the Subscription board yet — the row is created at Final Profile Confirmation"
                }
                onClick={() => setParam(VIEW_PARAM, "subscription")}
              >
                Subscription
              </ViewTab>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0">
                {view === "onboarding" || !subItem ? (
                  <OnboardingView dossier={dossier} />
                ) : (
                  <section className="rounded-xl border bg-card p-4 shadow-sm">
                    <h2 className="text-sm font-semibold">Subscription</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {subItem.groupTitle}
                    </p>
                    {/* The Profile | Orders tabs are the existing pages for now —
                        linked rather than duplicated, so there is exactly one
                        writer for those columns. */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to={`/subscription?patientId=${subItem.itemId}&from=patient`}
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                      >
                        Open profile <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        onClick={() => navigate(`/orders?query=${encodeURIComponent(dossier.name)}`)}
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                      >
                        Open orders <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </section>
                )}
              </div>

              <PatientCommsColumn
                phone={phone}
                patient={threadPatient}
                side={side}
                onSide={(s: PatientSide) => setParam(SIDE_PARAM, s)}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-[hsl(var(--mm-navy,222_47%_11%))] px-4 py-3 text-white">
        <button onClick={onBack} className="rounded p-1.5 hover:bg-white/10" title="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  );
}

function ViewTab({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "border hover:bg-muted",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}
