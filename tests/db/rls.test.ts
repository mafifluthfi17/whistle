import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './harness'

let t: TestDb
let admin: string
let wh: string
let viewer: string
let warehouseId: string

const q = (sql: string, params: unknown[] = []) => t.db.query<Record<string, any>>(sql, params)
const insertProduct = (sku: string, barcode: string | null = null) =>
  q(`insert into public.products (sku, barcode, product_name) values ($1, $2, $3) returning id`, [sku, barcode, `Barang ${sku}`])

let uuidCounter = 0
const uuid = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}`
const newTx = (userId: string, over: Partial<Record<string, unknown>> = {}) => {
  const v = { type: 'IN', status: 'PENDING', ...over }
  return q(
    `insert into public.inventory_transactions (transaction_number, client_transaction_id, transaction_type, status, created_by)
     values ($1, $2, $3, $4, $5) returning id`,
    [`TX-${uuidCounter}-${Math.random()}`, uuid(), v.type, v.status, userId],
  )
}

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.createUser('admin@whistle.test', 'ADMIN')
  wh = await t.createUser('gudang@whistle.test', 'WAREHOUSE')
  viewer = await t.createUser('viewer@whistle.test', 'VIEWER')
  warehouseId = (await q(`select id from public.warehouses`)).rows[0].id
  await insertProduct('SKU-001', '8999999000011')
}, 60_000)

afterAll(async () => {
  await t.db.close()
})

describe('pengguna baru', () => {
  it('membuat profil dan role VIEWER otomatis', async () => {
    const id = await t.createUser('baru@whistle.test', 'VIEWER', 'Budi')
    const p = await q(`select full_name, email, is_active from public.profiles where id = $1`, [id])
    expect(p.rows[0]).toMatchObject({ full_name: 'Budi', email: 'baru@whistle.test', is_active: true })
    const r = await q(`select role from public.user_roles where user_id = $1`, [id])
    expect(r.rows[0].role).toBe('VIEWER')
  })

  it('gudang awal tersedia dan hanya satu gudang aktif', async () => {
    await expect(
      q(`insert into public.warehouses (warehouse_code, warehouse_name) values ('WH-02', 'Gudang Dua')`),
    ).rejects.toThrow(/warehouses_single_active/)
  })
})

describe('akses baca', () => {
  it.each([
    ['ADMIN', () => admin],
    ['WAREHOUSE', () => wh],
    ['VIEWER', () => viewer],
  ])('%s dapat membaca master barang', async (_n, who) => {
    const r = await t.as(who(), () => q(`select sku from public.products`))
    expect(r.rows.length).toBeGreaterThan(0)
  })

  it('anon tidak punya akses ke tabel mana pun', async () => {
    for (const table of ['products', 'profiles', 'stock_balances', 'inventory_movements', 'audit_logs', 'user_roles']) {
      await expect(t.as(null, () => q(`select * from public.${table}`), 'anon')).rejects.toThrow(/permission denied/)
    }
  })

  it('pengguna tanpa sesi (uid kosong) tidak melihat data', async () => {
    const r = await t.as(null, () => q(`select * from public.products`))
    expect(r.rows).toHaveLength(0)
  })
})

describe('master barang: hanya ADMIN yang menulis', () => {
  it.each([
    ['WAREHOUSE', () => wh],
    ['VIEWER', () => viewer],
  ])('%s ditolak menambah barang', async (_n, who) => {
    await expect(
      t.as(who(), () => q(`insert into public.products (sku, product_name) values ('X-1', 'X')`)),
    ).rejects.toThrow(/row-level security/)
  })

  it('WAREHOUSE tidak dapat mengubah atau menghapus barang (0 baris terpengaruh)', async () => {
    const upd = await t.as(wh, () => q(`update public.products set product_name = 'Diretas' where sku = 'SKU-001'`))
    expect(upd.affectedRows).toBe(0)
    const del = await t.as(wh, () => q(`delete from public.products where sku = 'SKU-001'`))
    expect(del.affectedRows).toBe(0)
    const r = await q(`select product_name from public.products where sku = 'SKU-001'`)
    expect(r.rows[0].product_name).toBe('Barang SKU-001')
  })

  it('ADMIN dapat menambah dan mengubah barang', async () => {
    await t.as(admin, () => q(`insert into public.products (sku, product_name) values ('ADM-1', 'Dari Admin')`))
    const upd = await t.as(admin, () => q(`update public.products set category = 'Umum' where sku = 'ADM-1'`))
    expect(upd.affectedRows).toBe(1)
  })
})

describe('role dan pengguna', () => {
  it('pengguna tidak dapat menaikkan role sendiri', async () => {
    const upd = await t.as(viewer, () => q(`update public.user_roles set role = 'ADMIN' where user_id = $1`, [viewer]))
    expect(upd.affectedRows).toBe(0)
    await expect(
      t.as(wh, () => q(`insert into public.user_roles (user_id, role) values ($1, 'ADMIN')`, [uuid()])),
    ).rejects.toThrow(/row-level security/)
    const r = await q(`select role from public.user_roles where user_id = $1`, [viewer])
    expect(r.rows[0].role).toBe('VIEWER')
  })

  it('pengguna biasa hanya melihat role dan profil sendiri', async () => {
    const roles = await t.as(wh, () => q(`select user_id from public.user_roles`))
    expect(roles.rows.map((x) => x.user_id)).toEqual([wh])
    const profiles = await t.as(wh, () => q(`select id from public.profiles`))
    expect(profiles.rows.map((x) => x.id)).toEqual([wh])
  })

  it('ADMIN dapat melihat semua dan mengubah role pengguna lain', async () => {
    const u = await t.createUser('ubah@whistle.test', 'VIEWER')
    const upd = await t.as(admin, () => q(`update public.user_roles set role = 'WAREHOUSE' where user_id = $1`, [u]))
    expect(upd.affectedRows).toBe(1)
    const all = await t.as(admin, () => q(`select id from public.profiles`))
    expect(all.rows.length).toBeGreaterThanOrEqual(4)
  })

  it('pengguna biasa boleh mengubah nama sendiri tetapi bukan is_active atau email', async () => {
    const ok = await t.as(viewer, () => q(`update public.profiles set full_name = 'Nama Baru' where id = $1`, [viewer]))
    expect(ok.affectedRows).toBe(1)
    await expect(
      t.as(viewer, () => q(`update public.profiles set is_active = false where id = $1`, [viewer])),
    ).rejects.toThrow(/Hanya ADMIN/)
    await expect(
      t.as(viewer, () => q(`update public.profiles set email = 'x@x.com' where id = $1`, [viewer])),
    ).rejects.toThrow(/Hanya ADMIN/)
  })

  it('pengguna tidak dapat mengubah profil pengguna lain', async () => {
    const upd = await t.as(viewer, () => q(`update public.profiles set full_name = 'Hack' where id = $1`, [wh]))
    expect(upd.affectedRows).toBe(0)
  })

  it('ADMIN dapat menonaktifkan pengguna', async () => {
    const u = await t.createUser('nonaktif@whistle.test', 'WAREHOUSE')
    const upd = await t.as(admin, () => q(`update public.profiles set is_active = false where id = $1`, [u]))
    expect(upd.affectedRows).toBe(1)
  })
})

describe('pengguna nonaktif', () => {
  it('tidak dapat membaca data maupun membuat transaksi', async () => {
    const u = await t.createUser('off@whistle.test', 'WAREHOUSE')
    await q(`update public.profiles set is_active = false where id = $1`, [u])
    const read = await t.as(u, () => q(`select * from public.products`))
    expect(read.rows).toHaveLength(0)
    await expect(t.as(u, () => newTx(u))).rejects.toThrow(/row-level security/)
  })

  it('ADMIN nonaktif kehilangan hak admin', async () => {
    const a = await t.createUser('adminoff@whistle.test', 'ADMIN')
    await q(`update public.profiles set is_active = false where id = $1`, [a])
    await expect(
      t.as(a, () => q(`insert into public.products (sku, product_name) values ('OFF-1', 'x')`)),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('transaksi', () => {
  it('WAREHOUSE dan ADMIN boleh membuat transaksi PENDING atas nama sendiri', async () => {
    await t.as(wh, () => newTx(wh))
    await t.as(admin, () => newTx(admin, { type: 'OUT' }))
  })

  it('VIEWER tidak dapat membuat transaksi', async () => {
    await expect(t.as(viewer, () => newTx(viewer))).rejects.toThrow(/row-level security/)
  })

  it('tidak dapat membuat transaksi atas nama orang lain', async () => {
    await expect(t.as(wh, () => newTx(admin))).rejects.toThrow(/row-level security/)
  })

  it('tidak dapat membuat transaksi berstatus POSTED lewat insert langsung', async () => {
    await expect(t.as(wh, () => newTx(wh, { status: 'POSTED' }))).rejects.toThrow(/row-level security|check/)
  })

  it('OPENING, ADJUSTMENT, REVERSAL hanya untuk ADMIN', async () => {
    for (const type of ['OPENING', 'ADJUSTMENT', 'REVERSAL']) {
      await expect(t.as(wh, () => newTx(wh, { type }))).rejects.toThrow(/row-level security/)
      await t.as(admin, () => newTx(admin, { type }))
    }
  })

  it('transaksi tidak dapat diubah atau dihapus langsung oleh pengguna', async () => {
    const id = (await t.as(wh, () => newTx(wh))).rows[0].id
    await expect(
      t.as(wh, () => q(`update public.inventory_transactions set status = 'POSTED' where id = $1`, [id])),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.as(admin, () => q(`delete from public.inventory_transactions where id = $1`, [id])),
    ).rejects.toThrow(/permission denied/)
    const r = await q(`select status from public.inventory_transactions where id = $1`, [id])
    expect(r.rows[0].status).toBe('PENDING')
  })

  it('item hanya dapat ditambah ke transaksi milik sendiri yang belum POSTED', async () => {
    const pid = (await q(`select id from public.products where sku = 'SKU-001'`)).rows[0].id
    const own = (await t.as(wh, () => newTx(wh))).rows[0].id
    await t.as(wh, () =>
      q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity, unit_cost, total_value) values ($1, $2, 10, 1000, 10000)`, [own, pid]),
    )
    const others = (await t.as(admin, () => newTx(admin))).rows[0].id
    await expect(
      t.as(wh, () => q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity) values ($1, $2, 1)`, [others, pid])),
    ).rejects.toThrow(/row-level security/)
    await expect(
      t.as(viewer, () => q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity) values ($1, $2, 1)`, [own, pid])),
    ).rejects.toThrow(/row-level security/)

    const posted = (await newTx(wh, { status: 'PENDING' })).rows[0].id
    await q(`update public.inventory_transactions set status = 'POSTED', posted_at = now(), posting_sequence = nextval('public.inventory_posting_seq') where id = $1`, [posted])
    await expect(
      t.as(wh, () => q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity) values ($1, $2, 1)`, [posted, pid])),
    ).rejects.toThrow(/row-level security/)
  })

  it('status POSTED mewajibkan posted_at dan posting_sequence', async () => {
    const id = (await newTx(wh)).rows[0].id
    await expect(q(`update public.inventory_transactions set status = 'POSTED' where id = $1`, [id])).rejects.toThrow(/check/)
  })

  it('client_transaction_id harus unik (idempotency)', async () => {
    const cid = uuid()
    const ins = () => q(`insert into public.inventory_transactions (transaction_number, client_transaction_id, transaction_type, created_by) values ($1, $2, 'IN', $3)`, [`N-${Math.random()}`, cid, wh])
    await ins()
    await expect(ins()).rejects.toThrow(/client_transaction_id/)
  })
})

describe('saldo dan ledger', () => {
  it('stock_balances tidak dapat ditulis langsung oleh role mana pun', async () => {
    const pid = (await q(`select id from public.products where sku = 'SKU-001'`)).rows[0].id
    for (const who of [admin, wh, viewer]) {
      await expect(
        t.as(who, () => q(`insert into public.stock_balances (warehouse_id, product_id, quantity) values ($1, $2, 5)`, [warehouseId, pid])),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('inventory_movements tidak dapat ditulis langsung oleh pengguna', async () => {
    await expect(
      t.as(admin, () => q(`insert into public.inventory_movements (transaction_item_id, product_id, warehouse_id, movement_sequence, movement_date, movement_type, balance_quantity, balance_value, average_cost) values ($1,$1,$1,1,now(),'IN',0,0,0)`, [uuid()])),
    ).rejects.toThrow(/permission denied/)
  })

  async function seedMovement() {
    const pid = (await q(`select id from public.products where sku = 'SKU-001'`)).rows[0].id
    const txId = (await newTx(admin)).rows[0].id
    const item = await q(
      `insert into public.inventory_transaction_items (transaction_id, product_id, quantity, unit_cost, total_value) values ($1, $2, 100, 10000, 1000000) returning id`,
      [txId, pid],
    )
    const m = await q(
      `insert into public.inventory_movements (transaction_item_id, product_id, warehouse_id, movement_sequence, movement_date, movement_type, quantity_in, unit_cost, value_in, balance_quantity, balance_value, average_cost)
       values ($1, $2, $3, nextval('public.inventory_movement_seq'), now(), 'IN', 100, 10000, 1000000, 100, 1000000, 10000) returning id`,
      [item.rows[0].id, pid, warehouseId],
    )
    return m.rows[0].id as string
  }

  it('UPDATE, DELETE, dan TRUNCATE pada ledger diblokir, bahkan untuk superuser', async () => {
    const id = await seedMovement()
    await expect(q(`update public.inventory_movements set quantity_in = 1 where id = $1`, [id])).rejects.toThrow(/append-only/)
    await expect(q(`delete from public.inventory_movements where id = $1`, [id])).rejects.toThrow(/append-only/)
    await expect(q(`truncate public.inventory_movements`)).rejects.toThrow(/append-only/)
    const r = await q(`select quantity_in from public.inventory_movements where id = $1`, [id])
    expect(Number(r.rows[0].quantity_in)).toBe(100)
  })

  it('ledger tidak dapat diubah lewat sesi ADMIN', async () => {
    const id = await seedMovement()
    await expect(
      t.as(admin, () => q(`update public.inventory_movements set quantity_in = 1 where id = $1`, [id])),
    ).rejects.toThrow(/permission denied/)
    await expect(
      t.as(admin, () => q(`delete from public.inventory_movements where id = $1`, [id])),
    ).rejects.toThrow(/permission denied/)
  })

  it('semua role aktif dapat membaca saldo dan ledger', async () => {
    for (const who of [admin, wh, viewer]) {
      const m = await t.as(who, () => q(`select * from public.inventory_movements`))
      expect(m.rows.length).toBeGreaterThan(0)
      await t.as(who, () => q(`select * from public.stock_balances`))
    }
  })

  it('stok negatif ditolak oleh constraint', async () => {
    const pid = (await insertProduct('NEG-1')).rows[0].id
    await expect(
      q(`insert into public.stock_balances (warehouse_id, product_id, quantity) values ($1, $2, -1)`, [warehouseId, pid]),
    ).rejects.toThrow(/check/)
  })

  it('satu baris saldo per gudang dan barang', async () => {
    const pid = (await insertProduct('UNQ-1')).rows[0].id
    await q(`insert into public.stock_balances (warehouse_id, product_id) values ($1, $2)`, [warehouseId, pid])
    await expect(
      q(`insert into public.stock_balances (warehouse_id, product_id) values ($1, $2)`, [warehouseId, pid]),
    ).rejects.toThrow(/duplicate|unique/)
  })
})

describe('audit trail', () => {
  it('perubahan master dan role tercatat otomatis dengan pelaku', async () => {
    await t.as(admin, () => q(`insert into public.products (sku, product_name) values ('AUD-1', 'Audit')`))
    await t.as(admin, () => q(`update public.products set product_name = 'Audit 2' where sku = 'AUD-1'`))
    const r = await q(`select action, user_id from public.audit_logs where table_name = 'products' and new_value ->> 'sku' = 'AUD-1' order by created_at, action`)
    expect(r.rows.map((x) => x.action).sort()).toEqual(['INSERT', 'UPDATE'])
    expect(r.rows.every((x) => x.user_id === admin)).toBe(true)
  })

  it('hanya ADMIN yang dapat membaca audit_logs', async () => {
    const a = await t.as(admin, () => q(`select count(*)::int as n from public.audit_logs`))
    expect(a.rows[0].n).toBeGreaterThan(0)
    for (const who of [wh, viewer]) {
      const r = await t.as(who, () => q(`select * from public.audit_logs`))
      expect(r.rows).toHaveLength(0)
    }
  })

  it('audit_logs tidak dapat ditulis atau diubah pengguna, dan append-only untuk semua', async () => {
    await expect(
      t.as(admin, () => q(`insert into public.audit_logs (action, table_name) values ('X', 'products')`)),
    ).rejects.toThrow(/permission denied/)
    await expect(q(`update public.audit_logs set action = 'Z'`)).rejects.toThrow(/append-only/)
    await expect(q(`delete from public.audit_logs`)).rejects.toThrow(/append-only/)
  })
})

describe('integritas data', () => {
  it('SKU dan barcode duplikat ditolak, barcode kosong (NULL) boleh banyak', async () => {
    await expect(insertProduct('SKU-001')).rejects.toThrow(/sku/)
    await expect(insertProduct('SKU-DUP', '8999999000011')).rejects.toThrow(/barcode/)
    await insertProduct('NULL-A')
    await insertProduct('NULL-B')
  })

  it('SKU dan barcode tersimpan sebagai teks dengan nol di depan', async () => {
    await insertProduct('00123', '0001234567890')
    const r = await q(`select sku, barcode from public.products where sku = '00123'`)
    expect(r.rows[0]).toEqual({ sku: '00123', barcode: '0001234567890' })
  })

  it('tidak ada kolom FLOAT/DOUBLE dan presisi NUMERIC sesuai spesifikasi', async () => {
    const bad = await q(`select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type in ('double precision', 'real')`)
    expect(bad.rows).toEqual([])
    const cols = await q(`select table_name || '.' || column_name as c, numeric_precision as p, numeric_scale as s from information_schema.columns where table_schema = 'public' and data_type = 'numeric'`)
    const spec = Object.fromEntries(cols.rows.map((x) => [x.c, `${x.p},${x.s}`]))
    expect(spec['stock_balances.quantity']).toBe('20,4')
    expect(spec['stock_balances.average_cost']).toBe('20,6')
    expect(spec['stock_balances.inventory_value']).toBe('20,2')
    expect(spec['inventory_transaction_items.unit_cost']).toBe('20,6')
    expect(spec['inventory_movements.balance_value']).toBe('20,2')
    expect(spec['products.minimum_stock']).toBe('20,4')
  })

  it('quantity item harus positif', async () => {
    const pid = (await q(`select id from public.products where sku = 'SKU-001'`)).rows[0].id
    const tx = (await newTx(admin)).rows[0].id
    await expect(
      q(`insert into public.inventory_transaction_items (transaction_id, product_id, quantity) values ($1, $2, 0)`, [tx, pid]),
    ).rejects.toThrow(/check/)
  })
})
