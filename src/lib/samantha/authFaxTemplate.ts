/**
 * authFaxTemplate — pure builders for the Submit-Auth "Fax to Payer" panel.
 *
 * Produces the fax subject + a payer-facing prior-authorization cover letter
 * listing the products/HCPCS codes we're requesting. No side effects — the
 * auth counterpart to masheke/requestTemplate.ts. Kept pure so it's unit
 * tested and the panel can regenerate it live until the rep edits.
 */
import type { Patient } from "@/lib/samantha/workflow";
import type { ResolvedProduct } from "@/lib/samantha/hcpcRules";
import { PRODUCT_LABELS } from "@/lib/samantha/hcpcRules";

/** Medically Modern's billing NPI — same value the MN request letter signs with. */
const MM_NPI = "1023042348";

/** Title-case a name for display ("marcus feldman" → "Marcus Feldman"). */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function buildAuthFaxSubject(patient: Patient): string {
  const name = titleCase(patient.name || "");
  const payer = (patient.primaryInsurance || "").trim();
  return payer
    ? `Prior authorization request — ${name} · ${payer}`
    : `Prior authorization request — ${name}`;
}

/**
 * Build the fax cover letter. `products` are the auth cards whose submission
 * method is Fax (see AuthFaxPanel) — each contributes an HCPCS line item.
 */
export function buildAuthFaxBody(patient: Patient, products: ResolvedProduct[]): string {
  const name = titleCase(patient.name || "");
  const payer = (patient.primaryInsurance || "").trim();
  const memberId = (patient.memberId1 || "").trim();
  const lines: string[] = [];

  lines.push(`To the ${payer || "plan"} Prior Authorization Department,`);
  lines.push("");
  lines.push(
    "We are requesting prior authorization for the following durable medical equipment for our mutual patient:",
  );
  lines.push("");
  lines.push(`Patient: ${name}`);
  if (patient.dob) lines.push(`DOB: ${patient.dob}`);
  if (payer) lines.push(`Plan: ${payer}`);
  if (memberId) lines.push(`Member ID: ${memberId}`);
  lines.push("");
  lines.push("Requested item(s):");
  if (products.length) {
    for (const p of products) {
      lines.push(`  • ${PRODUCT_LABELS[p.product]} — HCPCS ${p.hcpc}`);
    }
  } else {
    lines.push("  • (see attached)");
  }
  lines.push("");
  lines.push(
    "Supporting clinical documentation is attached. Please confirm receipt and advise if anything further is needed to process this authorization.",
  );
  lines.push("");
  lines.push("Thank you,");
  lines.push(`Medically Modern (NPI: ${MM_NPI})`);

  return lines.join("\n");
}
