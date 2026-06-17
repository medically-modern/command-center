/**
 * MissingChecklist — "What we're still missing" block from the Send Request
 * redesign (June 2026). One card per served device (Documentation + Coverage
 * Language) plus a shared Medical Records card. Extracted from
 * SendRequestPanel.tsx so Confirm Receipt can reuse the exact same visual.
 * Pure presentation — no Monday writes, no workflow logic.
 */
import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { MnChecklist, MnItem, MnLangItem, MnState } from "@/lib/masheke/evalState";

/** "What we're still missing" — one card per served device (Documentation +
 *  Coverage Language), plus a shared Medical Records card so Clinicals is never
 *  duplicated. Missing language criteria are listed in rose; satisfied ones in
 *  green at the bottom of each device's language list. */
export function MissingChecklist({ checklist }: { checklist: MnChecklist }) {
  const doc = (label: string) => checklist.documents.find((d) => d.label === label)!;
  const clinicals = doc("Clinicals");
  const cgmScript = doc("CGM Script");
  const ipScript = doc("Insulin Pump Script");
  const cgmLang = checklist.language.find((l) => l.label === "CGM Language")!;
  const ipLang = checklist.language.find((l) => l.label === "Insulin Pump Language")!;

  const cgmServed = cgmScript.state !== "na";
  const ipServed = ipScript.state !== "na";

  const established = checklist.established;
  const anyDocGap =
    (cgmServed && cgmScript.state !== "ok") ||
    (ipServed && ipScript.state !== "ok") ||
    clinicals.state !== "ok";
  // "na" language (a path with no language requirement, e.g. Supplies Only) is
  // not a gap — only treat ok-less, applicable language as outstanding.
  const langGap = (served: boolean, s: MnState) => served && s !== "ok" && s !== "na";
  const anyLangGap = langGap(cgmServed, cgmLang.state) || langGap(ipServed, ipLang.state);
  const summary = established
    ? null
    : anyDocGap && anyLangGap
      ? "Requesting Docs & Language"
      : anyDocGap
        ? "Requesting Docs"
        : anyLangGap
          ? "Requesting Language"
          : null;
  // Build a specific "what's missing" line. Scripts are their own documents;
  // coverage language, visit date, and diagnosis all live in the medical records.
  const cgmScriptGap = cgmServed && cgmScript.state !== "ok";
  const ipScriptGap = ipServed && ipScript.state !== "ok";
  const scriptPart =
    cgmScriptGap && ipScriptGap
      ? "CGM and insulin pump scripts"
      : ipScriptGap
        ? "insulin pump script"
        : cgmScriptGap
          ? "CGM script"
          : null;

  const mrMissing = clinicals.state === "missing";
  const mrExpired = clinicals.state === "invalid";
  const within: string[] = [];
  if (anyLangGap) within.push("language");
  let recordsPart: string | null = null;
  if (mrMissing || mrExpired) {
    const noun = mrExpired ? "updated medical records" : "medical records";
    recordsPart = within.length ? `${noun} with ${within.join(" and ")}` : noun;
  } else if (within.length) {
    recordsPart = `${within.join(" and ")} in the medical records`;
  }

  const parts = [scriptPart, recordsPart].filter(Boolean) as string[];
  const tagline = parts.length
    ? `Missing ${parts.join(" and ")}.`
    : "Nothing outstanding — ready to send.";

  return (
    <div className="space-y-4">
      {/* Concise request summary */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {summary && (
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white"
            style={{ background: "oklch(0.55 0.02 260)" }}
          >
            {summary}
          </span>
        )}
        <span className="text-sm font-medium text-foreground">{tagline}</span>
      </div>

      {/* Color legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <LegendDot color="var(--mm-rose)" label="Missing" />
        <LegendDot color="oklch(0.75 0.15 75)" label="Invalid" />
        <LegendDot color="var(--mm-green)" label="Valid" />
      </div>

      {/* Cards across in columns (Insulin Pump | CGM | Medical Records) */}
      {(() => {
        const cards = [
          cgmServed && (
            <DeviceSection key="cgm" name="CGM" coverage={cgmLang.coverage} script={cgmScript} lang={cgmLang} />
          ),
          ipServed && (
            <DeviceSection key="ip" name="Insulin Pump" coverage={ipLang.coverage} script={ipScript} lang={ipLang} />
          ),
          <MedRecordsCard key="mr" clinicals={clinicals} mr={checklist.mr} />,
        ].filter(Boolean);
        const cols =
          cards.length >= 3 ? "md:grid-cols-3" : cards.length === 2 ? "md:grid-cols-2" : "grid-cols-1";
        return <div className={`grid gap-4 ${cols}`}>{cards}</div>;
      })()}
    </div>
  );
}

/** Legend swatch: colored dot + colored label. */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="font-semibold" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

const AMBER = "oklch(0.62 0.13 75)";
const stateColor = (s: MnState) =>
  s === "ok" ? "var(--mm-green)" : s === "invalid" ? AMBER : "var(--mm-rose)";

/** Right-aligned status word with icon (used for the script + records rows). */
function StatusText({ state }: { state: MnState }) {
  if (state === "na") return <span className="text-xs font-semibold text-muted-foreground">N/A</span>;
  const label = state === "ok" ? "Yes" : state === "invalid" ? "Invalid" : "No";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: stateColor(state) }}>
      {state === "ok" ? (
        <Check className="h-4 w-4" />
      ) : state === "invalid" ? (
        <span className="text-xs font-bold leading-none">!</span>
      ) : (
        <X className="h-4 w-4" />
      )}
      {label}
    </span>
  );
}

/** A requirement row: small checkbox + label (label colored when not met). */
function SubCheck({ state, label }: { state: MnState; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid place-items-center h-[18px] w-[18px] rounded-[5px] shrink-0"
        style={{ background: stateColor(state) }}
      >
        {state === "ok" ? (
          <Check className="h-3 w-3 text-white" />
        ) : state === "invalid" ? (
          <span className="text-white text-[10px] font-bold leading-none">!</span>
        ) : (
          <X className="h-3 w-3 text-white" />
        )}
      </span>
      <span className="text-sm font-medium" style={state === "ok" ? undefined : { color: stateColor(state) }}>
        {label}
      </span>
    </div>
  );
}

/** White card with a faint rose header tint when incomplete; title + optional
 *  uppercase badge in the header, content (doc-on-top → divider → details). */
function ChecklistCard({
  complete,
  title,
  badgeLabel,
  children,
}: {
  complete: boolean;
  title: string;
  badgeLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border overflow-hidden bg-card" style={{ borderColor: "var(--mm-card-border)" }}>
      <div
        className="flex items-center justify-between gap-3 px-5 py-3"
        style={{ background: complete ? "var(--mm-mint)" : "var(--mm-rose-soft)" }}
      >
        <h4 className="text-lg font-bold tracking-tight">{title}</h4>
        {badgeLabel && (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider shrink-0 text-white"
            style={{ background: "var(--mm-teal)" }}
          >
            {badgeLabel}
          </span>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

/** One device card: the script on top, a divider, then the coverage-language
 *  requirements below. */
function DeviceSection({
  name,
  coverage,
  script,
  lang,
}: {
  name: string;
  coverage?: string;
  script: MnItem;
  lang: MnLangItem;
}) {
  const langOk = lang.state === "ok";
  const langNa = lang.state === "na"; // path needs no language
  const complete = script.state === "ok" && (langOk || langNa);
  const rank = (s: MnState) => (s === "missing" ? 0 : s === "invalid" ? 1 : 2);
  const subs = [...lang.subItems].sort((a, b) => rank(a.state) - rank(b.state));
  const met = subs.filter((s) => s.state === "ok").length;

  return (
    <ChecklistCard complete={complete} title={name} badgeLabel={coverage}>
      {/* Documentation — on top */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold">{name} Script</span>
        <StatusText state={script.state} />
      </div>

      {/* Gray divider */}
      <div className="border-t my-3.5" style={{ borderColor: "var(--mm-card-border)" }} />

      {/* Coverage language — below */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold">{name} Language</span>
        {langNa ? (
          <span className="text-xs font-semibold text-muted-foreground">None required</span>
        ) : subs.length > 0 && !langOk ? (
          <span className="text-sm font-semibold text-foreground">
            {met} of {subs.length}
          </span>
        ) : (
          <StatusText state={lang.state} />
        )}
      </div>
      {subs.length > 0 ? (
        <div className="mt-2.5 flex flex-col gap-2">
          {subs.map((s) => (
            <SubCheck key={s.label} state={s.state} label={s.label} />
          ))}
        </div>
      ) : !langOk && !langNa ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {coverage ? `${coverage} language in the note` : "Select a coverage path on Evaluate"}
        </p>
      ) : null}
    </ChecklistCard>
  );
}

/** Shared medical-records card — the records doc on top, divider, then the
 *  details (diagnosis, last visit, expiry) below. */
function MedRecordsCard({ clinicals, mr }: { clinicals: MnItem; mr: MnChecklist["mr"] }) {
  const complete = clinicals.state === "ok" && mr.diagnosisOk && !mr.expired;
  const docLabel = clinicals.state === "invalid" ? "Updated Medical Records" : "Medical Records";
  return (
    <ChecklistCard complete={complete} title="Medical Records" badgeLabel="General Requirements">
      {/* Documentation — on top */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold">{docLabel}</span>
        <StatusText state={clinicals.state} />
      </div>

      {/* Gray divider */}
      <div className="border-t my-3.5" style={{ borderColor: "var(--mm-card-border)" }} />

      {/* From the records — below */}
      <div className="flex flex-col gap-2">
        <SubCheck
          state={mr.diagnosisOk ? "ok" : "missing"}
          label={mr.diagnosisOk && mr.diagnosis ? `Diagnosis · ${mr.diagnosis}` : "Diagnosis documented"}
        />
        <SubCheck
          state={!mr.expiry ? "missing" : mr.expired ? "invalid" : "ok"}
          label={mr.expiry ? `Expires · ${fmtMrDate(mr.expiry)}` : "Expiry — last visit needed"}
        />
      </div>
    </ChecklistCard>
  );
}

/** MM/DD/YYYY from an ISO date (no tz parsing). */
function fmtMrDate(iso?: string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}
