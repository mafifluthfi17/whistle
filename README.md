# WHISTLE

**Warehouse Inventory, Stock Tracking & Ledger Engine**

*Smart Stock. Accurate Value. Total Control*

Aplikasi inventori gudang hybrid cloud-local (PWA Android dan desktop) dengan metode Perpetual Moving Weighted Average. Supabase adalah sumber kebenaran; IndexedDB (Dexie) untuk cache dan antrean offline.

## Menjalankan

```bash
npm install
cp .env.example .env.local   # isi URL dan anon key Supabase
npm run dev
```

Perintah lain: `npm run typecheck`, `npm test`, `npm run build`.

## Deployment

GitHub Actions membangun dan men-deploy ke GitHub Pages saat push ke `main`. Atur `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` di GitHub Secrets. Jangan pernah memasukkan Service Role Key ke repository.

## Database (Supabase)

Migration ada di `supabase/migrations/`. Tes RLS (`npm test`) berjalan pada Postgres lokal (PGlite), tanpa Docker.

Menjalankan migration ke project Supabase Anda:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Semua pengguna baru otomatis berperan VIEWER. Jadikan akun pertama ADMIN lewat Supabase SQL Editor (lihat komentar di bagian atas file migration).

## Master barang dan Excel

- Menu Master Barang: tambah, edit, nonaktifkan, cari (SKU/barcode/nama), filter, pagination.
- Menu Import/Export (ADMIN): download template, import (mode Barang baru atau Update master), export master.
- Import atomik lewat fungsi database `import_products`. Stok awal disimpan di `product_opening_stock` dan baru diposting sebagai transaksi OPENING di FASE 4.

## Mesin Moving Weighted Average

Seluruh pembukuan saldo dilakukan di PostgreSQL (`supabase/migrations/20261118000003_inventory_engine.sql`), bukan di frontend:

| Fungsi | Kegunaan |
|---|---|
| `post_transaction` | OPENING, IN, OUT, ADJUSTMENT. Atomik, idempoten (`client_transaction_id`), kunci baris per SKU dalam urutan SKU. |
| `reverse_transaction` | Reversal (ADMIN) dengan replay penuh rangkaian mutasi SKU. |
| `post_pending_openings` | Memposting stok awal hasil import yang belum diposting. |
| `reconcile_inventory` | Rekonsiliasi `stock_balances` vs replay ledger vs jumlah mutasi. |

Aturan: IN `avg = round((nilai + nilai masuk) / (qty + qty masuk), 6)`; OUT `HPP = round(qty × avg sebelum, 2)`, avg tidak berubah. Stok negatif ditolak (`WS001`), transaksi mundur ditolak kecuali disetujui ADMIN (`WS002`), validasi (`WS003`), reversal ditolak (`WS004`). Ledger `inventory_movements` bersifat append-only.

Tes konkurensi memakai Postgres sungguhan (`embedded-postgres`), jadi `npm test` mengunduh biner Postgres pada pemasangan pertama.

Status: FASE 4 (mesin Moving Average).
