import type { WhistleDB } from './db'
import type { OutboxPayload, OutboxTxn, SyncStatus } from '../types'
import type { PostResult } from '../services/transactions'
import type { PostErrorKind, PostItem, PostRequest } from '../utils/transactionForm'
import { formatScaled, toScaled } from '../utils/decimal'

export interface EnqueueInput {
  userId: string
  type: 'IN' | 'OUT'
  payload: OutboxPayload
  /** Kunci idempotensi. Beri nilai yang sama jika dokumen ini sebelumnya sudah dicoba diposting online. */
  clientTransactionId?: string
  createdAt?: string
}

export type EditPatch = Partial<Pick<OutboxPayload, 'items' | 'reference' | 'party' | 'notes' | 'dateIso' | 'dateInput' | 'allowBackdate'>>

function uuid(): string {
  const c: Crypto = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const OPEN_STATUSES: SyncStatus[] = ['PENDING', 'SYNCING', 'FAILED', 'CONFLICT']

/** Permintaan posting dari satu entri antrean. */
export function toPostRequest(t: OutboxTxn): PostRequest {
  return {
    type: t.type,
    clientTransactionId: t.clientTransactionId,
    dateIso: t.payload.dateIso,
    reference: t.payload.reference,
    party: t.payload.party,
    notes: t.payload.notes,
    items: t.payload.items,
    allowBackdate: t.payload.allowBackdate,
  }
}

/**
 * Antrean transaksi offline di IndexedDB.
 * Aturan: data lokal tidak pernah dihapus atau diubah otomatis. Hanya pengguna yang dapat
 * memperbaiki (edit) atau membatalkan; transaksi yang sudah SYNCED tidak dapat diubah.
 */
export class Outbox {
  constructor(private readonly db: WhistleDB) {}

  async enqueue(input: EnqueueInput): Promise<OutboxTxn> {
    const skus = [...new Set(input.payload.items.map((i) => i.sku))]
    const txn: OutboxTxn = {
      id: uuid(),
      clientTransactionId: input.clientTransactionId ?? uuid(),
      userId: input.userId,
      type: input.type,
      payload: input.payload,
      createdAt: input.createdAt ?? new Date().toISOString(),
      status: 'PENDING',
      skus,
      attempts: 0,
    }
    // idempoten terhadap client_transaction_id: tidak membuat entri ganda untuk dokumen yang sama
    const existing = await this.db.outbox.where('clientTransactionId').equals(txn.clientTransactionId).first()
    if (existing) return existing
    const seq = await this.db.outbox.add(txn)
    return { ...txn, seq: seq as number }
  }

  get(id: string): Promise<OutboxTxn | undefined> {
    return this.db.outbox.where('id').equals(id).first()
  }

  /** Semua entri menurut urutan pencatatan lokal. */
  listAll(): Promise<OutboxTxn[]> {
    return this.db.outbox.orderBy('seq').toArray()
  }

  async counts(userId?: string): Promise<Record<SyncStatus, number>> {
    const c: Record<SyncStatus, number> = { PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0 }
    for (const t of await this.db.outbox.toArray()) if (!userId || t.userId === userId) c[t.status]++
    return c
  }

  /** Entri yang belum selesai (PENDING/SYNCING/FAILED/CONFLICT) untuk SKU tertentu milik pengguna. */
  async hasUnsyncedFor(userId: string, skus: string[]): Promise<boolean> {
    const set = new Set(skus)
    const open = await this.db.outbox.where('status').anyOf(OPEN_STATUSES).toArray()
    return open.some((t) => t.userId === userId && t.skus.some((s) => set.has(s)))
  }

  /**
   * Proyeksi stok dari antrean milik pengguna yang masih menunggu (PENDING/SYNCING):
   * stok cache + masuk - keluar. Hanya untuk peringatan; server tetap yang memutuskan.
   */
  async queuedDelta(userId: string, sku: string): Promise<string> {
    let delta = 0n
    for (const t of await this.db.outbox.where('status').anyOf(['PENDING', 'SYNCING']).toArray()) {
      if (t.userId !== userId) continue
      for (const it of t.payload.items) {
        if (it.sku !== sku) continue
        const q = toScaled(it.quantity, 4)
        delta += t.type === 'IN' ? q : -q
      }
    }
    const neg = delta < 0n
    const s = formatScaled(neg ? -delta : delta, 4)
    return neg ? `-${s}` : s
  }

  /** Setelah aplikasi ditutup paksa: entri SYNCING dikembalikan ke PENDING (dikirim ulang dengan kunci yang sama). */
  async recoverInterrupted(): Promise<number> {
    return this.db.outbox.where('status').equals('SYNCING').modify({ status: 'PENDING' })
  }

  async markSyncing(id: string, now = new Date()): Promise<void> {
    const t = await this.get(id)
    if (!t) return
    await this.db.outbox.update(t.seq!, { status: 'SYNCING', attempts: t.attempts + 1, lastAttemptAt: now.toISOString(), blockedBy: undefined })
  }

  async markSynced(id: string, result: PostResult, now = new Date()): Promise<void> {
    const t = await this.get(id)
    if (!t) return
    await this.db.outbox.update(t.seq!, {
      status: 'SYNCED', result, syncedAt: now.toISOString(), error: undefined, errorKind: undefined, blockedBy: undefined,
    })
  }

  /** Gangguan jaringan/server sementara: kembali ke PENDING tanpa mengubah isi transaksi. */
  async markPending(id: string, message?: string, kind: PostErrorKind = 'offline'): Promise<void> {
    const t = await this.get(id)
    if (!t) return
    await this.db.outbox.update(t.seq!, { status: 'PENDING', error: message, errorKind: message ? kind : undefined })
  }

  /** Ditolak server: FAILED (data salah/hak) atau CONFLICT (kondisi server berubah). Isi tidak diubah. */
  async markRejected(id: string, status: 'FAILED' | 'CONFLICT', kind: PostErrorKind, message: string): Promise<void> {
    const t = await this.get(id)
    if (!t) return
    await this.db.outbox.update(t.seq!, { status, errorKind: kind, error: message, blockedBy: undefined })
  }

  async setBlockedBy(id: string, blockedBy: string | undefined): Promise<void> {
    const t = await this.get(id)
    if (t) await this.db.outbox.update(t.seq!, { blockedBy })
  }

  /**
   * Perbaikan oleh pengguna (hanya untuk entri yang DITOLAK server: FAILED/CONFLICT).
   * Dokumen baru mendapat client_transaction_id baru (dokumen lama tidak pernah diposting),
   * posisi urutan (seq) dipertahankan, dan status kembali PENDING.
   */
  async edit(id: string, patch: EditPatch): Promise<OutboxTxn> {
    const t = await this.get(id)
    if (!t) throw new Error('Transaksi antrean tidak ditemukan')
    if (t.status !== 'FAILED' && t.status !== 'CONFLICT') {
      throw new Error('Hanya transaksi berstatus FAILED atau CONFLICT yang dapat diperbaiki')
    }
    const payload: OutboxPayload = { ...t.payload, ...patch }
    const skus = [...new Set(payload.items.map((i: PostItem) => i.sku))]
    const next: Partial<OutboxTxn> = {
      payload, skus, clientTransactionId: uuid(), status: 'PENDING', error: undefined, errorKind: undefined, blockedBy: undefined, attempts: 0,
    }
    await this.db.outbox.update(t.seq!, next)
    return { ...t, ...next } as OutboxTxn
  }

  /** Pembatalan oleh pengguna. Transaksi SYNCED tidak dapat dibatalkan (sudah dibukukan di server). */
  async cancel(id: string): Promise<void> {
    const t = await this.get(id)
    if (!t) return
    if (t.status === 'SYNCED') throw new Error('Transaksi sudah diposting di server dan tidak dapat dibatalkan; gunakan reversal oleh ADMIN')
    if (t.status === 'SYNCING') throw new Error('Transaksi sedang dikirim; tunggu hingga selesai')
    await this.db.outbox.delete(t.seq!)
  }

  /** Bersihkan riwayat SYNCED yang lama (data resmi ada di server). */
  async purgeSynced(olderThanMs: number, now = new Date()): Promise<number> {
    const cutoff = now.getTime() - olderThanMs
    const old = (await this.db.outbox.where('status').equals('SYNCED').toArray()).filter((t) => t.syncedAt && new Date(t.syncedAt).getTime() < cutoff)
    await this.db.outbox.bulkDelete(old.map((t) => t.seq!))
    return old.length
  }
}
