/**
 * "You're seeing <name>'s Command Center" — the strip under the global header
 * while a borrow is on (§5.39g).
 *
 * ⚠️⚠️ **THE BORROW NOW CHANGES THE WHOLE UI, SO THE SAY-SO HAS TO FOLLOW IT.**
 * Josh, 2026-09-19: *"the whole ui should be EXACTLY what they see"*. Once the
 * header's own tabs answer for somebody else, a banner that lives only on the
 * home pane is not enough — click through to a patient and there would be
 * nothing on screen telling you the tabs you are looking at are not yours. This
 * renders in `AppShell`, above every page, and it is the one thing about a
 * borrow that is NOT impersonated.
 *
 * ⚠️ It renders nothing at all when nobody is borrowed, so the shell is
 * untouched for everybody else — no strip, no spacer, no layout shift.
 *
 * ⚠️⚠️ **IT SAYS BOTH HALVES, AND IT IS THE ONLY BANNER.** `HomeViewSwitch`
 * carried its own version, so a borrow showed TWO strips saying overlapping
 * things — found by rendering it. Worse, the in-page one read *"anything you do
 * here runs with your permissions, not theirs"*, which was the whole truth
 * before §5.39h and is half of it now: the DISPLAY is theirs, the WRITES are
 * still mine. Two banners disagreeing about what a borrow means is how somebody
 * does something they are not allowed to do and believes the app let them.
 */
import { Eye, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function ViewAsBanner({ name }: { name: string }) {
  const navigate = useNavigate();
  if (!name) return null;
  return (
    <div className="cc-viewas" role="status">
      <Eye style={{ width: 13, height: 13, flexShrink: 0 }} />
      <span>
        You're seeing <b>{name}'s</b> Command Center — their tabs, their bars, their view.{" "}
        <i>Anything you do still runs as you.</i>
      </span>
      {/* ⚠️ The way out is on the strip itself. The dropdown that started the
          borrow is on the HOME screen, so from anywhere else there would
          otherwise be no control to end it — the dead end §5.10 · §5.20 ·
          §5.31c · §5.39d each record reversing. */}
      <button type="button" onClick={() => navigate("/")} title="Back to my own Command Center">
        <X style={{ width: 12, height: 12, marginRight: 4, verticalAlign: -1 }} />
        Back to mine
      </button>
    </div>
  );
}
