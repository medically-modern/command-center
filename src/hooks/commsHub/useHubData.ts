/**
 * The Communications Hub's four RingCentral reads, each behind `createRcStore`.
 *
 * Windows and TTLs are chosen per list rather than shared, because what "stale"
 * means differs: an unanswered text is urgent, a fax from Tuesday is not.
 */
import {
  fetchInboundFaxesAll,
  fetchRecentCallActivity,
  fetchRecentMessageActivity,
  fetchVoicemails,
  mmPhoneNumber,
  type InboundFax,
  type VoicemailRecord,
} from "@/lib/fax/ringcentralApi";
import type { RcCallLogRecord } from "@/lib/callHistory/callHistory";
import { buildConversations, type Conversation, type RcConversationRecord } from "@/lib/commsHub/conversations";
import { createRcStore } from "./rcStore";

/** A month of texts. Long enough that a rep scrolling back finds the thread
 *  they half-remember, short enough to stay inside the page cap. */
const TEXT_WINDOW_DAYS = 30;
/** Two weeks of calls — the phone tab is about what happened recently. */
const CALL_WINDOW_DAYS = 14;

/** The inbox is live: a rep watches it for replies. */
const TEXT_TTL_MS = 60_000;
/** Calls, voicemails and faxes arrive far less often than texts. */
const SLOW_TTL_MS = 120_000;

const textStore = createRcStore<Conversation[]>(
  async () =>
    buildConversations((await fetchRecentMessageActivity({ days: TEXT_WINDOW_DAYS })) as RcConversationRecord[], {
      ownNumbers: [mmPhoneNumber()],
    }),
  TEXT_TTL_MS,
);

const callStore = createRcStore<RcCallLogRecord[]>(
  () => fetchRecentCallActivity({ days: CALL_WINDOW_DAYS }),
  SLOW_TTL_MS,
);

const voicemailStore = createRcStore<VoicemailRecord[]>(() => fetchVoicemails({ sinceDays: 30 }), SLOW_TTL_MS);

const faxStore = createRcStore<InboundFax[]>(
  // ⚠️ PAGED. A single `perPage: 50` page silently capped the tab at the newest
  // 50 faxes with nothing to say there were more (Josh, 2026-09-02) — this list
  // has no pager of its own, unlike /fax-inbox.
  () => fetchInboundFaxesAll({ sinceDays: 30 }),
  SLOW_TTL_MS,
);

/** `enabled` is the tab gate — an unopened tab must not poll RingCentral. */
export const useTextInbox = textStore.useStore;
export const useCallLog = callStore.useStore;
export const useVoicemails = voicemailStore.useStore;
export const useFaxList = faxStore.useStore;

/** After a read/unread write, pull the affected list forward rather than
 *  waiting out the TTL. */
export function reloadTexts(): void {
  void textStore.refresh(true);
}
export function reloadVoicemails(): void {
  void voicemailStore.refresh(true);
}
export function reloadFaxes(): void {
  void faxStore.refresh(true);
}
