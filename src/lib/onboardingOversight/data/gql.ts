/**
 * Read-only GraphQL client for the dashboard (BUILD-SPEC §5.2).
 * WHY a private copy: every CC module owns its gql(); this one refuses mutations before any
 * network call, asks monday for its complexity budget, and pauses when the shared token's
 * budget runs low so the reps' own queues are never starved.
 */
import type { Dict } from "../types";
import { MONDAY_API_URL, mondayAuthHeaders, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";
import { OO_CONFIG } from "../config";

export const READ_ONLY_ERROR = "onboarding-oversight is read-only";
const MUTATION_RE = /\bmutation\b/i;

export interface Complexity { before: number; after: number; reset_in_x_seconds: number }

export class MondayReadError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryInSeconds?: number) { super(message); }
}

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (input, init) => fetch(input, init);
let sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Test seams. */
export function __setGqlTransport(f: FetchLike, sleep?: (ms: number) => Promise<void>) { fetchImpl = f; if (sleep) sleepImpl = sleep; }

let pauseHook: ((msg: string | null) => void) | null = null;
export function onComplexityPause(fn: ((msg: string | null) => void) | null) { pauseHook = fn; }

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (MUTATION_RE.test(query)) throw new Error(READ_ONLY_ERROR);
  let attempt = 0;
  for (;;) {
    attempt++;
    const res = await fetchImpl(MONDAY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...mondayAuthHeaders(), ...mondayIdentityHeaders(), "API-Version": "2024-10" },
      body: JSON.stringify({ query, variables }),
    });
    let json: Dict = null;
    try { json = await res.json(); } catch { /* non-JSON error body */ }
    const errs: Dict[] = json?.errors ?? json?.error_message ? (json.errors ?? [{ message: json.error_message }]) : [];
    const rateLimited = res.status === 429 || errs.some((e) => /complexity|rate limit|budget/i.test(String(e?.message ?? "")));
    if (rateLimited) {
      const retry = Number(errs.find((e) => e?.extensions?.retry_in_seconds)?.extensions?.retry_in_seconds ?? 10);
      if (attempt > 3) throw new MondayReadError("monday rate limit: try again shortly", 429, retry);
      pauseHook?.(`Pausing ${retry}s to protect monday rate limits`);
      await sleepImpl(retry * 1000);
      pauseHook?.(null);
      continue;
    }
    if (!res.ok) throw new MondayReadError(`monday request failed (${res.status})`, res.status);
    if (errs.length) throw new MondayReadError(String(errs[0]?.message ?? "monday error"));
    const c: Complexity | undefined = json?.data?.complexity;
    if (c && c.after < OO_CONFIG.complexityFloor) {
      pauseHook?.("Pausing to protect monday rate limits");
      await sleepImpl(Math.max(1, c.reset_in_x_seconds) * 1000);
      pauseHook?.(null);
    }
    return json.data as T;
  }
}
