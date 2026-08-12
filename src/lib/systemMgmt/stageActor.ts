/**
 * "Who marked this stage complete?" — asked of the Command Center gateway.
 *
 * Monday can't answer it: every write the SPA makes carries the same Monday API
 * token, so the board's own activity log attributes all of them to one service
 * account. The gateway records the SIGNED-IN email against every mutation
 * (CLAUDE.md §5.1), which makes its audit log the only place the person exists.
 *
 * Server side: `services/monday-gateway/stageActor.mjs`.
 *
 * Two ways this comes back empty, both normal:
 * - **Direct mode** (no `VITE_MONDAY_GATEWAY_URL`) — there is no audit log at
 *   all. `stageActorConfigured()` says so up front, so the caller can skip the
 *   request instead of showing a failure.
 * - **No matching row** — the stage was completed before the gateway existed,
 *   or by hand on the Monday board. The UI must simply omit the name; a
 *   confident wrong email is worse than no email.
 */
const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

export interface StageCompletionActor {
  /** The signed-in email recorded against the write. */
  actor: string;
  /** TRUE only when that email came from a checked Google token. The durable
   *  /send path records no flag, so most real completions are false — it marks
   *  how the attribution was obtained, NOT whether it's plausible. */
  verified: boolean;
  /** When the matched write happened (≈ the completion instant). */
  at: string;
  /** True when the matched row wrote the stage-advancer column itself; false
   *  when the actor was inferred from the writes immediately around it. */
  matchedColumn: boolean;
}

/** Whether an audit log exists to ask. False in direct (no-gateway) builds. */
export function stageActorConfigured(): boolean {
  return !!GATEWAY;
}

/**
 * Who completed `itemId` at `atIso`. `columnId` is the board's completion
 * column, used to pick the exact write rather than a neighbouring one.
 *
 * Never throws: attribution is a nice-to-have on a banner whose real job is to
 * say the stage is finished, so a gateway hiccup must not take that with it.
 */
export async function fetchStageCompletedBy(
  itemId: string,
  atIso: string,
  columnId?: string | null,
): Promise<StageCompletionActor | null> {
  if (!GATEWAY || !itemId || !atIso) return null;
  const params = new URLSearchParams({ item: itemId, at: atIso });
  if (columnId) params.set("column", columnId);

  try {
    const res = await fetch(`${GATEWAY}/audit/stage-completion?${params.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<StageCompletionActor> & { actor?: string | null };
    if (!json?.actor) return null;
    return {
      actor: json.actor,
      verified: json.verified === true,
      at: json.at ?? atIso,
      matchedColumn: json.matchedColumn === true,
    };
  } catch {
    return null;
  }
}
