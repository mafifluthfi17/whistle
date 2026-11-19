import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'

/** Berlangganan hasil query IndexedDB (Dexie liveQuery): komponen ikut diperbarui saat data berubah. */
export function useLive<T>(query: () => Promise<T> | T, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial)
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: setValue,
      error: (e) => console.error('liveQuery', e),
    })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
