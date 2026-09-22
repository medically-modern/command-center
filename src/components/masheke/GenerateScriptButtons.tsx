/**
 * The Generate-script buttons — one set of markup for every surface that
 * triggers DocExport.
 *
 * Send Request has had these since the redesign; the Chase Clinicals drawer
 * gained them on 2026-09-22 (Josh: *"…and generate a script too"*). Extracted
 * rather than copied, for the reason `SmsDeliveryNote` (§5.5) and
 * `FaxStatusChip` (§5.9b) exist: a control on two screens that is two
 * components is a control that starts behaving differently on one of them.
 *
 * The RULE lives in `lib/masheke/generateScripts.ts`; this file is only how it
 * looks. `GenerateScriptsControl` additionally owns the small state machine —
 * which is why Send Request does NOT use it: that panel keeps its generate
 * state inside the persisted `EvalState`, so it drives `GenBtn`/`GeneratingChip`
 * itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { COL } from "@/lib/masheke/mondayApi";
import {
  missingForScript,
  showCgmGenerate,
  showIpGenerate,
  triggerGenerateScript,
  type ScriptInputs,
} from "@/lib/masheke/generateScripts";

/** Outlined teal "Generate …" button. */
export function GenBtn({
  label,
  disabled,
  spinner,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  spinner?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg px-[18px] py-2.5 text-sm font-semibold transition-colors text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1.5px_var(--mm-teal)] hover:bg-[oklch(0.36_0.04_200_/_0.06)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      {spinner ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      {label}
    </button>
  );
}

/**
 * Amber "Generating…" chip with a cancel ✕.
 *
 * ⚠️ The cancel is not decoration. DocExport can leave the column on
 * "Generate" — a failed run, a redeploy mid-job — and without a way to clear
 * it the rep is looking at a spinner nothing will ever end, on a button they
 * cannot press again (`triggerGenerateScript` needs the column to CHANGE).
 */
export function GeneratingChip({ label, onCancel }: { label: string; onCancel: () => void }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm font-semibold">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </span>
      <button
        onClick={onCancel}
        title="Cancel"
        className="p-2 rounded-lg border bg-background hover:bg-muted transition-colors"
        style={{ borderColor: "var(--mm-card-border)" }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface Props {
  itemId: string;
  patient: ScriptInputs & { serving?: string };
  /** Whether each column already holds a generated template. */
  hasCgmTemplate: boolean;
  hasIpTemplate: boolean;
  /** The live Generate column values, from `useMondayFiles`. */
  cgmStatus: string | undefined;
  ipStatus: string | undefined;
  /** Tell the caller to poll Monday faster while a job is running. */
  onGeneratingChange?: (generating: boolean) => void;
}

/**
 * Both Generate buttons plus the "cannot generate — missing X" lines.
 *
 * ⚠️ It keeps its own optimistic flag per product AND reads Monday's column,
 * because neither alone is enough: the column takes a second or two to reflect
 * the write (so the button would not change on the press), and the local flag
 * has no way to learn the job finished (so the spinner would never stop). The
 * pair is what makes the chip appear at once and clear on its own.
 */
export function GenerateScriptsControl({
  itemId,
  patient,
  hasCgmTemplate,
  hasIpTemplate,
  cgmStatus,
  ipStatus,
  onGeneratingChange,
}: Props) {
  const [cgmLocal, setCgmLocal] = useState(false);
  const [ipLocal, setIpLocal] = useState(false);

  const cgmGenerating = cgmLocal || cgmStatus === "Generate";
  const ipGenerating = ipLocal || ipStatus === "Generate";

  // ⚠️ Drop the optimistic flag once Monday says the job LEFT "Generate", not
  // merely that it is not "Generate" — the column reads empty before the write
  // lands too, and clearing on that would flip the chip straight back off.
  const prevCgm = useRef<string | undefined>(undefined);
  const prevIp = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevCgm.current === "Generate" && cgmStatus && cgmStatus !== "Generate") setCgmLocal(false);
    prevCgm.current = cgmStatus;
  }, [cgmStatus]);
  useEffect(() => {
    if (prevIp.current === "Generate" && ipStatus && ipStatus !== "Generate") setIpLocal(false);
    prevIp.current = ipStatus;
  }, [ipStatus]);

  useEffect(() => {
    onGeneratingChange?.(cgmGenerating || ipGenerating);
  }, [cgmGenerating, ipGenerating, onGeneratingChange]);

  const run = useCallback(
    async (
      kind: "cgm" | "ip",
      v: "Generate" | undefined,
    ) => {
      const setLocal = kind === "cgm" ? setCgmLocal : setIpLocal;
      const columnId = kind === "cgm" ? COL.generateCgmScript : COL.generateIpScript;
      setLocal(v === "Generate");
      try {
        await triggerGenerateScript(itemId, columnId, v);
      } catch (e) {
        setLocal(false);
        toast.error("Generate request failed", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [itemId],
  );

  const showCgm = showCgmGenerate(patient.serving);
  const showIp = showIpGenerate(patient.serving);
  const cgmMissing = missingForScript(patient, "cgm");
  const ipMissing = missingForScript(patient, "ip");

  if (!showCgm && !showIp) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {showCgm &&
          (cgmGenerating ? (
            <GeneratingChip label="Generating CGM Script…" onCancel={() => void run("cgm", undefined)} />
          ) : (
            <GenBtn
              label={hasCgmTemplate ? "Regenerate CGM Script" : "Generate CGM Script"}
              disabled={cgmMissing.length > 0}
              onClick={() => void run("cgm", "Generate")}
            />
          ))}
        {showIp &&
          (ipGenerating ? (
            <GeneratingChip label="Generating IP Script…" onCancel={() => void run("ip", undefined)} />
          ) : (
            <GenBtn
              label={hasIpTemplate ? "Regenerate Insulin Pump Script" : "Generate Insulin Pump Script"}
              disabled={ipMissing.length > 0}
              onClick={() => void run("ip", "Generate")}
            />
          ))}
      </div>
      {/* ⚠️ A disabled Generate always says WHY. A greyed-out button with no
          stated passing move is the dead end §5.10 · §5.20 · §5.31c · §5.32c ·
          §5.39d each record reversing. */}
      {showCgm && cgmMissing.length > 0 && (
        <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--mm-rose)" }}>
          Cannot generate CGM Script — missing: {cgmMissing.join(", ")}
        </p>
      )}
      {showIp && ipMissing.length > 0 && (
        <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--mm-rose)" }}>
          Cannot generate Insulin Pump Script — missing: {ipMissing.join(", ")}
        </p>
      )}
    </div>
  );
}
