/**
 * The settings menu's Calls status sentence (§5.52) — Brandon's three, with
 * the badge's own label standing in for his "Connected — calls ring in this
 * tab" once the line is actually up, so the menu and the phone icon beside the
 * gear cannot disagree about the line.
 */
export function callStatusLine(enabled: boolean, ringing: boolean, badgeLabel: string): string {
  if (!enabled) return "Calls don't ring you — you're not a call answerer";
  if (!ringing) return "Ringing is paused for you";
  return badgeLabel;
}
