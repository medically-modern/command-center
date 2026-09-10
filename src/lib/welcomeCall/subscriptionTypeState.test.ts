import { describe, expect, it } from "vitest";
import { subscriptionTypeState } from "./orderDefaults";

/**
 * Brandon, 2026-09-09: "Subscription Type … Default from the product mix,
 * editable, required" + the one muted hint that flips to "edited".
 *
 * The bug this closes: `expectedSubscriptionType` computed the right answer and
 * its ONLY consumer was a red mismatch line, which cannot render on a blank
 * field — so the field never defaulted and the help arrived only after the rep
 * had already picked something else.
 */
describe("subscriptionTypeState", () => {
  it("asks the caller to fill a blank field from the product mix", () => {
    const s = subscriptionTypeState({ current: "", derived: "Sensors & Supplies", autoFilled: "" });
    expect(s.needsFill).toBe(true);
    expect(s.label).toBe("");
  });

  it("does not ask for a fill when the products say nothing", () => {
    const s = subscriptionTypeState({ current: "", derived: null, autoFilled: "" });
    expect(s.needsFill).toBe(false);
  });

  it("hints 'from product mix' while showing our own untouched guess", () => {
    const s = subscriptionTypeState({
      current: "Sensors",
      derived: "Sensors",
      autoFilled: "Sensors",
    });
    expect(s.hint).toBe("from product mix");
    expect(s.mismatch).toBe("");
    expect(s.needsFill).toBe(false);
  });

  it("flips to 'edited' once the rep changes what we filled", () => {
    const s = subscriptionTypeState({
      current: "Supplies",
      derived: "Sensors",
      autoFilled: "Sensors",
    });
    expect(s.hint).toBe("edited");
  });

  /* A value the board already carried is neither our guess nor this call's
     edit — Brandon asked for ONE hint, only while it means something. */
  it("gives a board-held value no hint at all", () => {
    const s = subscriptionTypeState({
      current: "Sensors",
      derived: "Sensors",
      autoFilled: "",
    });
    expect(s.hint).toBe("");
  });

  /* ⚠️ A deliberate override is REPORTED, never corrected: Serving and the
     product columns are editable right there, and self-healing a rep's explicit
     choice is how a real override gets lost. */
  it("reports a mismatch without overriding the rep", () => {
    const s = subscriptionTypeState({
      current: "Supplies",
      derived: "Sensors & Supplies",
      autoFilled: "",
    });
    expect(s.label).toBe("Supplies");
    expect(s.mismatch).toContain("Sensors & Supplies");
    expect(s.needsFill).toBe(false);
  });

  it("stays quiet when the choice and the products agree", () => {
    const s = subscriptionTypeState({
      current: "Sensors",
      derived: "Sensors",
      autoFilled: "",
    });
    expect(s.mismatch).toBe("");
  });

  /* Our own fresh guess cannot be a mismatch with the thing it was derived
     from, so the red line must never appear on a field we just filled. */
  it("never shows a mismatch on a value we just auto-filled", () => {
    const s = subscriptionTypeState({
      current: "Sensors & Supplies",
      derived: "Sensors & Supplies",
      autoFilled: "Sensors & Supplies",
    });
    expect(s.mismatch).toBe("");
  });
});
