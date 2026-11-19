import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

export type ToastKind = 'success' | 'error' | 'info' | 'pending' | 'conflict' | 'insufficient' | 'notfound'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

const STYLE: Record<ToastKind, string> = {
  success: 'bg-emerald-600',
  error: 'bg-red-600',
  info: 'bg-sky-700',
  pending: 'bg-amber-600',
  conflict: 'bg-orange-700',
  insufficient: 'bg-red-700',
  notfound: 'bg-rose-700',
}

const ToastContext = createContext<(kind: ToastKind, text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current
    setItems((x) => [...x, { id, kind, text }])
    const long = kind === 'error' || kind === 'insufficient' || kind === 'notfound'
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), long ? 8000 : 4000)
  }, [])
  const value = useMemo(() => push, [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`pointer-events-auto max-w-md rounded-lg px-4 py-2 text-sm text-white shadow-lg ${STYLE[i.kind]}`}>
            {i.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
