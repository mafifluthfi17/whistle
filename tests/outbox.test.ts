import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalCache } from '../src/database/cache'
import { WhistleDB } from '../src/database/db'
import { Outbox, toPostRequest } from '../src/database/outbox'
import type { CachedBalance, CachedItem, OutboxPayload } from '../src/types'

let dbSeq = 0
let db: WhistleDB
let outbox: Outbox
let cache: LocalCache
const dbName = () => `whistle-test-${++dbSeq}-${Math.random().toString(36).slice(2)}`

beforeEach(() => {
  db = new WhistleDB(dbName())
  outbox = new Outbox(db)
  cache = new LocalCache(db)
})

const payload = (items: { sku: string; quantity: string; unit_cost?: string }[], over: Partial<OutboxPayload> = {}): OutboxPayload => ({
  dateIso: '2026-11-19T03:00:00.000Z',
  dateInput: '2026-11-19',
  reference: 'DOK-1',
  party: 'Pihak',
  notes: '',
  items,
  allowBackdate: false,
  names: Object.fromEntries(items.map((i) => [i.sku, { name: `Barang ${i.sku}`, unit: 'PCS' }])),
  ...over,
})

describe('antrean offline: data yang disimpan', () => {
  it('setiap transaksi memiliki UUID, client_transaction_id, waktu, pengguna, jenis, payload, dan status PENDING', async () => {
    const t = await outbox.enqueue({ userId: 'user-1', type: 'IN', payload: payload([{ sku: 'A', quantity: '5', unit_cost: '100' }]) })
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(t.clientTransactionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(t.id).not.toBe(t.clientTransactionId)
    expect(new Date(t.createdAt).toString()).not.toBe('Invalid Date')
    expect(t).toMatchObject({ userId: 'user-1', type: 'IN', status: 'PENDING', attempts: 0, skus: ['A'] })
    const stored = await outbox.get(t.id)
    expect(stored?.payload.items).toEqual([{ sku: 'A', quantity: '5', unit_cost: '100' }])
    expect(stored?.seq).toBeGreaterThan(0)
  })

  it('urutan pencatatan lokal (seq) naik dan listAll menurut urutan itu', async () => {
    const a = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]) })
    const b = await outbox.enqueue({ userId: 'u', type: 'OUT', payload: payload([{ sku: 'A', quantity: '1' }]) })
    const c = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'B', quantity: '1', unit_cost: '1' }]) })
    expect(b.seq! > a.seq! && c.seq! > b.seq!).toBe(true)
    expect((await outbox.listAll()).map((t) => t.id)).toEqual([a.id, b.id, c.id])
  })

  it('data tetap ada setelah aplikasi ditutup dan dibuka lagi (database yang sama)', async () => {
    const name = dbName()
    const first = new WhistleDB(name)
    const t = await new Outbox(first).enqueue({ userId: 'u', type: 'OUT', payload: payload([{ sku: 'A', quantity: '3' }]) })
    first.close()
    const reopened = new Outbox(new WhistleDB(name))
    const again = await reopened.get(t.id)
    expect(again).toMatchObject({ clientTransactionId: t.clientTransactionId, status: 'PENDING', type: 'OUT' })
  })

  it('client_transaction_id yang sama tidak membuat entri ganda', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const a = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]), clientTransactionId: id })
    const b = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '9', unit_cost: '9' }]), clientTransactionId: id })
    expect(b.id).toBe(a.id)
    expect(await db.outbox.count()).toBe(1)
    expect((await outbox.get(a.id))!.payload.items[0].quantity).toBe('1') // tidak tertimpa
  })

  it('permintaan posting dibangun dari entri tanpa mengubah isinya', async () => {
    const t = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '2.5', unit_cost: '12.5' }], { reference: 'PO-9', party: 'PT X', notes: 'cat', allowBackdate: true }) })
    expect(toPostRequest(t)).toEqual({
      type: 'IN', clientTransactionId: t.clientTransactionId, dateIso: '2026-11-19T03:00:00.000Z', reference: 'PO-9', party: 'PT X', notes: 'cat',
      items: [{ sku: 'A', quantity: '2.5', unit_cost: '12.5' }], allowBackdate: true,
    })
  })
})

describe('antrean offline: status dan pemulihan', () => {
  it('SYNCING yang tertinggal (aplikasi mati saat mengirim) dikembalikan ke PENDING dengan kunci yang sama', async () => {
    const t = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]) })
    await outbox.markSyncing(t.id)
    expect((await outbox.get(t.id))!.status).toBe('SYNCING')
    expect(await outbox.recoverInterrupted()).toBe(1)
    const r = await outbox.get(t.id)
    expect(r).toMatchObject({ status: 'PENDING', clientTransactionId: t.clientTransactionId, attempts: 1 })
  })

  it('counts per status dan per pengguna', async () => {
    const a = await outbox.enqueue({ userId: 'u1', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]) })
    await outbox.enqueue({ userId: 'u2', type: 'IN', payload: payload([{ sku: 'B', quantity: '1', unit_cost: '1' }]) })
    await outbox.markRejected(a.id, 'CONFLICT', 'insufficient', 'stok kurang')
    expect(await outbox.counts()).toEqual({ PENDING: 1, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 1 })
    expect(await outbox.counts('u1')).toEqual({ PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 1 })
  })

  it('penolakan server menyimpan penyebab dan TIDAK mengubah isi transaksi', async () => {
    const t = await outbox.enqueue({ userId: 'u', type: 'OUT', payload: payload([{ sku: 'A', quantity: '8' }]) })
    await outbox.markRejected(t.id, 'CONFLICT', 'insufficient', 'Stok tidak mencukupi untuk SKU A: tersedia 5, diminta 8')
    const r = (await outbox.get(t.id))!
    expect(r).toMatchObject({ status: 'CONFLICT', errorKind: 'insufficient', error: expect.stringContaining('tersedia 5') })
    expect(r.payload.items).toEqual([{ sku: 'A', quantity: '8' }])
    expect(r.clientTransactionId).toBe(t.clientTransactionId)
  })

  it('gangguan jaringan mengembalikan ke PENDING dengan catatan, bukan FAILED', async () => {
    const t = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]) })
    await outbox.markSyncing(t.id)
    await outbox.markPending(t.id, 'Tidak dapat terhubung')
    expect(await outbox.get(t.id)).toMatchObject({ status: 'PENDING', errorKind: 'offline', error: 'Tidak dapat terhubung', attempts: 1 })
  })
})

describe('perbaikan dan pembatalan oleh pengguna', () => {
  it('edit hanya untuk FAILED/CONFLICT: kunci baru, urutan dipertahankan, status PENDING', async () => {
    const t = await outbox.enqueue({ userId: 'u', type: 'OUT', payload: payload([{ sku: 'A', quantity: '8' }]) })
    await expect(outbox.edit(t.id, { items: [{ sku: 'A', quantity: '5' }] })).rejects.toThrow(/FAILED atau CONFLICT/) // masih PENDING
    await outbox.markRejected(t.id, 'CONFLICT', 'insufficient', 'stok kurang')
    const e = await outbox.edit(t.id, { items: [{ sku: 'A', quantity: '5' }], notes: 'dikoreksi' })
    expect(e.clientTransactionId).not.toBe(t.clientTransactionId)
    const r = (await outbox.get(t.id))!
    expect(r).toMatchObject({ status: 'PENDING', seq: t.seq, attempts: 0 })
    expect(r.error).toBeUndefined()
    expect(r.errorKind).toBeUndefined()
    expect(r.blockedBy).toBeUndefined()
    expect(r.payload).toMatchObject({ items: [{ sku: 'A', quantity: '5' }], notes: 'dikoreksi', reference: 'DOK-1' })
  })

  it('edit memperbarui daftar SKU (indeks ketergantungan)', async () => {
    const t = await outbox.enqueue({ userId: 'u', type: 'OUT', payload: payload([{ sku: 'A', quantity: '8' }]) })
    await outbox.markRejected(t.id, 'FAILED', 'validation', 'x')
    await outbox.edit(t.id, { items: [{ sku: 'B', quantity: '1' }] })
    expect((await outbox.get(t.id))!.skus).toEqual(['B'])
  })

  it('SYNCED tidak dapat diedit atau dibatalkan; SYNCING tidak dapat dibatalkan', async () => {
    const t = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]) })
    await outbox.markSyncing(t.id)
    await expect(outbox.cancel(t.id)).rejects.toThrow(/sedang dikirim/)
    await outbox.markSynced(t.id, { transaction_id: 'x', transaction_number: 'IN-1', type: 'IN', status: 'POSTED', posting_sequence: 1, duplicate: false, items: [] })
    await expect(outbox.cancel(t.id)).rejects.toThrow(/tidak dapat dibatalkan/)
    await expect(outbox.edit(t.id, { notes: 'x' })).rejects.toThrow()
    expect(await outbox.get(t.id)).toBeDefined()
  })

  it('pembatalan menghapus hanya entri itu', async () => {
    const a = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]) })
    const b = await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'B', quantity: '1', unit_cost: '1' }]) })
    await outbox.cancel(a.id)
    expect((await outbox.listAll()).map((t) => t.id)).toEqual([b.id])
  })

  it('riwayat SYNCED lama dibersihkan, yang baru dan yang belum selesai dipertahankan', async () => {
    const mk = (sku: string) => outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku, quantity: '1', unit_cost: '1' }]) })
    const [old, fresh, open] = [await mk('A'), await mk('B'), await mk('C')]
    const res = { transaction_id: 'x', transaction_number: 'N', type: 'IN', status: 'POSTED', posting_sequence: 1, duplicate: false, items: [] }
    await outbox.markSynced(old.id, res, new Date('2026-11-01T00:00:00Z'))
    await outbox.markSynced(fresh.id, res, new Date('2026-11-18T00:00:00Z'))
    const removed = await outbox.purgeSynced(7 * 86_400_000, new Date('2026-11-19T00:00:00Z'))
    expect(removed).toBe(1)
    expect((await outbox.listAll()).map((t) => t.id)).toEqual([fresh.id, open.id])
  })
})

describe('urutan antar transaksi dan proyeksi stok', () => {
  it('hasUnsyncedFor: hanya milik pengguna itu dan hanya untuk SKU yang sama', async () => {
    const a = await outbox.enqueue({ userId: 'u1', type: 'IN', payload: payload([{ sku: 'A', quantity: '1', unit_cost: '1' }]) })
    expect(await outbox.hasUnsyncedFor('u1', ['A'])).toBe(true)
    expect(await outbox.hasUnsyncedFor('u1', ['B'])).toBe(false)
    expect(await outbox.hasUnsyncedFor('u2', ['A'])).toBe(false)
    await outbox.markRejected(a.id, 'FAILED', 'validation', 'x')
    expect(await outbox.hasUnsyncedFor('u1', ['A'])).toBe(true) // FAILED tetap menahan urutan
    await outbox.cancel(a.id)
    expect(await outbox.hasUnsyncedFor('u1', ['A'])).toBe(false)
  })

  it('queuedDelta menjumlah masuk dan keluar yang menunggu tanpa float', async () => {
    await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '0.1', unit_cost: '1' }]) })
    await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'A', quantity: '0.2', unit_cost: '1' }]) })
    expect(await outbox.queuedDelta('u', 'A')).toBe('0.3000')
    await outbox.enqueue({ userId: 'u', type: 'OUT', payload: payload([{ sku: 'A', quantity: '5' }]) })
    expect(await outbox.queuedDelta('u', 'A')).toBe('-4.7000')
    expect(await outbox.queuedDelta('u', 'Z')).toBe('0.0000')
    expect(await outbox.queuedDelta('lain', 'A')).toBe('0.0000')
  })
})

describe('cache lokal: pencarian dan scan offline', () => {
  const items: CachedItem[] = [
    { sku: 'SKU-1', barcode: '4006381333931', name: 'Air Mineral', category: 'Minuman', unit: 'PCS', active: true },
    { sku: '00123', barcode: '0001234567890', name: 'Kopi Sachet', category: 'Minuman', unit: 'DUS', active: true },
    { sku: 'UPC-ITEM', barcode: '0042100005264', name: 'Barang UPC', category: null, unit: 'PCS', active: true },
    { sku: 'OLD-1', barcode: null, name: 'Barang Lama', category: null, unit: 'PCS', active: false },
    { sku: 'ABC-9', barcode: null, name: 'Kode Besar', category: null, unit: 'PCS', active: true },
  ]
  const balances: CachedBalance[] = [
    { sku: 'SKU-1', qty: '120', averageCost: '10666.666667', value: '1280000', updatedAt: '2026-11-19T00:00:00Z' },
    { sku: 'OLD-1', qty: '5', averageCost: '10', value: '50', updatedAt: '2026-11-19T00:00:00Z' },
  ]

  beforeEach(async () => {
    await cache.replaceAll(items, balances, new Date('2026-11-19T01:00:00Z'))
  })

  it('menyimpan waktu cache dan jumlah barang', async () => {
    expect(await cache.cachedAt()).toBe('2026-11-19T01:00:00.000Z')
    expect(await cache.count()).toBe(5)
  })

  it('cari menurut SKU, barcode, dan nama; hanya barang aktif; stok terakhir ikut tampil', async () => {
    const r = await cache.search('air')
    expect(r.map((p) => p.sku)).toEqual(['SKU-1'])
    expect(r[0]).toMatchObject({ quantity: '120', average_cost: '10666.666667', product_name: 'Air Mineral', unit: 'PCS' })
    expect((await cache.search('4006381')).map((p) => p.sku)).toEqual(['SKU-1'])
    expect((await cache.search('sku-1')).map((p) => p.sku)).toEqual(['SKU-1'])
    expect((await cache.search('lama'))).toEqual([]) // nonaktif tidak dicari
    expect(await cache.search('   ')).toEqual([])
  })

  it('barang tanpa saldo di cache dianggap stok 0', async () => {
    expect((await cache.search('kopi'))[0]).toMatchObject({ sku: '00123', quantity: '0' })
  })

  it('scan: barcode, SKU bernol di depan, UPC-A -> EAN-13, huruf kecil, tidak ditemukan, nonaktif', async () => {
    expect(await cache.findByScan('4006381333931')).toMatchObject({ kind: 'found', matchedBy: 'barcode', product: { sku: 'SKU-1', quantity: '120' } })
    expect(await cache.findByScan('00123')).toMatchObject({ kind: 'found', matchedBy: 'sku', product: { sku: '00123' } })
    expect(await cache.findByScan('042100005264')).toMatchObject({ kind: 'found', product: { sku: 'UPC-ITEM' } })
    expect(await cache.findByScan('abc-9')).toMatchObject({ kind: 'found', product: { sku: 'ABC-9' } })
    expect(await cache.findByScan('TIDAK-ADA')).toEqual({ kind: 'none', scanned: 'TIDAK-ADA' })
    expect(await cache.findByScan('OLD-1')).toMatchObject({ kind: 'inactive' })
    expect(await cache.findByScan('{"sku":"SKU-1"}')).toMatchObject({ kind: 'found', product: { sku: 'SKU-1' } })
  })

  it('replaceAll mengganti seluruh isi: barang yang hilang di server ikut hilang', async () => {
    await cache.replaceAll([items[0]], [balances[0]])
    expect(await cache.count()).toBe(1)
    expect(await cache.findByScan('00123')).toMatchObject({ kind: 'none' })
  })

  it('saldo dari hasil posting memperbarui cache; hasil tanpa saldo diabaikan', async () => {
    await cache.applyPostedBalances([
      { sku: 'SKU-1', quantity: '30.0000', unit_cost: '1', total_value: '1', average_cost_before: '1', average_cost_after: '10666.666667', balance_quantity: '90.0000', balance_value: '960000.00' },
    ])
    expect((await cache.stockFor(['SKU-1'])).get('SKU-1')).toMatchObject({ quantity: '90.0000', inventory_value: '960000.00', average_cost: '10666.666667' })
  })

  it('clear mengosongkan cache tetapi TIDAK menyentuh antrean', async () => {
    await outbox.enqueue({ userId: 'u', type: 'IN', payload: payload([{ sku: 'SKU-1', quantity: '1', unit_cost: '1' }]) })
    await cache.clear()
    expect(await cache.count()).toBe(0)
    expect(await cache.cachedAt()).toBeNull()
    expect(await db.outbox.count()).toBe(1)
  })
})
