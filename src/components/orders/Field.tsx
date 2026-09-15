import { cn } from "@/lib/utils";

/** A labelled value that renders NOTHING when empty — a card full of em-dashes
 *  is what makes a rep slow (§5.28). Pass `always` to keep a blank slot. */
export function Field({
  label, value, always = false, className, valueClassName, children,
}: {
  label: string;
  value?: string;
  always?: boolean;
  className?: string;
  valueClassName?: string;
  children?: React.ReactNode;
}) {
  const v = (value ?? "").trim();
  if (!v && !children && !always) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      {children ?? (
        <p className={cn("text-sm font-medium break-words", valueClassName)} title={v}>
          {v || "—"}
        </p>
      )}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{children}</p>
      {aside}
    </div>
  );
}
