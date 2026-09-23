import type { InboxKind } from "@/lib/commsInbox/rules";

/** The coloured left edge of a list row, by what opened it — a text blue, a
 *  missed call orange, a voicemail purple (Brandon's mockup). */
export const KIND_EDGE: Record<InboxKind, string> = {
  text: "border-l-sky-500",
  missed: "border-l-orange-500",
  voicemail: "border-l-violet-500",
};
