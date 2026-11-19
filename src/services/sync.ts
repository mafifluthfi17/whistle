import type { LocalCache } from '../database/cache'
import { toPostRequest, type Outbox } from '../database/outbox'
import { PostFailure, type PostResult } from './transactions'
import { mapPostError, type PostErrorKind, type PostRequest } from '../utils/transactionForm'

export interface SyncDeps {
  outbox: Outbox
  cache: LocalCache
  /** Pengguna yang sedang login. Hanya transaksi miliknya yang dikirim. */
  userId: string
  /** Mengirim satu dokumen ke server (post_transaction). Melempar PostFailure bila gagal. */
  post: (req: PostRequest) => Promise<PostResult>
  now?: () => Date
  /** Batas percobaan untuk error server tak dikenal sebelum dianggap FAILED (bawaan 5). */
  maxUnknownAttempts?: number
}

export interface SyncSummary {
  attempted: number
  synced: number
  /** Sudah pernah diposting sebelumnya (hasil retry); tidak diposting ulang */
  duplicates: number
  conflicts: number
  failed: number
  /** Ditahan karena transaksi sebelumnya pada SKU yang sama gagal/konflik */
  blocked: number
  skippedOtherUser: number
  stoppedByNetwork: boolean
}

export type Outcome = 'transient' | 'conflict' | 'failed'

/**
 * - transient: jaringan/server sementara -> tetap PENDING, data tidak berubah
 * - conflict : kondisi server berubah (stok kurang, barang nonaktif/hilang, tanggal mundur) -> CONFLICT
 * - failed   : data tidak valid atau tidak berhak -> FAILED
 */
export function classifyFailure(kind: PostErrorKind): Outcome {
  switch (kind) {
    case 'offline':
    case 'unknown':
      return 'transient'
    case 'insufficient':
    case 'backdated':
    case 'inactive':
    case 'notfound':
      return 'conflict'
    case 'validation':
    case 'forbidden':
      return 'failed'
  }
}

const running = new WeakMap<Outbox, Promise<SyncSummary>>()

function emptySummary(): SyncSummary {
  return { attempted: 0, synced: 0, duplicates: 0, conflicts: 0, failed: 0, blocked: 0, skippedOtherUser: 0, stoppedByNetwork: false }
}

/**
 * Sinkronkan antrean ke server.
 *  - Satu proses pada satu waktu (pemanggilan bersamaan bergabung ke proses yang sedang berjalan).
 *  - Urutan pencatatan lokal dipertahankan; transaksi berikutnya pada SKU yang sama TIDAK dikirim
 *    selama transaksi sebelumnya gagal atau konflik (server tetap memvalidasi seluruh rangkaian).
 *  - Idempoten: client_transaction_id yang sama tidak menggandakan transaksi.
 *  - Transaksi SYNCED tidak pernah dikirim ulang. Isi transaksi tidak pernah diubah otomatis.
 */
export function syncOutbox(deps: SyncDeps): Promise<SyncSummary> {
  const current = running.get(deps.outbox)
  if (current) return current
  const p = run(deps).finally(() => running.delete(deps.outbox))
  running.set(deps.outbox, p)
  return p
}

async function run(deps: SyncDeps): Promise<SyncSummary> {
  const summary = emptySummary()
  await deps.outbox.recoverInterrupted()
  for (let round = 0; round < 5; round++) {
    const before = (await deps.outbox.listAll()).reduce((m, t) => Math.max(m, t.seq ?? 0), 0)
    const keepGoing = await pass(deps, summary, round === 0)
    if (!keepGoing) break
    const after = (await deps.outbox.listAll()).reduce((m, t) => Math.max(m, t.seq ?? 0), 0)
    if (after <= before) break // tidak ada entri baru selama proses
  }
  return summary
}

async function pass(deps: SyncDeps, summary: SyncSummary, countOthers: boolean): Promise<boolean> {
  const now = deps.now ?? (() => new Date())
  const maxUnknown = deps.maxUnknownAttempts ?? 5
  const all = await deps.outbox.listAll()
  const blocked = new Map<string, string>() // SKU -> id transaksi penyebab

  for (const t of all) {
    if (t.status === 'SYNCED' || t.status === 'SYNCING') continue
    if (t.userId !== deps.userId) {
      if (countOthers) summary.skippedOtherUser++
      continue
    }
    if (t.status === 'FAILED' || t.status === 'CONFLICT') {
      for (const s of t.skus) if (!blocked.has(s)) blocked.set(s, t.id)
      continue
    }

    // PENDING
    const blocker = t.skus.map((s) => blocked.get(s)).find((x) => x !== undefined)
    if (blocker) {
      await deps.outbox.setBlockedBy(t.id, blocker)
      summary.blocked++
      for (const s of t.skus) if (!blocked.has(s)) blocked.set(s, blocker)
      continue
    }

    await deps.outbox.markSyncing(t.id, now())
    summary.attempted++
    try {
      const res = await deps.post(toPostRequest(t))
      await deps.outbox.markSynced(t.id, res, now())
      summary.synced++
      if (res.duplicate) summary.duplicates++
      // Hasil duplikat berisi saldo saat dokumen pertama diposting (bisa usang): jangan menimpa cache dengannya.
      else await deps.cache.applyPostedBalances(res.items, now())
    } catch (e) {
      const f = e instanceof PostFailure ? e : new PostFailure(mapPostError({ message: (e as Error).message }))
      const outcome = classifyFailure(f.kind)
      if (outcome === 'transient') {
        if (f.kind === 'unknown' && t.attempts + 1 >= maxUnknown) {
          await deps.outbox.markRejected(t.id, 'FAILED', f.kind, f.message)
          summary.failed++
          for (const s of t.skus) blocked.set(s, t.id)
          summary.stoppedByNetwork = true
          return false
        }
        await deps.outbox.markPending(t.id, f.message, f.kind)
        summary.stoppedByNetwork = true
        return false // hentikan: koneksi/server bermasalah, coba lagi nanti
      }
      await deps.outbox.markRejected(t.id, outcome === 'conflict' ? 'CONFLICT' : 'FAILED', f.kind, f.message)
      if (outcome === 'conflict') summary.conflicts++
      else summary.failed++
      for (const s of t.skus) blocked.set(s, t.id)
    }
  }
  return true
}
