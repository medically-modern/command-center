/**
 * The card photo, and the carrier picker beside it.
 *
 * Brandon, 2026-09-22: *"When i click photo upload, i should be able to see the
 * photo, but also then assign a general insurance from a drop-down"*. Josh,
 * 2026-09-23: *"click it, it opens the photo, we select an insurance from the
 * drop down of general insurance, it writes to monday only the general
 * insurance, doesnt run a stedi check, this is just an ease of access thing"*.
 *
 * ⚠️ **ONE dialog rather than the global file viewer plus a picker somewhere
 * else.** `openFileViewer` is a full-screen modal, so a dropdown on the card
 * underneath it would be covered at exactly the moment the coordinator is
 * reading the carrier off the photo — they would close the photo, lose it, and
 * have to reopen it to check. The two belong on one surface because they are
 * one action.
 *
 * ⚠️ **The image is tried first and falls back, never sniffed by filename.**
 * These files are whatever a patient's phone uploaded — jpg and png mostly, but
 * HEIC and the odd PDF reach the column too, and a name-based guess renders a
 * broken-image icon for them with nothing saying why. `<img onError>` is the
 * only test that is true of the actual bytes; the fallback hands the file to
 * the shared viewer, which has pdf.js and the worker proxy behind it (§5.5).
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { useBoardLabels } from "@/hooks/profile/useBoardLabels";
import { INSURANCE_LABEL_COLUMN_IDS } from "@/lib/profile/boardLabels";
import {
  assignGeneralInsurance, carrierOptions, carrierWriteRefusal,
} from "@/lib/careCoordinator/carrierAssign";
import { fetchInsuranceCardAsset } from "@/lib/careCoordinator/mondayApi";

export interface InsuranceCardTarget {
  itemId: string;
  name: string;
  /** The carrier the board holds right now — blank for most of this
   *  population, which is the whole reason the dialog exists. */
  carrier: string;
}

export function InsuranceCardDialog({ target, onClose, onSaved }: {
  /** Null when nothing is open. Keyed on the patient by the caller, so a
   *  half-made selection can never survive a change of patient (§9). */
  target: InsuranceCardTarget | null;
  onClose: () => void;
  /** Fired with the carrier that landed, so the column can show it at once
   *  rather than waiting on the 60s poll. */
  onSaved: (itemId: string, carrier: string) => void;
}) {
  const { optionsFor, index } = useBoardLabels(INSURANCE_LABEL_COLUMN_IDS);
  const options = carrierOptions(optionsFor);

  const [photo, setPhoto] = useState<{ url: string; name: string } | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [imgFailed, setImgFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [saving, setSaving] = useState(false);

  const itemId = target?.itemId ?? "";

  // Seed from the board every time a different patient opens. ⚠️ Keyed on the
  // item, not on `target` — the page re-creates that object on every poll, and
  // a re-seed there would wipe a selection the coordinator had just made
  // underneath them.
  useEffect(() => { setCarrier(target?.carrier?.trim() ?? ""); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Resolve the signed URL when the dialog opens.
   *
   * ⚠️ On OPEN, never on render — this is a monday read per patient, and the
   * column it sits in already spends four paged reads on ~1,754 rows (§5.30).
   * ⚠️ The URL is signed and expires in an hour, so it cannot be carried on the
   * list row even if that were free: a coordinator with the page open would
   * click a dead link (§5.30f, the `protected_static` note).
   */
  const want = useRef("");
  useEffect(() => {
    setPhoto(null); setPhotoError(""); setImgFailed(false);
    if (!itemId) return;
    want.current = itemId;
    setLoading(true);
    fetchInsuranceCardAsset(itemId)
      .then((p) => {
        // A slower answer for a patient the coordinator has already navigated
        // away from must not paint over the open one.
        if (want.current !== itemId) return;
        if (!p) setPhotoError("That insurance card is no longer on the patient's row.");
        else setPhoto(p);
      })
      .catch((e) => {
        if (want.current !== itemId) return;
        setPhotoError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (want.current === itemId) setLoading(false); });
  }, [itemId]);

  if (!target) return null;

  const picked = carrier.trim();
  const refusal = picked ? carrierWriteRefusal(picked, index) : "";
  const unchanged = picked === (target.carrier ?? "").trim();
  // ⚠️ A carrier the board already holds but the picker does not offer is still
  // shown, or the select would render blank over a real value and read as
  // "nobody has set this" (the `withCurrentSelection` rule, §5.31b).
  const list = picked && !options.includes(picked) ? [picked, ...options] : options;

  async function save() {
    setSaving(true);
    try {
      await assignGeneralInsurance(target!.itemId, picked);
      toast.success(`${target!.name}: insurance set to ${picked}.`);
      onSaved(target!.itemId, picked);
      onClose();
    } catch (e) {
      // ⚠️ The dialog STAYS OPEN on a failure, holding what they picked. The
      // carrier is on a photo they are looking at right now; closing would make
      // them find the patient and open the card again to retype it.
      toast.error(`Couldn't save the insurance: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Insurance card — {target.name}</DialogTitle>
          <DialogDescription>
            Read the carrier off the card and record it. This saves General Insurance
            and nothing else — it does not run a benefits check.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-2">
          {loading && (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening the card…
            </div>
          )}
          {!loading && photoError && (
            <p className="px-2 py-6 text-center text-sm text-destructive">{photoError}</p>
          )}
          {!loading && photo && !imgFailed && (
            <img
              src={photo.url}
              alt={`Insurance card for ${target.name}`}
              className="mx-auto max-h-64 w-auto rounded"
              onError={() => setImgFailed(true)}
            />
          )}
          {!loading && photo && imgFailed && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              This file can't be shown here — open it in the viewer.
            </p>
          )}
          {!loading && photo && (
            <div className="mt-2 flex justify-center">
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

        {refusal && <p className="text-sm text-destructive">{refusal}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving || !picked || !!refusal || unchanged}>
            {saving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Saving…</> : "Save insurance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
