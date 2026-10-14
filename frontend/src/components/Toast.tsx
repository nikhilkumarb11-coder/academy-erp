import clsx from 'clsx';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  text: string;
  tone: 'success' | 'error';
}

const ToastContext = createContext<(text: string, tone?: ToastItem['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback((text: string, tone: ToastItem['tone'] = 'success') => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg',
              t.tone === 'success' ? 'bg-primary' : 'bg-danger',
            )}
          >
            {t.tone === 'success' ? <CheckCircle2 className="size-4 text-accent" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
