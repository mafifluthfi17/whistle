# WHISTLE

**Warehouse Inventory, Stock Tracking & Ledger Engine**

*Smart Stock. Accurate Value. Total Control*

Aplikasi inventori gudang hybrid cloud-local berbentuk PWA (Android dan desktop) dengan metode **Perpetual Moving Weighted Average**. Supabase (PostgreSQL) adalah sumber kebenaran; IndexedDB (Dexie) hanya untuk cache dan antrean offline.

- Aplikasi (GitHub Pages, HTTPS): https://whistle-id.github.io/whistle/
- Panduan pengguna: [docs/PANDUAN_PENGGUNA.md](docs/PANDUAN_PENGGUNA.md)
- Hasil pengujian: [tests/TEST_CASES.md](tests/TEST_CASES.md)

## Fitur

| Area | Isi |
|---|---|
| Multi-user | Login Supabase Auth; role ADMIN, WAREHOUSE, VIEWER; RLS di semua tabel; pengguna nonaktif ditolak |
| Master barang | CRUD, pencarian, filter, import/export Excel (SheetJS), stok awal (OPENING) |
| Pembukuan | Barang Masuk, Barang Keluar, adjustment, reversal; Moving Average dan HPP dihitung di PostgreSQL |
| Scanner | Kamera (ZXing): EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, QR; input manual SKU |
| Offline | Cache barang dan saldo, antrean transaksi, sinkronisasi idempoten, penanganan konflik |
| Laporan | Kartu stok, stock summary, valuation, movement, low/zero stock, history, dashboard, export Excel |
| Keamanan data | Backup/restore (JSON, checksum), titik pemulihan otomatis, cek integritas, audit trail |

## Arsitektur singkat

```
React + TypeScript + Vite + Tailwind  (PWA: vite-plugin-pwa, hanya cache app shell dan aset)
        │  supabase-js (anon key + sesi pengguna)
        ▼
Supabase: Auth + PostgreSQL + RLS + fungsi SECURITY DEFINER
        ▲
        │  sinkronisasi (urut per SKU, idempoten lewat client_transaction_id)
IndexedDB (Dexie): items, balances, outbox, meta
```

Aturan penting:
- Frontend **tidak** menghitung saldo. Seluruh perhitungan ada di fungsi PostgreSQL (`supabase/migrations/20261118000003_inventory_engine.sql`).
- Angka memakai `NUMERIC` (qty 20,4; harga satuan 20,6; nilai 20,2; average cost 20,6), tidak pernah `FLOAT`. Di klien angka diperlakukan sebagai teks desimal.
- IN: `avg = round((nilai + nilai masuk) / (qty + qty masuk), 6)`. OUT: `HPP = round(qty × avg sebelum, 2)`, average cost tidak berubah. Stok negatif ditolak.
- Ledger `inventory_movements` bersifat append-only; transaksi POSTED tidak dapat diubah atau dihapus langsung.
- Antrean offline bukan pembukuan resmi; server dapat menolaknya jika stok berubah.

## Menyiapkan dan menjalankan

Prasyarat: Node.js 22, akun Supabase.

```bash
npm ci
cp .env.example .env.local   # isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY
npm run dev
```

`.env.local` masuk `.gitignore`. **Jangan pernah** menaruh Service Role Key atau password di repository maupun frontend; aplikasi hanya memakai URL dan anon key.

### 1. Database Supabase

Jalankan lima migration **berurutan** di `supabase/migrations/` (SQL Editor atau `npx supabase db push`):

1. `20261118000001_init_schema.sql` — skema, RLS, trigger audit
2. `20261118000002_product_import.sql` — import master dan stok awal
3. `20261118000003_inventory_engine.sql` — mesin Moving Average, posting, reversal, rekonsiliasi
4. `20261118000004_reports.sql` — kartu stok, laporan, dashboard
5. `20261118000005_backup_restore_audit.sql` — backup, restore, integritas, audit

Jika SQL Editor memperingatkan "Potential issues detected" pada migration 5, pilih opsi yang mengaktifkan RLS.

### 2. Akun ADMIN pertama

Semua pengguna baru otomatis berperan VIEWER. Buat pengguna di Supabase (Authentication > Users), lalu jadikan ADMIN lewat SQL Editor:

```sql
update public.user_roles set role = 'ADMIN'
where user_id = (select id from auth.users where email = 'email-anda@contoh.com');
```

Setelah itu ADMIN dapat mengatur role pengguna lain.

### 3. Deploy (GitHub Pages)

Workflow `.github/workflows/ci.yml`: install, typecheck, tes, build, deploy ke Pages, lalu **smoke test** situs hasil deploy.

1. Settings > Pages > Source: **GitHub Actions**.
2. Settings > Secrets and variables > Actions: tambahkan `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY`.
3. Push ke `main`. Base path otomatis mengikuti nama repository.

Smoke test manual: `npm run smoke -- https://whistle-id.github.io/whistle/ --supabase-url=https://<ref>.supabase.co`.

### 4. Memasang di Android

Buka URL aplikasi di Chrome (HTTPS) > menu ⋮ > **Pasang aplikasi / Tambahkan ke layar utama**. Kamera hanya berfungsi lewat HTTPS. Panduan uji perangkat: [tests/MANUAL_ANDROID.md](tests/MANUAL_ANDROID.md) dan [tests/MANUAL_OFFLINE.md](tests/MANUAL_OFFLINE.md).

## Pengujian

```bash
npm run typecheck
npm test               # seluruh tes otomatis
npm run test:report    # jalankan tes lalu buat ulang tests/TEST_CASES.md
npm run build
```

Tes database memakai PostgreSQL sungguhan (`embedded-postgres`, biner diunduh saat `npm ci`) dan PGlite, termasuk tes konkurensi dengan koneksi paralel. Tes UI memakai jsdom + Testing Library dengan layanan jaringan di-mock. Hasil lengkap beserta expected/actual: [tests/TEST_CASES.md](tests/TEST_CASES.md).

## Struktur repository

```
src/            aplikasi (pages, components, hooks, services, database/Dexie, utils)
supabase/       migrations SQL (skema, RLS, mesin Moving Average, laporan, backup)
tests/          tes otomatis (utils, db, ui), TEST_CASES.md, uji manual perangkat
scripts/        smoke test deploy, pembuat TEST_CASES.md
docs/           panduan pengguna
public/         ikon PWA
```

## Batasan yang diketahui

- **Backup otomatis Supabase tidak aktif** pada Free Plan (diperiksa 19 November 2026). Buat backup manual berkala di menu Pengaturan dan simpan file serta SHA-256-nya di luar aplikasi.
- Transaksi offline **tidak dijamin berhasil**: server menolak bila stok berubah di perangkat lain; transaksi itu menunggu perbaikan atau pembatalan pengguna.
- Restore file backup sangat besar (puluhan MB) dapat ditolak batas ukuran permintaan server; pulihkan lewat SQL Editor bila perlu.
- **Belum diuji di perangkat nyata**: kamera dan scanner, pemasangan PWA di Android, mode pesawat, dan dua perangkat bersamaan. Logikanya teruji otomatis; daftar lengkap di [tests/TEST_CASES.md](tests/TEST_CASES.md).
- `UPCEReader` bawaan `@zxing/library` 0.23 rusak, sehingga ditambal di `src/utils/upcePatch.ts` (teruji dengan gambar sintetis, belum dengan kamera).
- Satu gudang aktif; belum ada multi-gudang di antarmuka.
- Layar Kartu Stok, Laporan, Audit Trail, dan Import/Export belum punya tes antarmuka (logika data dan Excel-nya teruji).
