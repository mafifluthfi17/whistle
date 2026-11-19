import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { startRealDb, type RealDb } from './pg'
import {
  movementWorkbook,
  reportToBuffer,
  stockCardWorkbook,
  stockSummaryWorkbook,
  transactionHistoryWorkbook,
  transactionLinesWorkbook,
  valuationWorkbook,
} from '../../src/utils/reportExcel'

let t: RealDb
let admin: string
let wh: string
let viewer: string

const DAY = 86_400_000
const q = (sql: string, params: unknown[] = []) => t.admin.query(sql, params)
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)
/** Tanggal (kalender Jakarta) n hari lalu pada pukul 12:00 WIB, sebagai ISO. */
const at = (daysAgo: number) => new Date(`${ymd(new Date(Date.now() - daysAgo * DAY))}T12:00:00+07:00`)
const dstr = (daysAgo: number) => ymd(new Date(Date.now() - daysAgo * DAY))
const todayIso = () => new Date().toISOString()

async function product(sku: string, over: { category?: string; min?: number; active?: boolean } = {}) {
  await q(`insert into public.products (sku, product_name, category, minimum_stock, is_active) values ($1, $2, $3, $4, $5)`, [
    sku, `Barang ${sku}`, over.category ?? null, over.min ?? 0, over.active ?? true,
  ])
}

async function post(who: string, type: string, items: unknown[], date: Date | string, o: { ref?: string; backdate?: boolean; reason?: string; party?: string } = {}) {
  const r = await t.callAs(who, `select public.post_transaction($1, $2, $3, $4, $5, null, $6::jsonb, $7, $8) as r`, [
    randomUUID(), type, typeof date === 'string' ? date : date.toISOString(), o.ref ?? null, o.party ?? null,
    JSON.stringify(items), o.reason ?? null, o.backdate ?? false,
  ])
  return r.rows[0].r as { transaction_id: string; transaction_number: string }
}
const open = (who: string, sku: string, qty: number, value: number, d: Date) => post(who, 'OPENING', [{ sku, quantity: qty, total_value: value }], d, { ref: 'OPENING' })
const buy = (who: string, sku: string, qty: number, cost: number, d: Date | string, ref = 'PO') => post(who, 'IN', [{ sku, quantity: qty, unit_cost: cost }], d, { ref })
const sell = (who: string, sku: string, qty: number, d: Date | string, ref = 'SJ') => post(who, 'OUT', [{ sku, quantity: qty }], d, { ref })

const rpc = async (who: string | null, sql: string, params: unknown[] = []) => (await t.callAs(who, sql, params)).rows[0].r as any
const card = (sku: string, from: string | null = null, to: string | null = null, who = viewer) =>
  rpc(who, `select public.stock_card($1, $2::date, $3::date) as r`, [sku, from, to])
const summary = (a: { search?: string; category?: string; status?: string; inactive?: boolean } = {}, who = viewer) =>
  rpc(who, `select public.report_stock_summary($1, $2, $3, $4) as r`, [a.search ?? null, a.category ?? null, a.status ?? null, a.inactive ?? false])
const sumStr = async (sql: string, params: unknown[] = []) => String((await q(sql, params)).rows[0].v)

beforeAll(async () => {
  t = await startRealDb()
  admin = await t.createUser('admin@whistle.test', 'ADMIN')
  wh = await t.createUser('gudang@whistle.test', 'WAREHOUSE')
  viewer = await t.createUser('viewer@whistle.test', 'VIEWER')
  await q(`update public.profiles set full_name = 'Admin Utama' where id = $1`, [admin])
  await q(`update public.profiles set full_name = 'Petugas Gudang' where id = $1`, [wh])

  for (const [sku, o] of [
    ['RPT-A', { category: 'Minuman', min: 20 }],
    ['RPT-B', { category: 'Snack', min: 50 }],
    ['RPT-C', { category: 'Minuman' }],
    ['RPT-D', { category: 'Snack' }],
    ['RPT-E', { category: 'Snack', min: 100 }],
    ['RPT-F', { category: 'Minuman' }],
    ['RPT-G', { category: 'Minuman' }],
    ['WILD_1', {}],
    ['WILDX1', {}],
  ] as const) await product(sku, o)

  // Produk A: kronologis, banyak jenis mutasi
  await open(admin, 'RPT-A', 100, 1_000_000, at(10))
  await buy(admin, 'RPT-A', 50, 12000, at(7), 'PO-001')
  await sell(admin, 'RPT-A', 30, at(3), 'SJ-001')
  await buy(admin, 'RPT-A', 20, 13000, at(1), 'PO-002')
  await sell(wh, 'RPT-A', 10, todayIso(), 'SJ-002')
  // Produk B: habis
  await open(admin, 'RPT-B', 40, 400_000, at(10))
  await sell(wh, 'RPT-B', 40, at(2), 'SJ-003')
  // Produk D: ada stok lalu dinonaktifkan
  await open(admin, 'RPT-D', 5, 500, at(10))
  await q(`update public.products set is_active = false where sku = 'RPT-D'`)
  // Produk E: stok di bawah minimum
  await buy(wh, 'RPT-E', 10, 500, at(1), 'PO-003')
  await buy(wh, 'RPT-E', 5, 500, todayIso(), 'PO-004')
  // Produk F: pembelian lalu direversal
  await open(admin, 'RPT-F', 10, 1000, at(5))
  const fIn = await buy(admin, 'RPT-F', 5, 100, at(1), 'PO-005')
  await t.callAs(admin, `select public.reverse_transaction($1, $2, 'Salah input')`, [randomUUID(), fIn.transaction_id])
  // Produk G: transaksi mundur yang disetujui ADMIN (urutan ledger != urutan tanggal)
  await open(admin, 'RPT-G', 10, 100, at(6))
  await buy(admin, 'RPT-G', 30, 10, at(2), 'PO-006')
  await post(admin, 'IN', [{ sku: 'RPT-G', quantity: 10, unit_cost: 50 }], at(5), { ref: 'PO-BACKDATE', backdate: true })
  // Barang masuk bernilai sama, dokumen pending (tidak boleh dihitung)
  const pid = (await q(`select id from public.products where sku = 'RPT-A'`)).rows[0].id
  const pend = await q(
    `insert into public.inventory_transactions (transaction_number, client_transaction_id, transaction_type, status, created_by, reference_number)
     values ('PEND-1', gen_random_uuid(), 'IN', 'PENDING', $1, 'PENDING-DOC') returning id`,
    [wh],
  )
  await q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity, unit_cost, total_value) values ($1, $2, 1000, 99999, 99999000)`, [pend.rows[0].id, pid])
})
afterAll(async () => {
  await t?.stop()
})

describe('kartu stok', () => {
  it('semua kolom terisi benar dan tidak tertukar (masuk/keluar, harga, HPP, nilai, saldo)', async () => {
    const c = await card('RPT-A')
    expect(c.product).toMatchObject({ sku: 'RPT-A', product_name: 'Barang RPT-A', category: 'Minuman' })
    expect(c.opening).toEqual({ qty: '0.0000', value: '0.00', average_cost: '0.000000' })
    expect(c.rows).toHaveLength(5)

    const [r1, r2, r3, r4, r5] = c.rows
    expect(r1).toMatchObject({
      movement_type: 'OPENING', reference_number: 'OPENING', sku: 'RPT-A', product_name: 'Barang RPT-A',
      qty_in: '100.0000', unit_cost_in: '10000.000000', value_in: '1000000.00',
      qty_out: '0.0000', unit_cost_out: null, value_out: '0.00',
      balance_qty: '100.0000', average_cost: '10000.000000', balance_value: '1000000.00',
    })
    expect(r2).toMatchObject({
      movement_type: 'IN', reference_number: 'PO-001', qty_in: '50.0000', unit_cost_in: '12000.000000', value_in: '600000.00',
      qty_out: '0.0000', balance_qty: '150.0000', average_cost: '10666.666667', balance_value: '1600000.00',
    })
    expect(r3).toMatchObject({
      movement_type: 'OUT', reference_number: 'SJ-001', qty_in: '0.0000', unit_cost_in: null, value_in: '0.00',
      qty_out: '30.0000', unit_cost_out: '10666.666667', value_out: '320000.00', // HPP per unit & nilai keluar
      balance_qty: '120.0000', average_cost: '10666.666667', balance_value: '1280000.00',
    })
    expect(r4).toMatchObject({ qty_in: '20.0000', unit_cost_in: '13000.000000', value_in: '260000.00', balance_qty: '140.0000', balance_value: '1540000.00', average_cost: '11000.000000' })
    expect(r5).toMatchObject({ qty_out: '10.0000', unit_cost_out: '11000.000000', value_out: '110000.00', balance_qty: '130.0000', balance_value: '1430000.00' })

    expect(c.totals).toEqual({ qty_in: '170.0000', value_in: '1860000.00', qty_out: '40.0000', value_out: '430000.00' })
    expect(c.closing).toEqual({ qty: '130.0000', value: '1430000.00', average_cost: '11000.000000' })
    expect(r5.user_name).toBe('Petugas Gudang')
    expect(r1.user_name).toBe('Admin Utama')
  })

  it('saldo akhir = saldo resmi di stock_balances', async () => {
    const c = await card('RPT-A')
    const b = (await q(`select quantity::text as q, inventory_value::text as v, average_cost::text as a from public.stock_balances sb join public.products p on p.id = sb.product_id where p.sku = 'RPT-A'`)).rows[0]
    expect(c.closing).toEqual({ qty: b.q, value: b.v, average_cost: b.a })
  })

  it('setiap baris dapat ditelusuri ke transaksi sumber (transaction_id, nomor, detail)', async () => {
    const c = await card('RPT-A')
    for (const r of c.rows) {
      const tx = await q(`select transaction_number, status from public.inventory_transactions where id = $1`, [r.transaction_id])
      expect(tx.rows[0].transaction_number).toBe(r.transaction_number)
      const mv = await q(`select product_id from public.inventory_movements where id = $1`, [r.movement_id])
      expect(mv.rows).toHaveLength(1)
      const d = await rpc(viewer, `select public.transaction_detail($1) as r`, [r.transaction_id])
      expect(d.transaction_number).toBe(r.transaction_number)
      expect(d.items.some((i: any) => i.sku === 'RPT-A' && i.balance_qty === r.balance_qty)).toBe(true)
    }
  })

  it('filter tanggal: saldo awal, mutasi periode, dan saldo akhir', async () => {
    // d-6..d-2: hanya penjualan d-3 (pembelian d-7 masuk ke saldo awal)
    const c = await card('RPT-A', dstr(6), dstr(2))
    expect(c.opening).toEqual({ qty: '150.0000', value: '1600000.00', average_cost: '10666.666667' })
    expect(c.rows.map((r: any) => r.reference_number)).toEqual(['SJ-001'])
    expect(c.totals).toEqual({ qty_in: '0.0000', value_in: '0.00', qty_out: '30.0000', value_out: '320000.00' })
    expect(c.closing).toEqual({ qty: '120.0000', value: '1280000.00', average_cost: '10666.666667' })
  })

  it('periode tanpa mutasi: saldo awal = saldo akhir; periode hari ini saja', async () => {
    const quiet = await card('RPT-A', dstr(9), dstr(8))
    expect(quiet.rows).toEqual([])
    expect(quiet.opening).toEqual({ qty: '100.0000', value: '1000000.00', average_cost: '10000.000000' })
    expect(quiet.closing.qty).toBe('100.0000')
    const today = await card('RPT-A', dstr(0), dstr(0))
    expect(today.opening.qty).toBe('140.0000')
    expect(today.rows).toHaveLength(1)
    expect(today.closing).toEqual({ qty: '130.0000', value: '1430000.00', average_cost: '11000.000000' })
  })

  it('identitas saldo awal + masuk - keluar = saldo akhir berlaku untuk semua jendela tanggal', async () => {
    for (const sku of ['RPT-A', 'RPT-B', 'RPT-F', 'RPT-G']) {
      for (let from = 12; from >= 0; from -= 3) {
        for (let to = from; to >= 0; to -= 2) {
          const c = await card(sku, dstr(from), dstr(to))
          const exp = async (open: string, inn: string, out: string) =>
            (await q(`select ($1::numeric + $2::numeric - $3::numeric)::text as v`, [open, inn, out])).rows[0].v
          expect(c.closing.qty, `${sku} ${from}..${to}`).toBe(await exp(c.opening.qty, c.totals.qty_in, c.totals.qty_out))
          expect(c.closing.value, `${sku} ${from}..${to}`).toBe(await exp(c.opening.value, c.totals.value_in, c.totals.value_out))
        }
      }
    }
  })

  it('transaksi mundur (ADMIN): urutan ledger tetap, identitas aritmetika tetap berlaku', async () => {
    const full = await card('RPT-G')
    expect(full.rows.map((r: any) => r.reference_number)).toEqual(['OPENING', 'PO-006', 'PO-BACKDATE']) // urutan posting
    // 10 unit @ nilai 100 + 30 @ 10 + 10 @ 50 (mundur) = 50 unit, nilai 900, avg 18
    expect(full.closing).toEqual({ qty: '50.0000', value: '900.00', average_cost: '18.000000' })
    const early = await card('RPT-G', dstr(6), dstr(4))
    expect(early.rows.map((r: any) => r.reference_number)).toEqual(['OPENING', 'PO-BACKDATE']) // berdasar tanggal transaksi
    expect(early.totals.qty_in).toBe('20.0000')
    const mid = await card('RPT-G', dstr(3), dstr(0))
    expect(mid.opening.qty).toBe('20.0000')
    expect(mid.closing.qty).toBe('50.0000')
  })

  it('transaksi yang direversal tetap tampil beserta koreksinya dan saldo tetap benar', async () => {
    const c = await card('RPT-F')
    const types = c.rows.map((r: any) => `${r.movement_type}:${r.transaction_status}`)
    expect(types).toEqual(['OPENING:POSTED', 'IN:REVERSED', 'REVERSAL:POSTED'])
    expect(c.closing).toEqual({ qty: '10.0000', value: '1000.00', average_cost: '100.000000' })
    const d = await rpc(viewer, `select public.transaction_detail($1) as r`, [c.rows[1].transaction_id])
    expect(d.reversed_by_number).toBe(c.rows[2].transaction_number)
    const rv = await rpc(viewer, `select public.transaction_detail($1) as r`, [c.rows[2].transaction_id])
    expect(rv.reversal_of_number).toBe(c.rows[1].transaction_number)
  })

  it('pengecualian: SKU tidak ada, rentang terbalik, anon, dan pengguna nonaktif', async () => {
    await expect(card('TIDAK-ADA')).rejects.toMatchObject({ code: 'WS003' })
    await expect(card('RPT-A', dstr(1), dstr(5))).rejects.toMatchObject({ code: 'WS003' })
    await expect(t.callAs(null, `select public.stock_card('RPT-A')`, [], 'anon')).rejects.toThrow(/permission denied/)
    const off = await t.createUser('off@whistle.test', 'VIEWER')
    await q(`update public.profiles set is_active = false where id = $1`, [off])
    await expect(card('RPT-A', null, null, off)).rejects.toMatchObject({ code: '42501' })
  })

  it('transaksi PENDING tidak muncul di kartu stok', async () => {
    const c = await card('RPT-A')
    expect(c.rows.some((r: any) => r.reference_number === 'PENDING-DOC')).toBe(false)
    expect(c.closing.qty).toBe('130.0000')
  })
})

describe('A. Stock Summary, Low Stock, dan Zero Stock', () => {
  it('total = jumlah saldo resmi untuk barang aktif; nonaktif dikecualikan kecuali diminta', async () => {
    const s = await summary()
    expect(s.rows.map((r: any) => r.sku)).not.toContain('RPT-D')
    expect(s.totals.total_value).toBe(await sumStr(`select coalesce(sum(sb.inventory_value), 0)::text as v from public.stock_balances sb join public.products p on p.id = sb.product_id where p.is_active`))
    expect(s.totals.total_qty).toBe(await sumStr(`select coalesce(sum(sb.quantity), 0)::text as v from public.stock_balances sb join public.products p on p.id = sb.product_id where p.is_active`))
    expect(s.totals.count).toBe(s.rows.length)
    const all = await summary({ inactive: true })
    expect(all.rows.map((r: any) => r.sku)).toContain('RPT-D')
    expect(all.totals.total_value).toBe(await sumStr(`select coalesce(sum(inventory_value), 0)::text as v from public.stock_balances`))
  })

  it('status stok dan kolom: HABIS, RENDAH, AMAN', async () => {
    const s = await summary()
    const by = Object.fromEntries(s.rows.map((r: any) => [r.sku, r]))
    expect(by['RPT-A']).toMatchObject({ quantity: '130.0000', average_cost: '11000.000000', inventory_value: '1430000.00', minimum_stock: '20.0000', status: 'AMAN', shortage: '0.0000', category: 'Minuman' })
    expect(by['RPT-B']).toMatchObject({ quantity: '0.0000', status: 'HABIS', shortage: '50.0000' })
    expect(by['RPT-C']).toMatchObject({ quantity: '0.0000', average_cost: '0.000000', inventory_value: '0.00', status: 'HABIS' }) // belum punya saldo sama sekali
    expect(by['RPT-E']).toMatchObject({ quantity: '15.0000', status: 'RENDAH', shortage: '85.0000' })
  })

  it('Low Stock (qty < minimum, termasuk habis) dan Zero Stock', async () => {
    const low = await summary({ status: 'LOW' })
    expect(low.rows.map((r: any) => r.sku)).toEqual(['RPT-B', 'RPT-E'])
    const zero = await summary({ status: 'ZERO' })
    const zs = zero.rows.map((r: any) => r.sku)
    expect(zs).toEqual(expect.arrayContaining(['RPT-B', 'RPT-C']))
    expect(zs).not.toContain('RPT-A')
    for (const r of zero.rows) expect(Number(r.quantity)).toBeLessThanOrEqual(0)
    expect((await summary({ status: 'AMAN' })).rows.every((r: any) => r.status === 'AMAN')).toBe(true)
  })

  it('filter kategori dan pencarian; wildcard % dan _ dianggap huruf biasa', async () => {
    const mn = await summary({ category: 'Minuman' })
    expect(mn.rows.every((r: any) => r.category === 'Minuman')).toBe(true)
    expect((await summary({ search: 'rpt-a' })).rows.map((r: any) => r.sku)).toEqual(['RPT-A'])
    expect((await summary({ search: 'WILD_1' })).rows.map((r: any) => r.sku)).toEqual(['WILD_1'])
    expect((await summary({ search: '%' })).rows).toEqual([])
    await expect(summary({ status: 'ANEH' })).rejects.toMatchObject({ code: 'WS003' })
  })
})

describe('B. Inventory Valuation dan rekonsiliasi ledger', () => {
  it('hanya barang bernilai/bersaldo, total = jumlah baris = saldo resmi', async () => {
    const v = await rpc(viewer, `select public.report_valuation() as r`)
    expect(v.rows.every((r: any) => Number(r.quantity) > 0 || Number(r.inventory_value) > 0)).toBe(true)
    expect(v.rows.map((r: any) => r.sku)).not.toContain('RPT-B') // saldo 0
    const [sumRows] = (await q(`select coalesce(sum(x::numeric), 0)::text as v from jsonb_array_elements_text($1::jsonb) x`, [JSON.stringify(v.rows.map((r: any) => r.inventory_value))])).rows
    expect(v.totals.total_value).toBe(sumRows.v)
    expect(v.totals.total_value).toBe(await sumStr(`select coalesce(sum(inventory_value), 0)::text as v from public.stock_balances where quantity > 0 or inventory_value > 0`))
  })

  it('totals.reconciled benar bila saldo = ledger, dan salah bila saldo menyimpang', async () => {
    const ok = await rpc(viewer, `select public.report_valuation() as r`)
    expect(ok.totals.reconciled).toBe(true)
    expect(ok.totals.all_balance_value).toBe(ok.totals.ledger_value)
    expect(ok.totals.all_balance_qty).toBe(ok.totals.ledger_qty)

    await q(`update public.stock_balances set quantity = quantity + 1 where product_id = (select id from public.products where sku = 'RPT-A')`)
    const bad = await rpc(viewer, `select public.report_valuation() as r`)
    expect(bad.totals.reconciled).toBe(false)
    await q(`update public.stock_balances set quantity = quantity - 1 where product_id = (select id from public.products where sku = 'RPT-A')`)
    expect((await rpc(viewer, `select public.report_valuation() as r`)).totals.reconciled).toBe(true)
  })

  it('include_zero menyertakan barang bersaldo nol; filter kategori', async () => {
    const z = await rpc(viewer, `select public.report_valuation(null, true) as r`)
    expect(z.rows.map((r: any) => r.sku)).toContain('RPT-B')
    const mn = await rpc(viewer, `select public.report_valuation('Minuman') as r`)
    expect(mn.rows.every((r: any) => r.category === 'Minuman')).toBe(true)
  })
})

describe('C. Stock Movement per periode', () => {
  const movement = (from: string, to: string, cat: string | null = null) =>
    rpc(viewer, `select public.report_movement($1::date, $2::date, $3) as r`, [from, to, cat])

  it('periode penuh: saldo akhir = saldo resmi dan totals = jumlah baris', async () => {
    const m = await movement(dstr(30), dstr(0))
    expect(m.totals.opening_qty).toBe('0.0000')
    expect(m.totals.closing_value).toBe(await sumStr(`select coalesce(sum(inventory_value), 0)::text as v from public.stock_balances`))
    expect(m.totals.closing_qty).toBe(await sumStr(`select coalesce(sum(quantity), 0)::text as v from public.stock_balances`))
    for (const k of ['qty_in', 'value_in', 'qty_out', 'value_out'] as const) {
      const s = await sumStr(`select coalesce(sum(x::numeric), 0)::text as v from jsonb_array_elements_text($1::jsonb) x`, [JSON.stringify(m.rows.map((r: any) => r[k]))])
      expect(m.totals[k], k).toBe(s)
    }
    expect(m.totals.value_in).toBe(await sumStr(`select coalesce(sum(value_in), 0)::text as v from public.inventory_movements`))
    expect(m.totals.value_out).toBe(await sumStr(`select coalesce(sum(value_out), 0)::text as v from public.inventory_movements`))
  })

  it('setiap SKU: saldo awal + masuk - keluar = saldo akhir, dan cocok dengan kartu stok', async () => {
    const m = await movement(dstr(6), dstr(2))
    for (const r of m.rows) {
      const exp = (await q(`select ($1::numeric + $2::numeric - $3::numeric)::text as v`, [r.opening_qty, r.qty_in, r.qty_out])).rows[0].v
      expect(r.closing_qty, r.sku).toBe(exp)
      const c = await card(r.sku, dstr(6), dstr(2))
      expect(c.opening.qty, r.sku).toBe(r.opening_qty)
      expect(c.totals.qty_in, r.sku).toBe(r.qty_in)
      expect(c.totals.value_out, r.sku).toBe(r.value_out)
      expect(c.closing.value, r.sku).toBe(r.closing_value)
    }
  })

  it('rincian per jenis mutasi dan HPP produk A', async () => {
    const m = await movement(dstr(30), dstr(0))
    const types = Object.fromEntries(m.totals.by_type.map((x: any) => [x.movement_type, x]))
    expect(Object.keys(types).sort()).toEqual(['IN', 'OPENING', 'OUT', 'REVERSAL'])
    expect(types.OPENING.count).toBeGreaterThanOrEqual(4)
    expect(types.REVERSAL.qty_out).toBe('5.0000')
    const a = m.rows.find((r: any) => r.sku === 'RPT-A')
    expect(a).toMatchObject({ qty_in: '170.0000', value_in: '1860000.00', qty_out: '40.0000', value_out: '430000.00', closing_qty: '130.0000', closing_value: '1430000.00' })
  })

  it('filter kategori, validasi periode, dan hak akses', async () => {
    const m = await movement(dstr(30), dstr(0), 'Snack')
    expect(m.rows.every((r: any) => r.category === 'Snack')).toBe(true)
    await expect(movement(dstr(1), dstr(3))).rejects.toMatchObject({ code: 'WS003' })
    await expect(t.callAs(null, `select public.report_movement(null, null)`, [], 'anon')).rejects.toThrow(/permission denied/)
  })
})

describe('F. Transaction History dan transaksi masuk/keluar', () => {
  const history = (a: Record<string, unknown> = {}) =>
    rpc(viewer, `select public.report_transactions($1::date, $2::date, $3::uuid, $4, $5, $6, $7, $8) as r`, [
      a.from ?? null, a.to ?? null, a.user ?? null, a.type ?? null, a.status ?? null, a.search ?? null, a.limit ?? 200, a.offset ?? 0,
    ])

  it('filter jenis, pengguna, status, tanggal, dan pencarian', async () => {
    const outs = await history({ type: 'OUT' })
    expect(outs.rows.every((r: any) => r.transaction_type === 'OUT')).toBe(true)
    expect(outs.rows.map((r: any) => r.reference_number).sort()).toEqual(['SJ-001', 'SJ-002', 'SJ-003'])

    const byWh = await history({ user: wh })
    expect(byWh.rows.every((r: any) => r.created_by === wh && r.created_by_name === 'Petugas Gudang')).toBe(true)
    expect(byWh.rows.length).toBeGreaterThanOrEqual(4)

    const pending = await history({ status: 'PENDING' })
    expect(pending.rows.map((r: any) => r.reference_number)).toEqual(['PENDING-DOC'])
    expect((await history({ status: 'REVERSED' })).rows).toHaveLength(1)

    const range = await history({ from: dstr(3), to: dstr(2), type: 'OUT' })
    expect(range.rows.map((r: any) => r.reference_number).sort()).toEqual(['SJ-001', 'SJ-003'])
    expect((await history({ search: 'po-00' })).rows.every((r: any) => /^PO-00/.test(r.reference_number))).toBe(true)
  })

  it('transaksi PENDING tampil sebagai PENDING dan tidak dihitung dalam total nilai atau saldo', async () => {
    const all = await history()
    const pend = all.rows.find((r: any) => r.status === 'PENDING')
    expect(pend).toMatchObject({ transaction_number: 'PEND-1', total_value: '99999000.00', item_count: 1 })
    const posted = await sumStr(
      `select coalesce(sum(i.total_value), 0)::text as v from public.inventory_transaction_items i join public.inventory_transactions t on t.id = i.transaction_id where t.status = 'POSTED'`,
    )
    expect(all.totals.posted_total_value).toBe(posted)
    expect(Number(posted)).toBeLessThan(99_999_000)
    expect((await card('RPT-A')).closing.qty).toBe('130.0000')
  })

  it('pagination: jumlah total tetap, halaman tidak tumpang tindih, urutan terbaru dahulu', async () => {
    const p1 = await history({ limit: 4, offset: 0 })
    const p2 = await history({ limit: 4, offset: 4 })
    const total = (await history()).rows.length
    expect(p1.total_count).toBe(total)
    expect(p1.rows).toHaveLength(4)
    const ids1 = p1.rows.map((r: any) => r.id)
    expect(p2.rows.every((r: any) => !ids1.includes(r.id))).toBe(true)
    const seqs = (await q(`select transaction_number from public.inventory_transactions where status <> 'PENDING' order by posting_sequence desc limit 4`)).rows.map((r) => r.transaction_number)
    const posted = p1.rows.filter((r: any) => r.status !== 'PENDING').map((r: any) => r.transaction_number)
    expect(posted).toEqual(seqs.slice(0, posted.length))
  })

  it('hak: jenis/status tidak valid ditolak; anon ditolak; daftar pengguna', async () => {
    await expect(history({ type: 'XXX' })).rejects.toMatchObject({ code: 'WS003' })
    await expect(history({ status: 'XXX' })).rejects.toMatchObject({ code: 'WS003' })
    await expect(t.callAs(null, `select public.report_transactions()`, [], 'anon')).rejects.toThrow(/permission denied/)
    const users = await rpc(viewer, `select public.report_transaction_users() as r`)
    expect(users.map((u: any) => u.name).sort()).toEqual(['Admin Utama', 'Petugas Gudang'])
  })

  it('baris item Barang Masuk dan Keluar: total hanya transaksi POSTED, tertukar tidak mungkin', async () => {
    const lines = (type: string, from: string, to: string) => rpc(viewer, `select public.report_transaction_lines($1, $2::date, $3::date) as r`, [type, from, to])
    const ins = await lines('IN', dstr(30), dstr(0))
    const pendIn = ins.rows.find((r: any) => r.status === 'PENDING')
    expect(pendIn).toBeUndefined() // laporan masuk/keluar hanya memuat transaksi yang sudah dibukukan (POSTED/REVERSED)
    const rev = ins.rows.find((r: any) => r.reference_number === 'PO-005')
    expect(rev).toMatchObject({ status: 'REVERSED', sku: 'RPT-F', quantity: '5.0000', unit_cost: '100.000000', total_value: '500.00' })
    expect(ins.totals.excluded_count).toBeGreaterThanOrEqual(1)
    const expected = await sumStr(
      `select coalesce(sum(i.total_value), 0)::text as v from public.inventory_transaction_items i join public.inventory_transactions t on t.id = i.transaction_id where t.transaction_type = 'IN' and t.status = 'POSTED'`,
    )
    expect(ins.totals.total_value).toBe(expected)
    const outs = await lines('OUT', dstr(30), dstr(0))
    expect(outs.rows.every((r: any) => ['SJ-001', 'SJ-002', 'SJ-003'].includes(r.reference_number))).toBe(true)
    expect(outs.totals.total_value).toBe(await sumStr(`select coalesce(sum(value_out), 0)::text as v from public.inventory_movements where movement_type = 'OUT'`))
    await expect(lines('ADJUSTMENT', dstr(3), dstr(0))).rejects.toMatchObject({ code: 'WS003' })
    await expect(lines('IN', dstr(0), dstr(3))).rejects.toMatchObject({ code: 'WS003' })
  })
})

describe('Dashboard', () => {
  const dash = () => rpc(viewer, `select public.dashboard_summary() as r`)

  it('total sama dengan saldo resmi; pending dipisah dan tidak dibukukan', async () => {
    const d = await dash()
    expect(d.active_sku).toBe(Number((await q(`select count(*)::int as n from public.products where is_active`)).rows[0].n))
    expect(d.total_qty).toBe(await sumStr(`select coalesce(sum(quantity), 0)::text as v from public.stock_balances`))
    expect(d.total_value).toBe(await sumStr(`select coalesce(sum(inventory_value), 0)::text as v from public.stock_balances`))
    expect(d.pending_count).toBe(1)
    expect(Number(d.total_qty)).toBeLessThan(1000) // pending 1000 unit tidak ikut
  })

  it('barang masuk/keluar hari ini hanya dari transaksi POSTED jenis IN/OUT', async () => {
    const d = await dash()
    // hari ini: IN RPT-E 5 @500 (2500) oleh wh; OUT RPT-A 10 (HPP 110000)
    expect(d.in_today).toEqual({ count: 1, qty: '5.0000', value: '2500.00' })
    expect(d.out_today).toEqual({ count: 1, qty: '10.0000', value: '110000.00' })
  })

  it('low stock dan zero stock sama dengan laporan', async () => {
    const d = await dash()
    expect(d.low_stock_count).toBe((await summary({ status: 'LOW' })).rows.length)
    expect(d.zero_stock_count).toBe((await summary({ status: 'ZERO' })).rows.length)
  })

  it('aktivitas terakhir: maks. 10, terbaru dahulu, pending berstatus PENDING', async () => {
    const d = await dash()
    expect(d.recent.length).toBeLessThanOrEqual(10)
    expect(d.recent.length).toBe(10)
    const times = d.recent.map((r: any) => r.transaction_number)
    expect(times[0]).toBe('PEND-1') // dibuat paling akhir
    expect(d.recent[0]).toMatchObject({ status: 'PENDING', item_count: 1, user_name: 'Petugas Gudang' })
  })

  it('anon ditolak; WAREHOUSE dan ADMIN dapat membaca', async () => {
    await expect(t.callAs(null, `select public.dashboard_summary()`, [], 'anon')).rejects.toThrow(/permission denied/)
    for (const who of [wh, admin]) expect((await rpc(who, `select public.dashboard_summary() as r`)).active_sku).toBeGreaterThan(0)
  })
})

describe('Excel dari data database (total dapat direkonsiliasi)', () => {
  const rows = (wb: XLSX.WorkBook, name: string) =>
    XLSX.utils.sheet_to_json<Record<string, string | number>>(XLSX.read(reportToBuffer(wb), { type: 'array' }).Sheets[name], { raw: true, defval: null })
  const asNum = async (sql: string) => Number(await sumStr(sql))
  const today = () => dstr(0)

  it('Saldo Stok: total Excel = saldo resmi di database', async () => {
    const s = await summary()
    const { wb } = stockSummaryWorkbook(s, today())
    const total = rows(wb, 'SALDO_STOK').find((r) => r['Nama Barang'] === 'TOTAL')!
    expect(total['Nilai Persediaan']).toBe(await asNum(`select coalesce(sum(sb.inventory_value), 0)::text as v from public.stock_balances sb join public.products p on p.id = sb.product_id where p.is_active`))
    expect(total['Quantity']).toBe(await asNum(`select coalesce(sum(sb.quantity), 0)::text as v from public.stock_balances sb join public.products p on p.id = sb.product_id where p.is_active`))
    const data = rows(wb, 'SALDO_STOK').filter((r) => r['Nama Barang'] !== 'TOTAL')
    expect(data).toHaveLength(s.rows.length)
    const a = data.find((r) => r['SKU'] === 'RPT-A')!
    expect(a).toMatchObject({ Quantity: 130, 'Average Cost': 11000, 'Nilai Persediaan': 1430000, 'Minimum Stock': 20, 'Status Stok': 'AMAN' })
  })

  it('Inventory Valuation: lembar rekonsiliasi SESUAI dan total = jumlah ledger', async () => {
    const v = await rpc(viewer, `select public.report_valuation() as r`)
    const { wb } = valuationWorkbook(v, today())
    const total = rows(wb, 'VALUATION').find((r) => r['Nama Barang'] === 'TOTAL NILAI PERSEDIAAN')!
    expect(total['Nilai Persediaan']).toBe(await asNum(`select coalesce(sum(value_in - value_out), 0)::text as v from public.inventory_movements`))
    const info = Object.fromEntries(XLSX.utils.sheet_to_json<string[]>(XLSX.read(reportToBuffer(wb), { type: 'array' }).Sheets.REKONSILIASI, { header: 1 }).map((r) => [r[0], r[1]]))
    expect(info['Rekonsiliasi saldo vs ledger']).toBe('SESUAI')
  })

  it('Kartu Stok: baris, total, dan saldo akhir sama dengan database', async () => {
    const c = await card('RPT-A', dstr(30), dstr(0))
    const { wb, fileName } = stockCardWorkbook(c)
    expect(fileName).toBe(`WHISTLE_Kartu_Stok_RPT-A_${dstr(30)}_sd_${dstr(0)}.xlsx`)
    const data = rows(wb, 'KARTU_STOK')
    expect(data.filter((r) => r['Jenis'] !== null)).toHaveLength(5)
    const close = data.find((r) => r['Keterangan'] === 'SALDO AKHIR')!
    expect(close['Saldo Nilai']).toBe(await asNum(`select sb.inventory_value::text as v from public.stock_balances sb join public.products p on p.id = sb.product_id where p.sku = 'RPT-A'`))
    const tot = data.find((r) => r['Keterangan'] === 'TOTAL PERIODE')!
    expect(tot['Nilai Keluar']).toBe(await asNum(`select sum(m.value_out)::text as v from public.inventory_movements m join public.products p on p.id = m.product_id where p.sku = 'RPT-A'`))
    // Setiap baris Excel: nilai masuk = qty masuk x harga masuk (dibulatkan) dan tidak tertukar dengan keluar
    for (const r of data.filter((x) => x['Jenis'] === 'IN')) expect(r['Nilai Masuk']).toBe(Math.round(Number(r['Qty Masuk']) * Number(r['Harga Masuk']) * 100) / 100)
  })

  it('Stock Movement: total saldo akhir Excel = total saldo resmi', async () => {
    const m = await rpc(viewer, `select public.report_movement($1::date, $2::date) as r`, [dstr(30), dstr(0)])
    const { wb } = movementWorkbook(m)
    const total = rows(wb, 'STOCK_MOVEMENT').find((r) => r['Nama Barang'] === 'TOTAL')!
    expect(total['Saldo Akhir Nilai']).toBe(await asNum(`select coalesce(sum(inventory_value), 0)::text as v from public.stock_balances`))
    expect(total['HPP (Nilai Keluar)']).toBe(await asNum(`select coalesce(sum(value_out), 0)::text as v from public.inventory_movements`))
  })

  it('Barang Masuk / Keluar / Transaction History: total hanya transaksi POSTED', async () => {
    const lines = async (type: string) => rpc(viewer, `select public.report_transaction_lines($1, $2::date, $3::date) as r`, [type, dstr(30), dstr(0)])
    const inn = transactionLinesWorkbook(await lines('IN'))
    const inTotal = rows(inn.wb, 'BARANG_MASUK').find((r) => r['Nama Barang'] === 'TOTAL (hanya status POSTED)')!
    expect(inTotal['Nilai Masuk']).toBe(await asNum(`select coalesce(sum(i.total_value), 0)::text as v from public.inventory_transaction_items i join public.inventory_transactions t on t.id = i.transaction_id where t.transaction_type = 'IN' and t.status = 'POSTED'`))
    const out = transactionLinesWorkbook(await lines('OUT'))
    const outTotal = rows(out.wb, 'BARANG_KELUAR').find((r) => r['Nama Barang'] === 'TOTAL (hanya status POSTED)')!
    expect(outTotal['Nilai Keluar (HPP)']).toBe(await asNum(`select coalesce(sum(value_out), 0)::text as v from public.inventory_movements where movement_type = 'OUT'`))

    const hist = await rpc(viewer, `select public.report_transactions(null, null, null, null, null, null, 1000, 0) as r`)
    const h = transactionHistoryWorkbook(hist, null, null)
    expect(h.fileName).toBe('WHISTLE_Transaction_History_semua_periode.xlsx')
    const data = rows(h.wb, 'TRANSACTION_HISTORY')
    expect(data.filter((r) => r['No. Transaksi'] !== null)).toHaveLength(hist.total_count)
    const histTotal = data.find((r) => String(r['Supplier/Penerima'] ?? '').startsWith('TOTAL'))!
    expect(histTotal['Total Nilai']).toBe(await asNum(`select coalesce(sum(i.total_value), 0)::text as v from public.inventory_transaction_items i join public.inventory_transactions t on t.id = i.transaction_id where t.status = 'POSTED'`))
    // transaksi PENDING tampil dengan statusnya tetapi nilainya tidak ikut total
    expect(data.find((r) => r['No. Transaksi'] === 'PEND-1')).toMatchObject({ Status: 'PENDING', 'Total Nilai': 99999000 })
    expect(Number(histTotal['Total Nilai'])).toBeLessThan(99_999_000)
  })
})
