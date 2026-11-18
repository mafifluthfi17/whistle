import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealDb, type RealDb } from './pg'

let t: RealDb
let admin: string
let wh: string
let viewer: string

const DAY = 86_400_000
let skuCounter = 0

const q = (sql: string, params: unknown[] = []) => t.admin.query(sql, params)

async function product(prefix = 'P', over: { active?: boolean } = {}): Promise<string> {
  const sku = `${prefix}-${++skuCounter}`
  await q(`insert into public.products (sku, product_name, is_active) values ($1, $2, $3)`, [sku, `Barang ${sku}`, over.active ?? true])
  return sku
}

interface Opts {
  id?: string
  date?: Date
  ref?: string | null
  party?: string | null
  notes?: string | null
  reason?: string | null
  backdate?: boolean
}
type Item = Record<string, unknown>

async function post(who: string | null, type: string, items: Item[], o: Opts = {}) {
  const r = await t.callAs(
    who,
    `select public.post_transaction($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) as r`,
    [o.id ?? randomUUID(), type, (o.date ?? new Date()).toISOString(), o.ref ?? null, o.party ?? null, o.notes ?? null, JSON.stringify(items), o.reason ?? null, o.backdate ?? false],
  )
  return r.rows[0].r as any
}
const reverse = async (who: string | null, original: string, reason: string | null, id = randomUUID()) =>
  (await t.callAs(who, `select public.reverse_transaction($1, $2, $3) as r`, [id, original, reason])).rows[0].r as any

const opening = (sku: string, quantity: number | string, total_value: number | string) =>
  post(admin, 'OPENING', [{ sku, quantity, total_value }], { ref: 'OPENING' })
const purchase = (sku: string, quantity: number | string, unit_cost: number | string, o: Opts = {}, who = admin) =>
  post(who, 'IN', [{ sku, quantity, unit_cost }], o)
const sale = (sku: string, quantity: number | string, o: Opts = {}, who = admin) => post(who, 'OUT', [{ sku, quantity }], o)

async function bal(sku: string) {
  const r = await q(
    `select sb.quantity::text as qty, sb.average_cost::text as avg, sb.inventory_value::text as val
     from public.stock_balances sb join public.products p on p.id = sb.product_id where p.sku = $1`,
    [sku],
  )
  return r.rows[0] as { qty: string; avg: string; val: string } | undefined
}
const count = async (table: string) => Number((await q(`select count(*)::int as n from public.${table}`)).rows[0].n)
async function reconcileAll() {
  const r = await t.callAs(admin, `select * from public.reconcile_inventory()`)
  return r.rows as { sku: string; ok: boolean }[]
}
const expectCode = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code })

beforeAll(async () => {
  t = await startRealDb()
  admin = await t.createUser('admin@whistle.test', 'ADMIN')
  wh = await t.createUser('gudang@whistle.test', 'WAREHOUSE')
  viewer = await t.createUser('viewer@whistle.test', 'VIEWER')
})
afterAll(async () => {
  await t?.stop()
})

// ---------------------------------------------------------------------------
describe('contoh perhitungan wajib (Bagian 10)', () => {
  it('100 unit @10.000 + beli 50 @12.000 = 150 unit, Rp1.600.000, avg 10.666,666667; keluar 30 = HPP Rp320.000', async () => {
    const sku = await product('EX')
    const open = await opening(sku, 100, 1_000_000)
    expect(await bal(sku)).toEqual({ qty: '100.0000', avg: '10000.000000', val: '1000000.00' })
    expect(open.items[0]).toMatchObject({ unit_cost: '10000.000000', total_value: '1000000.00' })

    const buy = await purchase(sku, 50, 12000)
    expect(buy.items[0]).toMatchObject({
      quantity: '50.0000', unit_cost: '12000.000000', total_value: '600000.00',
      average_cost_before: '10000.000000', average_cost_after: '10666.666667',
      balance_quantity: '150.0000', balance_value: '1600000.00',
    })
    expect(await bal(sku)).toEqual({ qty: '150.0000', avg: '10666.666667', val: '1600000.00' })

    const out = await sale(sku, 30)
    expect(out.items[0]).toMatchObject({
      total_value: '320000.00', // HPP
      unit_cost: '10666.666667', // average cost sebelum transaksi
      average_cost_before: '10666.666667', average_cost_after: '10666.666667',
      balance_quantity: '120.0000', balance_value: '1280000.00',
    })
    expect(await bal(sku)).toEqual({ qty: '120.0000', avg: '10666.666667', val: '1280000.00' })
  })

  it('HPP tersimpan permanen di item transaksi dan ledger', async () => {
    const sku = await product('HPP')
    await opening(sku, 10, 100000)
    const out = await sale(sku, 4)
    const it = await q(`select total_value::text as v from public.inventory_transaction_items where transaction_id = $1`, [out.transaction_id])
    expect(it.rows[0].v).toBe('40000.00')
    const mv = await q(`select value_out::text as v, quantity_out::text as q from public.inventory_movements m join public.inventory_transaction_items i on i.id = m.transaction_item_id where i.transaction_id = $1`, [out.transaction_id])
    expect(mv.rows[0]).toEqual({ v: '40000.00', q: '4.0000' })
  })
})

describe('pembulatan', () => {
  it('avg 6 desimal, nilai 2 desimal, HPP per detail, sisa pembulatan tidak tertinggal', async () => {
    const sku = await product('RND')
    await opening(sku, 3, 100)
    expect((await bal(sku))!.avg).toBe('33.333333')
    expect((await sale(sku, 1)).items[0]).toMatchObject({ total_value: '33.33', balance_value: '66.67' })
    expect((await sale(sku, 1)).items[0]).toMatchObject({ total_value: '33.33', balance_value: '33.34' })
    // keluar habis: HPP = seluruh sisa nilai (bukan 33.33) sehingga saldo nilai tepat 0
    expect((await sale(sku, 1)).items[0]).toMatchObject({ total_value: '33.34', balance_quantity: '0.0000', balance_value: '0.00' })
  })

  it('nilai pembelian dibulatkan 2 desimal dan avg baru dari nilai yang dibukukan', async () => {
    const sku = await product('RND')
    const buy = await purchase(sku, 3, '3.333333')
    expect(buy.items[0]).toMatchObject({ total_value: '10.00', average_cost_after: '3.333333' })
    const sku2 = await product('RND')
    await opening(sku2, 7, 100)
    expect((await bal(sku2))!.avg).toBe('14.285714')
  })

  it('pecahan quantity (4 desimal) dan harga (6 desimal) diterima, lebih dari itu ditolak', async () => {
    const sku = await product('FRAC')
    await purchase(sku, '2.5', '1234.567891')
    // nilai dibukukan 2 desimal (3086.42); avg = nilai dibukukan / qty = 1234.568, bukan harga satuan mentah
    expect(await bal(sku)).toEqual({ qty: '2.5000', avg: '1234.568000', val: '3086.42' })
    await expectCode(purchase(sku, '1.00001', 10), 'WS003')
    await expectCode(purchase(sku, 1, '10.1234567'), 'WS003')
  })
})

describe('stok negatif dan atomik', () => {
  it('menolak keluar melebihi stok dan tidak mengubah apa pun', async () => {
    const sku = await product('NEG')
    await opening(sku, 120, 1_280_000)
    const before = { tx: await count('inventory_transactions'), mv: await count('inventory_movements'), bal: await bal(sku) }
    await expectCode(sale(sku, 121), 'WS001')
    expect(await sale(sku, 120).then((r) => r.items[0].balance_quantity)).toBe('0.0000')
    await expectCode(sale(sku, '0.0001'), 'WS001')
    expect(before.bal).toEqual({ qty: '120.0000', avg: '10666.666667', val: '1280000.00' })
    expect(await count('inventory_transactions')).toBe(before.tx + 1) // hanya OUT 120 yang berhasil
  })

  it('satu detail gagal membatalkan seluruh dokumen', async () => {
    const a = await product('ATM')
    const b = await product('ATM')
    await opening(a, 50, 5000)
    await opening(b, 5, 500)
    const tx = await count('inventory_transactions')
    const mv = await count('inventory_movements')
    await expectCode(post(admin, 'OUT', [{ sku: a, quantity: 10 }, { sku: b, quantity: 6 }]), 'WS001')
    expect(await bal(a)).toEqual({ qty: '50.0000', avg: '100.000000', val: '5000.00' })
    expect(await bal(b)).toEqual({ qty: '5.0000', avg: '100.000000', val: '500.00' })
    expect(await count('inventory_transactions')).toBe(tx)
    expect(await count('inventory_movements')).toBe(mv)
  })

  it('SKU yang sama dua kali dalam satu dokumen dihitung berurutan dan tetap tidak boleh minus', async () => {
    const sku = await product('DUPL')
    await opening(sku, 10, 1000)
    await expectCode(post(admin, 'OUT', [{ sku, quantity: 6 }, { sku, quantity: 6 }]), 'WS001')
    expect((await bal(sku))!.qty).toBe('10.0000')
    const ok = await post(admin, 'OUT', [{ sku, quantity: 6 }, { sku, quantity: 4 }])
    expect(ok.items.map((i: any) => i.balance_quantity)).toEqual(['4.0000', '0.0000'])
  })
})

describe('idempotensi (retry tidak menggandakan)', () => {
  it('client_transaction_id yang sama mengembalikan transaksi yang sama dan saldo hanya berubah sekali', async () => {
    const sku = await product('IDEM')
    await opening(sku, 100, 1000)
    const id = randomUUID()
    const first = await sale(sku, 10, { id })
    const retry = await sale(sku, 10, { id })
    expect(first.duplicate).toBe(false)
    expect(retry.duplicate).toBe(true)
    expect(retry.transaction_id).toBe(first.transaction_id)
    expect(retry.transaction_number).toBe(first.transaction_number)
    expect((await bal(sku))!.qty).toBe('90.0000')
    const n = await q(`select count(*)::int as n from public.inventory_transactions where client_transaction_id = $1`, [id])
    expect(n.rows[0].n).toBe(1)
  })

  it('client_transaction_id milik pengguna lain ditolak', async () => {
    const sku = await product('IDEM')
    await opening(sku, 100, 1000)
    const id = randomUUID()
    await sale(sku, 1, { id }, admin)
    await expectCode(sale(sku, 1, { id }, wh), 'WS003')
  })
})

describe('hak akses dan validasi', () => {
  it('VIEWER tidak boleh memposting apa pun; WAREHOUSE hanya IN/OUT', async () => {
    const sku = await product('ACL')
    await opening(sku, 10, 100)
    await expectCode(purchase(sku, 1, 10, {}, viewer), '42501')
    await expectCode(sale(sku, 1, {}, viewer), '42501')
    await purchase(sku, 1, 10, {}, wh)
    await sale(sku, 1, {}, wh)
    await expectCode(post(wh, 'OPENING', [{ sku, quantity: 1, total_value: 1 }]), '42501')
    await expectCode(post(wh, 'ADJUSTMENT', [{ sku, quantity: 1, direction: 'OUT' }], { reason: 'x', ref: 'y' }), '42501')
    await expectCode(post(wh, 'REVERSAL', [{ sku, quantity: 1 }]), 'WS003')
  })

  it('pengguna nonaktif, tanpa sesi, dan anon ditolak', async () => {
    const sku = await product('ACL')
    await opening(sku, 10, 100)
    const off = await t.createUser('off@whistle.test', 'WAREHOUSE')
    await q(`update public.profiles set is_active = false where id = $1`, [off])
    await expectCode(sale(sku, 1, {}, off), '42501')
    await expectCode(sale(sku, 1, {}, null as unknown as string), '42501')
    await expect(
      t.callAs(null, `select public.post_transaction(gen_random_uuid(), 'IN', now(), null, null, null, '[]'::jsonb)`, [], 'anon'),
    ).rejects.toThrow(/permission denied/)
  })

  it('fungsi internal tidak dapat dipanggil langsung oleh pengguna', async () => {
    await expect(
      t.callAs(admin, `select app.post_document($1, gen_random_uuid(), 'IN', now(), null, null, null, null, '[]'::jsonb, false)`, [admin]),
    ).rejects.toThrow(/permission denied/)
    await expect(t.callAs(admin, `select * from app.replay_product(gen_random_uuid())`)).rejects.toThrow(/permission denied/)
  })

  it('validasi item: SKU tidak ada, barang nonaktif, qty tidak valid, angka rusak, dokumen kosong', async () => {
    const sku = await product('VAL')
    const dead = await product('VAL', { active: false })
    await expectCode(purchase('TIDAK-ADA', 1, 10), 'WS003')
    await expectCode(purchase(dead, 1, 10), 'WS003')
    await expectCode(purchase(sku, 0, 10), 'WS003')
    await expectCode(purchase(sku, -5, 10), 'WS003')
    await expectCode(purchase(sku, 'abc', 10), 'WS003')
    await expectCode(post(admin, 'IN', [{ sku, quantity: 1 }]), 'WS003') // harga beli wajib
    await expectCode(post(admin, 'IN', []), 'WS003')
    await expectCode(t.callAs(admin, `select public.post_transaction(null, 'IN', now(), null, null, null, '[{"sku":"x","quantity":1,"unit_cost":1}]'::jsonb)`), 'WS003')
    expect(await bal(sku)).toBeUndefined()
  })

  it('nomor transaksi dan posting_sequence dibuat server, unik, dan naik', async () => {
    const sku = await product('SEQ')
    await opening(sku, 100, 1000)
    const a = await sale(sku, 1)
    const b = await sale(sku, 1)
    expect(a.transaction_number).toMatch(/^OUT-\d{6}-\d{6}$/)
    expect(a.transaction_number).not.toBe(b.transaction_number)
    expect(Number(b.posting_sequence)).toBeGreaterThan(Number(a.posting_sequence))
  })
})

describe('transaksi bertanggal mundur', () => {
  it('ditolak untuk WAREHOUSE dan ADMIN tanpa persetujuan; diizinkan ADMIN dengan persetujuan + audit', async () => {
    const sku = await product('BKD')
    await opening(sku, 100, 1000)
    await purchase(sku, 10, 10) // mutasi terakhir: hari ini
    const old = new Date(Date.now() - 3 * DAY)
    await expectCode(purchase(sku, 1, 10, { date: old }, wh), 'WS002')
    await expectCode(purchase(sku, 1, 10, { date: old }), 'WS002')
    await expectCode(sale(sku, 1, { date: old }, wh), 'WS002')
    await expectCode(purchase(sku, 1, 10, { date: old, backdate: true }, wh), '42501') // bukan ADMIN
    const ok = await purchase(sku, 1, 10, { date: old, backdate: true })
    expect(ok.status).toBe('POSTED')
    const audit = await q(`select count(*)::int as n from public.audit_logs where action = 'BACKDATED_POST' and record_id = $1`, [ok.transaction_id])
    expect(audit.rows[0].n).toBe(1)
  })

  it('tanggal yang sama (jam lebih awal) boleh; tanggal di masa depan ditolak', async () => {
    const sku = await product('BKD')
    await opening(sku, 100, 1000)
    const sameDayEarlier = new Date(Date.now() - 2 * 3600_000)
    // dua jam lalu bisa jatuh di tanggal Jakarta kemarin pada pukul 00-02; gunakan awal hari Jakarta + 1 menit
    const jakartaMidnight = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
    jakartaMidnight.setHours(0, 1, 0, 0)
    const offsetMs = Date.now() - new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).getTime()
    const startOfJakartaDay = new Date(jakartaMidnight.getTime() + offsetMs)
    await sale(sku, 1, { date: startOfJakartaDay })
    void sameDayEarlier
    await expectCode(purchase(sku, 1, 10, { date: new Date(Date.now() + 3 * DAY) }), 'WS002')
  })

  it('OPENING tidak terkena pemeriksaan tanggal mundur', async () => {
    const sku = await product('BKD')
    await opening(sku, 5, 50)
    expect((await bal(sku))!.qty).toBe('5.0000')
  })
})

describe('adjustment', () => {
  it('wajib alasan dan referensi, hanya ADMIN, tercatat dengan penyetuju', async () => {
    const sku = await product('ADJ')
    await opening(sku, 100, 10000)
    await expectCode(post(admin, 'ADJUSTMENT', [{ sku, quantity: 5, direction: 'OUT' }]), 'WS003')
    await expectCode(post(admin, 'ADJUSTMENT', [{ sku, quantity: 5, direction: 'OUT' }], { reason: 'rusak' }), 'WS003')
    await expectCode(post(admin, 'ADJUSTMENT', [{ sku, quantity: 5 }], { reason: 'rusak', ref: 'BA-1' }), 'WS003')

    const out = await post(admin, 'ADJUSTMENT', [{ sku, quantity: 5, direction: 'OUT' }], { reason: 'Barang rusak', ref: 'BA-001' })
    expect(out.items[0]).toMatchObject({ total_value: '500.00', balance_quantity: '95.0000', balance_value: '9500.00' })
    const tx = await q(`select reason, reference_number, approved_by, created_by from public.inventory_transactions where id = $1`, [out.transaction_id])
    expect(tx.rows[0]).toEqual({ reason: 'Barang rusak', reference_number: 'BA-001', approved_by: admin, created_by: admin })

    const inc = await post(admin, 'ADJUSTMENT', [{ sku, quantity: 10, direction: 'IN', unit_cost: 120 }], { reason: 'Selisih opname', ref: 'SO-1' })
    expect(inc.items[0]).toMatchObject({ total_value: '1200.00', balance_quantity: '105.0000', balance_value: '10700.00' })
    expect((await bal(sku))!.avg).toBe('101.904762')
  })

  it('adjustment masuk tanpa harga memakai average cost; wajib harga jika stok nol', async () => {
    const sku = await product('ADJ')
    await opening(sku, 10, 1000)
    const r = await post(admin, 'ADJUSTMENT', [{ sku, quantity: 2, direction: 'IN' }], { reason: 'opname', ref: 'SO-2' })
    expect(r.items[0]).toMatchObject({ total_value: '200.00', average_cost_after: '100.000000' })
    const empty = await product('ADJ')
    await expectCode(post(admin, 'ADJUSTMENT', [{ sku: empty, quantity: 1, direction: 'IN' }], { reason: 'opname', ref: 'SO-3' }), 'WS003')
  })
})

describe('saldo awal (OPENING)', () => {
  it('hanya satu kali per SKU dan hanya sebelum ada mutasi lain', async () => {
    const a = await product('OPN')
    await opening(a, 10, 100)
    await expectCode(opening(a, 5, 50), 'WS003')
    const b = await product('OPN')
    await purchase(b, 1, 10)
    await expectCode(opening(b, 5, 50), 'WS003')
    expect((await bal(a))!.qty).toBe('10.0000')
  })

  it('import Excel membuat satu transaksi OPENING per SKU secara atomik', async () => {
    const rows = [
      { sku: 'IMP-A', product_name: 'A', unit: 'PCS', opening_quantity: '150', opening_value: '1600000' },
      { sku: 'IMP-B', product_name: 'B', unit: 'PCS', opening_quantity: '10', opening_value: '250' },
      { sku: 'IMP-C', product_name: 'C', unit: 'PCS' },
    ]
    const res = (await t.callAs(admin, `select public.import_products($1::jsonb, 'NEW') as r`, [JSON.stringify(rows)])).rows[0].r
    expect(res).toMatchObject({ inserted: 3, openings_posted: 2 })
    const tx = await q(`select p.sku, t.transaction_type, t.status from public.inventory_transactions t join public.inventory_transaction_items i on i.transaction_id = t.id join public.products p on p.id = i.product_id where p.sku like 'IMP-%' order by p.sku`)
    expect(tx.rows).toEqual([
      { sku: 'IMP-A', transaction_type: 'OPENING', status: 'POSTED' },
      { sku: 'IMP-B', transaction_type: 'OPENING', status: 'POSTED' },
    ])
    expect(await bal('IMP-A')).toEqual({ qty: '150.0000', avg: '10666.666667', val: '1600000.00' })
    expect(await bal('IMP-B')).toEqual({ qty: '10.0000', avg: '25.000000', val: '250.00' })
    expect(await bal('IMP-C')).toBeUndefined()
  })

  it('import yang gagal di tengah tidak meninggalkan OPENING sebagian', async () => {
    const tx = await count('inventory_transactions')
    const mv = await count('inventory_movements')
    const sb = await count('stock_balances')
    const pr = await count('products')
    const rows = [
      { sku: 'ATM-A', product_name: 'A', unit: 'PCS', opening_quantity: '5', opening_value: '50' },
      { sku: 'ATM-B', product_name: 'B', unit: 'PCS', opening_quantity: '5', opening_value: '50.123' }, // 3 desimal: ditolak posting
    ]
    await expect(t.callAs(admin, `select public.import_products($1::jsonb, 'NEW')`, [JSON.stringify(rows)])).rejects.toThrow(/Baris 2/)
    expect([await count('inventory_transactions'), await count('inventory_movements'), await count('stock_balances'), await count('products')]).toEqual([tx, mv, sb, pr])
  })

  it('post_pending_openings memposting stok awal hasil FASE 3 yang tertinggal, sekali saja', async () => {
    const sku = await product('LEG')
    const pid = (await q(`select id from public.products where sku = $1`, [sku])).rows[0].id
    await q(`insert into public.product_opening_stock (product_id, quantity, opening_value, average_cost) values ($1, 20, 400, 20)`, [pid])
    await expectCode(t.callAs(wh, `select public.post_pending_openings()`), '42501')
    expect((await t.callAs(admin, `select public.post_pending_openings() as n`)).rows[0].n).toBe(1)
    expect((await t.callAs(admin, `select public.post_pending_openings() as n`)).rows[0].n).toBe(0)
    expect(await bal(sku)).toEqual({ qty: '20.0000', avg: '20.000000', val: '400.00' })
  })
})

describe('reversal dengan replay', () => {
  it('membalik transaksi HISTORIS memperhitungkan dampak ke HPP setelahnya (bukan sekadar membalik saldo)', async () => {
    const sku = await product('REV')
    await opening(sku, 100, 1_000_000) // avg 10.000
    const buy = await purchase(sku, 100, 20_000) // qty 200, nilai 3.000.000, avg 15.000
    await sale(sku, 50) // HPP 750.000 -> qty 150, nilai 2.250.000, avg 15.000
    expect(await bal(sku)).toEqual({ qty: '150.0000', avg: '15000.000000', val: '2250000.00' })

    const rev = await reverse(admin, buy.transaction_id, 'Salah input pembelian')
    // Tanpa pembelian itu, 50 unit keluar seharusnya dihitung pada avg 10.000 (HPP 500.000)
    expect(await bal(sku)).toEqual({ qty: '50.0000', avg: '10000.000000', val: '500000.00' })
    expect(rev.type).toBe('REVERSAL')

    const orig = await q(`select status from public.inventory_transactions where id = $1`, [buy.transaction_id])
    expect(orig.rows[0].status).toBe('REVERSED')
    const row = await q(`select reversal_of, reason, approved_by, status from public.inventory_transactions where id = $1`, [rev.transaction_id])
    expect(row.rows[0]).toEqual({ reversal_of: buy.transaction_id, reason: 'Salah input pembelian', approved_by: admin, status: 'POSTED' })

    const audit = await q(`select old_value, new_value from public.audit_logs where action = 'REVERSAL' and record_id = $1`, [buy.transaction_id])
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].new_value.changes[0]).toMatchObject({
      sku,
      before: { quantity: 150, value: 2250000 },
      after: { quantity: 50, value: 500000 },
    })
    expect((await reconcileAll()).every((r) => r.ok)).toBe(true)

    // pembukuan berikutnya berlanjut dari saldo hasil replay
    const next = await sale(sku, 10)
    expect(next.items[0]).toMatchObject({ total_value: '100000.00', balance_quantity: '40.0000', balance_value: '400000.00' })
    expect((await reconcileAll()).every((r) => r.ok)).toBe(true)
  })

  it('reversal transaksi terakhir mengembalikan saldo persis seperti sebelum transaksi', async () => {
    const sku = await product('REV')
    await opening(sku, 100, 1_000_000)
    const before = await bal(sku)
    const buy = await purchase(sku, 50, 12_000)
    await reverse(admin, buy.transaction_id, 'Batal beli')
    expect(await bal(sku)).toEqual(before)

    const out = await sale(sku, 30)
    expect((await bal(sku))!.val).toBe('700000.00')
    await reverse(admin, out.transaction_id, 'Batal keluar')
    expect(await bal(sku)).toEqual(before)
    expect((await reconcileAll()).every((r) => r.ok)).toBe(true)
  })

  it('reversal yang membuat stok minus pada mutasi setelahnya ditolak dan tidak mengubah apa pun', async () => {
    const sku = await product('REV')
    await opening(sku, 10, 1000)
    const buy = await purchase(sku, 10, 100)
    await sale(sku, 15)
    const before = await bal(sku)
    const tx = await count('inventory_transactions')
    await expectCode(reverse(admin, buy.transaction_id, 'salah'), 'WS004')
    expect(await bal(sku)).toEqual(before)
    expect(await count('inventory_transactions')).toBe(tx)
    const orig = await q(`select status from public.inventory_transactions where id = $1`, [buy.transaction_id])
    expect(orig.rows[0].status).toBe('POSTED')
  })

  it('hanya ADMIN, wajib alasan, tidak dua kali, dan hanya jenis IN/OUT/ADJUSTMENT', async () => {
    const sku = await product('REV')
    const open = await opening(sku, 100, 1000)
    const buy = await purchase(sku, 10, 10)
    await expectCode(reverse(wh, buy.transaction_id, 'x'), '42501')
    await expectCode(reverse(viewer, buy.transaction_id, 'x'), '42501')
    await expectCode(reverse(admin, buy.transaction_id, '  '), 'WS003')
    await expectCode(reverse(admin, buy.transaction_id, null), 'WS003')
    const id = randomUUID()
    const rev = await reverse(admin, buy.transaction_id, 'salah', id)
    expect((await reverse(admin, buy.transaction_id, 'salah', id)).duplicate).toBe(true) // retry idempoten
    await expectCode(reverse(admin, buy.transaction_id, 'lagi'), 'WS004') // sudah direversal
    await expectCode(reverse(admin, rev.transaction_id, 'balik reversal'), 'WS004')
    await expectCode(reverse(admin, open.transaction_id, 'opening'), 'WS004')
    await expectCode(reverse(admin, randomUUID(), 'tidak ada'), 'WS004')
  })

  it('adjustment dapat direversal', async () => {
    const sku = await product('REV')
    await opening(sku, 100, 10000)
    const adj = await post(admin, 'ADJUSTMENT', [{ sku, quantity: 5, direction: 'OUT' }], { reason: 'rusak', ref: 'BA-9' })
    await reverse(admin, adj.transaction_id, 'salah catat')
    expect(await bal(sku)).toEqual({ qty: '100.0000', avg: '100.000000', val: '10000.00' })
  })

  it('reversal dokumen multi-SKU memproses semua SKU terdampak', async () => {
    const a = await product('REV')
    const b = await product('REV')
    await opening(a, 10, 100)
    await opening(b, 10, 200)
    const doc = await post(admin, 'IN', [{ sku: a, quantity: 5, unit_cost: 10 }, { sku: b, quantity: 5, unit_cost: 20 }])
    await reverse(admin, doc.transaction_id, 'batal')
    expect(await bal(a)).toEqual({ qty: '10.0000', avg: '10.000000', val: '100.00' })
    expect(await bal(b)).toEqual({ qty: '10.0000', avg: '20.000000', val: '200.00' })
  })
})

describe('transaksi POSTED tidak boleh diedit atau dihapus langsung', () => {
  it('trigger memblokir update/delete transaksi dan item (bahkan superuser); hanya POSTED->REVERSED lewat reversal', async () => {
    const sku = await product('IMM')
    await opening(sku, 10, 100)
    const out = await sale(sku, 1)
    await expect(q(`update public.inventory_transactions set notes = 'edit' where id = $1`, [out.transaction_id])).rejects.toThrow(/tidak boleh diubah/)
    await expect(q(`update public.inventory_transactions set status = 'PENDING' where id = $1`, [out.transaction_id])).rejects.toThrow(/tidak boleh diubah/)
    await expect(q(`delete from public.inventory_transactions where id = $1`, [out.transaction_id])).rejects.toThrow(/tidak boleh dihapus/)
    await expect(q(`update public.inventory_transaction_items set quantity = 99 where transaction_id = $1`, [out.transaction_id])).rejects.toThrow(/tidak boleh diubah/)
    await expect(q(`delete from public.inventory_transaction_items where transaction_id = $1`, [out.transaction_id])).rejects.toThrow(/tidak boleh/)
    await expect(q(`update public.inventory_movements set quantity_out = 0`)).rejects.toThrow(/append-only/)
    await expect(q(`delete from public.inventory_movements`)).rejects.toThrow(/append-only/)
  })

  it('pengguna tidak dapat menulis saldo atau ledger secara langsung', async () => {
    await expect(t.callAs(admin, `update public.stock_balances set quantity = 999999`)).rejects.toThrow(/permission denied/)
    await expect(t.callAs(admin, `delete from public.inventory_movements`)).rejects.toThrow(/permission denied/)
  })
})

// ---------------------------------------------------------------------------
describe('rekonsiliasi ledger dengan stock_balances (urutan acak, 200 operasi)', () => {
  function rng(seed: number) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
  }

  it('saldo = replay ledger efektif = jumlah mutasi ledger, untuk setiap SKU', async () => {
    const rand = rng(20261118)
    const skus = [await product('RCN'), await product('RCN'), await product('RCN'), await product('RCN'), await product('RCN')]
    for (const s of skus) await opening(s, 100, Math.round(rand() * 900_000) / 100 + 1000)
    const posted: { id: string; reversed: boolean }[] = []
    let rejected = 0

    for (let i = 0; i < 200; i++) {
      const roll = rand()
      const sku = skus[Math.floor(rand() * skus.length)]
      try {
        if (roll < 0.4) {
          const cost = rand() < 0.5 ? Math.round(rand() * 1_000_000) / 1000 : (Math.round(rand() * 1e9) / 1e6).toFixed(6)
          const r = await purchase(sku, Math.floor(rand() * 40) + 1, cost)
          posted.push({ id: r.transaction_id, reversed: false })
        } else if (roll < 0.75) {
          const have = Number((await bal(sku))!.qty)
          if (have > 0) {
            const r = await sale(sku, Math.max(1, Math.floor(rand() * have * 0.6)))
            posted.push({ id: r.transaction_id, reversed: false })
          }
        } else if (roll < 0.85) {
          const dir = rand() < 0.5 ? 'IN' : 'OUT'
          const have = Number((await bal(sku))!.qty)
          if (dir === 'OUT' && have < 1) continue
          const item = dir === 'IN' ? { sku, quantity: Math.floor(rand() * 5) + 1, direction: 'IN', unit_cost: Math.round(rand() * 5000) / 100 } : { sku, quantity: 1, direction: 'OUT' }
          const r = await post(admin, 'ADJUSTMENT', [item], { reason: 'opname', ref: `SO-${i}` })
          posted.push({ id: r.transaction_id, reversed: false })
        } else if (roll < 0.92 && posted.length) {
          const open = posted.filter((p) => !p.reversed)
          if (open.length) {
            const pick = open[Math.floor(rand() * open.length)]
            try {
              await reverse(admin, pick.id, 'koreksi acak')
              pick.reversed = true
            } catch (e) {
              if ((e as { code?: string }).code !== 'WS004') throw e
              rejected++
            }
          }
        } else {
          // dokumen multi-SKU
          const picks = [...new Set([sku, skus[Math.floor(rand() * skus.length)]])]
          const r = await post(admin, 'IN', picks.map((s) => ({ sku: s, quantity: 3, unit_cost: 777.123456 })))
          posted.push({ id: r.transaction_id, reversed: false })
        }
      } catch (e) {
        if ((e as { code?: string }).code !== 'WS001') throw e
      }
      if (i % 25 === 24) {
        const rows = await reconcileAll()
        const bad = rows.filter((r) => !r.ok)
        expect(bad, `rekonsiliasi gagal setelah operasi ke-${i + 1}`).toEqual([])
      }
    }
    expect(posted.filter((p) => p.reversed).length).toBeGreaterThan(0)
    void rejected

    const rows = await reconcileAll()
    expect(rows.length).toBeGreaterThanOrEqual(5)
    expect(rows.every((r) => r.ok)).toBe(true)

    // saldo terakhir di ledger = stock_balances, dan rantai saldo ledger konsisten
    const chain = await q(`
      select p.sku,
             sb.quantity = (select balance_quantity from public.inventory_movements m where m.product_id = p.id order by movement_sequence desc limit 1) as last_ok,
             sb.inventory_value = (select balance_value from public.inventory_movements m where m.product_id = p.id order by movement_sequence desc limit 1) as val_ok
      from public.stock_balances sb join public.products p on p.id = sb.product_id where p.sku like 'RCN-%'`)
    expect(chain.rows.every((r) => r.last_ok && r.val_ok)).toBe(true)
    const broken = await q(`
      select count(*)::int as n from (
        select balance_quantity,
               lag(balance_quantity, 1, 0::numeric) over (partition by product_id order by movement_sequence) + quantity_in - quantity_out as expected_q,
               balance_value,
               lag(balance_value, 1, 0::numeric) over (partition by product_id order by movement_sequence) + value_in - value_out as expected_v
        from public.inventory_movements) x
      where x.balance_quantity <> x.expected_q or x.balance_value <> x.expected_v`)
    expect(broken.rows[0].n).toBe(0)
    const negative = await q(`select count(*)::int as n from public.stock_balances where quantity < 0 or inventory_value < 0`)
    expect(negative.rows[0].n).toBe(0)
  })
})

// ---------------------------------------------------------------------------
describe('konkurensi (koneksi paralel sungguhan)', () => {
  it('dua OUT bersamaan atas stok yang hanya cukup untuk satu: tidak terjadi oversell', async () => {
    const sku = await product('CC')
    await opening(sku, 10, 1000)
    const res = await Promise.allSettled([sale(sku, 6), sale(sku, 6, {}, wh)])
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = res.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((failed.reason as { code: string }).code).toBe('WS001')
    expect(await bal(sku)).toEqual({ qty: '4.0000', avg: '100.000000', val: '400.00' })
  })

  it('25 OUT @1 bersamaan atas stok 10: tepat 10 berhasil dan stok berakhir 0', async () => {
    const sku = await product('CC')
    await opening(sku, 10, 1000)
    const res = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => sale(sku, 1, {}, i % 2 ? wh : admin)))
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(10)
    for (const r of res.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
      expect((r.reason as { code: string }).code).toBe('WS001')
    }
    expect(await bal(sku)).toEqual({ qty: '0.0000', avg: '100.000000', val: '0.00' })
    expect((await reconcileAll()).filter((r) => r.sku === sku).every((r) => r.ok)).toBe(true)
  })

  it('dokumen dengan urutan SKU berlawanan bersamaan tidak deadlock', async () => {
    const skus = [await product('DL'), await product('DL'), await product('DL'), await product('DL'), await product('DL')]
    for (const s of skus) await opening(s, 1000, 100000)
    const fwd = skus.map((sku) => ({ sku, quantity: 1 }))
    const rev = [...fwd].reverse()
    const jobs: Promise<unknown>[] = []
    for (let i = 0; i < 20; i++) {
      jobs.push(post(admin, 'OUT', fwd))
      jobs.push(post(wh, 'OUT', rev))
    }
    const res = await Promise.allSettled(jobs)
    const failures = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(failures.map((f) => (f.reason as Error).message)).toEqual([])
    for (const s of skus) expect((await bal(s))!.qty).toBe('960.0000')
  })

  it('retry paralel dengan client_transaction_id yang sama hanya membuat satu transaksi', async () => {
    const sku = await product('CC')
    await opening(sku, 100, 10000)
    const id = randomUUID()
    const res = await Promise.all(Array.from({ length: 10 }, () => sale(sku, 5, { id })))
    expect(new Set(res.map((r) => r.transaction_id)).size).toBe(1)
    expect(res.filter((r) => r.duplicate === false)).toHaveLength(1)
    expect((await bal(sku))!.qty).toBe('95.0000')
    const n = await q(`select count(*)::int as n from public.inventory_transactions where client_transaction_id = $1`, [id])
    expect(n.rows[0].n).toBe(1)
  })

  it('campuran IN/OUT paralel: urutan ledger per SKU konsisten dan rekonsiliasi lulus', async () => {
    const skus = [await product('MIX'), await product('MIX'), await product('MIX')]
    for (const s of skus) await opening(s, 500, 50000)
    const jobs: Promise<unknown>[] = []
    for (let i = 0; i < 60; i++) {
      const sku = skus[i % 3]
      jobs.push(
        i % 3 === 0
          ? purchase(sku, 5, 90 + i, {}, i % 2 ? wh : admin)
          : sale(sku, 3, {}, i % 2 ? wh : admin),
      )
    }
    const res = await Promise.allSettled(jobs)
    expect(res.filter((r) => r.status === 'rejected')).toHaveLength(0)
    expect((await reconcileAll()).filter((r) => r.sku.startsWith('MIX-')).every((r) => r.ok)).toBe(true)
    const broken = await q(`
      select count(*)::int as n from (
        select balance_quantity,
               lag(balance_quantity, 1, 0::numeric) over (partition by product_id order by movement_sequence) + quantity_in - quantity_out as expected_q
        from public.inventory_movements m join public.products p on p.id = m.product_id where p.sku like 'MIX-%') x
      where x.balance_quantity <> x.expected_q`)
    expect(broken.rows[0].n).toBe(0)
    const seq = await q(`select count(*)::int as total, count(distinct posting_sequence)::int as uniq from public.inventory_transactions`)
    expect(seq.rows[0].total).toBe(seq.rows[0].uniq)
  })

  it('reversal paralel atas transaksi yang sama: hanya satu yang berhasil', async () => {
    const sku = await product('CC')
    await opening(sku, 100, 10000)
    const buy = await purchase(sku, 10, 100)
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => reverse(admin, buy.transaction_id, 'paralel')))
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await bal(sku)).toEqual({ qty: '100.0000', avg: '100.000000', val: '10000.00' })
    const n = await q(`select count(*)::int as n from public.inventory_transactions where reversal_of = $1`, [buy.transaction_id])
    expect(n.rows[0].n).toBe(1)
  })
})

describe('integritas keseluruhan setelah semua skenario', () => {
  it('seluruh SKU lolos rekonsiliasi, tidak ada saldo negatif, dan HPP/saldo tidak tertukar', async () => {
    const rows = await reconcileAll()
    expect(rows.length).toBeGreaterThan(20)
    expect(rows.filter((r) => !r.ok)).toEqual([])
    const neg = await q(`select count(*)::int as n from public.stock_balances where quantity < 0 or inventory_value < 0 or average_cost < 0`)
    expect(neg.rows[0].n).toBe(0)
    // ledger: jumlah nilai masuk - nilai keluar = nilai saldo total
    const tot = await q(`select (select coalesce(sum(value_in - value_out), 0) from public.inventory_movements)::text as ledger, (select coalesce(sum(inventory_value), 0) from public.stock_balances)::text as saldo`)
    expect(tot.rows[0].ledger).toBe(tot.rows[0].saldo)
  })
})
