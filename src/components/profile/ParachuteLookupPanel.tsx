import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronRight, Loader2, MapPin, PenLine, Search } from "lucide-react";
import { phoneToState } from "@/lib/profile/areaCodeState";

/**
 * Parachute Health doctor lookup.
 *
 * Searches the parachute-doctor-lookup Railway service (which proxies
 * dme.parachutehealth.com) by doctor name or NPI and lists every match:
 * name, NPI, city/state, specialty, signed-order count, and the
 * parachute-vs-fax contact verdict (> threshold signed orders → Parachute).
 */

const PARACHUTE_API = "https://parachute-doctor-lookup-production.up.railway.app";
const DEBOUNCE_MS = 450;
const MIN_CHARS = 2;

interface ParachuteDoctor {
  doctor_id: string;
  first_name: string;
  last_name: string;
  npi: string;
  credential: string | null;
  city: string;
  state: string;
  signature_count: number;
  doctor_contact: "parachute" | "fax";
  [key: string]: unknown;
}

interface SearchResponse {
  term: string;
  threshold: number;
  count: number;
  results: ParachuteDoctor[];
}

/** Parachute returns a variable set of fields — find the best specialty-ish label. */
function specialtyOf(d: ParachuteDoctor): string {
  for (const key of ["specialty", "specialty_name", "doctor_specialty", "title", "taxonomy_description"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return d.credential?.trim() ?? "";
}

/** Highlight the matched portion of a name, like Parachute's own autocomplete. */
function Highlight({ text, term }: { text: string; term: string }) {
  const t = term.trim();
  if (!t) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(t.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-inherit rounded-[2px]">{text.slice(idx, idx + t.length)}</mark>
      {text.slice(idx + t.length)}
    </>
  );
}

interface Props {
  /** Prefill the search box (e.g. the patient's doctor name). */
  defaultTerm?: string;
  /** Doctor phone from the form — its area code maps to a state, and
   *  doctors in that state are floated to the top of the results. */
  phoneHint?: string;
  /** Called when the user clicks "Use" on a result row. */
  onPick?: (doc: ParachuteDoctor) => void;
}

export function ParachuteLookupPanel({ defaultTerm = "", phoneHint = "", onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(defaultTerm);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const searchedOnce = useRef(false);

  const runSearch = async (q: string) => {
    const query = q.trim();
    if (query.length < MIN_CHARS) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${PARACHUTE_API}/api/search?term=${encodeURIComponent(query)}`, {
        signal: ctrl.signal,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message ?? body?.error ?? `Request failed (${res.status})`);
      setData(body as SearchResponse);
      searchedOnce.current = true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
      setData(null);
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  // Debounced search-as-you-type (only while expanded)
  useEffect(() => {
    if (!open || term.trim().length < MIN_CHARS) return;
    const id = setTimeout(() => runSearch(term), DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, open]);

  // First expand with a prefilled name → search immediately
  useEffect(() => {
    if (open && !searchedOnce.current && term.trim().length >= MIN_CHARS) runSearch(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const results = data?.results ?? [];

  // Area code from the form's doctor phone → state; matching-state doctors first
  const phoneState = phoneToState(phoneHint);
  const stateMatches = phoneState
    ? results.filter((d) => d.state?.toUpperCase() === phoneState.state)
    : [];
  const otherResults = phoneState
    ? results.filter((d) => d.state?.toUpperCase() !== phoneState.state)
    : results;

  const renderRow = (d: ParachuteDoctor) => {
    const name = `${d.first_name} ${d.last_name}`;
    const specialty = specialtyOf(d);
    const sigs = d.signature_count;
    const isParachute = d.doctor_contact === "parachute";
    return (
      <div
        key={d.doctor_id}
        role="button"
        tabIndex={0}
        title="Click to fill doctor name, NPI and clinicals method into the form"
        onClick={() => onPick?.(d)}
        onKeyDown={(e) => e.key === "Enter" && onPick?.(d)}
        className="px-3 py-2 hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm truncate min-w-0">
            <span className="font-semibold">
              <Highlight text={name} term={term} />
            </span>
            <span className="text-muted-foreground"> – {d.npi}</span>
          </p>
          <p className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {d.city}, {d.state}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 mt-0.5">
          <p className="text-xs text-muted-foreground truncate min-w-0">
            {specialty ? `${specialty}, ` : ""}
            {sigs} signed order{sigs === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              title={`${sigs} signed orders · threshold ${data?.threshold ?? 15}`}
              className={`rounded-full text-[10px] px-2 py-0.5 font-semibold ${
                isParachute ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
              }`}
            >
              {isParachute ? "Parachute" : "Fax"}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="border rounded-lg p-4 space-y-2 bg-card">
      {/* Header (click to expand/collapse) */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        title={open ? "Collapse Parachute lookup" : "Expand Parachute lookup"}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <PenLine className="h-4 w-4 shrink-0" />
        <span>Parachute Lookup</span>
        {!open && data && (
          <span className="ml-1 shrink-0 rounded-full bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0.5 font-medium">
            {data.count} match{data.count === 1 ? "" : "es"}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Search box */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(term)}
              placeholder="Search doctor name or NPI…"
              className="pl-9"
            />
            {loading && (
              <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 py-1">
              <p className="text-xs text-amber-600 italic">Parachute lookup failed: {error}</p>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => runSearch(term)}>
                Retry
              </Button>
            </div>
          )}

          {/* Idle hint */}
          {!error && !data && !loading && (
            <p className="text-xs text-muted-foreground italic py-1">
              Type at least {MIN_CHARS} characters to search Parachute Health.
            </p>
          )}

          {/* Empty */}
          {!error && data && results.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground italic py-1">
              No doctors found on Parachute for “{data.term}”.
            </p>
          )}

          {/* Results — matching-state doctors first */}
          {results.length > 0 && (
            <div className="border rounded-md max-h-72 overflow-y-auto">
              {phoneState && stateMatches.length > 0 && (
                <div className="sticky top-0 bg-emerald-50 border-b px-3 py-1 flex items-center gap-1.5">
                  <MapPin className="h-3 w-3 text-emerald-700" />
                  <p className="text-[11px] font-semibold text-emerald-700">
                    {phoneState.state} — matches phone area code ({phoneState.areaCode})
                  </p>
                </div>
              )}
              {phoneState && stateMatches.length === 0 && (
                <div className="border-b px-3 py-1">
                  <p className="text-[11px] text-muted-foreground italic">
                    No {phoneState.state} doctors (phone area code {phoneState.areaCode})
                  </p>
                </div>
              )}
              <div className="divide-y">
                {stateMatches.map((d) => renderRow(d))}
              </div>
              {phoneState && stateMatches.length > 0 && otherResults.length > 0 && (
                <div className="border-y bg-muted/50 px-3 py-1">
                  <p className="text-[11px] font-medium text-muted-foreground">Other states</p>
                </div>
              )}
              <div className="divide-y">
                {otherResults.map((d) => renderRow(d))}
              </div>
            </div>
          )}

          {/* Footer */}
          {data && results.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {data.count} result{data.count === 1 ? "" : "s"} · &gt;{data.threshold} signed orders → contact via
              Parachute, otherwise fax
            </p>
          )}
        </>
      )}
    </div>
  );
}
