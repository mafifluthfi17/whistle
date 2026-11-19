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

## Barang Masuk dan Barang Keluar

Menu untuk ADMIN dan WAREHOUSE (mode online). Cari barang (SKU/barcode/nama) atau ketik SKU manual, banyak SKU per dokumen, pratinjau, lalu posting lewat `post_transaction`. Stok tersedia dan average cost selalu dimuat dari server; angka di pratinjau hanya perkiraan. Setiap dokumen punya satu `client_transaction_id` sehingga klik ganda atau retry tidak menggandakan transaksi. Transaksi offline dikerjakan di FASE 8.

## Scanner barcode dan QR

Tombol "Scan Barcode / QR dengan Kamera" di Barang Masuk dan Barang Keluar (kamera belakang default, mulai/hentikan, senter bila didukung, pilih kamera, input manual SKU). Format: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, QR Code. Kamera hanya berfungsi lewat HTTPS. Uji manual Android: [tests/MANUAL_ANDROID.md](tests/MANUAL_ANDROID.md).

Catatan teknis: `UPCEReader` bawaan `@zxing/library` 0.23 rusak, sehingga UPC-E tidak pernah terbaca; aplikasi menambalnya di `src/utils/upcePatch.ts` (teruji dengan gambar sintetis, belum dengan kamera nyata).

## Kartu stok, laporan, dan dashboard

Semua angka dihitung di database (`supabase/migrations/20261118000004_reports.sql`) dari ledger dan saldo resmi, lalu ditampilkan apa adanya:

- **Kartu Stok** per SKU: saldo awal, mutasi, saldo akhir, filter tanggal, klik nomor transaksi untuk detail dan penelusuran.
- **Laporan**: Stock Summary, Inventory Valuation (dengan bukti rekonsiliasi saldo vs ledger), Stock Movement, Low Stock, Zero Stock, Transaction History (filter tanggal, pengguna, jenis, status).
- **Dashboard**: total SKU/qty/nilai, masuk dan keluar hari ini, transaksi PENDING (tidak dibukukan), low/zero stock, aktivitas terakhir.
- **Export Excel**: master barang, saldo stok, kartu stok, inventory valuation, stock movement, barang masuk, barang keluar, transaction history, dan low stock. Nama file memuat periode, SKU/barcode tetap teks, tanggal berupa tanggal Excel (jam Jakarta), format rupiah konsisten, dan ada baris TOTAL. Export audit trail dikerjakan di FASE 9.

Catatan: transaksi PENDING/DRAFT tidak pernah dihitung sebagai saldo. Transaksi mundur (disetujui ADMIN) tetap berurutan menurut urutan posting; saldo awal dan akhir kartu stok memakai jumlah mutasi per tanggal sehingga identitas saldo awal + masuk - keluar = saldo akhir selalu berlaku.

## Offline dan sinkronisasi

- **Cache** (IndexedDB/Dexie): master barang dan saldo terakhir yang diketahui, diperbarui otomatis saat online. Dipakai untuk mencari dan scan barang saat offline. Bukan saldo resmi.
- **Antrean offline**: transaksi masuk/keluar yang dicatat offline (atau saat masih ada antrean untuk SKU yang sama) disimpan di IndexedDB dengan UUID, `client_transaction_id`, waktu, pengguna, jenis, payload, dan status `PENDING`/`SYNCING`/`SYNCED`/`FAILED`/`CONFLICT`. Belum resmi dan tidak memengaruhi saldo.
- **Sinkronisasi** (`src/services/sync.ts`): otomatis saat online, berurutan menurut pencatatan lokal, idempoten lewat `client_transaction_id`, satu proses pada satu waktu. Server memvalidasi stok, urutan, dan menghitung Moving Average.
- **Jika gagal**: data lokal tidak dihapus dan tidak diubah otomatis; penyebab ditampilkan; pengguna dapat memperbaiki atau membatalkan di menu Antrean Offline. Transaksi `SYNCED` tidak pernah dikirim ulang. Transaksi berikutnya untuk SKU yang sama ditahan selama yang sebelumnya gagal/konflik.
- **Service worker** hanya meng-cache app shell dan aset (tanpa cache API), jadi aplikasi dapat dibuka offline.
- Transaksi offline **tidak dijamin berhasil** bila stok berubah di perangkat lain. Uji manual perangkat: [tests/MANUAL_OFFLINE.md](tests/MANUAL_OFFLINE.md).

## Backup, restore, integritas, dan audit trail

Menu **Pengaturan** (ADMIN) dan **Audit Trail** (ADMIN), migration `20261118000005_backup_restore_audit.sql`.

- **Backup** (file JSON): `FULL` (database lengkap), `MASTER` (master barang), `TRANSACTIONS`, `MOVEMENTS` (arsip). Dibuat di database sebagai teks sehingga angka NUMERIC tetap persis; dilengkapi checksum per tabel. Nama file memuat lingkup dan waktu; SHA-256 ditampilkan untuk verifikasi file.
- **Restore** (hanya ADMIN, `FULL` dan `MASTER`): validasi integritas file (checksum, skema, relasi, rantai saldo ledger, saldo vs ledger) lalu konfirmasi ketik `PULIHKAN`, titik pemulihan otomatis (5 terbaru), pengantian data secara **atomik**, dan pemeriksaan integritas ulang; gagal di mana pun = seluruhnya dibatalkan. Ledger tetap append-only kecuali di dalam fungsi restore. Pengguna/role dan audit trail tidak diganti; restore dicatat di audit trail.
- **Backup cloud berbeda dari export Excel**: backup untuk memulihkan, Excel untuk dibaca.
- **Backup otomatis Supabase TIDAK aktif**: dashboard Supabase (diperiksa 19 Nov 2026) menyatakan Free Plan tidak menyertakan backup project. Backup manual adalah satu-satunya salinan; buatlah berkala.
- **Audit trail**: pencatatan master, posting, reversal, adjustment, import, role, backup, dan restore; filter tanggal, pengguna, aksi, tabel, pencarian; export Excel. Hanya ADMIN, tidak dapat diubah.
- Batas: kiriman restore sangat besar (puluhan MB) dapat ditolak batas ukuran permintaan server; pulihkan lewat SQL Editor Supabase bila perlu.

Status: FASE 9 (backup, restore, audit trail).
