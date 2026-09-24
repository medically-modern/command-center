/**
 * The Insurance pill opens the patient's card — and the URL it opens has to be
 * one that actually returns the image.
 *
 * ⚠️⚠️ **THIS FILE EXISTS BECAUSE THE FIRST VERSION SHIPPED BROKEN AND EVERY
 * TEST STAYED GREEN.** The pill was wired to the file column's own `text`,
 * which reads like a URL and is a `protected_static` link: without a monday
 * session it answers **302 to a login page**. Measured against the live board
 * on 2026-09-18 — `protected_static` → HTTP 302, 0 bytes; the asset's signed
 * `public_url` → HTTP 200, `image/jpeg`, 134,500 bytes. So the pill opened an
 * error on every patient, and nothing caught it, because no test asserts that
 * a URL is reachable.
 *
 * What a unit test CAN pin is the shape: the lead must not carry an openable
 * URL at all, and the click must go through the asset resolver. The source
 * scans below are the `listColumns.test.ts` convention, and both are verified
 * to fail when the fix is reverted.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchInsuranceCardAsset } from "./mondayApi";
import { COL as PROFILE_COL } from "@/lib/profile/mondayApi";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** One monday response, shaped like the live one read on 2026-09-18. */
function reply(item: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { items: item === null ? [] : [item] } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const PROTECTED = "https://medicallymodern-force.monday.com/protected_static/28267378/resources/3212487057/insurance-card-1.jpg";
const SIGNED = "https://files-monday-com.s3.amazonaws.com/28267378/resources/3212487057/insurance-card-1.jpg?X-Amz-Signature=abc";

afterEach(() => vi.unstubAllGlobals());

describe("fetchInsuranceCardAsset", () => {
  it("returns the asset's SIGNED public_url, never the column's protected_static link", async () => {
    reply({
      column_values: [{
        id: PROFILE_COL.formCardPhoto,
        value: JSON.stringify({ files: [{ name: "insurance-card-1.jpg", assetId: 3212487057 }] }),
      }],
      assets: [{ id: "3212487057", name: "insurance-card-1.jpg", url: PROTECTED, public_url: SIGNED }],
    });

    const photo = await fetchInsuranceCardAsset("123");
    expect(photo).toEqual({ url: SIGNED, name: "insurance-card-1.jpg" });
    // The whole bug in one assertion.
    expect(photo?.url).not.toContain("protected_static");
  });

  /**
   * ⚠️ The item carries the patient's OTHER files too — the CGM data file and
   * a clinicals PDF — in an order monday does not promise. Opening `assets[0]`
   * under a label reading "insurance card" is worse than opening nothing.
   */
  it("matches the column's own asset id rather than taking the first asset", async () => {
    reply({
      column_values: [{
        id: PROFILE_COL.formCardPhoto,
        value: JSON.stringify({ files: [{ name: "card.jpg", assetId: 222 }] }),
      }],
      assets: [
        { id: "111", name: "cgm-export.pdf", url: PROTECTED, public_url: "https://signed/cgm.pdf" },
        { id: "222", name: "card.jpg", url: PROTECTED, public_url: "https://signed/card.jpg" },
      ],
    });

    const photo = await fetchInsuranceCardAsset("123");
    expect(photo?.name).toBe("card.jpg");
    expect(photo?.url).toBe("https://signed/card.jpg");
  });

  it("returns null when the column names an asset the item no longer holds", async () => {
    reply({
      column_values: [{
        id: PROFILE_COL.formCardPhoto,
        value: JSON.stringify({ files: [{ name: "gone.jpg", assetId: 999 }] }),
      }],
      assets: [{ id: "111", name: "something-else.pdf", url: PROTECTED, public_url: "https://signed/other" }],
    });
    // Not "open the other file" — the caller says the card is gone.
    expect(await fetchInsuranceCardAsset("123")).toBeNull();
  });

  it("returns null for a blank or unparseable column value", async () => {
    reply({ column_values: [{ id: PROFILE_COL.formCardPhoto, value: null }], assets: [] });
    expect(await fetchInsuranceCardAsset("123")).toBeNull();

    reply({ column_values: [{ id: PROFILE_COL.formCardPhoto, value: "{not json" }], assets: [
      { id: "111", name: "x.pdf", url: PROTECTED, public_url: "https://signed/x" },
    ] });
    expect(await fetchInsuranceCardAsset("123")).toBeNull();
  });

  it("returns null when the item is gone", async () => {
    reply(null);
    expect(await fetchInsuranceCardAsset("123")).toBeNull();
  });

  it("asks for the assets, not just the column", async () => {
    const fetchMock = reply({ column_values: [], assets: [] });
    await fetchInsuranceCardAsset("123");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.query).toContain("assets");
    expect(body.query).toContain("public_url");
  });
});

describe("the lead cannot carry an openable card URL", () => {
  it("holds presence as a boolean, so nobody can hand the column's link to a viewer", () => {
    const workflow = read("src/lib/careCoordinator/workflow.ts");
    expect(workflow).toContain("hasInsuranceCard: boolean");
    expect(workflow).not.toMatch(/insuranceCardUrl/);

    const api = read("src/lib/careCoordinator/mondayApi.ts");
    // The read may only TEST the column, never carry its value forward.
    expect(api).toMatch(/hasInsuranceCard:\s*text\(item, PROFILE_COL\.formCardPhoto\)\.trim\(\) !== ""/);
  });

  /**
   * ⚠️ These two scanned `cards.tsx` until 2026-09-23, when the press stopped
   * handing the photo straight to the viewer and started opening the dialog
   * that also sets the carrier (§5.30h). Both guarantees are unchanged — they
   * moved file. Follow them; do not delete them.
   */
  it("opens the card through the asset resolver", () => {
    const dialog = read("src/components/careCoordinator/InsuranceCardDialog.tsx");
    // ⚠️ `fetchCardDialogData` since 2026-09-24 — the same `cardPhotoFrom`
    // resolver `fetchInsuranceCardAsset` uses, plus the member ID on file, in
    // one read. The guarantee (a SIGNED url, never the column's) is unchanged.
    expect(dialog).toContain("fetchCardDialogData");
    const api = read("src/lib/careCoordinator/mondayApi.ts");
    expect(api).toMatch(/photo:\s*cardPhotoFrom\(item\)/);
    expect(api).toMatch(/return cardPhotoFrom\(await fetchCardItem\(itemId, \[PROFILE_COL\.formCardPhoto\]\)\)/);
    // Every render of the file must use a RESOLVED photo, never a lead field.
    expect(dialog).toMatch(/openFileViewer\(\{\s*url:\s*photo\.url/);
    expect(dialog).toMatch(/src=\{photo\.url\}/);
    expect(dialog).not.toMatch(/(openFileViewer|src=)\{?[^)}]*lead\.\w*[Cc]ard/);
    // And the card itself may no longer reach a viewer at all.
    expect(read("src/components/careCoordinator/cards.tsx")).not.toContain("openFileViewer");
  });

  it("tells the coordinator when the card cannot be opened", () => {
    const dialog = read("src/components/careCoordinator/InsuranceCardDialog.tsx");
    // A silent failure is what teaches somebody to stop pressing the pill.
    expect(dialog).toMatch(/setReadError\(/);
    expect(dialog).toMatch(/\{!loading && readError &&/);
    // …and a card that NEVER arrived is said as such, not as one that is
    // "no longer on the row" — that would claim there had been one (Ann
    // Hawkins, 2026-09-24).
    expect(dialog).toContain("No photo came through");
    expect(dialog).toMatch(/noPhoto && !target\.hasPhoto/);
  });
});
