/**
 * Three attempt cards — the shared "attempt N of 3" strip.
 *
 * Extracted from ChaseClinicalsPanel (2026-08-03) so Chase Clinicals and Doctor
 * Appointments render one implementation rather than two copies that drift.
 * The current round is bright white and fully opaque; every other round is
 * greyed and dimmed, so it's obvious at a glance which attempt you're on.
 */
import type { AttemptChip } from "@/lib/masheke/attemptLog";

export type AttemptStatus = "logged" | "in_progress" | "scheduled";

interface AttemptCardsProps {
  /** Attempts already logged, in any order — placed by their `attempt` slot. */
  history: AttemptChip[];
  /** No slots left: nothing renders as "in progress". */
  exhausted?: boolean;
}

export function AttemptCards({ history, exhausted = false }: AttemptCardsProps) {
  const doneSlots = new Set(history.map((h) => h.attempt));
  const activeSlot = [1, 2, 3].find((n) => !doneSlots.has(n)) ?? null;
  const cards = [1, 2, 3].map((n) => {
    const h = history.find((x) => x.attempt === n);
    // Show only what's actually on Monday — the timestamp and the note. Never
    // fabricate status text for a slot nobody has filled.
    if (h) return { n, status: "logged" as const, date: h.date || "—", desc: h.note };
    if (!exhausted && activeSlot === n) {
      return { n, status: "in_progress" as const, date: "Today", desc: "" };
    }
    return { n, status: "scheduled" as const, date: "—", desc: "" };
  });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map((c) => (
        <AttemptCard key={c.n} {...c} />
      ))}
    </div>
  );
}

export function AttemptCard({
  n,
  status,
  date,
  desc,
}: {
  n: number;
  status: AttemptStatus;
  date: string;
  desc: string;
}) {
  const cfg = {
    logged: {
      border: "var(--mm-card-border)",
      width: 1,
      current: false,
      pillColor: "var(--muted-foreground)",
      label: "Logged",
    },
    in_progress: {
      border: "var(--mm-teal)",
      width: 2,
      current: true,
      pillColor: "var(--mm-teal)",
      label: "In progress",
    },
    scheduled: {
      border: "var(--mm-card-border)",
      width: 1,
      current: false,
      pillColor: "var(--muted-foreground)",
      label: "",
    },
  }[status];
  return (
    <div
      className={`rounded-xl p-3.5 ${cfg.current ? "bg-card" : "bg-muted/50"}`}
      style={{
        border: `${cfg.width}px solid ${cfg.border}`,
        opacity: cfg.current ? 1 : 0.6,
        ...(cfg.current ? { boxShadow: "0 1px 2px rgba(15,31,36,.06)" } : {}),
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Attempt {n}
        </span>
        {cfg.label && (
          <span
            className="rounded-full bg-background px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: cfg.pillColor }}
          >
            {cfg.label}
          </span>
        )}
      </div>
      <p className="text-sm font-bold mt-2">{date}</p>
      {desc && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{desc}</p>}
    </div>
  );
}
