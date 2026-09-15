/**
 * Created → Placed → Accepted → Shipped → Delivered, drawn from
 * `lib/orders/timeline.ts`. The looks only; the states are tested there.
 */
import { Card } from "@/components/ui/card";
import { Check, Circle, Clock, Info, XOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { orderTimeline, type StepState } from "@/lib/orders/timeline";
import type { Order } from "@/lib/orders/workflow";

const RING: Record<StepState, string> = {
  done: "bg-[color:var(--mm-teal)] text-white border-[color:var(--mm-teal)]",
  current: "bg-background text-[color:var(--mm-teal)] border-[color:var(--mm-teal)] ring-4 ring-[color:var(--mm-green-12)]",
  pending: "bg-muted text-muted-foreground border-border",
  blocked: "bg-rose-600 text-white border-rose-600 ring-4 ring-rose-100 dark:ring-rose-900",
  note: "bg-amber-500 text-white border-amber-500",
};

const LINE: Record<StepState, string> = {
  done: "bg-[color:var(--mm-teal)]",
  current: "bg-border",
  pending: "bg-border",
  blocked: "bg-rose-300",
  note: "bg-amber-400",
};

function Icon({ state }: { state: StepState }) {
  const c = "h-3.5 w-3.5";
  if (state === "done") return <Check className={c} />;
  if (state === "blocked") return <XOctagon className={c} />;
  if (state === "note") return <Info className={c} />;
  if (state === "current") return <Clock className={c} />;
  return <Circle className={c} />;
}

export function OrderTimeline({ order }: { order: Order }) {
  const steps = orderTimeline(order);
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-4">Where it is</p>
      <ol className="grid gap-4" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li key={s.key} className="relative min-w-0">
            {i < steps.length - 1 && (
              <span className={cn("absolute left-[calc(50%+14px)] right-[calc(-50%+14px)] top-3.5 h-0.5", LINE[s.state])} aria-hidden />
            )}
            <div className="flex flex-col items-center text-center">
              <span className={cn("relative z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border-2", RING[s.state])}>
                <Icon state={s.state} />
              </span>
              <p className={cn("mt-2 text-xs font-semibold", s.state === "pending" ? "text-muted-foreground" : s.state === "blocked" ? "text-rose-700" : "text-foreground")}>
                {s.title}
              </p>
              {s.lines.map((l, j) => (
                <p key={j} className={cn("text-[11px] leading-snug break-words", j === 0 && s.state !== "pending" ? "text-foreground/80" : "text-muted-foreground")}>
                  {l}
                </p>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
