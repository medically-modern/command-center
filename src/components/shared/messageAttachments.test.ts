/**
 * The MMS archive fallback (§5.47c). RingCentral purges MMS bytes at ~30 days
 * while the message row survives, and the SMS archive serves those older
 * messages back into threads — so without the fallback every photo on an older
 * thread reads "attachment couldn't load" while the bytes sit in our bucket.
 * The failure is silent in CI (no test fetches real media), so the key rules
 * are pinned here as source scans, the listColumns.test.ts convention.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { archiveIds } from "./MessageAttachments";
import type { MessageAttachment } from "@/lib/assignedPatients/messagingApi";

const src = readFileSync("src/components/shared/MessageAttachments.tsx", "utf8");

const att = (over: Partial<MessageAttachment> = {}): MessageAttachment => ({
  id: 777,
  contentType: "image/jpeg",
  uri: "https://media.ringcentral.com/restapi/v1.0/account/1/extension/2/message-store/123456/content/777",
  ...over,
});

describe("archiveIds — the archive's key, read off the attachment", () => {
  it("reads the message id from the uri's documented shape", () => {
    expect(archiveIds(att())).toEqual({ messageId: "123456", attachmentId: "777" });
  });

  // The server prefers the payload's own id and falls back to the uri's last
  // path segment (mmsArchiveRules, §5.47c) — this must key the same way, or a
  // photo the archive holds under one id is asked for under another.
  it("falls back to the uri's last segment when the payload carries no id", () => {
    const a = att({ id: undefined as unknown as number });
    expect(archiveIds(a)).toEqual({ messageId: "123456", attachmentId: "777" });
  });

  it("survives a query string on the uri", () => {
    const a = att({ uri: att().uri + "?contentDisposition=Attachment" });
    expect(archiveIds(a)?.messageId).toBe("123456");
  });

  // A uri that matches nothing keeps the RingCentral error rather than asking
  // the archive a question it cannot key.
  it("returns null for a uri in no known shape", () => {
    expect(archiveIds(att({ uri: "https://example.com/whatever" }))).toBeNull();
    expect(archiveIds(att({ uri: "" }))).toBeNull();
  });
});

describe("the fallback's load-bearing rules stay in the source", () => {
  it("asks the MMS archive when RingCentral fails", () => {
    // The fallback lives in the shared loader's catch — remove it and every
    // photo older than ~30 days silently dies again.
    expect(src).toMatch(/archivedMediaUrl\("photo"/);
    expect(src).toMatch(/catch \(rcErr\)/);
  });

  // ⚠️ A presigned archive link dies in minutes (§5.47), so caching one hands
  // a later click a dead URL; only blob: URLs may be kept or revoked.
  it("never caches a presigned URL — only blob: URLs reach urlRef", () => {
    expect(src).toMatch(/if \(r\.blob\) urlRef\.current = r\.url/);
    expect(src).toMatch(/if \(blob\) urlRef\.current = url/);
    expect(src).not.toMatch(/urlRef\.current = await archivedMediaUrl/);
  });

  // ⚠️ The presigned URL is a bare src, never fetch()ed — a browser following
  // the bucket's cross-origin redirect with fetch needs CORS the bucket cannot
  // set (§5.47). fetch() here may only ever go through the /rc/fetch proxy.
  it("never fetch()es the archive URL", () => {
    expect(src).not.toMatch(/fetch\(\s*await archivedMediaUrl/);
    expect(src).not.toMatch(/fetchRcContentBlobUrl\(\s*await archivedMediaUrl/);
  });
});
