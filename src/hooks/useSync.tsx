import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { db } from '../database/db'
import { localCache, outbox, refreshCache } from '../services/catalog'
import { syncOutbox, type SyncSummary } from '../services/sync'
import { postTransaction } from '../services/transactions'
import { useToast } from '../components/Toast'
import { useAuth } from './useAuth'
import { useLive } from './useLive'
import { useOnlineStatus } from './useOnlineStatus'
import type { SyncStatus } from '../types'

const EMPTY: Record<SyncStatus, number> = { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 }
const SYNC_INTERVAL_MS = 30_000
const KEEP_SYNCED_MS = 7 * 86_400_000

interface SyncState {
  /** Jumlah antrean milik pengguna yang login, per status */
  counts: Record<SyncStatus, number>
  /** Antrean milik pengguna lain di perangkat ini (belum tersinkron) */
  othersOpen: number
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
  cachedAt: string | null
  cacheCount: number
  syncNow: () => Promise<SyncSummary | null>
  refreshCatalog: () => Promise<void>
}

const SyncContext = createContext<SyncState | null>(null)

/**
 * Menjalankan sinkronisasi otomatis: saat aplikasi dibuka, koneksi pulih, tab kembali aktif,
 * setelah transaksi baru masuk antrean, dan berkala selama ada yang menunggu.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth()
  const toast = useToast()
  const online = useOnlineStatus()
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const busy = useRef(false)

  const counts = useLive(() => (userId ? outbox.counts(userId) : EMPTY), [userId], EMPTY)
  const total = useLive(() => outbox.counts(), [], EMPTY)
  const cachedAt = useLive(() => localCache.cachedAt(), [], null as string | null)
  const cacheCount = useLive(() => db.items.count(), [], 0)
  const openAll = total.PENDING + total.SYNCING + total.FAILED + total.CONFLICT
  const openMine = counts.PENDING + counts.SYNCING + counts.FAILED + counts.CONFLICT

  const refreshCatalog = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      await refreshCache()
    } catch {
      /* cache lama tetap dipakai */
    }
  }, [])

  const syncNow = useCallback(async (): Promise<SyncSummary | null> => {
    if (!userId || !navigator.onLine || busy.current) return null
    busy.current = true
    setSyncing(true)
    try {
      const s = await syncOutbox({ outbox, cache: localCache, userId, post: postTransaction })
      setLastSyncAt(new Date().toISOString())
      setLastError(null)
      if (s.synced > 0) {
        toast('success', `${s.synced} transaksi offline berhasil diposting${s.duplicates ? ` (${s.duplicates} sudah terposting sebelumnya)` : ''}`)
        void refreshCatalog()
      }
      if (s.conflicts > 0) toast('conflict', `${s.conflicts} transaksi konflik dengan data server. Buka Antrean untuk memperbaiki atau membatalkan.`)
      if (s.failed > 0) toast('error', `${s.failed} transaksi ditolak server. Buka Antrean untuk melihat penyebabnya.`)
      return s
    } catch (e) {
      setLastError((e as Error).message)
      return null
    } finally {
      busy.current = false
      setSyncing(false)
    }
  }, [userId, toast, refreshCatalog])

  // Saat login / aplikasi dibuka: bersihkan riwayat lama, segarkan cache, kirim antrean
  useEffect(() => {
    if (!userId) return
    void outbox.purgeSynced(KEEP_SYNCED_MS)
    if (navigator.onLine) {
      void syncNow().then(() => refreshCatalog())
    }
  }, [userId, syncNow, refreshCatalog])

  // Koneksi pulih
  useEffect(() => {
    if (online && userId) void syncNow().then(() => refreshCatalog())
  }, [online, userId, syncNow, refreshCatalog])

  // Kembali ke tab ini
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [syncNow])

  // Berkala selama ada transaksi yang menunggu (PENDING)
  useEffect(() => {
    if (!userId || !online || counts.PENDING === 0) return
    const id = setInterval(() => void syncNow(), SYNC_INTERVAL_MS)
    // transaksi baru di antrean: kirim segera
    void syncNow()
    return () => clearInterval(id)
  }, [userId, online, counts.PENDING, syncNow])

  const value = useMemo<SyncState>(
    () => ({
      counts,
      othersOpen: Math.max(0, openAll - openMine),
      syncing,
      lastSyncAt,
      lastError,
      cachedAt,
      cacheCount,
      syncNow,
      refreshCatalog,
    }),
    [counts, openAll, openMine, syncing, lastSyncAt, lastError, cachedAt, cacheCount, syncNow, refreshCatalog],
  )
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync harus dipakai di dalam SyncProvider')
  return ctx
}
