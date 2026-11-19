import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealDb, type RealDb } from './pg'
import {
  buildItems,
  estimateValue,
  mapPostError,
  resolveTransactionDate,
  toRpcParams,
  validateLines,
  type PostError,
  type PostRequest,
  type TxLine,
  type TxType,
} from '../../src/utils/transactionForm'

let t: RealDb
let admin: string
let wh: string
let viewer: string
let n = 0

const q = (sql: string, params: unknown[] = []) => t.admin.query(sql, params)
const count = async (table: string) => Number((await q(`select count(*)::int as n from public.${table}`)).rows[0].n)

async function product(active = true): Promise<string> {
  const sku = `FLOW-${++n}`
  await q(`insert into public.products (sku, product_name, unit, is_active) values ($1, $2, 'PCS', $3)`, [sku, `Barang ${sku}`, active])
  return sku
}

/** Stok seperti yang dilihat UI (angka dari PostgREST berupa number, lalu di-String). */
async function stockOf(sku: string) {
  const r = await q(
    `select sb.quantity, sb.average_cost, sb.inventory_value from public.stock_balances sb join public.products p on p.id = sb.product_id where p.sku = $1`,
    [sku],
  )
  const row = r.rows[0] ?? { quantity: '0', average_cost: '0', inventory_value: '0' }
  return { quantity: String(Number(row.quantity)), average_cost: String(Number(row.average_cost)), inventory_value: String(Number(row.inventory_value)) }
}

async function toLine(sku: string, quantity: string, unitCost = ''): Promise<TxLine> {
  const s = await stockOf(sku)
  return { sku, name: sku, unit: 'PCS', quantity, unitCost, available: s.quantity, averageCost: s.average_cost, inventoryValue: s.inventory_value }
}

const lineNoStock = (sku: string, quantity: string, unitCost = ''): TxLine => ({ sku, name: sku, unit: 'PCS', quantity, unitCost })

function request(type: TxType, lines: TxLine[], over: Partial<PostRequest> & { date?: string } = {}): PostRequest {
  const d = resolveTransactionDate(over.date ?? new Date().toISOString().slice(0, 10))
  return {
    type,
    clientTransactionId: over.clientTransactionId ?? randomUUID(),
    dateIso: over.dateIso ?? d.iso,
    reference: over.reference ?? 'DOK-1',
    party: over.party ?? 'Pihak',
    notes: over.notes ?? '',
    items: buildItems(type, lines),
    allowBackdate: over.allowBackdate ?? false,
  }
}

/** Sama seperti supabase.rpc('post_transaction', toRpcParams(req)): parameter BERNAMA. */
async function rpc(who: string, req: PostRequest) {
  const p = toRpcParams(req)
  const r = await t.callAs(
    who,
    `select public.post_transaction(
       p_client_transaction_id := $1, p_type := $2, p_date := $3, p_reference := $4, p_party := $5,
       p_notes := $6, p_items := $7::jsonb, p_reason := $8, p_allow_backdate := $9) as r`,
    [p.p_client_transaction_id, p.p_type, p.p_date, p.p_reference, p.p_party, p.p_notes, JSON.stringify(p.p_items), p.p_reason, p.p_allow_backdate],
  )
  return r.rows[0].r as any
}

async function attempt(who: string, req: PostRequest): Promise<{ ok: true; res: any } | { ok: false; error: PostError }> {
  try {
    return { ok: true, res: await rpc(who, req) }
  } catch (e) {
    return { ok: false, error: mapPostError(e as { code?: string; message?: string }) }
  }
}

beforeAll(async () => {
  t = await startRealDb()
  admin = await t.createUser('admin@whistle.test', 'ADMIN')
  wh = await t.createUser('gudang@whistle.test', 'WAREHOUSE')
  viewer = await t.createUser('viewer@whistle.test', 'VIEWER')
})
afterAll(async () => {
  await t?.stop()
})

async function seed(sku: string, qty: number, value: number) {
  await t.callAs(admin, `select public.post_transaction($1, 'OPENING', now(), 'OPENING', null, null, $2::jsonb)`, [
    randomUUID(),
    JSON.stringify([{ sku, quantity: String(qty), total_value: String(value) }]),
  ])
}

describe('alur Barang Masuk lalu Barang Keluar (kode UI terhadap database)', () => {
  it('WAREHOUSE memposting IN dan OUT; hasil resmi berasal dari server', async () => {
    const sku = await product()
    await seed(sku, 100, 1_000_000)

    const inLines = [lineNoStock(sku, '50', '12000')]
    expect(validateLines('IN', inLines)).toEqual([])
    const buy = await attempt(wh, request('IN', inLines, { reference: 'PO-77', party: 'PT Pemasok', notes: 'Pembelian rutin' }))
    expect(buy.ok).toBe(true)
    if (!buy.ok) return
    expect(buy.res).toMatchObject({ type: 'IN', status: 'POSTED', duplicate: false })
    expect(buy.res.transaction_number).toMatch(/^IN-\d{6}-\d{6}$/)
    expect(buy.res.items[0]).toMatchObject({
      sku, quantity: '50.0000', total_value: '600000.00',
      average_cost_before: '10000.000000', average_cost_after: '10666.666667',
      balance_quantity: '150.0000', balance_value: '1600000.00',
    })
    const tx = await q(`select reference_number, supplier_or_recipient, notes, created_by from public.inventory_transactions where id = $1`, [buy.res.transaction_id])
    expect(tx.rows[0]).toEqual({ reference_number: 'PO-77', supplier_or_recipient: 'PT Pemasok', notes: 'Pembelian rutin', created_by: wh })

    const outLines = [await toLine(sku, '30')]
    expect(outLines[0].available).toBe('150')
    expect(validateLines('OUT', outLines)).toEqual([])
    const sale = await attempt(wh, request('OUT', outLines, { party: 'Toko A' }))
    expect(sale.ok).toBe(true)
    if (!sale.ok) return
    expect(sale.res.items[0]).toMatchObject({ total_value: '320000.00', balance_quantity: '120.0000', balance_value: '1280000.00' })
  })

  it('dokumen multi-SKU diposting dalam satu transaksi', async () => {
    const a = await product()
    const b = await product()
    await seed(a, 10, 100)
    await seed(b, 10, 200)
    const lines = [lineNoStock(a, '2', '10'), lineNoStock(b, '3', '20')]
    const r = await attempt(wh, request('IN', lines))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.res.items.map((i: any) => i.sku).sort()).toEqual([a, b].sort())
    const docs = await q(`select count(distinct transaction_id)::int as n from public.inventory_transaction_items where product_id in (select id from public.products where sku = any($1))`, [[a, b]])
    expect(docs.rows[0].n).toBe(3) // 2 OPENING + 1 dokumen IN
  })

  it('parameter RPC bernama cocok dengan fungsi database (kontrak UI-DB)', async () => {
    const sku = await product()
    await seed(sku, 5, 50)
    const req = request('OUT', [lineNoStock(sku, '1')])
    expect(Object.keys(toRpcParams(req)).sort()).toEqual([
      'p_allow_backdate', 'p_client_transaction_id', 'p_date', 'p_items', 'p_notes', 'p_party', 'p_reason', 'p_reference', 'p_type',
    ])
    expect((await attempt(wh, req)).ok).toBe(true)
  })
})

describe('penolakan stok kurang', () => {
  it('OUT melebihi stok: error "stok tidak mencukupi" dan tidak ada yang berubah', async () => {
    const sku = await product()
    await seed(sku, 5, 500)
    const before = { tx: await count('inventory_transactions'), mv: await count('inventory_movements'), stock: await stockOf(sku) }
    const r = await attempt(wh, request('OUT', [lineNoStock(sku, '6')]))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('insufficient')
    expect(r.error.message).toMatch(/tersedia 5\.0000, diminta 6/)
    expect(await count('inventory_transactions')).toBe(before.tx)
    expect(await count('inventory_movements')).toBe(before.mv)
    expect(await stockOf(sku)).toEqual(before.stock)
  })

  it('prefilter UI dan server sepakat: qty = stok diterima, qty > stok ditolak', async () => {
    const sku = await product()
    await seed(sku, 7, 100)
    const over = await toLine(sku, '7.0001')
    expect(validateLines('OUT', [over])[0].message).toMatch(/Melebihi stok tersedia/)
    const serverOver = await attempt(wh, request('OUT', [over]))
    expect(!serverOver.ok && serverOver.error.kind).toBe('insufficient')

    const exact = await toLine(sku, '7')
    expect(validateLines('OUT', [exact])).toEqual([])
    const serverExact = await attempt(wh, request('OUT', [exact]))
    expect(serverExact.ok).toBe(true)
    if (serverExact.ok) expect(serverExact.res.items[0]).toMatchObject({ balance_quantity: '0.0000', balance_value: '0.00' })
  })

  it('UI yang memakai stok usang tetap dilindungi server (stok sudah dipakai pengguna lain)', async () => {
    const sku = await product()
    await seed(sku, 10, 100)
    const staleLine = await toLine(sku, '8') // UI mengira stok 10
    expect(validateLines('OUT', [staleLine])).toEqual([])
    expect((await attempt(admin, request('OUT', [lineNoStock(sku, '5')]))).ok).toBe(true) // pengguna lain mengambil 5
    const r = await attempt(wh, request('OUT', [staleLine]))
    expect(!r.ok && r.error.kind).toBe('insufficient')
    expect((await stockOf(sku)).quantity).toBe('5')
  })

  it('satu barang kurang membatalkan seluruh dokumen multi-SKU', async () => {
    const a = await product()
    const b = await product()
    await seed(a, 50, 5000)
    await seed(b, 2, 200)
    const before = { tx: await count('inventory_transactions'), a: await stockOf(a), b: await stockOf(b) }
    const r = await attempt(wh, request('OUT', [lineNoStock(a, '10'), lineNoStock(b, '3')]))
    expect(!r.ok && r.error.kind).toBe('insufficient')
    expect(await count('inventory_transactions')).toBe(before.tx)
    expect(await stockOf(a)).toEqual(before.a)
    expect(await stockOf(b)).toEqual(before.b)
  })
})

describe('notifikasi untuk kesalahan lain', () => {
  it('SKU tidak ditemukan dan barang nonaktif', async () => {
    const dead = await product(false)
    const nf = await attempt(wh, request('IN', [lineNoStock('TIDAK-ADA', '1', '10')]))
    expect(!nf.ok && nf.error.kind).toBe('notfound')
    const off = await attempt(wh, request('IN', [lineNoStock(dead, '1', '10')]))
    expect(!off.ok && off.error.kind).toBe('inactive')
  })

  it('VIEWER ditolak (forbidden); nonaktif ditolak', async () => {
    const sku = await product()
    await seed(sku, 5, 50)
    const r = await attempt(viewer, request('OUT', [lineNoStock(sku, '1')]))
    expect(!r.ok && r.error.kind).toBe('forbidden')
    const off = await t.createUser('off@whistle.test', 'WAREHOUSE')
    await q(`update public.profiles set is_active = false where id = $1`, [off])
    const r2 = await attempt(off, request('OUT', [lineNoStock(sku, '1')]))
    expect(!r2.ok && r2.error.kind).toBe('forbidden')
  })

  it('tanggal mundur: WAREHOUSE ditolak, ADMIN dengan persetujuan berhasil', async () => {
    const sku = await product()
    await seed(sku, 20, 200)
    const past = resolveTransactionDate('2020-01-15')
    expect(past.relation).toBe('past')
    const denied = await attempt(wh, request('IN', [lineNoStock(sku, '1', '10')], { dateIso: past.iso }))
    expect(!denied.ok && denied.error.kind).toBe('backdated')
    const deniedAdmin = await attempt(admin, request('IN', [lineNoStock(sku, '1', '10')], { dateIso: past.iso }))
    expect(!deniedAdmin.ok && deniedAdmin.error.kind).toBe('backdated')
    const ok = await attempt(admin, request('IN', [lineNoStock(sku, '1', '10')], { dateIso: past.iso, allowBackdate: true }))
    expect(ok.ok).toBe(true)
    const wrongRole = await attempt(wh, request('IN', [lineNoStock(sku, '1', '10')], { dateIso: past.iso, allowBackdate: true }))
    expect(!wrongRole.ok && wrongRole.error.kind).toBe('forbidden')
  })

  it('tanggal di masa depan ditolak oleh server', async () => {
    const sku = await product()
    await seed(sku, 20, 200)
    const future = resolveTransactionDate(new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10))
    const r = await attempt(wh, request('IN', [lineNoStock(sku, '1', '10')], { dateIso: future.iso }))
    expect(!r.ok && r.error.kind).toBe('backdated') // WS002
  })
})

describe('retry dokumen yang sama (kunci idempotensi dari UI)', () => {
  it('klik Posting dua kali / retry jaringan tidak menggandakan transaksi', async () => {
    const sku = await product()
    await seed(sku, 100, 1000)
    const req = request('OUT', [lineNoStock(sku, '10')])
    const first = await attempt(wh, req)
    const retry = await attempt(wh, req)
    const third = await attempt(wh, { ...req })
    expect(first.ok && retry.ok && third.ok).toBe(true)
    if (!first.ok || !retry.ok || !third.ok) return
    expect(first.res.duplicate).toBe(false)
    expect(retry.res.duplicate).toBe(true)
    expect(third.res.transaction_id).toBe(first.res.transaction_id)
    expect((await stockOf(sku)).quantity).toBe('90')
  })

  it('setelah transaksi gagal, retry dengan kunci yang sama tetap aman dan berhasil saat stok tersedia', async () => {
    const sku = await product()
    await seed(sku, 3, 30)
    const req = request('OUT', [lineNoStock(sku, '5')])
    const fail = await attempt(wh, req)
    expect(!fail.ok && fail.error.kind).toBe('insufficient')
    await rpc(admin, request('IN', [lineNoStock(sku, '10', '10')])) // stok ditambah
    const retry = await attempt(wh, req) // kunci idempotensi sama dengan percobaan gagal
    expect(retry.ok).toBe(true)
    expect((await stockOf(sku)).quantity).toBe('8')
  })
})

describe('pratinjau UI vs hasil server', () => {
  it('estimasi HPP/nilai di pratinjau sama dengan angka resmi server pada kasus pembulatan', async () => {
    const cases: [number, number, string][] = [
      [3, 100, '1'], // avg 33.333333, keluar 1 -> 33.33
      [3, 100, '3'], // keluar habis -> seluruh sisa nilai 100.00
      [150, 1_600_000, '30'], // contoh wajib -> 320000.00
      [7, 100, '3'], // avg 14.285714 -> 42.86
      [1000, 123_456.78, '333.3333'],
    ]
    for (const [qty, value, out] of cases) {
      const sku = await product()
      await seed(sku, qty, value)
      const line = await toLine(sku, out)
      const estimate = estimateValue('OUT', line)
      const r = await attempt(wh, request('OUT', [line]))
      expect(r.ok).toBe(true)
      if (r.ok) expect(estimate, `qty=${qty} nilai=${value} keluar=${out}`).toBe(r.res.items[0].total_value)
    }
  })

  it('estimasi nilai pembelian sama dengan nilai resmi server', async () => {
    for (const [qty, cost] of [['2.5', '1234.567891'], ['3', '3.333333'], ['50', '12000'], ['0.0001', '0.01']]) {
      const sku = await product()
      await seed(sku, 1, 10)
      const line = lineNoStock(sku, qty, cost)
      const estimate = estimateValue('IN', line)
      const r = await attempt(wh, request('IN', [line]))
      expect(r.ok).toBe(true)
      if (r.ok) expect(estimate).toBe(r.res.items[0].total_value)
    }
  })
})

describe('hak baca untuk layar transaksi', () => {
  it('WAREHOUSE melihat barang beserta stok dan average cost; VIEWER hanya membaca', async () => {
    const sku = await product()
    await seed(sku, 10, 1000)
    for (const who of [wh, viewer]) {
      const r = await t.callAs(
        who,
        `select p.sku, sb.quantity::text as qty, sb.average_cost::text as avg from public.products p left join public.stock_balances sb on sb.product_id = p.id where p.sku = $1`,
        [sku],
      )
      expect(r.rows[0]).toEqual({ sku, qty: '10.0000', avg: '100.000000' })
    }
  })
})
