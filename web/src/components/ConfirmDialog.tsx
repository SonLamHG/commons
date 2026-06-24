import React, { useEffect, useRef } from 'react';

export type ConfirmRequest = {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
};

/**
 * A letterpress-styled confirmation modal — replaces the native window.confirm,
 * which breaks the paper aesthetic. Destructive by convention (vermilion stamp).
 * Esc or a backdrop click cancels; the cancel button takes initial focus so a
 * stray Enter never destroys anything.
 */
export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // Remember what had focus before the modal opened, so we can restore it on close.
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!request) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      // Trap focus inside the card: cycle between the first and last focusable.
      const f = cardRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!f || f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Return focus to the trigger when the dialog unmounts/closes.
      restoreRef.current?.focus?.();
    };
  }, [request, onClose]);

  if (!request) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={cardRef}
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="modal-stamp">Cần xác nhận</span>
        <h3 id="confirm-title" className="modal-title">{request.title}</h3>
        <div id="confirm-body" className="modal-body">{request.body}</div>
        <div className="modal-actions">
          <button ref={cancelRef} className="btn" onClick={onClose}>Hủy</button>
          <button
            className="btn reject"
            onClick={() => { request.onConfirm(); onClose(); }}
          >{request.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
