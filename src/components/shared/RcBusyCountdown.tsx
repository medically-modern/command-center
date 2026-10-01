/**
 * "RingCentral is busy — trying again in 0:42", counting down, then retrying
 * once by itself (Josh, 2026-10-01: "a timer showing how long you have to wait
 * to update"). Used where a RingCentral read answered 429 (`RcBusyError`).
 */
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function RcBusyCountdown({ retryAt, onRetry }: { retryAt: number; onRetry: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const retry = useRef(onRetry);
  retry.current = onRetry;

  useEffect(() => {
    fired.current = false;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  const left = retryAt - now;
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      retry.current();
    }
  }, [left]);

  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
      role="status"
      data-testid="rc-busy"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        RingCentral is busy — it only allows a few call-history reads a minute for the whole company.{" "}
        <span className="font-semibold tabular-nums">Trying again in {mmss(left)}</span>
      </div>
    </div>
  );
}
