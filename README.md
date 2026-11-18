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

Status: FASE 3 (master barang dan Excel).
