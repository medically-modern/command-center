/**
 * The Supabase copy of a monday board, through the gateway
 * (`services/monday-gateway/mirrorBoard.mjs`, docs/claude/5.55 *The board page*).
 *
 *     browser --(Google identity)--> gateway --(READ ONLY)--> Supabase monday_mirror
 *
 * The browser never talks to Supabase: the copy is PHI, and its schema has RLS
 * on with no policies, so Supabase's own API hands nothing to anybody.
 *
 * ⚠️ A failed read and an empty board are different answers — `{ok, error}`,
 * the same contract as `fetchCalendlyDay`. "Nobody is on the board" rendered
 * from an outage is a lie on screen.
 */
import { MONDAY_GATEWAY_BASE, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";

export const PROFILE_SEND_OFF_BOARD_ID = "18406352652";

export interface MirrorCell {
  /** monday's own display text. */
  t?: string;
  /** A status cell's label id — the colour lookup. */
  i?: number;
  /** A dropdown cell's label ids. */
  ids?: number[];
  /** A file cell's file count. */
  n?: number;
}

export interface MirrorItem {
  id: string;
  name: string;
  groupId: string;
  createdAt: string | null;
  updatedAt: string | null;
  cells: Record<string, MirrorCell>;
}

export interface MirrorBoard {
  board: { id: string; name: string; itemsOnMonday: number | null; syncedAt: string | null };
  groups: { id: string; title: string; color: string | null }[];
  columns: { id: string; title: string; type: string }[];
  labels: Record<string, Record<string, { label: string; hex: string | null }>>;
  items: MirrorItem[];
}

/**
 * `data` is set exactly when `ok`; `error` exactly when not. A plain shape, not
 * a discriminated union — this repo builds without strictNullChecks, which
 * does not narrow one.
 */
export interface MirrorBoardResult {
  ok: boolean;
  data?: MirrorBoard;
  error?: string;
}

export function mirrorBoardAvailable(): boolean {
  return MONDAY_GATEWAY_BASE.length > 0;
}

export async function fetchMirrorBoard(boardId: string, signal?: AbortSignal): Promise<MirrorBoardResult> {
  if (!mirrorBoardAvailable()) return { ok: false, error: "No gateway is configured in this build." };
  try {
    const res = await fetch(`${MONDAY_GATEWAY_BASE}/mirror/board?board=${encodeURIComponent(boardId)}`, {
      headers: { ...mondayIdentityHeaders() },
      signal,
    });
    const json = (await res.json().catch(() => null)) as (Partial<MirrorBoard> & { ok?: boolean; error?: string }) | null;
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.error || `The Supabase copy could not be read (HTTP ${res.status}).` };
    }
    return {
      ok: true,
      data: {
        board: json.board!,
        groups: json.groups ?? [],
        columns: json.columns ?? [],
        labels: json.labels ?? {},
        items: json.items ?? [],
      },
    };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return { ok: false, error: "The gateway could not be reached." };
  }
}
