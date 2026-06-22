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

  useEffect(() => {
    if (!request) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onClose]);

  if (!request) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="modal-stamp">Cần xác nhận</span>
        <h3 id="confirm-title" className="modal-title">{request.title}</h3>
        <div className="modal-body">{request.body}</div>
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
