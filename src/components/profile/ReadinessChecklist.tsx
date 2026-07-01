import { Check, X } from "lucide-react";

interface Props {
  items: { label: string; ok: boolean }[];
}

/**
 * "Ready to Send Off?" checklist — one ✓/✗ row per redesign requirement, driven
 * by ProfilePage's derived checklist. Mirrors the prototype's Step 6 readiness list.
 */
export function ReadinessChecklist({ items }: Props) {
  const missing = items.filter((i) => !i.ok);
  const ready = missing.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Ready to Send Off?</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            ready ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}
        >
          {ready ? "Ready" : `${missing.length} missing`}
        </span>
      </div>

      <div className="rounded-lg border divide-y">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2.5 px-3 py-2 text-sm">
            <span
              className={`grid place-items-center h-5 w-5 rounded shrink-0 ${
                it.ok ? "bg-emerald-600 text-white" : "bg-red-100 text-red-600 ring-1 ring-red-300"
              }`}
            >
              {it.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            </span>
            <span className={it.ok ? "text-foreground" : "text-foreground"}>{it.label}</span>
            <span className={`ml-auto text-xs font-medium ${it.ok ? "text-emerald-600" : "text-red-500"}`}>
              {it.ok ? "ok" : "missing"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
