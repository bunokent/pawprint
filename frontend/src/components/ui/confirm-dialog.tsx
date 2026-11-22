import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** True while the delete mutation is in flight — both buttons lock, label changes. */
  confirming?: boolean;
  title?: string;
  /** Subject named in bold inside the body copy, e.g. the pet's name. */
  subject?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Destructive-action confirmation — the beautiful replacement for `window.confirm()`.
 * `role="alertdialog"` with `aria-labelledby`/`aria-describedby` wiring; Escape and
 * backdrop click cancel, focus moves to the safe (cancel) action on open, loops inside
 * the dialog on Tab, and is restored to the trigger on close.
 */
export function ConfirmDeleteDialog({
  open,
  onClose,
  onConfirm,
  confirming = false,
  title = "Delete this flyer?",
  subject,
  confirmLabel = "Yes, delete flyer",
  cancelLabel = "Keep flyer",
}: ConfirmDeleteDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-confirm-cancel]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="confirm-dialog__backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog__icon" aria-hidden="true">
          <Trash2 size={24} />
        </div>
        <h2 className="confirm-dialog__title" id="confirm-dialog-title">
          {title}
        </h2>
        <p className="confirm-dialog__body" id="confirm-dialog-body">
          {subject ? (
            <>
              <strong style={{ color: "var(--color-ink)" }}>{subject}</strong>&rsquo;s flyer will be permanently
              deleted — the photo, QR code and public link will stop working.
            </>
          ) : (
            <>This flyer will be permanently deleted — the photo, QR code and public link will stop working.</>
          )}
        </p>
        <p className="confirm-dialog__warn">This cannot be undone.</p>
        <div className="confirm-dialog__actions">
          <Button data-confirm-cancel variant="secondary" onClick={onClose} disabled={confirming}>
            {cancelLabel}
          </Button>
          <Button variant="emergency" onClick={onConfirm} disabled={confirming}>
            {confirming ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
