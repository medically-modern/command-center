/**
 * The card photo — large — with the carrier and the member ID beside it.
 *
 * Brandon, 2026-09-22: *"When i click photo upload, i should be able to see the
 * photo, but also then assign a general insurance from a drop-down"*. Josh,
 * 2026-09-23: *"click it, it opens the photo, we select an insurance from the
 * drop down of general insurance, it writes to monday only the general
 * insurance, doesnt run a stedi check, this is just an ease of access thing"*.
 * Brandon, 2026-09-24: *"let's also have them enter the member ID too (as
 * optional) — is there a way where we can see the photo in larger size, while
 * also have the drop-down for insurance and member ID available so it's easy to
 * just read the card and type in the member ID? … put it in, not run the
 * check"*.
 *
 * ⚠️ **ONE dialog rather than the global file viewer plus a picker somewhere
 * else.** `openFileViewer` is a full-screen modal, so a field on the card
 * underneath it would be covered at exactly the moment the coordinator is
 * reading off the photo. The photo is therefore as large as the dialog allows,
 * with the two fields BESIDE it, and a click on the photo zooms it in place so
 * a small member ID can be read without leaving the fields.
 *
 * ⚠️ **The image is tried first and falls back, never sniffed by filename.**
 * These files are whatever a patient's phone uploaded — jpg and png mostly, but
 * HEIC and the odd PDF reach the column too, and a name-based guess renders a
 * broken-image icon for them with nothing saying why. `<img onError>` is the
 * only test that is true of the actual bytes; the fallback hands the file to
 * the shared viewer, which has pdf.js and the worker proxy behind it (§5.5).
 *
 * ⚠️ **A patient who CHOSE the photo and never sent one still opens this**
 * (Brandon, 2026-09-24: *"why can't we click into the photo of the card for Ann
 * Hawkins?"*). She answered the form's insurance step with "Photo of card" on
 * 2026-09-13 and no file ever reached her row, so the pill said "Photo upload"
 * and pressed nothing. The dialog now says exactly that, names the button that
 * texts her an upload link, and still takes a carrier and member ID for a
 * coordinator who has them another way.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { useBoardLabels } from "@/hooks/profile/useBoardLabels";
import { INSURANCE_LABEL_COLUMN_IDS } from "@/lib/profile/boardLabels";
import { assignFromCard, carrierOptions, cardWritePlan } from "@/lib/careCoordinator/carrierAssign";
import { fetchCardDialogData, type CardPhoto } from "@/lib/careCoordinator/mondayApi";
import { cn } from "@/lib/utils";

export interface InsuranceCardTarget {
  itemId: string;
  name: string;
  /** The carrier the board holds right now — blank for most of this
   *  population, which is the whole reason the dialog exists. */
  carrier: string;
  /**
   * A file is on the Insurance Card Photo column. False for a patient who
   * answered "Photo of card" and never sent one — the dialog then says so
   * rather than reporting a card that "is no longer on the row", which would
   * claim there had ever been one.
   */
  hasPhoto: boolean;
}

export function InsuranceCardDialog({ target, onClose, onSaved }: {
  /** Null when nothing is open. Keyed on the patient by the caller, so a
   *  half-made selection can never survive a change of patient (§9). */
  target: InsuranceCardTarget | null;
  onClose: () => void;
  /** Fired with the carrier that landed, so the column can show it at once
   *  rather than waiting on the 60s poll. Not fired for a member-ID-only save:
   *  nothing on the card shows the member ID. */
  onSaved: (itemId: string, carrier: string) => void;
}) {
  const { optionsFor, index } = useBoardLabels(INSURANCE_LABEL_COLUMN_IDS);
  const options = carrierOptions(optionsFor);

  const [photo, setPhoto] = useState<CardPhoto | null>(null);
  const [readError, setReadError] = useState("");
  const [imgFailed, setImgFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  /** Degrees clockwise — a card photographed upside down or sideways
   *  (Brandon, 2026-09-29: "sometimes cards come in backwards"). View only:
   *  nothing is written, the file on the row is untouched. */
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [memberId, setMemberId] = useState("");
  /** What the board held when the dialog opened — what "changed" means. */
  const [boardMemberId, setBoardMemberId] = useState("");
  const [saving, setSaving] = useState(false);
  /** The coordinator has typed in the Member ID box, so a late read must not
   *  overwrite it. */
  const memberTouched = useRef(false);

  const itemId = target?.itemId ?? "";

  // Seed from the board every time a different patient opens. ⚠️ Keyed on the
  // item, not on `target` — the page re-creates that object on every poll, and
  // a re-seed there would wipe a selection the coordinator had just made
  // underneath them.
  useEffect(() => { setCarrier(target?.carrier?.trim() ?? ""); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Resolve the signed photo URL and the member ID on file when the dialog
   * opens — one read (`fetchCardDialogData`).
   *
   * ⚠️ On OPEN, never on render — this is a monday read per patient, and the
   * column it sits in already spends four paged reads on ~1,754 rows (§5.30).
   * ⚠️ The URL is signed and expires in an hour, so it cannot be carried on the
   * list row even if that were free: a coordinator with the page open would
   * click a dead link (§5.30f, the `protected_static` note).
   */
  const want = useRef("");
  useEffect(() => {
    setPhoto(null); setReadError(""); setImgFailed(false); setZoomed(false); setRotation(0);
    setMemberId(""); setBoardMemberId(""); memberTouched.current = false;
    if (!itemId) return;
    want.current = itemId;
    setLoading(true);
    fetchCardDialogData(itemId)
      .then(({ photo: p, memberId: onFile }) => {
        // A slower answer for a patient the coordinator has already navigated
        // away from must not paint over the open one.
        if (want.current !== itemId) return;
        setPhoto(p);
        setBoardMemberId(onFile);
        if (!memberTouched.current) setMemberId(onFile);
      })
      .catch((e) => {
        if (want.current !== itemId) return;
        setReadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (want.current === itemId) setLoading(false); });
  }, [itemId]);

  if (!target) return null;

  const plan = cardWritePlan(
    { carrier, memberId, boardCarrier: target.carrier ?? "", boardMemberId },
    index,
  );
  const picked = carrier.trim();
  // ⚠️ A carrier the board already holds but the picker does not offer is still
  // shown, or the select would render blank over a real value and read as
  // "nobody has set this" (the `withCurrentSelection` rule, §5.31b).
  const list = picked && !options.includes(picked) ? [picked, ...options] : options;

  async function save() {
    if (!target) return;
    setSaving(true);
    try {
      const done = await assignFromCard(target.itemId, {
        carrier, memberId, boardCarrier: target.carrier ?? "", boardMemberId,
      });
      const what = [done.carrier && `insurance ${done.carrier}`, done.memberId && `member ID ${done.memberId}`]
        .filter(Boolean).join(" and ");
      toast.success(`${target.name}: saved ${what}. No benefits check was run.`);
      if (done.carrier) onSaved(target.itemId, done.carrier);
      onClose();
    } catch (e) {
      // ⚠️ The dialog STAYS OPEN on a failure, holding what they entered. The
      // answers are on a photo they are looking at right now; closing would
      // make them find the patient and open the card again to retype them.
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const noPhoto = !loading && !readError && !photo;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Insurance card — {target.name}</DialogTitle>
          <DialogDescription>
            Read the carrier and member ID off the card and record them. This saves
            General Insurance and the Member ID and nothing else — it does not run a
            benefits check. Run that from the patient's profile.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
          {/* ── The card, as large as the dialog allows ─────────────── */}
          <div className="flex min-h-[16rem] flex-col rounded-lg border bg-muted/40 p-2">
            {loading && (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Opening the card…
              </div>
            )}
            {!loading && readError && (
              <p className="m-auto px-2 py-6 text-center text-sm text-destructive">
                Couldn't open the card: {readError}
              </p>
            )}
            {noPhoto && !target.hasPhoto && (
              <div className="m-auto max-w-md space-y-2 px-3 py-6 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> No photo came through
                </p>
                <p className="text-muted-foreground">
                  {target.name} chose to send a photo of their insurance card on the web
                  form, but no photo ever reached their row. <b>Start Insurance
                  Follow-Up</b> on their profile texts them a link to upload it.
                </p>
                <p className="text-muted-foreground">
                  If you have the carrier and member ID another way, you can still record
                  them here.
                </p>
              </div>
            )}
            {noPhoto && target.hasPhoto && (
              <p className="m-auto px-2 py-6 text-center text-sm text-destructive">
                That insurance card is no longer on the patient's row.
              </p>
            )}
            {!loading && photo && !imgFailed && rotation !== 0 && (
              <RotatedCard
                src={photo.url}
                alt={`Insurance card for ${target.name}`}
                rotation={rotation}
                zoomed={zoomed}
                onToggleZoom={() => setZoomed((z) => !z)}
                onError={() => setImgFailed(true)}
              />
            )}
            {!loading && photo && !imgFailed && rotation === 0 && (
              // ⚠️ A click ZOOMS in place — the fields stay beside it, which is
              // the point of this being one dialog. Zoomed, the image keeps its
              // natural size and the frame scrolls.
              <div className={cn("flex-1", zoomed ? "max-h-[68vh] overflow-auto" : "flex items-center justify-center")}>
                <img
                  src={photo.url}
                  alt={`Insurance card for ${target.name}`}
                  onClick={() => setZoomed((z) => !z)}
                  title={zoomed ? "Click to fit" : "Click to zoom in"}
                  className={cn(
                    "rounded",
                    zoomed ? "max-w-none cursor-zoom-out" : "max-h-[64vh] w-full cursor-zoom-in object-contain",
                  )}
                  onError={() => setImgFailed(true)}
                />
              </div>
            )}
            {!loading && photo && imgFailed && (
              <p className="m-auto px-2 py-6 text-center text-sm text-muted-foreground">
                This file can't be shown here — open it in the viewer.
              </p>
            )}
            {!loading && photo && (
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {!imgFailed && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setZoomed((z) => !z)}>
                    {zoomed
                      ? <><ZoomOut className="mr-1.5 h-3.5 w-3.5" />Fit</>
                      : <><ZoomIn className="mr-1.5 h-3.5 w-3.5" />Zoom in</>}
                  </Button>
                )}
                {!imgFailed && (
                  <>
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => setRotation((r) => (r + 270) % 360)}
                      title="Rotate left" aria-label="Rotate left"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => setRotation((r) => (r + 90) % 360)}
                      title="Rotate right" aria-label="Rotate right"
                    >
                      <RotateCw className="mr-1.5 h-3.5 w-3.5" />Rotate
                    </Button>
                  </>
                )}
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => openFileViewer({ url: photo.url, name: `Insurance card — ${target.name}` })}
                >
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  {imgFailed ? "Open the file" : "Open full size"}
                </Button>
              </div>
            )}
          </div>

          {/* ── What is read off it ─────────────────────────────────── */}
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!saving && !loading && !plan.nothing && !plan.refusal) void save();
            }}
          >
            <label className="block text-sm">
              <span className="mb-1 block font-medium">General Insurance</span>
              <select
                value={picked}
                disabled={saving}
                onChange={(e) => setCarrier(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <option value="">Not set</option>
                {list.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Member ID <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <input
                type="text"
                value={memberId}
                disabled={saving}
                autoComplete="off"
                spellCheck={false}
                placeholder={loading ? "Checking what's on file…" : "As printed on the card"}
                onChange={(e) => { memberTouched.current = true; setMemberId(e.target.value); }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm tracking-wide ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
              {plan.keptMemberId && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  Left blank, the member ID on file (<span className="font-mono">{boardMemberId}</span>) stays
                  as it is. Remove it from the patient's profile if it's wrong.
                </span>
              )}
            </label>

            {plan.refusal && <p className="text-sm text-destructive">{plan.refusal}</p>}

            <div className="mt-auto flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || loading || plan.nothing || !!plan.refusal}>
                {saving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Saving…</> : "Save"}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The card photo turned by `rotation` (90, 180 or 270), sized from the image's
 * OWN dimensions so a sideways card fits the frame exactly as an upright one
 * does. ⚠️ A bare CSS `rotate()` turns the picture but not its layout box, so
 * a portrait-shot card turned 90° spilled over the fields beside it. Fit: as
 * large as the frame's width and 64vh allow. Zoomed: natural size, the frame
 * scrolls — the same two sizes the upright photo has.
 */
function RotatedCard({ src, alt, rotation, zoomed, onToggleZoom, onError }: {
  src: string;
  alt: string;
  rotation: number;
  zoomed: boolean;
  onToggleZoom: () => void;
  onError: () => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [frameW, setFrameW] = useState(0);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    setFrameW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sideways = rotation === 90 || rotation === 270;
  const box = natural
    ? (() => {
        const vw = sideways ? natural.h : natural.w;
        const vh = sideways ? natural.w : natural.h;
        const maxH = (typeof window !== "undefined" ? window.innerHeight : 800) * 0.64;
        const scale = zoomed ? 1 : Math.max(0.05, Math.min(frameW > 0 ? frameW / vw : 1, maxH / vh));
        return { w: vw * scale, h: vh * scale, imgW: natural.w * scale, imgH: natural.h * scale };
      })()
    : null;

  return (
    <div
      ref={frame}
      className={cn("flex-1", zoomed ? "max-h-[68vh] overflow-auto" : "flex items-center justify-center")}
      data-card-rotation={rotation}
    >
      <div
        className="relative mx-auto shrink-0"
        style={box ? { width: box.w, height: box.h } : { width: 1, height: 1 }}
      >
        <img
          src={src}
          alt={alt}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={onError}
          onClick={onToggleZoom}
          title={zoomed ? "Click to fit" : "Click to zoom in"}
          className={cn("absolute left-1/2 top-1/2 max-w-none rounded", zoomed ? "cursor-zoom-out" : "cursor-zoom-in")}
          style={{
            width: box?.imgW,
            height: box?.imgH,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            visibility: box ? "visible" : "hidden",
          }}
        />
      </div>
    </div>
  );
}
