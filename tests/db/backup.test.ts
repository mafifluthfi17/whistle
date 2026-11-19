import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startRealDb, type RealDb } from './pg'

let t: RealDb
let admin: string
let wh: string
let viewer: string

const DAY = 86_400_000
const q = (sql: string, params: unknown[] = []) => t.admin.query(sql, params)
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)
const at = (daysAgo: number) => new Date(`${ymd(new Date(Date.now() - daysAgo * DAY))}T12:00:00+07:00`)
const dstr = (daysAgo: number) => ymd(new Date(Date.now() - daysAgo * DAY))

const TABLES: [string, string][] = [
  ['warehouses', 'id'], ['products', 'id'], ['product_opening_stock', 'product_id'], ['inventory_transactions', 'id'],
  ['inventory_transaction_items', 'id'], ['inventory_movements', 'id'], ['stock_balances', 'id'],
]

/** Sidik jari seluruh data persediaan: md5 isi setiap tabel. Dua keadaan identik = hash identik. */
async function state(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [tbl, key] of TABLES) {
    const r = await q(`select md5(coalesce(jsonb_agg(to_jsonb(x) order by x.${key}::text), '[]'::jsonb)::text) as h from public.${tbl} x`)
    out[tbl] = r.rows[0].h
  }
  return out
}
const count = async (table: string) => Number((await q(`select count(*)::int as n from public.${table}`)).rows[0].n)
const auditCount = (action?: string) => (action ? count2(`select count(*)::int as n from public.audit_logs where action = '${action}'`) : count('audit_logs'))
const count2 = async (sql: string) => Number((await q(sql)).rows[0].n)

async function post(who: string, type: string, items: unknown[], date: Date | string, o: { ref?: string; backdate?: boolean; reason?: string } = {}) {
  const r = await t.callAs(who, `select public.post_transaction($1, $2, $3, $4, null, null, $5::jsonb, $6, $7) as r`, [
    randomUUID(), type, typeof date === 'string' ? date : date.toISOString(), o.ref ?? null, JSON.stringify(items), o.reason ?? null, o.backdate ?? false,
  ])
  return r.rows[0].r as { transaction_id: string; transaction_number: string; posting_sequence: number }
}
const asAdmin = async (sql: string, params: unknown[] = []) => (await t.callAs(admin, sql, params)).rows[0]
const backup = async (scope = 'FULL', note: string | null = null, who = admin): Promise<string> =>
  (await t.callAs(who, `select public.create_backup($1, $2) as r`, [scope, note])).rows[0].r
const validate = async (payload: string, remap = false, who = admin) =>
  (await t.callAs(who, `select public.validate_backup($1, $2) as r`, [payload, remap])).rows[0].r
const restore = async (payload: string, confirm = 'PULIHKAN', remap = false, who = admin) =>
  (await t.callAs(who, `select public.restore_database($1, $2, $3) as r`, [payload, confirm, remap])).rows[0].r
const failed = (r: { checks: { name: string; ok: boolean }[] }) => r.checks.filter((c) => !c.ok).map((c) => c.name)

/** Ubah isi backup lalu hitung ulang checksum dan jumlah baris tabel itu (file "rapi" tetapi isinya salah). */
async function tamper(payload: string, mutate: string, tbl: string): Promise<string> {
  const r = await q(`select public.test_retag(${mutate}, $2) as r`, [payload, tbl])
  return r.rows[0].r
}

let skuN = 0
async function product(over: { name?: string; category?: string; min?: number; barcode?: string } = {}): Promise<string> {
  const sku = `BK-${++skuN}`
  await q(`insert into public.products (sku, barcode, product_name, category, minimum_stock) values ($1, $2, $3, $4, $5)`, [
    sku, over.barcode ?? null, over.name ?? `Barang ${sku}`, over.category ?? null, over.min ?? 0,
  ])
  return sku
}

beforeAll(async () => {
  t = await startRealDb()
  admin = await t.createUser('admin@whistle.test', 'ADMIN')
  wh = await t.createUser('gudang@whistle.test', 'WAREHOUSE')
  viewer = await t.createUser('viewer@whistle.test', 'VIEWER')
  await q(`update public.profiles set full_name = 'Admin Utama' where id = $1`, [admin])
  // pembantu tes: ubah file backup lalu hitung ulang checksum dan jumlah baris tabel tertentu
  await q(`
    create function public.test_retag(p jsonb, tbl text) returns text language sql as $$
      select jsonb_set(jsonb_set(p, array['meta','md5',tbl], to_jsonb(md5((p #> array['tables', tbl])::text))),
                       array['meta','counts',tbl], to_jsonb(jsonb_array_length(p #> array['tables', tbl])))::text
    $$`)

  // --- data awal yang beragam ---
  const a = await product({ name: 'Kopi “Spesial” ☕ 100% arabika', category: 'Minuman', min: 20, barcode: '8999000000011' })
  const b = await product({ category: 'Snack', min: 50 })
  const c = await product({ category: 'Minuman' })
  const d = await product({ category: 'Snack' })
  await post(admin, 'OPENING', [{ sku: a, quantity: 100, total_value: 1_000_000 }], at(10), { ref: 'OPENING' })
  await post(admin, 'OPENING', [{ sku: b, quantity: 40, total_value: 400_000 }], at(10), { ref: 'OPENING' })
  await post(admin, 'IN', [{ sku: a, quantity: 50, unit_cost: '12000.123456' }], at(7), { ref: 'PO-1' })
  await post(wh, 'OUT', [{ sku: a, quantity: 30 }], at(3), { ref: 'SJ-1' })
  await post(wh, 'OUT', [{ sku: b, quantity: 40 }], at(2), { ref: 'SJ-2' })
  const cIn = await post(admin, 'IN', [{ sku: c, quantity: 5, unit_cost: 100 }], at(1), { ref: 'PO-2' })
  await t.callAs(admin, `select public.reverse_transaction($1, $2, 'Salah input')`, [randomUUID(), cIn.transaction_id])
  await post(admin, 'ADJUSTMENT', [{ sku: a, quantity: 2, direction: 'OUT' }], new Date().toISOString(), { ref: 'BA-1', reason: 'Barang rusak' })
  await post(admin, 'IN', [{ sku: d, quantity: 7, unit_cost: 10 }], at(1), { ref: 'PO-3' })
  await post(admin, 'IN', [{ sku: d, quantity: 3, unit_cost: 10 }], at(4), { ref: 'PO-BACKDATE', backdate: true })
  await t.callAs(admin, `select public.import_products($1::jsonb, 'NEW')`, [
    JSON.stringify([{ sku: 'IMP-1', product_name: 'Impor Satu', unit: 'PCS', opening_quantity: '10', opening_value: '250' }]),
  ])
  const pid = (await q(`select id from public.products where sku = $1`, [a])).rows[0].id
  const pend = await q(
    `insert into public.inventory_transactions (transaction_number, client_transaction_id, transaction_type, status, created_by, reference_number)
     values ('PEND-1', gen_random_uuid(), 'IN', 'PENDING', $1, 'PENDING-DOC') returning id`, [wh])
  await q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity, unit_cost, total_value) values ($1, $2, 5, 1, 5)`, [pend.rows[0].id, pid])
  await q(`update public.products set is_active = false where sku = $1`, [d])
})
afterAll(async () => {
  await t?.stop()
})

describe('membuat backup', () => {
  it('backup FULL memuat metadata, jumlah baris, checksum per tabel, dan total; angka tetap persis (teks)', async () => {
    const text = await backup('FULL', 'uji')
    expect(typeof text).toBe('string')
    const meta = JSON.parse(text).meta
    expect(meta).toMatchObject({ format: 'whistle-backup', version: 1, schema_version: '5', scope: 'FULL', note: 'uji', created_by: admin })
    for (const [tbl] of TABLES) expect(meta.counts[tbl]).toBe(await count(tbl))
    expect(meta.counts.profiles).toBe(await count('profiles'))
    expect(Object.keys(meta.md5)).toHaveLength(10)
    expect(meta.totals.inventory_value).toBe((await q(`select sum(inventory_value)::text as v from public.stock_balances`)).rows[0].v)
    // presisi 6 desimal dan karakter Unicode tidak berubah
    expect(text).toContain('12000.123456')
    expect(text).toContain('Kopi “Spesial” ☕ 100% arabika')
    // 100 @ nilai 1.000.000 + 50 @ 12.000,123456 (nilai dibukukan 600.006,17) => average 10.666,707800
    expect(text).toContain('10666.707800')
  })

  it('lingkup MASTER, TRANSACTIONS, MOVEMENTS hanya memuat tabelnya; lingkup tidak valid ditolak', async () => {
    const tables = async (scope: string) => Object.keys(JSON.parse(await backup(scope)).tables).sort()
    expect(await tables('MASTER')).toEqual(['product_opening_stock', 'products', 'warehouses'])
    expect(await tables('TRANSACTIONS')).toEqual(['inventory_transaction_items', 'inventory_transactions'])
    expect(await tables('MOVEMENTS')).toEqual(['inventory_movements', 'stock_balances'])
    await expect(backup('SEMUA')).rejects.toMatchObject({ code: 'WS003' })
  })

  it('setiap backup dicatat di audit trail', async () => {
    const before = await auditCount('BACKUP')
    await backup('MASTER', 'catatan audit')
    expect(await auditCount('BACKUP')).toBe(before + 1)
    const row = (await q(`select user_id, new_value from public.audit_logs where action = 'BACKUP' order by created_at desc limit 1`)).rows[0]
    expect(row.user_id).toBe(admin)
    expect(row.new_value).toMatchObject({ scope: 'MASTER', note: 'catatan audit' })
  })
})

describe('validasi integritas SEBELUM restore', () => {
  it('backup yang utuh lolos semua pemeriksaan dan dapat dipulihkan', async () => {
    const v = await validate(await backup('FULL'))
    expect(failed(v)).toEqual([])
    expect(v).toMatchObject({ ok: true, restorable: true })
    const names = v.checks.map((c: { name: string }) => c.name)
    expect(names).toEqual(expect.arrayContaining(['format', 'schema', 'scope', 'table_inventory_movements', 'load', 'unique_keys', 'ledger_chain', 'balances_match_ledger', 'ledger_totals', 'no_negative', 'references', 'status_rules', 'sequences_unique', 'users']))
  })

  it('file diubah tanpa menghitung ulang checksum ditolak (checksum tabel)', async () => {
    const text = await backup('FULL')
    const bad = (await q(`select jsonb_set($1::jsonb, '{tables,inventory_movements,0,quantity_in}', '"999"')::text as r`, [text])).rows[0].r
    const v = await validate(bad)
    expect(v.restorable).toBe(false)
    expect(failed(v)).toContain('table_inventory_movements')
  })

  it('isi diubah dengan checksum "dirapikan": rantai saldo ledger tetap tertangkap', async () => {
    const text = await backup('FULL')
    const bad = await tamper(text, `jsonb_set($1::jsonb, '{tables,inventory_movements,1,quantity_in}', '"1.0000"')`, 'inventory_movements')
    const v = await validate(bad)
    expect(v.restorable).toBe(false)
    expect(failed(v)).toEqual(expect.arrayContaining(['ledger_chain']))
  })

  it('saldo resmi yang tidak sama dengan ledger tertangkap', async () => {
    const text = await backup('FULL')
    const bad = await tamper(text, `jsonb_set($1::jsonb, '{tables,stock_balances,0,quantity}', '"12345.0000"')`, 'stock_balances')
    const v = await validate(bad)
    expect(failed(v)).toEqual(expect.arrayContaining(['balances_match_ledger']))
    expect(v.restorable).toBe(false)
  })

  it('relasi putus (item tanpa transaksi) dan kunci ganda tertangkap', async () => {
    const text = await backup('FULL')
    const orphan = await tamper(text, `jsonb_set($1::jsonb, '{tables,inventory_transaction_items}', ($1::jsonb #> '{tables,inventory_transaction_items}') - 0)`, 'inventory_transaction_items')
    expect(failed(await validate(orphan))).toEqual(expect.arrayContaining(['references']))
    const dup = await tamper(text, `jsonb_set($1::jsonb, '{tables,products}', ($1::jsonb #> '{tables,products}') || jsonb_build_array(($1::jsonb #> '{tables,products,0}')))`, 'products')
    expect(failed(await validate(dup))).toEqual(expect.arrayContaining(['unique_keys']))
  })

  it('format, versi skema, dan teks bukan JSON ditolak', async () => {
    const text = await backup('FULL')
    expect((await validate('bukan json {')).checks[0]).toMatchObject({ name: 'format', ok: false })
    const wrongFormat = (await q(`select jsonb_set($1::jsonb, '{meta,format}', '"lain"')::text as r`, [text])).rows[0].r
    expect(failed(await validate(wrongFormat))).toContain('format')
    const wrongSchema = (await q(`select jsonb_set($1::jsonb, '{meta,schema_version}', '"1"')::text as r`, [text])).rows[0].r
    const v = await validate(wrongSchema)
    expect(failed(v)).toContain('schema')
    expect(v.restorable).toBe(false)
    const badScope = (await q(`select jsonb_set($1::jsonb, '{meta,scope}', '"XYZ"')::text as r`, [text])).rows[0].r
    expect((await validate(badScope)).restorable).toBe(false)
  })

  it('backup TRANSACTIONS/MOVEMENTS valid sebagai arsip tetapi tidak dapat dipulihkan', async () => {
    for (const scope of ['TRANSACTIONS', 'MOVEMENTS']) {
      const text = await backup(scope)
      const v = await validate(text)
      expect(v.ok).toBe(true) // utuh
      expect(v.restorable).toBe(false) // tetapi bukan untuk restore
      expect(failed(v)).toContain('restorable')
      await expect(restore(text)).rejects.toMatchObject({ code: 'WS004' })
    }
  })

  it('pengguna yang tidak dikenal database tujuan: ditolak, kecuali dipetakan ke ADMIN pemulih', async () => {
    const text = await backup('FULL')
    const stranger = randomUUID()
    const bad = await tamper(text, `jsonb_set($1::jsonb, '{tables,inventory_transactions}', (select jsonb_agg(case when x.ord = 1 then jsonb_set(x.e, '{created_by}', to_jsonb('${stranger}'::text)) else x.e end order by x.ord) from jsonb_array_elements($1::jsonb #> '{tables,inventory_transactions}') with ordinality as x(e, ord)))`, 'inventory_transactions')
    const v = await validate(bad)
    expect(failed(v)).toContain('users')
    expect(v.restorable).toBe(false)
    expect(v.missing_users).toBe(1)
    expect((await validate(bad, true)).restorable).toBe(true)
  })
})

describe('restore penuh: round trip persis sama', () => {
  it('backup -> ubah banyak hal -> restore = keadaan semula (seluruh tabel identik), saldo dan ledger konsisten', async () => {
    const s1 = await state()
    const rev1 = (await q(`select count(*)::int as n from public.inventory_transactions where status = 'REVERSED'`)).rows[0].n
    const b1 = await backup('FULL', 'sebelum perubahan')

    // ubah banyak hal setelah backup
    const sku = (await q(`select sku from public.products where sku = 'BK-1'`)).rows[0].sku
    await post(wh, 'OUT', [{ sku, quantity: 5 }], new Date().toISOString(), { ref: 'SJ-NEW' })
    await post(admin, 'IN', [{ sku, quantity: 9, unit_cost: 777 }], new Date().toISOString(), { ref: 'PO-NEW' })
    await q(`update public.products set product_name = 'Diubah', category = 'Lain' where sku = $1`, [sku])
    await q(`update public.products set is_active = true where sku = 'BK-4'`)
    await t.callAs(admin, `select public.import_products($1::jsonb, 'NEW')`, [JSON.stringify([{ sku: 'IMP-2', product_name: 'Baru Setelah Backup', unit: 'PCS', opening_quantity: '3', opening_value: '30' }])])
    const lastBuy = (await q(`select id from public.inventory_transactions where reference_number = 'PO-NEW'`)).rows[0].id
    await t.callAs(admin, `select public.reverse_transaction($1, $2, 'uji')`, [randomUUID(), lastBuy])
    const s2 = await state()
    expect(s2).not.toEqual(s1)
    const auditBefore = await auditCount()

    const res = await restore(b1)
    expect(res).toMatchObject({ ok: true, scope: 'FULL' })
    expect(res.post_check.ok).toBe(true)
    expect(res.counts.products).toBe(await count('products'))

    // seluruh tabel kembali persis seperti saat backup
    expect(await state()).toEqual(s1)
    expect((await q(`select count(*)::int as n from public.inventory_transactions where status = 'REVERSED'`)).rows[0].n).toBe(rev1)
    // data setelah backup memang hilang
    expect((await q(`select count(*)::int as n from public.products where sku = 'IMP-2'`)).rows[0].n).toBe(0)
    // audit trail TIDAK ditulis ulang: hanya bertambah satu catatan RESTORE
    expect(await auditCount()).toBe(auditBefore + 1)
    expect((await q(`select new_value from public.audit_logs where action = 'RESTORE' order by created_at desc limit 1`)).rows[0].new_value).toMatchObject({
      scope: 'FULL', backup_created_by: admin, counts: expect.objectContaining({ products: expect.any(Number) }),
    })
  })

  it('setelah restore: integritas sempurna dan pembukuan berikutnya berjalan normal (urutan lanjut, tanpa bentrok)', async () => {
    const integ = await asAdmin(`select public.verify_integrity() as r`)
    expect(integ.r.ok).toBe(true)
    expect(integ.r.checks.every((c: { ok: boolean }) => c.ok)).toBe(true)
    const maxSeq = Number((await q(`select max(posting_sequence) as m from public.inventory_transactions`)).rows[0].m)
    const maxMov = Number((await q(`select max(movement_sequence) as m from public.inventory_movements`)).rows[0].m)
    const r = await post(wh, 'OUT', [{ sku: 'BK-1', quantity: 1 }], new Date().toISOString(), { ref: 'SJ-AFTER' })
    expect(Number(r.posting_sequence)).toBe(maxSeq + 1)
    expect(Number((await q(`select max(movement_sequence) as m from public.inventory_movements`)).rows[0].m)).toBe(maxMov + 1)
    const nums = await q(`select count(*)::int as total, count(distinct transaction_number)::int as uniq from public.inventory_transactions`)
    expect(nums.rows[0].total).toBe(nums.rows[0].uniq)
    const rec = await t.callAs(admin, `select count(*)::int as bad from public.reconcile_inventory() where not ok`)
    expect(rec.rows[0].bad).toBe(0)
  })

  it('restore point otomatis menyimpan keadaan sebelum restore, dapat diunduh, dan dapat dipulihkan (batal restore)', async () => {
    const before = await state()
    const mark = await backup('FULL')
    await post(admin, 'IN', [{ sku: 'BK-2', quantity: 2, unit_cost: 5 }], new Date().toISOString(), { ref: 'PO-MARK' }) // keadaan "terbaru"
    const latest = await state()
    expect(latest).not.toEqual(before)

    const res = await restore(mark) // kembali ke "before"
    expect(await state()).toEqual(before)
    const points = (await asAdmin(`select public.list_restore_points() as r`)).r
    const p = points.find((x: { id: string }) => x.id === res.restore_point_id)
    expect(p).toMatchObject({ scope: 'FULL', created_by_name: 'Admin Utama' })
    expect(p.counts.inventory_movements).toBeGreaterThan(0)

    const snap = (await asAdmin(`select public.get_restore_point($1) as r`, [res.restore_point_id])).r
    expect((await validate(snap)).restorable).toBe(true)
    await restore(snap) // batalkan restore -> kembali ke "latest"
    expect(await state()).toEqual(latest)
  })

  it('titik pemulihan dibatasi 5 terbaru', async () => {
    const b = await backup('FULL')
    for (let i = 0; i < 7; i++) await restore(b)
    const points = (await asAdmin(`select public.list_restore_points() as r`)).r
    expect(points).toHaveLength(5)
    expect(points.map((x: { created_at: string }) => x.created_at)).toEqual([...points.map((x: { created_at: string }) => x.created_at)].sort().reverse())
  })

  it('backup yang tidak lolos validasi ditolak dan database TIDAK berubah', async () => {
    const before = await state()
    const text = await backup('FULL')
    const bad = await tamper(text, `jsonb_set($1::jsonb, '{tables,inventory_movements,2,value_in}', '"1.00"')`, 'inventory_movements')
    await expect(restore(bad)).rejects.toMatchObject({ code: 'WS004' })
    await expect(restore('bukan json')).rejects.toMatchObject({ code: 'WS004' })
    expect(await state()).toEqual(before)
  })

  it('kegagalan di tengah restore membatalkan SEMUANYA, gerbang bersih, ledger tetap terlindungi', async () => {
    const before = await state()
    const points = await count2(`select count(*)::int as n from public.backup_snapshots`)
    const text = await backup('FULL')
    // lolos validasi (rantai saldo tetap utuh: neto 0) tetapi melanggar CHECK saat dimasukkan
    const sneaky = await tamper(
      text,
      `jsonb_set(jsonb_set(jsonb_set(jsonb_set($1::jsonb,
         '{tables,inventory_movements,0,quantity_in}', to_jsonb(((($1::jsonb #>> '{tables,inventory_movements,0,quantity_in}')::numeric) + 5)::text)),
         '{tables,inventory_movements,0,quantity_out}', to_jsonb(((($1::jsonb #>> '{tables,inventory_movements,0,quantity_out}')::numeric) + 5)::text)),
         '{tables,inventory_movements,0,value_in}', to_jsonb(((($1::jsonb #>> '{tables,inventory_movements,0,value_in}')::numeric) + 5)::text)),
         '{tables,inventory_movements,0,value_out}', to_jsonb(((($1::jsonb #>> '{tables,inventory_movements,0,value_out}')::numeric) + 5)::text))`,
      'inventory_movements',
    )
    expect((await validate(sneaky)).restorable).toBe(true) // validasi file tidak melihat CHECK tabel asli
    await expect(restore(sneaky)).rejects.toThrow(/check|violates/i)
    expect(await state()).toEqual(before) // tidak ada yang berubah
    expect(await count2(`select count(*)::int as n from public.backup_snapshots`)).toBe(points) // titik pemulihan ikut dibatalkan
    expect(await count2(`select count(*)::int as n from app.restore_gate`)).toBe(0)
    // pelindung ledger tetap berlaku di luar restore
    await expect(q(`update public.inventory_movements set quantity_in = 1`)).rejects.toThrow(/append-only/)
    await expect(q(`delete from public.inventory_movements`)).rejects.toThrow(/append-only/)
    await expect(q(`update public.inventory_transactions set notes = 'x' where status = 'POSTED'`)).rejects.toThrow(/tidak boleh diubah/)
  })

  it('pemetaan pengguna: backup dari lingkungan lain dapat dipulihkan dengan pemetaan ke ADMIN dan tercatat', async () => {
    const text = await backup('FULL')
    const stranger = randomUUID()
    const bad = await tamper(text, `jsonb_set($1::jsonb, '{tables,inventory_transactions}', (select jsonb_agg(case when x.ord <= 3 then jsonb_set(x.e, '{created_by}', to_jsonb('${stranger}'::text)) else x.e end order by x.ord) from jsonb_array_elements($1::jsonb #> '{tables,inventory_transactions}') with ordinality as x(e, ord)))`, 'inventory_transactions')
    await expect(restore(bad)).rejects.toMatchObject({ code: 'WS004' })
    const res = await restore(bad, 'PULIHKAN', true)
    expect(res.remapped_transactions).toBe(3)
    expect((await q(`select count(*)::int as n from public.inventory_transactions where created_by = $1`, [stranger])).rows[0].n).toBe(0)
    expect((await q(`select new_value from public.audit_logs where action = 'RESTORE' order by created_at desc limit 1`)).rows[0].new_value.remapped_transactions).toBe(3)
    expect((await asAdmin(`select public.verify_integrity() as r`)).r.ok).toBe(true)
  })
})

describe('restore master barang', () => {
  it('MASTER mengembalikan master tanpa menyentuh transaksi, ledger, dan saldo', async () => {
    const master = await backup('MASTER')
    const full = await state()
    await q(`update public.products set product_name = 'RUSAK', category = 'X', minimum_stock = 999, is_active = false where sku = 'BK-2'`)
    await q(`update public.warehouses set warehouse_name = 'Diganti'`)
    await q(`insert into public.products (sku, product_name) values ('SETELAH-MASTER', 'Barang baru')`)
    const res = await restore(master)
    expect(res).toMatchObject({ ok: true, scope: 'MASTER' })
    const p = (await q(`select product_name, category, minimum_stock::text as ms, is_active from public.products where sku = 'BK-2'`)).rows[0]
    expect(p).toMatchObject({ product_name: 'Barang BK-2', category: 'Snack', is_active: true })
    expect(p.ms).toBe('50.0000')
    expect((await q(`select warehouse_name from public.warehouses`)).rows[0].warehouse_name).toBe('Gudang Utama')
    // tidak menghapus barang yang ditambahkan setelah backup (upsert, bukan ganti total)
    expect((await q(`select count(*)::int as n from public.products where sku = 'SETELAH-MASTER'`)).rows[0].n).toBe(1)
    // transaksi, ledger, dan saldo tidak tersentuh
    const after = await state()
    for (const tbl of ['inventory_transactions', 'inventory_transaction_items', 'inventory_movements', 'stock_balances']) expect(after[tbl]).toBe(full[tbl])
    await q(`delete from public.products where sku = 'SETELAH-MASTER'`)
  })
})

describe('hak akses dan konfirmasi', () => {
  it('hanya ADMIN yang boleh membuat, memvalidasi, memulihkan, memeriksa, dan melihat titik pemulihan/audit', async () => {
    const text = await backup('FULL')
    for (const who of [wh, viewer]) {
      await expect(backup('FULL', null, who)).rejects.toMatchObject({ code: '42501' })
      await expect(validate(text, false, who)).rejects.toMatchObject({ code: '42501' })
      await expect(restore(text, 'PULIHKAN', false, who)).rejects.toMatchObject({ code: '42501' })
      for (const sql of [`select public.verify_integrity()`, `select public.list_restore_points()`, `select public.audit_trail()`, `select public.audit_filters()`, `select public.get_restore_point(gen_random_uuid())`]) {
        await expect(t.callAs(who, sql)).rejects.toMatchObject({ code: '42501' })
      }
    }
    for (const sql of [`select public.create_backup('FULL')`, `select public.verify_integrity()`, `select public.audit_trail()`]) {
      await expect(t.callAs(null, sql, [], 'anon')).rejects.toThrow(/permission denied/)
    }
    const off = await t.createUser('adminoff@whistle.test', 'ADMIN')
    await q(`update public.profiles set is_active = false where id = $1`, [off])
    await expect(backup('FULL', null, off)).rejects.toMatchObject({ code: '42501' })
  })

  it('kalimat konfirmasi wajib PULIHKAN; salah = ditolak tanpa efek', async () => {
    const text = await backup('FULL')
    const before = await state()
    const points = await count2(`select count(*)::int as n from public.backup_snapshots`)
    for (const wrong of ['pulihkan', 'YA', '', 'PULIHKAN ']) {
      await expect(restore(text, wrong)).rejects.toMatchObject({ code: 'WS003' })
    }
    expect(await state()).toEqual(before)
    expect(await count2(`select count(*)::int as n from public.backup_snapshots`)).toBe(points)
  })

  it('gerbang restore tidak dapat dipalsukan: pengguna tidak punya akses, dan ledger tetap terkunci', async () => {
    await expect(t.callAs(admin, `insert into app.restore_gate (txid) values (txid_current())`)).rejects.toThrow(/permission denied/)
    await expect(t.callAs(admin, `select app.restore_active()`)).rejects.toThrow(/permission denied/)
    await expect(
      t.callAs(admin, `select set_config('whistle.restore', 'on', true), set_config('app.restore', 'on', true)`),
    ).resolves.toBeDefined()
    await expect(t.callAs(admin, `delete from public.inventory_movements`)).rejects.toThrow(/permission denied/)
    await expect(t.callAs(admin, `select * from public.backup_snapshots`)).rejects.toThrow(/permission denied/)
  })
})

describe('cek integritas database', () => {
  it('mendeteksi saldo yang menyimpang dari ledger', async () => {
    expect((await asAdmin(`select public.verify_integrity() as r`)).r.ok).toBe(true)
    await q(`update public.stock_balances set quantity = quantity + 1 where product_id = (select id from public.products where sku = 'BK-1')`)
    const bad = (await asAdmin(`select public.verify_integrity() as r`)).r
    expect(bad.ok).toBe(false)
    const names = bad.checks.filter((c: { ok: boolean }) => !c.ok).map((c: { name: string }) => c.name)
    expect(names).toEqual(expect.arrayContaining(['balances_match_ledger', 'ledger_totals', 'replay']))
    await q(`update public.stock_balances set quantity = quantity - 1 where product_id = (select id from public.products where sku = 'BK-1')`)
    expect((await asAdmin(`select public.verify_integrity() as r`)).r.ok).toBe(true)
  })

  it('melaporkan jumlah data dan waktu pemeriksaan', async () => {
    const r = (await asAdmin(`select public.verify_integrity() as r`)).r
    expect(r.counts.products).toBe(await count('products'))
    expect(r.counts.movements).toBe(await count('inventory_movements'))
    expect(new Date(r.checked_at).toString()).not.toBe('Invalid Date')
  })
})

describe('audit trail', () => {
  const trail = (a: Record<string, unknown> = {}) =>
    asAdmin(`select public.audit_trail($1::date, $2::date, $3::uuid, $4, $5, $6, $7, $8) as r`, [
      a.from ?? null, a.to ?? null, a.user ?? null, a.action ?? null, a.table ?? null, a.search ?? null, a.limit ?? 500, a.offset ?? 0,
    ]).then((x) => x.r)

  it('mencatat posting, reversal, adjustment, import, perubahan master, role, backup, dan restore', async () => {
    const all = await trail()
    const actions = new Set(all.rows.map((r: { action: string }) => r.action))
    for (const a of ['POST', 'REVERSAL', 'IMPORT', 'BACKDATED_POST', 'INSERT', 'UPDATE', 'BACKUP', 'RESTORE']) expect(actions.has(a), a).toBe(true)
    const adj = all.rows.find((r: { action: string; new_value: { type?: string } }) => r.action === 'POST' && r.new_value?.type === 'ADJUSTMENT')
    expect(adj).toBeDefined()
    const role = all.rows.find((r: { table_name: string }) => r.table_name === 'user_roles')
    expect(role).toBeDefined()
    const rev = all.rows.find((r: { action: string; new_value: { reason?: string } }) => r.action === 'REVERSAL' && r.new_value?.reason === 'Salah input')
    expect(rev.old_value).toMatchObject({ status: 'POSTED' })
    expect(rev.new_value).toMatchObject({ status: 'REVERSED', reason: 'Salah input' })
  })

  it('setiap entri memuat pelaku, waktu, tabel, dan nilai lama/baru', async () => {
    const upd = (await trail({ action: 'UPDATE', table: 'products' })).rows[0]
    expect(upd.table_name).toBe('products')
    expect(upd.old_value).toBeTruthy()
    expect(upd.new_value).toBeTruthy()
    expect(new Date(upd.created_at).toString()).not.toBe('Invalid Date')
    const post = (await trail({ action: 'POST' })).rows[0]
    expect(post.user_name).toBeTruthy()
  })

  it('filter tanggal, pengguna, aksi, tabel, pencarian, dan pagination', async () => {
    const all = await trail({ limit: 1000 })
    expect(all.total_count).toBe(await count('audit_logs'))
    expect(all.rows.length).toBe(all.total_count)
    const posts = await trail({ action: 'POST' })
    expect(posts.rows.every((r: { action: string }) => r.action === 'POST')).toBe(true)
    expect(posts.total_count).toBe(await auditCount('POST'))
    const mine = await trail({ user: wh })
    expect(mine.rows.every((r: { user_id: string }) => r.user_id === wh)).toBe(true)
    const today = await trail({ from: dstr(0), to: dstr(0) })
    expect(today.total_count).toBeGreaterThan(0)
    expect((await trail({ from: dstr(-5), to: dstr(-3) })).total_count).toBe(0)
    expect((await trail({ search: 'Salah input' })).rows.some((r: { action: string }) => r.action === 'REVERSAL')).toBe(true)
    const p1 = await trail({ limit: 5, offset: 0 })
    const p2 = await trail({ limit: 5, offset: 5 })
    expect(p1.total_count).toBe(p2.total_count)
    expect(p1.rows).toHaveLength(5)
    const ids = p1.rows.map((r: { id: string }) => r.id)
    expect(p2.rows.every((r: { id: string }) => !ids.includes(r.id))).toBe(true)
    const times = p1.rows.map((r: { created_at: string }) => new Date(r.created_at).getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('filter untuk dropdown dan audit trail tidak dapat diubah', async () => {
    const f = (await asAdmin(`select public.audit_filters() as r`)).r
    expect(f.actions).toEqual(expect.arrayContaining(['POST', 'BACKUP', 'RESTORE']))
    expect(f.tables).toEqual(expect.arrayContaining(['products', 'inventory_transactions', 'database']))
    expect(f.users.map((u: { name: string }) => u.name)).toContain('Admin Utama')
    await expect(q(`update public.audit_logs set action = 'X'`)).rejects.toThrow(/append-only/)
    await expect(q(`delete from public.audit_logs`)).rejects.toThrow(/append-only/)
  })
})

describe('skala: 1.000 SKU', () => {
  it('backup, validasi, ubah, dan restore data besar tetap identik dan cepat', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      sku: `BIG-${String(i).padStart(5, '0')}`, barcode: `7700${String(i).padStart(8, '0')}`, product_name: `Besar ${i}`, unit: 'PCS',
      opening_quantity: i % 2 ? '10' : '25.5', opening_value: i % 2 ? '1000.10' : '2550.05',
    }))
    await t.callAs(admin, `select public.import_products($1::jsonb, 'NEW')`, [JSON.stringify(rows)])
    for (let i = 0; i < 100; i++) await post(wh, 'OUT', [{ sku: `BIG-${String(i).padStart(5, '0')}`, quantity: 1 }], new Date().toISOString(), { ref: `SJ-BIG-${i}` })

    const s1 = await state()
    const t0 = Date.now()
    const text = await backup('FULL')
    const v = await validate(text)
    expect(v.restorable).toBe(true)
    expect(JSON.parse(text).meta.counts.products).toBeGreaterThanOrEqual(1000)
    await q(`update public.products set product_name = 'Hancur' where sku like 'BIG-%'`)
    await post(admin, 'IN', [{ sku: 'BIG-00001', quantity: 1, unit_cost: 5 }], new Date().toISOString())
    await restore(text)
    expect(await state()).toEqual(s1)
    expect(Date.now() - t0).toBeLessThan(90_000)
    expect((await asAdmin(`select public.verify_integrity() as r`)).r.ok).toBe(true)
  }, 180_000)
})
