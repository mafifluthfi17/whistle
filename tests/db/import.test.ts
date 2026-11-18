import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

let t: TestDb
let admin: string
let wh: string
let viewer: string

const q = (sql: string, params: unknown[] = []) => t.db.query<Record<string, any>>(sql, params)
const count = async (table: string) => Number((await q(`select count(*)::int as n from public.${table}`)).rows[0].n)
const importAs = (who: string | null, rows: unknown[], mode = 'NEW', role: 'authenticated' | 'anon' = 'authenticated') =>
  t.as(who, () => q(`select public.import_products($1::jsonb, $2) as r`, [JSON.stringify(rows), mode]), role)

const row = (sku: string, over: Record<string, unknown> = {}) => ({
  sku,
  product_name: `Barang ${sku}`,
  unit: 'PCS',
  ...over,
})

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.createUser('admin@whistle.test', 'ADMIN')
  wh = await t.createUser('gudang@whistle.test', 'WAREHOUSE')
  viewer = await t.createUser('viewer@whistle.test', 'VIEWER')
}, 60_000)

afterAll(async () => {
  await t.db.close()
})

describe('import_products: hak akses', () => {
  it('hanya ADMIN yang boleh import', async () => {
    for (const who of [wh, viewer]) {
      await expect(importAs(who, [row('A-1')])).rejects.toThrow(/Hanya ADMIN/)
    }
    await expect(importAs(null, [row('A-1')], 'NEW', 'anon')).rejects.toThrow(/permission denied/)
    expect(await count('products')).toBe(0)
  })

  it('pengguna ADMIN yang nonaktif ditolak', async () => {
    const a = await t.createUser('adminoff@whistle.test', 'ADMIN')
    await q(`update public.profiles set is_active = false where id = $1`, [a])
    await expect(importAs(a, [row('A-1')])).rejects.toThrow(/Hanya ADMIN/)
  })

  it('mode tidak valid dan data kosong ditolak', async () => {
    await expect(importAs(admin, [row('A-1')], 'HAPUS')).rejects.toThrow(/Mode import/)
    await expect(importAs(admin, [])).rejects.toThrow(/kosong/)
  })
})

describe('import_products: mode NEW', () => {
  it('menyimpan barang baru, menjaga nol di depan SKU/barcode, dan mencatat audit', async () => {
    const res = await importAs(admin, [
      row('00123', { barcode: '0001234567890', category: 'Minuman', brand: 'X', location: 'A-01', minimum_stock: '5' }),
      row('SKU-2'),
    ])
    expect(res.rows[0].r).toMatchObject({ inserted: 2, openings_staged: 0 })
    const p = await q(`select sku, barcode, category, minimum_stock::text as ms from public.products where sku = '00123'`)
    expect(p.rows[0]).toEqual({ sku: '00123', barcode: '0001234567890', category: 'Minuman', ms: '5.0000' })
    const audit = await q(`select new_value from public.audit_logs where action = 'IMPORT'`)
    expect(audit.rows[0].new_value).toMatchObject({ mode: 'NEW', inserted: 2 })
  })

  it('stok awal tersimpan di penampung dan rata-rata dihitung dari nilai / qty', async () => {
    await importAs(admin, [row('OPN-1', { opening_quantity: '150', opening_value: '1600000' })])
    const r = await q(
      `select o.quantity::text as q, o.opening_value::text as v, o.average_cost::text as a, o.posted_at
       from public.product_opening_stock o join public.products p on p.id = o.product_id where p.sku = 'OPN-1'`,
    )
    expect(r.rows[0]).toMatchObject({ q: '150.0000', v: '1600000.00', a: '10666.666667' })
    expect(r.rows[0].posted_at).not.toBeNull()
  })

  it('memposting OPENING satu per SKU: transaksi, ledger, dan saldo dibuat bersama impor', async () => {
    expect(await count('inventory_transactions')).toBe(1)
    expect(await count('inventory_movements')).toBe(1)
    expect(await count('stock_balances')).toBe(1)
    const tx = await q(`select transaction_type, reference_number, status from public.inventory_transactions`)
    expect(tx.rows).toEqual([{ transaction_type: 'OPENING', reference_number: 'IMPORT', status: 'POSTED' }])
    const b = await q(
      `select sb.quantity::text as q, sb.inventory_value::text as v, sb.average_cost::text as a
       from public.stock_balances sb join public.products p on p.id = sb.product_id where p.sku = 'OPN-1'`,
    )
    expect(b.rows[0]).toEqual({ q: '150.0000', v: '1600000.00', a: '10666.666667' })
  })

  it('stok 0 dan nilai 0 tidak membuat baris stok awal', async () => {
    await importAs(admin, [row('ZERO-1', { opening_quantity: '0', opening_value: '0' })])
    const r = await q(`select count(*)::int as n from public.product_opening_stock o join public.products p on p.id = o.product_id where p.sku = 'ZERO-1'`)
    expect(r.rows[0].n).toBe(0)
  })

  it('SKU yang sudah ada ditolak di mode NEW', async () => {
    await expect(importAs(admin, [row('SKU-2')])).rejects.toThrow(/Baris 1.*duplikat/)
  })
})

describe('import_products: atomik (gagal sebagian = batal semua)', () => {
  const before = async () => ({
    p: await count('products'),
    o: await count('product_opening_stock'),
    a: await count('audit_logs'),
    tx: await count('inventory_transactions'),
    mv: await count('inventory_movements'),
    sb: await count('stock_balances'),
  })

  it('barcode duplikat di baris ke-3 membatalkan baris 1-2', async () => {
    const b = await before()
    await expect(
      importAs(admin, [row('ATM-1', { barcode: '111' }), row('ATM-2', { opening_quantity: '10', opening_value: '100' }), row('ATM-3', { barcode: '111' })]),
    ).rejects.toThrow(/Baris 3.*duplikat/)
    expect(await before()).toEqual(b)
  })

  it('SKU ganda di dalam file membatalkan semuanya', async () => {
    const b = await before()
    await expect(importAs(admin, [row('DUP-1'), row('DUP-1')])).rejects.toThrow(/Baris 2.*duplikat/)
    expect(await before()).toEqual(b)
  })

  it('barcode bentrok dengan data yang sudah ada membatalkan semuanya', async () => {
    await importAs(admin, [row('EXIST-1', { barcode: '999' })])
    const b = await before()
    await expect(importAs(admin, [row('NEW-OK'), row('NEW-BAD', { barcode: '999' })])).rejects.toThrow(/Baris 2/)
    expect(await before()).toEqual(b)
  })

  it('stok awal > 0 tanpa nilai membatalkan semuanya', async () => {
    const b = await before()
    await expect(importAs(admin, [row('V-1'), row('V-2', { opening_quantity: '5' })])).rejects.toThrow(/Baris 2.*Nilai persediaan/)
    expect(await before()).toEqual(b)
  })

  it('stok awal 0 dengan nilai > 0 ditolak', async () => {
    const b = await before()
    await expect(importAs(admin, [row('V-3', { opening_quantity: '0', opening_value: '50' })])).rejects.toThrow(/Baris 1/)
    expect(await before()).toEqual(b)
  })

  it('stok awal negatif atau angka rusak ditolak', async () => {
    const b = await before()
    await expect(importAs(admin, [row('N-1', { opening_quantity: '-5', opening_value: '10' })])).rejects.toThrow(/Baris 1/)
    await expect(importAs(admin, [row('N-2', { minimum_stock: 'abc' })])).rejects.toThrow(/Baris 1.*format angka/)
    await expect(importAs(admin, [row('N-3', { minimum_stock: '-1' })])).rejects.toThrow(/Baris 1/)
    expect(await before()).toEqual(b)
  })

  it('SKU kosong ditolak', async () => {
    await expect(importAs(admin, [{ product_name: 'Tanpa SKU' }])).rejects.toThrow(/Baris 1.*SKU wajib/)
  })
})

describe('import_products: mode UPDATE', () => {
  let pid: string

  beforeAll(async () => {
    await importAs(admin, [row('UPD-1', { barcode: 'B-UPD', category: 'Lama', brand: 'MerekLama', location: 'L1', minimum_stock: '3', opening_quantity: '10', opening_value: '1000' })])
    pid = (await q(`select id from public.products where sku = 'UPD-1'`)).rows[0].id
    // saldo (10 unit, nilai 1000, avg 100) sudah dibuat oleh posting OPENING saat impor
  })

  it('mengubah master tetapi tidak menyentuh saldo maupun stok awal', async () => {
    const snapshot = async () =>
      JSON.stringify([
        (await q(`select quantity::text, average_cost::text, inventory_value::text from public.stock_balances where product_id = $1`, [pid])).rows,
        (await q(`select quantity::text, opening_value::text, average_cost::text from public.product_opening_stock where product_id = $1`, [pid])).rows,
      ])
    const before = await snapshot()
    const res = await importAs(
      admin,
      [row('UPD-1', { product_name: 'Nama Baru', category: 'Baru', opening_quantity: '999', opening_value: '999' })],
      'UPDATE',
    )
    expect(res.rows[0].r).toMatchObject({ updated: 1, inserted: 0 })
    const p = await q(`select product_name, category from public.products where id = $1`, [pid])
    expect(p.rows[0]).toEqual({ product_name: 'Nama Baru', category: 'Baru' })
    expect(await snapshot()).toBe(before)
  })

  it('sel kosong berarti tidak diubah', async () => {
    await importAs(admin, [{ sku: 'UPD-1', product_name: '', barcode: '', category: '', brand: 'MerekBaru', location: '', minimum_stock: '' }], 'UPDATE')
    const p = await q(`select product_name, barcode, category, brand, location, minimum_stock::text as ms from public.products where id = $1`, [pid])
    expect(p.rows[0]).toEqual({ product_name: 'Nama Baru', barcode: 'B-UPD', category: 'Baru', brand: 'MerekBaru', location: 'L1', ms: '3.0000' })
  })

  it('SKU tidak terdaftar membatalkan seluruh update', async () => {
    await expect(
      importAs(admin, [row('UPD-1', { product_name: 'Tidak Boleh Berubah' }), row('GAIB-1')], 'UPDATE'),
    ).rejects.toThrow(/Baris 2.*tidak ditemukan/)
    const p = await q(`select product_name from public.products where id = $1`, [pid])
    expect(p.rows[0].product_name).toBe('Nama Baru')
  })

  it('barcode yang bentrok saat update ditolak dan membatalkan semuanya', async () => {
    await importAs(admin, [row('UPD-2', { barcode: 'B-UPD-2' })])
    await expect(importAs(admin, [row('UPD-2', { barcode: 'B-UPD' })], 'UPDATE')).rejects.toThrow(/Baris 1.*duplikat/)
    const p = await q(`select barcode from public.products where sku = 'UPD-2'`)
    expect(p.rows[0].barcode).toBe('B-UPD-2')
  })
})

describe('master barang: penghapusan dan histori', () => {
  it('barang yang punya histori transaksi tidak dapat dihapus, yang tidak punya dapat dihapus', async () => {
    await importAs(admin, [row('HIS-1'), row('HIS-2')])
    const pid = (await q(`select id from public.products where sku = 'HIS-1'`)).rows[0].id
    const tx = await q(
      `insert into public.inventory_transactions (transaction_number, client_transaction_id, transaction_type, created_by)
       values ('TX-H1', gen_random_uuid(), 'IN', $1) returning id`,
      [admin],
    )
    await q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity) values ($1, $2, 1)`, [tx.rows[0].id, pid])

    await expect(t.as(admin, () => q(`delete from public.products where sku = 'HIS-1'`))).rejects.toThrow(/foreign key/)
    const del = await t.as(admin, () => q(`delete from public.products where sku = 'HIS-2'`))
    expect(del.affectedRows).toBe(1)
  })

  it('perubahan nama dan kategori tidak mengubah histori ledger', async () => {
    const pid = (await q(`select id from public.products where sku = 'HIS-1'`)).rows[0].id
    const before = (await q(`select count(*)::int as n from public.inventory_transaction_items where product_id = $1`, [pid])).rows[0].n
    await importAs(admin, [row('HIS-1', { product_name: 'Diganti', category: 'Baru' })], 'UPDATE')
    const after = (await q(`select count(*)::int as n from public.inventory_transaction_items where product_id = $1`, [pid])).rows[0].n
    expect(after).toBe(before)
  })
})

describe('import_products: 1.000 SKU', () => {
  it('mengimpor 1.000 SKU (dengan stok awal) dalam satu transaksi', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => {
      const n = String(i + 1).padStart(5, '0')
      return row(`BULK-${n}`, {
        barcode: `89990000${n}`,
        category: `Kat ${i % 10}`,
        opening_quantity: i % 2 === 0 ? '10' : undefined,
        opening_value: i % 2 === 0 ? '100000' : undefined,
      })
    })
    const start = Date.now()
    const res = await importAs(admin, rows)
    expect(res.rows[0].r).toMatchObject({ rows: 1000, inserted: 1000, openings_staged: 500 })
    expect(Date.now() - start).toBeLessThan(30_000)
    const n = await q(`select count(*)::int as n from public.products where sku like 'BULK-%'`)
    expect(n.rows[0].n).toBe(1000)
  }, 60_000)

  it('duplikat di baris terakhir dari 1.000 membatalkan seluruh impor', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row(`BULK2-${i}`, { barcode: `77${i}` }))
    rows[999] = row('BULK2-LAST', { barcode: '770' })
    const b = await count('products')
    await expect(importAs(admin, rows)).rejects.toThrow(/Baris 1000.*duplikat/)
    expect(await count('products')).toBe(b)
  }, 60_000)
})

describe('stok awal tidak terbaca oleh anon, terbaca oleh role aktif', () => {
  it('VIEWER dapat membaca; tidak ada yang dapat menulis langsung', async () => {
    const r = await t.as(viewer, () => q(`select count(*)::int as n from public.product_opening_stock`))
    expect(r.rows[0].n).toBeGreaterThan(0)
    await expect(
      t.as(admin, () => q(`insert into public.product_opening_stock (product_id, quantity, opening_value, average_cost) values (gen_random_uuid(), 1, 1, 1)`)),
    ).rejects.toThrow(/permission denied/)
  })
})
