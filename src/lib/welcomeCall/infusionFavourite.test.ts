/**
 * The infusion-set favourite (Brandon 2026-09-11, Joslin scope from Josh the
 * same day: "all joslin, yes").
 */
import { describe, it, expect } from "vitest";
import {
  FAVOURITE_SET,
  FAVOURITE_SET_JOSLIN,
  favouriteSetLabel,
  withFavouriteFirst,
  type SetOption,
} from "./infusionSelection";

/* The real labels, read off Infusion Set 1 `color_mm1x9paw` on 2026-09-11. */
const OPTIONS: SetOption[] = [
  { index: 3, label: 'AutoSoft XC 9 mm 23"' },
  { index: 6, label: 'TruSteel 6 mm 23"' },
  { index: 0, label: 'AutoSoft XC 6 mm 23"' },
  { index: 101, label: "Not Serving" },
];

describe("favouriteSetLabel", () => {
  it("is AutoSoft XC 6 mm 23\" by default", () => {
    expect(favouriteSetLabel("")).toBe(FAVOURITE_SET);
    expect(favouriteSetLabel("NYU PEDIATRIC DIABETES CENTER")).toBe(FAVOURITE_SET);
  });

  /* ⚠️ ANY Joslin practice, not the one exact label. Of the five Joslin entries
     on the Clinic Name dropdown, the exact "Joslin Pediatric Educators" is on
     3 of 466 Welcome Call items and none of them live, while the SUNY Upstate
     spellings carry the other 33 — an exact match would have fired for nobody. */
  it("is TruSteel for every Joslin clinic on the board", () => {
    for (const clinic of [
      "Joslin Pediatric Educators",
      "SUNY Upstate Joslin Diabetes Center",
      "SUNY Upstate Pediatric Joslin Diabetes Center",
      "SUNY Upstate Pediatric - Joslin Diabetes Center",
      "SUNY Upstate Joslin Diabetes Center Update Facility",
    ]) {
      expect(favouriteSetLabel(clinic)).toBe(FAVOURITE_SET_JOSLIN);
    }
  });

  it("is case-insensitive and survives a blank clinic", () => {
    expect(favouriteSetLabel("joslin pediatric educators")).toBe(FAVOURITE_SET_JOSLIN);
    expect(favouriteSetLabel(undefined as unknown as string)).toBe(FAVOURITE_SET);
  });
});

describe("withFavouriteFirst", () => {
  it("moves the favourite to the top and keeps everything else in order", () => {
    const out = withFavouriteFirst(OPTIONS, FAVOURITE_SET);
    expect(out.map((o) => o.index)).toEqual([0, 3, 6, 101]);
  });

  it("puts TruSteel first for a Joslin patient", () => {
    const out = withFavouriteFirst(OPTIONS, FAVOURITE_SET_JOSLIN);
    expect(out[0].label).toBe('TruSteel 6 mm 23"');
  });

  /* ⚠️ Adds nothing. A favourite the compatibility filter already dropped must
     stay dropped — the pump cannot take it, and preference does not outrank
     that. */
  it("does not re-admit a favourite the filter removed", () => {
    const filtered = OPTIONS.filter((o) => o.index !== 0);
    const out = withFavouriteFirst(filtered, FAVOURITE_SET);
    expect(out.map((o) => o.index)).toEqual([3, 6, 101]);
    expect(out).toHaveLength(3);
  });

  /* The board writes "9mm" in one label and "9 mm" in its siblings — the same
     spacing drift the stock tracker needs normalising for. */
  it("matches across spacing and quote drift", () => {
    const odd: SetOption[] = [
      { index: 3, label: 'AutoSoft XC 9 mm 23"' },
      { index: 0, label: 'AutoSoft XC 6mm 23”' },
    ];
    expect(withFavouriteFirst(odd, FAVOURITE_SET)[0].index).toBe(0);
  });

  it("is a no-op on an empty list or an empty favourite", () => {
    expect(withFavouriteFirst([], FAVOURITE_SET)).toEqual([]);
    expect(withFavouriteFirst(OPTIONS, "")).toEqual(OPTIONS);
  });
});
