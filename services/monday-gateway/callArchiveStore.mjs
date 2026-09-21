/**
 * callArchiveStore.mjs — the bucket half of the call-recording archive.
 *
 * S3-compatible object storage, which on Railway is a Storage Bucket (private,
 * encrypted at rest, running on Tigris). Isolated here so callArchive.mjs holds
 * the job and this holds the only knowledge of how bytes get in and out —
 * the same split as rcAllowlist.mjs beside ringcentral.mjs.
 *
 * ── Why the AWS SDK rather than hand-rolled SigV4 ──────────────────────────
 * Presigned GET is query-string SigV4 and it is perfectly specifiable, but a
 * subtly wrong signature produces a URL that 403s in production and is
 * miserable to debug from a log line. The boring dependency is the right call
 * for something whose failure mode is "the recording will not play and nobody
 * knows why". It costs container size; it buys never writing a canonical
 * request by hand.
 *
 * ── Configuration ──────────────────────────────────────────────────────────
 * Set these on the gateway as Variable References to the bucket's own values,
 * rather than relying on Railway's generic BUCKET / ACCESS_KEY_ID names — those
 * are broad enough to be clobbered by any other integration that wants them,
 * and a silently-rebound credential here means writes going somewhere else.
 *
 *   CALL_ARCHIVE_BUCKET        ← ${{Bucket.BUCKET}}
 *   CALL_ARCHIVE_S3_ENDPOINT   ← ${{Bucket.ENDPOINT}}
 *   CALL_ARCHIVE_S3_REGION     ← ${{Bucket.REGION}}
 *   CALL_ARCHIVE_S3_KEY_ID     ← ${{Bucket.ACCESS_KEY_ID}}
 *   CALL_ARCHIVE_S3_SECRET     ← ${{Bucket.SECRET_ACCESS_KEY}}
 *
 * Optional: CALL_ARCHIVE_S3_FORCE_PATH_STYLE=1. Railway buckets use
 * virtual-hosted-style URLs (bucket as a subdomain), which is the default here;
 * buckets created before that change need path-style, and the bucket's own
 * Credentials tab says which. An endpoint mismatch shows up as a signature
 * error rather than anything that names the cause, so it gets a switch.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.CALL_ARCHIVE_BUCKET || "";
const ENDPOINT = process.env.CALL_ARCHIVE_S3_ENDPOINT || "";
const REGION = process.env.CALL_ARCHIVE_S3_REGION || "auto";
const KEY_ID = process.env.CALL_ARCHIVE_S3_KEY_ID || "";
const SECRET = process.env.CALL_ARCHIVE_S3_SECRET || "";
const FORCE_PATH_STYLE = process.env.CALL_ARCHIVE_S3_FORCE_PATH_STYLE === "1";

/** Every piece, or none. A half-configured store is the shape that writes to a
 *  default AWS endpoint by accident. */
export function storeConfigured() {
  return Boolean(BUCKET && ENDPOINT && KEY_ID && SECRET);
}

export function storeName() {
  return BUCKET;
}

let _client = null;
function client() {
  if (!storeConfigured()) throw new Error("Call archive object store is not configured (CALL_ARCHIVE_* env vars).");
  if (!_client) {
    _client = new S3Client({
      region: REGION,
      endpoint: ENDPOINT,
      forcePathStyle: FORCE_PATH_STYLE,
      credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
    });
  }
  return _client;
}

/**
 * Write one object.
 *
 * ⚠️ Idempotent by KEY, and the key is derived from the call id + recording id
 * (`callArchiveRules.objectKey`), so re-archiving the same recording overwrites
 * itself rather than growing a duplicate. That is what lets a run be retried,
 * interrupted and retried again without anybody reconciling the bucket.
 */
export async function putObject({ key, body, contentType }) {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    }),
  );
  return { key, bytes: body?.length ?? 0 };
}

/** Bytes back out, for the proxy path. Returns a Node readable stream. */
export async function getObjectStream(key) {
  const out = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return { body: out.Body, contentType: out.ContentType, bytes: Number(out.ContentLength ?? 0) };
}

/** Does the object actually exist? Used to verify a write rather than trust it. */
export async function objectExists(key) {
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * A time-limited URL that fetches the object directly from the bucket.
 *
 * ⚠️⚠️ THIS URL IS A BEARER CREDENTIAL FOR PHI. Anyone holding it can fetch a
 * patient's recorded call, with no sign-in, until it expires — so it is issued
 * only behind the caller check in callArchive.mjs, every issuance is written to
 * `call_archive_access`, and the lifetime is minutes rather than hours
 * (`URL_TTL_SECONDS`, capped at an hour by the rules module).
 *
 * `ResponseContentDisposition` is what makes a cross-origin download land with
 * a sensible filename — an `<a download>` attribute is ignored cross-origin, so
 * without this the browser saves the object key's last segment.
 */
export async function presignGet({ key, expiresIn, filename, contentType }) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(filename
      ? { ResponseContentDisposition: `attachment; filename="${String(filename).replace(/["\\]/g, "")}"` }
      : {}),
    ...(contentType ? { ResponseContentType: contentType } : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn: Math.max(30, Number(expiresIn) || 300) });
}
