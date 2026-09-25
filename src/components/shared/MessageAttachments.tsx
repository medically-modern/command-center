/**
 * The media a text message carried — the photo a patient sent back, a PDF,
 * whatever rode the MMS. Photos render inline in the bubble; anything else
 * gets an open button.
 *
 * MMS bytes live on media.ringcentral.com behind the RC bearer token, so the
 * browser can't point an <img src> at them: each attachment is fetched through
 * the gateway's /rc/fetch proxy — the same allowlisted
 * /message-store/{id}/content/{attachmentId} shape fax pages use — and shown
 * from a blob URL. Rendered by every conversation view (IntakeMessages,
 * ConversationThread, mmKit's TextCompose), so a photo shows up the same
 * wherever the thread is read.
 *
 * ⚠️ RingCentral PURGES the bytes at ~30 days while the message row survives
 * (§5.47c), so on an older thread — which the SMS archive now serves back into
 * /messaging/conversation — the RC fetch 404s for a photo we still hold. The
 * fallback asks the MMS archive (/mms/media, §5.47c) for a presigned URL,
 * which is used as a bare <img src> and NEVER fetch()ed: a browser following
 * the bucket's cross-origin redirect with fetch needs CORS the bucket cannot
 * set (§5.47). A presigned link dies in minutes, so it is never cached — the
 * open-in-tab path mints a fresh one per click — and only blob: URLs are
 * revoked.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { fetchRcContentBlobUrl } from "@/lib/fax/ringcentralApi";
import { archivedMediaUrl } from "@/lib/commsInbox/api";
import type { MessageAttachment } from "@/lib/assignedPatients/messagingApi";

function extFor(contentType: string): string {
  const sub = (contentType.split("/")[1] ?? "").toLowerCase();
  return sub ? sub.replace("jpeg", "jpg") : "file";
}

/**
 * The archive's key for this attachment, read off the uri's own documented
 * shape. The last path segment IS the attachment id for that shape — the same
 * fallback the archive itself keys on (mmsArchiveRules, §5.47c) — with the
 * attachment's `id` preferred where the payload carries one, exactly as the
 * server prefers it. A uri that matches nothing returns null and the caller
 * keeps the RingCentral error.
 */
export function archiveIds(a: MessageAttachment): { messageId: string; attachmentId: string } | null {
  const m = /\/message-store\/(\d+)\/content\/([^/?#]+)/.exec(a.uri || "");
  if (!m) return null;
  return { messageId: m[1], attachmentId: a.id != null ? String(a.id) : m[2] };
}

function Attachment({ a }: { a: MessageAttachment }) {
  const isImage = /^image\//i.test(a.contentType);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  // blob: URLs only — a presigned archive link is never cached (it expires)
  // and never revoked (revokeObjectURL on a non-blob URL is a silent no-op,
  // but caching one would hand a click a dead link minutes later).
  const urlRef = useRef<string | null>(null);

  /** RingCentral first (free, and it has everything under ~30 days), the MMS
   *  archive second. Throws only when both are out of answers. */
  const load = async (): Promise<{ url: string; blob: boolean }> => {
    try {
      return { url: await fetchRcContentBlobUrl(a.uri), blob: true };
    } catch (rcErr) {
      const ids = archiveIds(a);
      if (!ids) throw rcErr;
      return { url: await archivedMediaUrl("photo", ids), blob: false };
    }
  };

  // Images load eagerly — they ARE the message. Other types wait for a click.
  useEffect(() => {
    if (!isImage) return;
    let alive = true;
    load()
      .then(({ url, blob }) => {
        if (!alive) { if (blob) URL.revokeObjectURL(url); return; }
        if (blob) urlRef.current = url;
        setSrc(url);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
    // load reads only a.uri / a.id, both covered by a.uri's identity here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.uri, isImage]);

  const openBlob = async () => {
    setOpening(true);
    try {
      let u = urlRef.current;
      if (!u) {
        const r = await load();
        if (r.blob) urlRef.current = r.url;
        u = r.url;
      }
      window.open(u, "_blank", "noopener");
    } catch {
      setFailed(true);
    } finally {
      setOpening(false);
    }
  };

  if (failed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-black/10 px-2 py-1 text-[11px] opacity-80">
        <Paperclip className="h-3 w-3" /> attachment couldn&apos;t load
      </span>
    );
  }

  if (isImage) {
    return src ? (
      <img
        src={src}
        alt="Texted attachment"
        onClick={() => void openBlob()}
        className="max-h-56 max-w-full cursor-zoom-in rounded-lg border border-black/10"
      />
    ) : (
      <span className="inline-flex h-24 w-32 items-center justify-center rounded-lg bg-black/10">
        <Loader2 className="h-4 w-4 animate-spin opacity-70" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openBlob()}
      disabled={opening}
      className="inline-flex items-center gap-1.5 rounded-md bg-black/10 px-2 py-1 text-[12px] font-medium hover:bg-black/20"
    >
      {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
      Open {extFor(a.contentType)}
    </button>
  );
}

export function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <div className="mt-1.5 flex flex-col items-start gap-1.5">
      {attachments.map((a) => <Attachment key={a.id} a={a} />)}
    </div>
  );
}
