import 'fake-indexeddb/auto'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealDb, type RealDb } from './pg'
import { LocalCache } from '../../src/database/cache'
import { WhistleDB } from '../../src/database/db'
import { Outbox } from '../../src/database/outbox'
import { PostFailure, type PostResult } from '../../src/services/transactions'
import { classifyFailure, syncOutbox, type SyncDeps } from '../../src/services/sync'
import { mapPostError, toRpcParams, type PostRequest } from '../../src/utils/transactionForm'
import type { OutboxPayload } from '../../src/types'

let t: RealDb
let admin: string
let ali: string
let budi: string
let n = 0
let dbn = 0

const q = (sql: string, params: unknown[] = []) => t.admin.query(sql, params)

async function product(active = true): Promise<string> {
  const sku = `SYNC-${++n}`
  await q(`insert into public.products (sku, product_name, unit, is_active) values ($1, $2, 'PCS', $3)`, [sku, `Barang ${sku}`, active])
  return sku
}

async function rpc(who: string, req: PostRequest): Promise<PostResult> {
  const p = toRpcParams(req)
  const r = await t.callAs(
    who,
    `select public.post_transaction(p_client_transaction_id := $1, p_type := $2, p_date := $3, p_reference := $4, p_party := $5,
       p_notes := $6, p_items := $7::jsonb, p_reason := $8, p_allow_backdate := $9) as r`,
    [p.p_client_transaction_id, p.p_type, p.p_date, p.p_reference, p.p_party, p.p_notes, JSON.stringify(p.p_items), p.p_reason, p.p_allow_backdate],
  )
  return r.rows[0].r as PostResult
}

async function seed(sku: string, qty: number, value: number) {
  await t.callAs(admin, `select public.post_transaction($1, 'OPENING', now(), 'OPENING', null, null, $2::jsonb)`, [
    randomUUID(),
    JSON.stringify([{ sku, quantity: String(qty), total_value: String(value) }]),
  ])
}

async function stock(sku: string) {
  const r = await q(`select sb.quantity::text as qty, sb.inventory_value::text as val from public.stock_balances sb join public.products p on p.id = sb.product_id where p.sku = $1`, [sku])
  return r.rows[0] as { qty: string; val: string } | undefined
}
const txCount = async (clientId: string) => Number((await q(`select count(*)::int as n from public.inventory_transactions where client_transaction_id = $1`, [clientId])).rows[0].n)

interface Env {
  outbox: Outbox
  cache: LocalCache
  db: WhistleDB
  calls: PostRequest[]
  /** true = jaringan putus (permintaan tidak sampai ke server) */
  offline: { value: boolean }
  /** respons hilang: server memproses, tetapi klien tidak menerima jawaban */
  loseResponses: { count: number }
  /** error sementara tak dikenal dari server */
  serverErrors: { count: number }
  deps: (userId: string) => SyncDeps
}

function env(): Env {
  const db = new WhistleDB(`sync-test-${++dbn}-${Math.random().toString(36).slice(2)}`)
  const outbox = new Outbox(db)
  const cache = new LocalCache(db)
  const calls: PostRequest[] = []
  const offline = { value: false }
  const loseResponses = { count: 0 }
  const serverErrors = { count: 0 }
  return {
    outbox, cache, db, calls, offline, loseResponses, serverErrors,
    deps: (userId) => ({
      outbox, cache, userId,
      post: async (req) => {
        calls.push(req)
        if (offline.value) throw new PostFailure({ kind: 'offline', message: 'Tidak dapat terhubung ke server' })
        if (serverErrors.count > 0) {
          serverErrors.count--
          throw new PostFailure({ kind: 'unknown', message: 'Server error sementara' })
        }
        try {
          const res = await rpc(userId, req)
          if (loseResponses.count > 0) {
            loseResponses.count--
            throw new PostFailure({ kind: 'offline', message: 'Koneksi terputus sebelum jawaban diterima' })
          }
          return res
        } catch (e) {
          if (e instanceof PostFailure) throw e
          throw new PostFailure(mapPostError(e as { code?: string; message?: string }))
        }
      },
    }),
  }
}

const payload = (items: { sku: string; quantity: string; unit_cost?: string }[], over: Partial<OutboxPayload> = {}): OutboxPayload => ({
  dateIso: new Date().toISOString(),
  dateInput: new Date().toISOString().slice(0, 10),
  reference: 'OFF-1',
  party: 'Pihak',
  notes: '',
  items,
  allowBackdate: false,
  names: Object.fromEntries(items.map((i) => [i.sku, { name: i.sku, unit: 'PCS' }])),
  ...over,
})
const inTx = (e: Env, user: string, sku: string, qty: string, cost: string, over: Partial<OutboxPayload> = {}) =>
  e.outbox.enqueue({ userId: user, type: 'IN', payload: payload([{ sku, quantity: qty, unit_cost: cost }], over) })
const outTx = (e: Env, user: string, sku: string, qty: string, over: Partial<OutboxPayload> = {}) =>
  e.outbox.enqueue({ userId: user, type: 'OUT', payload: payload([{ sku, quantity: qty }], over) })
const statuses = async (e: Env) => (await e.outbox.listAll()).map((x) => x.status)

beforeAll(async () => {
  t = await startRealDb()
  admin = await t.createUser('admin@whistle.test', 'ADMIN')
  ali = await t.createUser('ali@whistle.test', 'WAREHOUSE')
  budi = await t.createUser('budi@whistle.test', 'WAREHOUSE')
})
afterAll(async () => {
  await t?.stop()
})

describe('klasifikasi kegagalan', () => {
  it('jaringan/server sementara = transient; kondisi server berubah = conflict; data/hak salah = failed', () => {
    expect(classifyFailure('offline')).toBe('transient')
    expect(classifyFailure('unknown')).toBe('transient')
    for (const k of ['insufficient', 'backdated', 'inactive', 'notfound'] as const) expect(classifyFailure(k)).toBe('conflict')
    for (const k of ['validation', 'forbidden'] as const) expect(classifyFailure(k)).toBe('failed')
  })
})

describe('transaksi offline lalu sinkronisasi', () => {
  it('transaksi masuk dan keluar offline diposting berurutan; hasil resmi dari server; cache diperbarui', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 100, 1_000_000)
    // cache terakhir yang diketahui (diambil saat masih online)
    await e.cache.replaceAll(
      [{ sku, barcode: null, name: `Barang ${sku}`, category: null, unit: 'PCS', active: true }],
      [{ sku, qty: '100.0000', averageCost: '10000.000000', value: '1000000.00', updatedAt: new Date().toISOString() }],
    )
    e.offline.value = true
    const a = await inTx(e, ali, sku, '50', '12000') // 150 unit, avg 10666.666667
    const b = await outTx(e, ali, sku, '30') // HPP 320.000
    expect(await statuses(e)).toEqual(['PENDING', 'PENDING'])

    // masih offline: tidak ada yang berubah di server, data lokal utuh
    const off = await syncOutbox(e.deps(ali))
    expect(off.stoppedByNetwork).toBe(true)
    expect(await stock(sku)).toEqual({ qty: '100.0000', val: '1000000.00' })
    expect(await statuses(e)).toEqual(['PENDING', 'PENDING'])
    expect((await e.outbox.get(a.id))!.payload.items).toEqual([{ sku, quantity: '50', unit_cost: '12000' }])

    // koneksi pulih
    e.offline.value = false
    e.calls.length = 0
    const s = await syncOutbox(e.deps(ali))
    expect(s).toMatchObject({ attempted: 2, synced: 2, conflicts: 0, failed: 0, stoppedByNetwork: false })
    expect(await statuses(e)).toEqual(['SYNCED', 'SYNCED'])
    expect(e.calls.map((c) => c.clientTransactionId)).toEqual([a.clientTransactionId, b.clientTransactionId]) // urutan lokal dipertahankan
    expect(await stock(sku)).toEqual({ qty: '120.0000', val: '1280000.00' })

    const done = (await e.outbox.get(b.id))!
    expect(done.result!.items[0]).toMatchObject({ total_value: '320000.00', balance_quantity: '120.0000', balance_value: '1280000.00' })
    expect(done.result!.transaction_number).toMatch(/^OUT-/)
    expect(done.syncedAt).toBeDefined()
    // cache lokal mengikuti hasil server
    expect((await e.cache.stockFor([sku])).get(sku)).toMatchObject({ quantity: '120.0000', inventory_value: '1280000.00' })
    // pembuat transaksi = pengguna yang mengirim
    const who = await q(`select created_by from public.inventory_transactions where client_transaction_id = $1`, [a.clientTransactionId])
    expect(who.rows[0].created_by).toBe(ali)
  })

  it('urutan dijaga: keluar yang bergantung pada masuk sebelumnya tidak ditolak karena stok', async () => {
    const e = env()
    const sku = await product() // stok 0
    const buy = await inTx(e, ali, sku, '10', '100')
    const sell = await outTx(e, ali, sku, '8')
    const s = await syncOutbox(e.deps(ali))
    expect(s).toMatchObject({ synced: 2, conflicts: 0 })
    expect(await stock(sku)).toEqual({ qty: '2.0000', val: '200.00' })
    expect(buy.seq! < sell.seq!).toBe(true)
  })

  it('SYNCED tidak pernah dikirim ulang pada sinkronisasi berikutnya', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 100)
    await outTx(e, ali, sku, '3')
    await syncOutbox(e.deps(ali))
    const callsAfterFirst = e.calls.length
    const again = await syncOutbox(e.deps(ali))
    const third = await syncOutbox(e.deps(ali))
    expect(e.calls.length).toBe(callsAfterFirst)
    expect(again.attempted + third.attempted).toBe(0)
    expect((await stock(sku))!.qty).toBe('7.0000')
  })

  it('sinkronisasi bersamaan hanya satu proses (tidak mengirim ganda)', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 100, 1000)
    for (let i = 0; i < 5; i++) await outTx(e, ali, sku, '1')
    const [r1, r2, r3] = await Promise.all([syncOutbox(e.deps(ali)), syncOutbox(e.deps(ali)), syncOutbox(e.deps(ali))])
    expect(r1).toBe(r2)
    expect(r2).toBe(r3)
    expect(e.calls).toHaveLength(5)
    expect((await stock(sku))!.qty).toBe('95.0000')
  })

  it('transaksi yang dicatat saat sinkronisasi berjalan ikut terkirim', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 100, 1000)
    await outTx(e, ali, sku, '1')
    const deps = e.deps(ali)
    let injected = false
    const post: SyncDeps['post'] = async (req) => {
      if (!injected) {
        injected = true
        await outTx(e, ali, sku, '2') // dicatat selagi pengiriman pertama berjalan
      }
      return deps.post(req)
    }
    const s = await syncOutbox({ ...deps, post })
    expect(s.synced).toBe(2)
    expect((await stock(sku))!.qty).toBe('97.0000')
  })
})

describe('konflik stok (perangkat lain mengubah stok)', () => {
  it('CONFLICT dengan penyebab jelas; data lokal tidak berubah dan tidak dikirim ulang otomatis', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 1000)
    e.offline.value = true
    const mine = await outTx(e, ali, sku, '8') // menurut cache stok 10
    // sementara offline, pengguna lain mengambil 5
    await rpc(budi, { type: 'OUT', clientTransactionId: randomUUID(), dateIso: new Date().toISOString(), reference: '', party: '', notes: '', items: [{ sku, quantity: '5' }], allowBackdate: false })
    e.offline.value = false

    const s = await syncOutbox(e.deps(ali))
    expect(s).toMatchObject({ attempted: 1, synced: 0, conflicts: 1 })
    const c = (await e.outbox.get(mine.id))!
    expect(c).toMatchObject({ status: 'CONFLICT', errorKind: 'insufficient' })
    expect(c.error).toMatch(/Stok tidak mencukupi.*tersedia 5\.0000, diminta 8/)
    expect(c.payload.items).toEqual([{ sku, quantity: '8' }]) // kuantitas TIDAK diubah otomatis
    expect(c.clientTransactionId).toBe(mine.clientTransactionId)
    expect((await stock(sku))!.qty).toBe('5.0000')

    // sinkronisasi berikutnya tidak mencoba lagi (menunggu keputusan pengguna)
    e.calls.length = 0
    await syncOutbox(e.deps(ali))
    expect(e.calls).toHaveLength(0)
  })

  it('perbaikan oleh pengguna (kuantitas dikurangi) lalu sinkronisasi berhasil', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 1000)
    const mine = await outTx(e, ali, sku, '8')
    await rpc(budi, { type: 'OUT', clientTransactionId: randomUUID(), dateIso: new Date().toISOString(), reference: '', party: '', notes: '', items: [{ sku, quantity: '5' }], allowBackdate: false })
    await syncOutbox(e.deps(ali))
    expect((await e.outbox.get(mine.id))!.status).toBe('CONFLICT')

    await e.outbox.edit(mine.id, { items: [{ sku, quantity: '5' }] })
    const s = await syncOutbox(e.deps(ali))
    expect(s.synced).toBe(1)
    expect((await e.outbox.get(mine.id))!.status).toBe('SYNCED')
    expect((await stock(sku))!.qty).toBe('0.0000')
  })

  it('transaksi berikutnya pada SKU yang sama ditahan; SKU lain tetap berjalan', async () => {
    const e = env()
    const a = await product()
    const b = await product()
    await seed(a, 5, 500)
    await seed(b, 5, 500)
    const bad = await outTx(e, ali, a, '9') // akan konflik
    const later = await inTx(e, ali, a, '2', '100') // bergantung pada SKU a
    const other = await outTx(e, ali, b, '1') // SKU berbeda
    const s = await syncOutbox(e.deps(ali))
    expect(s).toMatchObject({ conflicts: 1, synced: 1, blocked: 1 })
    expect((await e.outbox.get(bad.id))!.status).toBe('CONFLICT')
    const held = (await e.outbox.get(later.id))!
    expect(held).toMatchObject({ status: 'PENDING', blockedBy: bad.id, attempts: 0 })
    expect((await e.outbox.get(other.id))!.status).toBe('SYNCED')
    expect((await stock(a))!.qty).toBe('5.0000') // tidak ada yang diposting untuk SKU a

    // setelah konflik dibatalkan pengguna, transaksi yang ditahan terkirim
    await e.outbox.cancel(bad.id)
    const s2 = await syncOutbox(e.deps(ali))
    expect(s2.synced).toBe(1)
    expect((await e.outbox.get(later.id))!.status).toBe('SYNCED')
    expect((await stock(a))!.qty).toBe('7.0000')
  })

  it('dokumen multi-SKU: satu SKU kurang membatalkan seluruh dokumen di server dan menahan kedua SKU', async () => {
    const e = env()
    const a = await product()
    const b = await product()
    await seed(a, 10, 100)
    await seed(b, 1, 10)
    const doc = await e.outbox.enqueue({ userId: ali, type: 'OUT', payload: payload([{ sku: a, quantity: '5' }, { sku: b, quantity: '3' }]) })
    const after = await outTx(e, ali, a, '1')
    const s = await syncOutbox(e.deps(ali))
    expect(s).toMatchObject({ conflicts: 1, blocked: 1 })
    expect((await e.outbox.get(doc.id))!.status).toBe('CONFLICT')
    expect((await stock(a))!.qty).toBe('10.0000') // tidak ada yang berubah sebagian
    expect((await e.outbox.get(after.id))!.blockedBy).toBe(doc.id)
  })

  it('tanggal mundur bentrok dengan mutasi terbaru = CONFLICT; ADMIN dapat menyetujui lewat perbaikan', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 100)
    await rpc(admin, { type: 'IN', clientTransactionId: randomUUID(), dateIso: new Date().toISOString(), reference: '', party: '', notes: '', items: [{ sku, quantity: '1', unit_cost: '10' }], allowBackdate: false })
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString()
    const item = await inTx(e, admin, sku, '5', '10', { dateIso: old, dateInput: old.slice(0, 10) })
    await syncOutbox(e.deps(admin))
    expect(await e.outbox.get(item.id)).toMatchObject({ status: 'CONFLICT', errorKind: 'backdated' })
    await e.outbox.edit(item.id, { allowBackdate: true })
    expect((await syncOutbox(e.deps(admin))).synced).toBe(1)
  })

  it('barang yang dinonaktifkan atau tidak ada = CONFLICT (bukan FAILED)', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 100)
    const x = await outTx(e, ali, sku, '1')
    await q(`update public.products set is_active = false where sku = $1`, [sku])
    const y = await inTx(e, ali, 'TIDAK-ADA-DI-SERVER', '1', '1')
    await syncOutbox(e.deps(ali))
    expect(await e.outbox.get(x.id)).toMatchObject({ status: 'CONFLICT', errorKind: 'inactive' })
    expect(await e.outbox.get(y.id)).toMatchObject({ status: 'CONFLICT', errorKind: 'notfound' })
  })
})

describe('kegagalan jaringan dan pemulihan koneksi', () => {
  it('jaringan putus di tengah: yang sudah terkirim tetap SYNCED, sisanya PENDING utuh dan urut, lalu pulih', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 100, 1000)
    const a = await outTx(e, ali, sku, '1')
    const b = await outTx(e, ali, sku, '2')
    const c = await outTx(e, ali, sku, '3')
    const deps = e.deps(ali)
    let n1 = 0
    const flaky: SyncDeps['post'] = async (req) => {
      if (++n1 === 2) throw new PostFailure({ kind: 'offline', message: 'Koneksi terputus' })
      return deps.post(req)
    }
    const s = await syncOutbox({ ...deps, post: flaky })
    expect(s).toMatchObject({ synced: 1, stoppedByNetwork: true })
    expect(await statuses(e)).toEqual(['SYNCED', 'PENDING', 'PENDING'])
    expect(await e.outbox.get(b.id)).toMatchObject({ attempts: 1, errorKind: 'offline', error: 'Koneksi terputus' })
    expect(await e.outbox.get(c.id)).toMatchObject({ attempts: 0 }) // belum disentuh
    expect((await stock(sku))!.qty).toBe('99.0000')

    const s2 = await syncOutbox(deps)
    expect(s2.synced).toBe(2)
    expect(await statuses(e)).toEqual(['SYNCED', 'SYNCED', 'SYNCED'])
    expect((await stock(sku))!.qty).toBe('94.0000')
    expect([a, b, c].every((x) => x.seq)).toBe(true)
  })

  it('RESPONS HILANG: server sudah memposting tetapi klien tidak menerima jawaban; retry tidak menggandakan', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 100, 10000)
    const item = await outTx(e, ali, sku, '10')
    e.loseResponses.count = 1
    const s1 = await syncOutbox(e.deps(ali))
    expect(s1.stoppedByNetwork).toBe(true)
    expect((await e.outbox.get(item.id))!.status).toBe('PENDING')
    expect((await stock(sku))!.qty).toBe('90.0000') // server sudah memposting!
    expect(await txCount(item.clientTransactionId)).toBe(1)

    const s2 = await syncOutbox(e.deps(ali))
    expect(s2).toMatchObject({ synced: 1, duplicates: 1 })
    expect((await e.outbox.get(item.id))!.status).toBe('SYNCED')
    expect((await stock(sku))!.qty).toBe('90.0000') // tidak berkurang lagi
    expect(await txCount(item.clientTransactionId)).toBe(1)
  })

  it('hasil duplikat tidak menimpa cache dengan saldo usang', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 100, 10000)
    const item = await outTx(e, ali, sku, '10')
    e.loseResponses.count = 1
    await syncOutbox(e.deps(ali))
    // cache sudah diperbarui dari server dengan saldo yang lebih baru
    await e.cache.replaceAll([{ sku, barcode: null, name: sku, category: null, unit: 'PCS', active: true }], [{ sku, qty: '42', averageCost: '100', value: '4200', updatedAt: new Date().toISOString() }])
    await syncOutbox(e.deps(ali))
    expect((await e.outbox.get(item.id))!.status).toBe('SYNCED')
    expect((await e.cache.stockFor([sku])).get(sku)!.quantity).toBe('42') // tidak ditimpa saldo lama (90)
  })

  it('aplikasi mati saat mengirim (SYNCING): pulih ke PENDING dan dikirim ulang dengan kunci yang sama tanpa duplikat', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 20, 200)
    const item = await outTx(e, ali, sku, '5')
    // server memposting, lalu aplikasi mati sebelum status lokal diperbarui
    await rpc(ali, { type: 'OUT', clientTransactionId: item.clientTransactionId, dateIso: item.payload.dateIso, reference: item.payload.reference, party: item.payload.party, notes: '', items: item.payload.items, allowBackdate: false })
    await e.outbox.markSyncing(item.id)
    expect((await e.outbox.get(item.id))!.status).toBe('SYNCING')

    const s = await syncOutbox(e.deps(ali))
    expect(s).toMatchObject({ synced: 1, duplicates: 1 })
    expect(await txCount(item.clientTransactionId)).toBe(1)
    expect((await stock(sku))!.qty).toBe('15.0000')
  })

  it('error server sementara: tetap PENDING; setelah 5 percobaan berubah FAILED agar tidak berputar selamanya', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 100)
    const item = await outTx(e, ali, sku, '1')
    e.serverErrors.count = 100
    for (let i = 1; i <= 4; i++) {
      await syncOutbox(e.deps(ali))
      expect(await e.outbox.get(item.id)).toMatchObject({ status: 'PENDING', attempts: i, errorKind: 'unknown' })
    }
    await syncOutbox(e.deps(ali))
    expect(await e.outbox.get(item.id)).toMatchObject({ status: 'FAILED', attempts: 5 })
    expect((await e.outbox.get(item.id))!.payload.items).toEqual([{ sku, quantity: '1' }])
    expect((await stock(sku))!.qty).toBe('10.0000')
  })
})

describe('kegagalan validasi dan hak akses', () => {
  it('data tidak valid ditolak server sebagai FAILED dan tidak diubah otomatis', async () => {
    const e = env()
    const sku = await product()
    const bad = await e.outbox.enqueue({ userId: ali, type: 'IN', payload: payload([{ sku, quantity: '1' }]) }) // harga beli tidak ada
    const s = await syncOutbox(e.deps(ali))
    expect(s).toMatchObject({ failed: 1, synced: 0 })
    const r = (await e.outbox.get(bad.id))!
    expect(r).toMatchObject({ status: 'FAILED', errorKind: 'validation' })
    expect(r.error).toMatch(/harga beli/i)
    expect(r.payload.items).toEqual([{ sku, quantity: '1' }])
    // diperbaiki pengguna lalu berhasil
    await e.outbox.edit(bad.id, { items: [{ sku, quantity: '1', unit_cost: '10' }] })
    expect((await syncOutbox(e.deps(ali))).synced).toBe(1)
  })

  it('pengguna yang dinonaktifkan: FAILED (forbidden), tidak ada yang diposting', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 100)
    const off = await t.createUser(`off-${n}@whistle.test`, 'WAREHOUSE')
    const item = await outTx(e, off, sku, '1')
    await q(`update public.profiles set is_active = false where id = $1`, [off])
    await syncOutbox(e.deps(off))
    expect(await e.outbox.get(item.id)).toMatchObject({ status: 'FAILED', errorKind: 'forbidden' })
    expect((await stock(sku))!.qty).toBe('10.0000')
  })

  it('WAREHOUSE tidak dapat menyetujui transaksi mundur lewat antrean (forbidden)', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 10, 100)
    const item = await inTx(e, ali, sku, '1', '10', { allowBackdate: true })
    await syncOutbox(e.deps(ali))
    expect(await e.outbox.get(item.id)).toMatchObject({ status: 'FAILED', errorKind: 'forbidden' })
  })
})

describe('banyak pengguna di satu perangkat', () => {
  it('transaksi milik pengguna lain tidak dikirim atas nama pengguna yang sedang login', async () => {
    const e = env()
    const sku = await product()
    await seed(sku, 20, 200)
    const aliTx = await outTx(e, ali, sku, '2')
    const budiTx = await outTx(e, budi, sku, '3')

    const s = await syncOutbox(e.deps(budi))
    expect(s).toMatchObject({ synced: 1, skippedOtherUser: 1 })
    expect((await e.outbox.get(aliTx.id))!.status).toBe('PENDING') // tetap menunggu pemiliknya
    const owner = await q(`select created_by from public.inventory_transactions where client_transaction_id = $1`, [budiTx.clientTransactionId])
    expect(owner.rows[0].created_by).toBe(budi)

    await syncOutbox(e.deps(ali))
    const owner2 = await q(`select created_by from public.inventory_transactions where client_transaction_id = $1`, [aliTx.clientTransactionId])
    expect(owner2.rows[0].created_by).toBe(ali)
    expect((await stock(sku))!.qty).toBe('15.0000')
  })
})

describe('ringkasan akhir: tidak ada transaksi ganda di server', () => {
  it('setiap client_transaction_id yang tersinkron muncul tepat satu kali', async () => {
    const dup = await q(`select client_transaction_id, count(*) from public.inventory_transactions group by 1 having count(*) > 1`)
    expect(dup.rows).toEqual([])
    const rec = await q(`select count(*)::int as n from (select 1 from public.inventory_movements m group by m.transaction_item_id having count(*) > 1) x`)
    expect(rec.rows[0].n).toBe(0)
  })
})
