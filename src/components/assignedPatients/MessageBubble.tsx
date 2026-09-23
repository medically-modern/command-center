/**
 * One text as a bubble — shared by the conversation thread and the
 * Communications inbox's timeline, so a text reads the same wherever it is
 * shown and the delivery-failure note (CLAUDE.md §5.5) is drawn by one
 * component in both.
 */
import type { ReactNode } from "react";
import { MessageAttachments } from "@/components/shared/MessageAttachments";
import SmsDeliveryNote from "@/components/shared/SmsDeliveryNote";
import type { MessageAttachment } from "@/lib/assignedPatients/messagingApi";
import { senderColor, senderName } from "@/lib/assignedPatients/format";
import { cn } from "@/lib/utils";

export interface BubbleMessage {
  direction: "Inbound" | "Outbound";
  text: string;
  /** ISO string or epoch ms. */
  time: string | number;
  sentBy?: string;
  attachments?: MessageAttachment[];
  messageStatus?: string;
  deliveryError?: string;
}

export default function MessageBubble({
  m,
  attachments,
  meta,
  timeLabel,
}: {
  m: BubbleMessage;
  /** Replaces the default attachment renderer — the inbox plays archived
   *  photos from our bucket first (§5.47c). */
  attachments?: ReactNode;
  /** Extra text after the time, e.g. which of the patient's numbers. */
  meta?: string;
  /** Replaces the default time — the inbox timeline writes every row, calls
   *  and texts alike, as Eastern "Sep 22 · 5:21 PM" (§5.15), so a text and the
   *  call beside it are read on one clock. Absent, the bubble is unchanged. */
  timeLabel?: string;
}) {
  const out = m.direction === "Outbound";
  const when = m.time ? new Date(m.time) : null;
  return (
    <div className={cn("flex flex-col", out ? "items-end" : "items-start")}>
      {/* Sender name ABOVE the bubble, and the bubble tinted per sender,
          so a long thread can be scanned for "who sent what" without
          reading every label. Colour is derived from the email, so one
          person is the same colour everywhere. */}
      {out && m.sentBy && (
        <span className="text-[10px] font-medium text-muted-foreground mb-0.5 mr-1">{senderName(m.sentBy)}</span>
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          !out
            ? "bg-card border border-border"
            : m.sentBy
              ? `${senderColor(m.sentBy)} text-white`
              : "bg-primary text-primary-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
        {attachments ?? <MessageAttachments attachments={m.attachments} />}
        <p className={cn("text-[10px] mt-0.5", out ? "text-white/70" : "text-muted-foreground")}>
          {timeLabel ??
            (when && Number.isFinite(when.getTime())
              ? when.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
              : "")}
          {meta ? ` · ${meta}` : ""}
          {/* Sends made outside the Command Center (or before this
              tracking existed) have no sender on record — say so rather
              than leaving the reader to guess. */}
          {out && !m.sentBy ? " · sent outside Command Center" : ""}
        </p>
      </div>
      {/* A text RingCentral could not deliver. Outside the bubble on
          purpose: inside a sender-tinted bubble the red is unreadable,
          and this is the one line in the thread a rep has to act on. */}
      <SmsDeliveryNote
        direction={m.direction}
        messageStatus={m.messageStatus}
        deliveryError={m.deliveryError}
        className="max-w-[75%]"
      />
    </div>
  );
}
