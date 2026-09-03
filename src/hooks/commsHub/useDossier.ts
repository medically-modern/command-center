/**
 * The patient behind a phone number — resolved on demand, once per number.
 *
 * Fetched when the rep OPENS something (a conversation, a call, a voicemail),
 * never on render, and memoised for the session by `dossierApi`. The effect
 * depends on the phone string alone, so there is no object identity to spin on
 * (INCIDENT_2026-08-20 rule 2).
 *
 * ⚠️ **Switching number CLEARS the dossier, it does not keep the old one while
 * the new one loads** (Josh, 2026-09-02). Holding the previous patient on
 * screen under a new conversation's header is not merely stale UI: the pane's
 * note composer writes to `dossier.active.itemId`, and the page derives
 * `threadPatient` — which carries `mondayItemId` onto an outbound text — from
 * the same object. A rep who typed during that window would attribute a note or
 * a text to the patient they had just navigated away from.
 *
 * ⚠️ A number already in the session cache resolves SYNCHRONOUSLY via
 * `peekDossierItems`, so clicking back and forth between two threads does not
 * flicker a spinner over data we already hold.
 *
 * ⚠️ **`preferPerson` is not a nicety on a shared line.** Searching a patient
 * by name and clicking THEM must open them — the click used to pass only the
 * phone number, so picking "Sue Hartley" opened John, who shares the line and
 * wins the default ordering. A rep who named a patient has already answered the
 * question the switcher asks.
 */
import { useCallback, useEffect, useState } from "react";
import { personKey, splitByPerson, type PatientDossier } from "@/lib/commsHub/dossier";
import {
  dossierConfigured,
  fetchDossierItems,
  fetchDossierItemsForPick,
  peekDossierItems,
  type DossierPick,
} from "@/lib/commsHub/dossierApi";

export interface DossierState {
  /** The SELECTED person's dossier — what every consumer reads. */
  dossier: PatientDossier | null;
  /**
   * Everyone who shares this number. Usually one; 18 of our 3,140 numbers are
   * shared by genuinely different patients (audited 2026-09-02), and the pane
   * offers a switcher for those.
   */
  people: PatientDossier[];
  /** Index into `people`. */
  selected: number;
  loading: boolean;
  error: string | null;
  /** Monday is reachable at all. False in a build with no API token. */
  configured: boolean;
}

export function useDossier(
  phone: string | null | undefined,
  /** Open on THIS person when the number carries several — the name a rep
   *  explicitly picked. Ignored when it matches nobody. */
  preferPerson?: string | null,
  /**
   * A patient the rep found through the pane's own search, because the number
   * on the line is on no board. Wins over the number entirely while set: the
   * trail is loaded from the PICKED record (`fetchDossierItemsForPick`), and the
   * page clears it the moment the rep moves to another number.
   */
  pick?: DossierPick | null,
): DossierState & { selectPerson: (i: number) => void } {
  const [state, setState] = useState<DossierState>({
    dossier: null,
    people: [],
    selected: 0,
    loading: false,
    error: null,
    configured: dossierConfigured(),
  });

  /** Switch to another patient on this number. Everything downstream follows,
   *  because `dossier` IS the selected one — including the pane's note
   *  composer and the page's outbound-text attribution. */
  const selectPerson = useCallback((index: number) => {
    setState((s) => (index >= 0 && index < s.people.length ? { ...s, selected: index, dossier: s.people[index] } : s));
  }, []);

  useEffect(() => {
    const num = (phone || "").trim();
    /** Which of the people on this number to open on. Falls back to the
     *  furthest-along default when the preference matches nobody. */
    const pickIndex = (people: PatientDossier[]) => {
      const want = personKey(preferPerson || "");
      if (!want) return 0;
      const i = people.findIndex((p) => personKey(p.name) === want);
      return i >= 0 ? i : 0;
    };
    if (pick) {
      let alive = true;
      setState((s) => ({ ...s, dossier: null, people: [], selected: 0, loading: true, error: null }));
      fetchDossierItemsForPick(pick)
        .then((items) => {
          if (!alive) return;
          const people = splitByPerson(items);
          const want = personKey(pick.name);
          const i = Math.max(0, people.findIndex((p) => personKey(p.name) === want));
          setState({ dossier: people[i] ?? null, people, selected: i, loading: false, error: null, configured: true });
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setState({ dossier: null, people: [], selected: 0, loading: false, error: e instanceof Error ? e.message : String(e), configured: true });
        });
      return () => {
        alive = false;
      };
    }
    if (!num) {
      setState((s) => ({ ...s, dossier: null, people: [], selected: 0, loading: false, error: null }));
      return;
    }

    // Already resolved this session — render it now rather than blanking and
    // re-showing the same thing a microtask later.
    const cached = peekDossierItems(num);
    if (cached) {
      const people = splitByPerson(cached);
      const i = pickIndex(people);
      setState({ dossier: people[i] ?? null, people, selected: i, loading: false, error: null, configured: true });
      return;
    }
    // ⚠️ Bound to the number that was open when the fetch started. Without
    // this, a rep clicking quickly through conversations paints an earlier
    // patient's dossier into a later one's pane — the same class of bug
    // useDeliveryRecheck's cancel() exists to prevent (CLAUDE.md §5.5).
    let alive = true;
    // ⚠️ `dossier: null`, not a spread that keeps it — see the header. The
    // previous patient must leave the pane the instant the rep selects another.
    setState((s) => ({ ...s, dossier: null, people: [], selected: 0, loading: true, error: null }));
    fetchDossierItems(num)
      .then((items) => {
        if (!alive) return;
        // ⚠️ Split by PERSON, not merged. A phone match is not a person: two
        // patients on one line used to become a single blended profile.
        const people = splitByPerson(items);
        const i = pickIndex(people);
        setState({ dossier: people[i] ?? null, people, selected: i, loading: false, error: null, configured: true });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          dossier: null,
          people: [],
          selected: 0,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          configured: true,
        });
      });
    return () => {
      alive = false;
    };
    // `pick` is keyed by its item, not its identity — the page hands down a
    // fresh object per render otherwise (INCIDENT_2026-08-20 rule 2).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, preferPerson, pick?.boardId, pick?.itemId]);

  return { ...state, selectPerson };
}
