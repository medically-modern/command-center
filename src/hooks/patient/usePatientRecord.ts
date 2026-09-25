/**
 * One patient's whole cross-board record, for the patient screen (§5.39).
 *
 * This is a THIN wrapper over the Comms Hub's dossier, deliberately: that
 * module already answers "every board record for this human", already runs the
 * two passes a completed record needs (§5.28), already guards identity
 * (`nameMatchAccepted`), and already caches per session. Re-implementing any of
 * it here would be a second opinion on who a patient is.
 *
 * ⚠️ **Keyed on the ITEM the caller navigated to, never on a phone number.**
 * The screen is opened from a Search row, a Comms Hub match or a stage page, and
 * in every one of those the rep has already picked a record. `fetchDossierItems
 * ForPick` admits that record unconditionally and finds the rest of the trail
 * through its OWN number — the same rule `DossierSearch` uses, and the reason a
 * patient whose line is shared (18 of 3,140 numbers, §5.28) opens on the person
 * who was picked rather than on whoever wins the default ordering.
 *
 * ⚠️ **Fetched ON OPEN, never on a timer** (Josh, 2026-09-18). Every guard
 * INCIDENT_2026-08-20 asks for: module-scope cache inside `dossierApi`, one
 * in-flight request per item, a `want` ref so a slow answer cannot paint the
 * previous patient's record onto the open one, and a FAILURE that is not cached
 * so re-opening retries (§5.28's `fetchDirectoryNames` lesson). There is no
 * poll: this screen is a reference view, and a rep who wants fresh data
 * reloads.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { buildDossier, type PatientDossier } from "@/lib/commsHub/dossier";
import {
  dossierConfigured,
  fetchDossierItemsForPick,
  type DossierPick,
} from "@/lib/commsHub/dossierApi";

export interface PatientRecordState {
  dossier: PatientDossier | null;
  loading: boolean;
  error: string | null;
  /** Monday is reachable at all. False in a build with no gateway and no token. */
  configured: boolean;
  /** Re-read this patient, discarding the session cache for them. */
  reload: () => void;
}

export function usePatientRecord(pick: DossierPick | null): PatientRecordState {
  const [dossier, setDossier] = useState<PatientDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  /** The item this render is for. A slow answer for a PREVIOUS patient must be
   *  dropped rather than painted — the screen's every deep link and the header
   *  itself read from `dossier`, so a stale one is another patient's chart. */
  const want = useRef<string>("");

  const key = pick ? `${pick.boardId}:${pick.itemId}` : "";

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    want.current = key;
    if (!pick || !key) {
      setDossier(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!dossierConfigured()) {
      setDossier(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Clearing FIRST is the §5.28 rule, and it is correctness rather than
    // polish: everything on this screen — the name, the Open links, the notes —
    // is derived from `dossier`, so holding the previous patient while the next
    // one loads puts one person's chart under another person's header.
    setDossier(null);
    setError(null);
    setLoading(true);

    let cancelled = false;
    fetchDossierItemsForPick(pick, {
      /* ⚠️ The picked record paints the moment its by-id read lands — the
         phone and name passes that chase the REST of the trail are two more
         sequential round trips, and the rep clicked a specific record they
         can be reading meanwhile (2026-09-25). Same data, same final answer:
         the full trail replaces this a moment later, `loading` stays true
         until it does, and the same `want`/`cancelled` guards keep a slow
         partial off the next patient's screen. */
      onPartial: (items) => {
        if (cancelled || want.current !== key) return;
        setDossier((cur) => cur ?? (items.length ? buildDossier(items) : null));
      },
    })
      .then((items) => {
        if (cancelled || want.current !== key) return;
        setDossier(items.length ? buildDossier(items) : null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled || want.current !== key) return;
        // NOT cached by `dossierApi` on the failure path, so re-opening the
        // patient asks again instead of pinning the screen blank for the session.
        setError(e instanceof Error ? e.message : "Couldn't load this patient");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `pick` is rebuilt per render by the page, so the dependency is the KEY
    // string — incident rule 2. `nonce` is the Reload button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { dossier, loading, error, configured: dossierConfigured(), reload };
}
