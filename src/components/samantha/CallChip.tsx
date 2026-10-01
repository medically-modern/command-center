/**
 * One "who to call" chip on the Benefits page (HANDOFF-Josh-Who-To-Call §3).
 * Mint = our side (the plan we bill, or CareCentrix); dark MM-teal = the
 * member's own plan when it's a different party. The payer NAME only — no
 * phone numbers anywhere (a payer phone directory is a separate project).
 * Styles: `.bnr .sugg-chip2` in benefitsRedesign.css.
 */
import { Phone } from "lucide-react";
import type { CallTarget } from "@/lib/samantha/whoToCall";

export function CallChip({ target, prefix }: { target: CallTarget; prefix?: string }) {
  const member = target.side === "member";
  return (
    <span
      className={`sugg-chip2${member ? " member" : ""}`}
      title={member ? "The member's own plan — a different party from the one we bill" : "Our side — the plan or manager we bill"}
    >
      <Phone size={12} aria-hidden="true" />
      {prefix && <span className="pfx">{prefix}</span>}
      {target.name}
    </span>
  );
}
