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
 */
import { useEffect, useState } from "react";
import { buildDossier, type PatientDossier } from "@/lib/commsHub/dossier";
import { dossierConfigured, fetchDossierItems, peekDossierItems } from "@/lib/commsHub/dossierApi";

export interface DossierState {
  dossier: PatientDossier | null;
  loading: boolean;
  error: string | null;
  /** Monday is reachable at all. False in a build with no API token. */
  configured: boolean;
}

export function useDossier(phone: string | null | undefined): DossierState {
  const [state, setState] = useState<DossierState>({
    dossier: null,
    loading: false,
    error: null,
    configured: dossierConfigured(),
  });

  useEffect(() => {
    const num = (phone || "").trim();
    if (!num) {
      setState((s) => ({ ...s, dossier: null, loading: false, error: null }));
      return;
    }

    // Already resolved this session — render it now rather than blanking and
    // re-showing the same thing a microtask later.
    const cached = peekDossierItems(num);
    if (cached) {
      setState({
        dossier: cached.length ? buildDossier(cached) : null,
        loading: false,
        error: null,
        configured: true,
      });
      return;
    }
    // ⚠️ Bound to the number that was open when the fetch started. Without
    // this, a rep clicking quickly through conversations paints an earlier
    // patient's dossier into a later one's pane — the same class of bug
    // useDeliveryRecheck's cancel() exists to prevent (CLAUDE.md §5.5).
    let alive = true;
    // ⚠️ `dossier: null`, not a spread that keeps it — see the header. The
    // previous patient must leave the pane the instant the rep selects another.
    setState((s) => ({ ...s, dossier: null, loading: true, error: null }));
    fetchDossierItems(num)
      .then((items) => {
        if (!alive) return;
        setState({
          dossier: items.length ? buildDossier(items) : null,
          loading: false,
          error: null,
          configured: true,
        });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState({
          dossier: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          configured: true,
        });
      });
    return () => {
      alive = false;
    };
  }, [phone]);

  return state;
}
