import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Ids of open sheets, innermost last; Escape closes only the innermost. */
const openStack: string[] = [];

/**
 * Modal form container: full-screen sheet on phones, centred dialog on larger screens (PRD §4).
 * Escape and the backdrop close it; focus moves into it on open and back on close.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    openStack.push(titleId);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === titleId) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
      (first ?? panelRef.current)?.focus();
    });
    return () => {
      openStack.splice(openStack.lastIndexOf(titleId), 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-dvh w-full flex-col bg-surface shadow-2xl outline-none sm:max-h-[90dvh] sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} h-dvh sm:h-auto`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" data-close onClick={onClose} className="grid size-10 place-items-center rounded-xl text-muted hover:bg-primary-soft hover:text-primary" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <div className="pb-safe border-t border-line bg-surface px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
