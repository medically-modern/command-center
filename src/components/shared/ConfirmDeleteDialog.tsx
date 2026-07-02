/**
 * Non-blocking "delete this file?" confirmation.
 *
 * Replaces the old window.confirm() calls: a native dialog suspends the
 * calling code indefinitely, so a rep who tabs away and later dismisses it
 * with a stray Enter/click fires an irreversible delete (and any keep-list
 * computed before the dialog silently drops files added in the meantime).
 * This renders through React, so nothing is suspended — the confirm handler
 * runs against current props at click time.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ConfirmDeleteDialog({
  open,
  name,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  /** What's being deleted — shown in the title (file name or label). */
  name: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}” from Monday?</AlertDialogTitle>
          <AlertDialogDescription>
            The file is removed from the Monday item for everyone. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            Delete file
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
