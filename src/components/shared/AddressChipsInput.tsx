import { X } from "lucide-react";

/**
 * Chip-style multi-address input (To / Cc). State lives in the parent so the
 * send handler can merge still-typed (uncommitted) text at send time. A pasted
 * list ("a@x.com, b@x.com; c@x.com") is split into chips so an embedded comma
 * can't corrupt the grouped To/Cc header. Extracted from SendRequestPanel so
 * multiple send panels share one input.
 */
export function AddressChipsInput({
  values,
  setValues,
  input,
  setInput,
  placeholder,
}: {
  values: string[];
  setValues: (next: string[]) => void;
  input: string;
  setInput: (next: string) => void;
  placeholder: string;
}) {
  const add = (raw: string) => {
    const parts = [...new Set(raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean))];
    const fresh = parts.filter((p) => !values.includes(p));
    if (fresh.length) setValues([...values, ...fresh]);
    setInput("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-input p-2 min-h-[44px]">
      {values.map((r) => (
        <span
          key={r}
          className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-0.5 text-sm bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {r}
          <button
            type="button"
            onClick={() => setValues(values.filter((x) => x !== r))}
            className="hover:opacity-70"
            aria-label={`Remove ${r}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => {
          // A separator arriving via onChange means a pasted list — commit it.
          const v = e.target.value;
          if (/[,;]/.test(v)) add(v);
          else setInput(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === ";") {
            e.preventDefault();
            add(input);
          } else if (e.key === "Backspace" && !input && values.length) {
            setValues(values.slice(0, -1));
          }
        }}
        onBlur={() => add(input)}
        placeholder={values.length ? "" : placeholder}
        className="flex-1 min-w-[140px] bg-transparent text-sm p-1 focus:outline-none"
      />
    </div>
  );
}
