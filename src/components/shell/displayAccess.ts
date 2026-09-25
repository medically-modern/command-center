/**
 * The resolved access a DISPLAY gate answers with (§5.39g-h) — the borrow's
 * split, in one hook.
 *
 * The header's question is *what does their screen look like*, so it answers
 * for the BORROWED person while a borrow is on; `AbilityGate`, `AbilityLock`
 * and every write guard ask *may I do this* and keep reading the signed-in
 * person through `useAccessContext()` directly. Until 2026-09-25 that split
 * lived only in `GlobalHeader`'s own lines — so the patient screen's Open
 * link, a display gate with nothing but the signed-in access to consult, kept
 * showing a manager every door while they were Viewing as somebody whose
 * profile does not hold it (Josh: *"i viewed as masani and the open profile
 * send off button is still there — she doesnt have it assigned to her"*).
 *
 * ⚠️ Mirrors `GlobalHeader`'s `who` exactly (`viewAsScope.test.ts` pins both
 * sides): the borrow counts only while the signed-in person holds
 * `viewOthers` — a revoked grant ends it here for the same reason it ends it
 * in the header — and an empty borrow is simply the signed-in access.
 *
 * ⚠️ NEVER hand this to anything that writes. A borrow is a preview
 * (`lib/shell/viewAs.ts`): it must neither grant the borrowed person's access
 * nor take away the signed-in person's own.
 */
import { useMemo } from "react";
import { useAccessContext } from "@/components/AccessProvider";
import { hasAbility } from "@/lib/shell/abilities";
import { resolveAccess, type Access } from "@/lib/accessStore";
import { useViewAs } from "@/lib/shell/viewAs";

export function useDisplayAccess(): Access {
  const { access, email, config } = useAccessContext();
  const borrowing = useViewAs();
  // Memoized — incident rule 2: this lands in render paths and could land in
  // a dependency array, and resolveAccess returns a fresh object every call.
  return useMemo(() => {
    if (!borrowing || borrowing === email) return access;
    if (!hasAbility(email, config, "viewOthers")) return access;
    return resolveAccess(borrowing, config);
  }, [borrowing, email, access, config]);
}
