# WHISTLE — MASTER PROMPT FINAL V3.1
# Warehouse Inventory, Stock Tracking & Ledger Engine

**Tagline: Smart Stock. Accurate Value. Total Control**

**Hybrid Cloud–Local | Android PWA | Multi-User | Single Warehouse | Perpetual Moving Weighted Average**

---

## 1. ROLE DAN TUJUAN

Bertindak sebagai:
- Senior Full Stack Developer.
- Software Architect.
- Database Engineer.
- UI/UX Designer.
- Inventory Accounting Specialist.
- Software Quality Assurance Engineer.

Bangun aplikasi Warehouse Inventory Management yang benar-benar berfungsi dan siap digunakan untuk kegiatan operasional gudang.

Aplikasi bukan sekadar prototype, mockup, atau tampilan dashboard.

### Konfigurasi aplikasi

| Parameter | Ketentuan |
|---|---|
| Nama aplikasi | WHISTLE (Warehouse Inventory, Stock Tracking & Ledger Engine) |
| Tagline | Smart Stock. Accurate Value. Total Control |
| Sistem | Hybrid Cloud–Local |
| Gudang | Single Warehouse |
| Pengguna | Multiple Users |
| Jumlah SKU | Di bawah 1.000 |
| Platform | Android PWA dan Desktop |
| Database utama | Supabase PostgreSQL |
| Database lokal | IndexedDB |
| Authentication | Supabase Auth |
| Frontend hosting | GitHub Pages |
| Source code | GitHub |
| Metode persediaan | Perpetual Moving Weighted Average |
| Bahasa | Indonesia |
| Mata uang | Rupiah (IDR) |
| Zona waktu | Asia/Jakarta |

Prioritas utama:
1. Akurasi perhitungan persediaan.
2. Konsistensi database.
3. Keamanan transaksi multi-user.
4. Kemudahan penggunaan Android.
5. Kemampuan offline dan sinkronisasi.
6. Import dan export Excel.

## 2. TECHNOLOGY STACK

Gunakan teknologi:

- React.
- TypeScript.
- Vite.
- Tailwind CSS.
- Supabase PostgreSQL.
- Supabase Authentication.
- Supabase Row Level Security.
- IndexedDB menggunakan Dexie.js.
- SheetJS untuk Excel.
- ZXing untuk barcode dan QR scanner.
- Vite PWA Plugin.
- GitHub Actions.
- GitHub Pages.

Gunakan versi library yang stabil dan kompatibel.

Seluruh source code harus berada dalam GitHub repository.

## 3. ARSITEKTUR HYBRID

Gunakan prinsip:

**Supabase = Single Source of Truth.**

Supabase menyimpan seluruh data resmi:
- Master barang.
- Transaksi masuk.
- Transaksi keluar.
- Saldo persediaan.
- Histori mutasi.
- User dan hak akses.
- Audit trail.

IndexedDB menyimpan:
- Cache master barang.
- Cache saldo stok.
- Data yang dibutuhkan ketika offline.
- Antrean transaksi offline.
- Status sinkronisasi.

### Ketika online

1. Aplikasi mengambil data terbaru dari Supabase.
2. Pengguna melakukan transaksi.
3. Server melakukan validasi.
4. Server menghitung Moving Average.
5. Database menyimpan transaksi secara atomik.
6. Aplikasi menerima saldo resmi.
7. IndexedDB diperbarui.

### Ketika offline

1. Aplikasi tetap dapat dibuka.
2. Pengguna dapat mencari master barang yang telah tersimpan.
3. Barcode scanner tetap dapat digunakan jika kamera dan aplikasi tersedia.
4. Transaksi masuk dan keluar dapat dicatat secara lokal.
5. Transaksi diberi status PENDING.
6. Transaksi belum dianggap sebagai transaksi resmi.
7. Setelah online, transaksi dikirim ke server.
8. Server memvalidasi stok, urutan transaksi, dan konsistensi data.
9. Jika valid, transaksi diposting.
10. Jika tidak valid, transaksi ditolak dengan alasan yang jelas.

Jangan menggunakan strategi last-write-wins untuk saldo persediaan.

Service worker hanya perlu melakukan cache terhadap application shell dan aset aplikasi. Jangan mengandalkan service worker sebagai database transaksi.

## 4. DATABASE DESIGN

Buat migration SQL untuk seluruh tabel berikut.

### A. profiles

- id UUID PRIMARY KEY.
- full_name.
- email.
- is_active.
- created_at.
- updated_at.

Relasi dengan auth.users.

### B. user_roles

- id UUID PRIMARY KEY.
- user_id UUID.
- role.
- created_at.

Role:
- ADMIN.
- WAREHOUSE.
- VIEWER.

### C. warehouses

- id UUID PRIMARY KEY.
- warehouse_code.
- warehouse_name.
- address.
- is_active.

Versi pertama hanya mendukung satu gudang aktif.

### D. products

- id UUID PRIMARY KEY.
- sku TEXT UNIQUE NOT NULL.
- barcode TEXT UNIQUE NULL.
- product_name.
- category.
- brand.
- unit.
- location.
- minimum_stock NUMERIC.
- is_active.
- created_at.
- updated_at.

SKU dan barcode harus diperlakukan sebagai teks.

### E. stock_balances

- id UUID PRIMARY KEY.
- warehouse_id.
- product_id.
- quantity.
- average_cost.
- inventory_value.
- updated_at.

Buat UNIQUE constraint untuk kombinasi warehouse_id dan product_id.

Saldo merupakan hasil pembukuan transaksi dan dapat dibangun ulang dari inventory ledger.

### F. inventory_transactions

- id UUID PRIMARY KEY.
- transaction_number UNIQUE.
- client_transaction_id UNIQUE.
- transaction_type.
- transaction_date.
- posting_sequence.
- reference_number.
- supplier_or_recipient.
- notes.
- status.
- created_by.
- approved_by.
- created_at.
- posted_at.

Jenis transaksi:
- OPENING.
- IN.
- OUT.
- ADJUSTMENT.
- REVERSAL.

Status:
- DRAFT.
- PENDING.
- POSTED.
- REJECTED.
- REVERSED.

### G. inventory_transaction_items

- id UUID PRIMARY KEY.
- transaction_id.
- product_id.
- quantity.
- unit_cost.
- total_value.
- average_cost_before.
- average_cost_after.
- created_at.

Satu dokumen transaksi dapat memiliki banyak SKU.

### H. inventory_movements

- id UUID PRIMARY KEY.
- transaction_item_id.
- product_id.
- warehouse_id.
- movement_sequence.
- movement_date.
- movement_type.
- quantity_in.
- quantity_out.
- unit_cost.
- value_in.
- value_out.
- balance_quantity.
- balance_value.
- average_cost.
- created_at.

Tabel ini menjadi histori mutasi persediaan yang tidak boleh diedit atau dihapus secara langsung oleh pengguna.

### I. audit_logs

- id UUID PRIMARY KEY.
- user_id.
- action.
- table_name.
- record_id.
- old_value.
- new_value.
- created_at.

Catat perubahan master, posting, reversal, adjustment, import, dan aktivitas administratif.

### J. Database integrity

Terapkan:
- Foreign keys.
- Unique constraints.
- Check constraints.
- Index untuk SKU, barcode, tanggal dan nomor transaksi.
- Row-level locking.
- Atomic database transactions.
- Idempotency protection.

Gunakan NUMERIC, bukan FLOAT atau DOUBLE PRECISION, untuk nilai persediaan dan perhitungan biaya.

Rekomendasi presisi:
- Quantity: NUMERIC(20,4).
- Unit cost: NUMERIC(20,6).
- Inventory value: NUMERIC(20,2).
- Average cost: NUMERIC(20,6).

## 5. AUTHENTICATION DAN USER ACCESS

Gunakan Supabase Auth.

Buat tiga tingkatan pengguna.

### ADMIN
- Mengelola pengguna.
- Mengelola master barang.
- Import dan export Excel.
- Melakukan transaksi.
- Melakukan adjustment.
- Mengelola reversal.
- Melihat seluruh laporan.
- Melakukan backup dan restore.
- Mengakses audit trail.

### WAREHOUSE
- Melihat master barang.
- Input barang masuk.
- Input barang keluar.
- Scan barcode.
- Input manual SKU.
- Melihat stok.
- Melihat histori transaksi.

### VIEWER
- Hanya membaca data.
- Melihat kartu stok.
- Melihat laporan.
- Tidak dapat membuat atau mengubah transaksi.

Terapkan RLS untuk setiap tabel yang relevan.

Ketentuan keamanan:
- User nonaktif tidak dapat melakukan transaksi.
- User tidak boleh menaikkan role sendiri.
- Perubahan role hanya ADMIN.
- Hak akses harus divalidasi di database.
- Jangan pernah menempatkan Service Role Key di frontend.
- Gunakan Supabase Anon/Publishable Key pada frontend dengan RLS yang benar.
- Gunakan fungsi database yang aman untuk validasi role tanpa menimbulkan recursive RLS.

## 6. MASTER BARANG

Buat fitur:

- Tambah barang.
- Edit barang.
- Nonaktifkan barang.
- Pencarian SKU.
- Pencarian barcode.
- Pencarian nama barang.
- Filter kategori.
- Filter status.
- Pagination.
- Import Excel.
- Export Excel.

Informasi barang:
- SKU.
- Barcode.
- Nama barang.
- Kategori.
- Merek.
- Satuan.
- Lokasi gudang.
- Minimum stock.
- Status aktif.

Jangan mengizinkan penghapusan master barang yang masih memiliki histori transaksi.

Perubahan nama, kategori, dan informasi lainnya tidak boleh mengubah histori transaksi.

Perubahan SKU dan barcode harus melalui validasi keunikan.

## 7. IMPORT MASTER BARANG DENGAN EXCEL

Sediakan tombol DOWNLOAD TEMPLATE EXCEL.

Buat workbook dengan dua sheet.

### Sheet 1: MASTER_BARANG

Kolom:
- SKU.
- BARCODE.
- NAMA_BARANG.
- KATEGORI.
- MEREK.
- SATUAN.
- LOKASI_GUDANG.
- STOK_AWAL.
- NILAI_PERSEDIAAN_AWAL.
- HARGA_RATA_RATA_AWAL.
- MINIMUM_STOCK.

### Sheet 2: PETUNJUK

Berisi:
- Petunjuk pengisian.
- Contoh data.
- Format kolom.
- Kolom wajib.
- Validasi data.

### Proses import

1. Upload Excel.
2. Baca workbook.
3. Validasi nama dan struktur kolom.
4. Tampilkan preview.
5. Validasi SKU duplikat.
6. Validasi barcode duplikat.
7. Validasi angka dan format.
8. Tampilkan error per baris.
9. Tampilkan ringkasan jumlah data valid dan tidak valid.
10. Konfirmasi import.
11. Simpan menggunakan database transaction.

Sediakan dua mode:
- Import barang baru.
- Update master barang yang sudah terdaftar.

Update master tidak boleh mengubah saldo persediaan.

### Opening inventory

Saldo awal harus dibuat melalui transaksi OPENING tersendiri.

Validasi:
- Jika quantity awal lebih besar dari nol, nilai persediaan harus tersedia.
- Harga rata-rata awal = nilai persediaan awal / quantity awal.
- Jika quantity awal nol, nilai persediaan awal harus nol.
- Nilai persediaan tidak boleh negatif.
- Setiap SKU hanya memiliki satu opening inventory untuk gudang tersebut.

Import harus atomik: jika proses gagal, tidak boleh meninggalkan data opening inventory yang hanya tersimpan sebagian.

Urutan pengerjaan: pada FASE 3 aplikasi hanya memvalidasi dan menyimpan master barang beserta data stok awal yang valid. Posting transaksi OPENING dilakukan setelah mesin Moving Average tersedia di FASE 4.

Jangan mengubah angka SKU atau barcode menjadi format numerik Excel.

Target awal: minimal 1.000 SKU.

## 8. TRANSAKSI BARANG MASUK

Buat menu BARANG MASUK.

Fitur:
- Scan barcode.
- Scan QR Code.
- Input SKU manual.
- Cari barang.
- Input kuantitas.
- Input harga beli per unit.
- Input nomor dokumen.
- Input tanggal.
- Input supplier.
- Input keterangan.
- Tambah banyak SKU dalam satu dokumen.
- Preview sebelum posting.

Harga beli harus mencerminkan biaya perolehan persediaan yang digunakan dalam kebijakan perusahaan, termasuk biaya pembelian yang relevan dan pengurang harga yang berlaku.

Rumus:

Nilai Pembelian = Quantity Masuk × Unit Cost.

Average Cost Baru:

(Saldo Nilai Sebelum + Nilai Pembelian) / (Saldo Quantity Sebelum + Quantity Masuk).

Simpan:
- Average cost sebelum.
- Average cost sesudah.
- Quantity masuk.
- Unit cost.
- Nilai masuk.
- Saldo akhir.

## 9. TRANSAKSI BARANG KELUAR

Buat menu BARANG KELUAR.

Fitur:
- Scan barcode.
- Scan QR Code.
- Input SKU manual.
- Cari barang.
- Tampilkan nama barang.
- Tampilkan stok tersedia.
- Tampilkan average cost.
- Input quantity keluar.
- Input tanggal.
- Input nomor dokumen.
- Input penerima/tujuan.
- Input keterangan.
- Banyak SKU dalam satu dokumen.

Rumus:

HPP = Quantity Keluar × Average Cost Sebelum Transaksi.

Saldo Quantity = Quantity Sebelum - Quantity Keluar.

Saldo Nilai = Saldo Nilai Sebelum - HPP.

Average cost tidak berubah karena transaksi keluar.

Ketentuan:
- Tidak boleh stok negatif.
- Tidak boleh posting jika saldo tidak mencukupi.
- HPP disimpan permanen pada transaksi.
- Posting harus dilakukan secara atomik.
- Jika salah satu detail transaksi gagal, seluruh dokumen gagal diposting.

## 10. MOVING WEIGHTED AVERAGE ENGINE

Gunakan metode Perpetual Moving Weighted Average.

Perhitungan final dilakukan di PostgreSQL melalui database function atau stored procedure yang terkendali.

Jangan mengandalkan perhitungan frontend untuk membukukan saldo.

### Contoh perhitungan wajib

Saldo awal:
- Quantity: 100 unit.
- Average cost: Rp10.000.
- Inventory value: Rp1.000.000.

Pembelian:
- Quantity: 50 unit.
- Unit cost: Rp12.000.
- Nilai masuk: Rp600.000.

Saldo setelah pembelian:
- Quantity: 150 unit.
- Inventory value: Rp1.600.000.
- Average cost: Rp10.666,666667.

Pengeluaran:
- Quantity: 30 unit.
- HPP: Rp320.000.

Saldo akhir:
- Quantity: 120 unit.
- Inventory value: Rp1.280.000.
- Average cost: Rp10.666,666667.

### Aturan pembulatan

- Simpan average cost sampai 6 angka desimal.
- Simpan nilai rupiah sampai 2 angka desimal.
- Hitung HPP berdasarkan average cost sebelum transaksi.
- Pembulatan HPP dilakukan pada tingkat detail transaksi.
- Saldo nilai dihitung berdasarkan mutasi nilai yang telah dibukukan.
- Hindari pembulatan prematur.

### Transaction ordering

Gunakan posting_sequence yang dibuat server sebagai urutan resmi pembukuan.

- Transaksi dengan tanggal yang sama mengikuti urutan posting server.
- Transaksi mundur tidak boleh langsung diposting jika tanggalnya lebih awal daripada transaksi yang sudah dibukukan untuk SKU terkait.
- Transaksi mundur harus melalui persetujuan ADMIN dan prosedur rekalkulasi.
- Transaksi yang sudah POSTED tidak boleh diedit langsung.
- Koreksi harus melalui adjustment atau reversal terkontrol.

### Concurrency control

Ketika dua user melakukan transaksi bersamaan:

- Lock baris stock_balances untuk SKU terkait.
- Lock dalam urutan SKU yang konsisten untuk menghindari deadlock.
- Validasi saldo terbaru di server.
- Hitung ulang Moving Average.
- Posting seluruh dokumen secara atomik.
- Gunakan idempotency key agar retry tidak menggandakan transaksi.

## 11. ADJUSTMENT, REVERSAL DAN AUDIT TRAIL

Buat prosedur koreksi.

### Adjustment

Digunakan untuk:
- Selisih stock opname.
- Barang rusak.
- Barang hilang.
- Kesalahan pencatatan kuantitas.
- Penyesuaian nilai dengan dasar yang dapat dipertanggungjawabkan.

Setiap adjustment harus memiliki alasan, referensi, pengguna pembuat, dan persetujuan ADMIN sesuai kebijakan.

### Reversal

Transaksi POSTED tidak boleh dihapus.

Buat mekanisme reversal dengan:
- Referensi transaksi asal.
- Alasan pembatalan.
- User yang melakukan.
- Tanggal koreksi.
- Approval.
- Histori sebelum dan sesudah.

Untuk reversal transaksi historis yang memengaruhi Moving Average, lakukan replay/recalculation atas seluruh rangkaian mutasi SKU terkait dari titik transaksi yang terdampak.

Jangan sekadar membalik saldo saat ini tanpa memperhitungkan dampaknya terhadap HPP transaksi setelahnya.

Simpan histori koreksi tanpa menghapus catatan sebelumnya.

## 12. HYBRID SYNC ENGINE

Antrean offline disimpan di IndexedDB.

Setiap transaksi lokal harus memiliki:
- UUID.
- Client transaction ID.
- Created timestamp.
- User ID.
- Transaction type.
- Transaction payload.
- Sync status.

Status:
- PENDING.
- SYNCING.
- SYNCED.
- FAILED.
- CONFLICT.

Proses:
1. Simpan transaksi offline.
2. Masukkan ke antrean lokal.
3. Kirim ketika online.
4. Server melakukan idempotency check.
5. Server memeriksa urutan transaksi.
6. Server memvalidasi saldo.
7. Server menghitung Moving Average.
8. Server menyimpan transaksi jika valid.
9. Server mengirim hasil.
10. Perbarui cache lokal.

Jika transaksi gagal:
- Jangan menghapus data lokal.
- Tampilkan penyebab.
- Berikan opsi perbaikan atau pembatalan.
- Jangan otomatis mengubah kuantitas atau harga transaksi.
- Jangan mengirim ulang transaksi yang sudah berhasil diposting.

Untuk transaksi offline yang saling bergantung pada SKU yang sama, pertahankan urutan pencatatan lokal dan validasi kembali seluruh rangkaiannya di server.

Jangan menjanjikan transaksi offline multi-user selalu berhasil karena stok dapat berubah pada perangkat lain.

## 13. BARCODE DAN QR SCANNER

Gunakan ZXing atau library stabil yang kompatibel.

Dukung:
- EAN-13.
- EAN-8.
- UPC-A.
- UPC-E.
- Code 128.
- Code 39.
- QR Code.

Fitur:
- Kamera belakang sebagai default.
- Tombol mulai scan.
- Tombol hentikan scan.
- Flashlight jika didukung perangkat.
- Input manual SKU.
- Pencarian barang.
- Tampilan hasil scan.
- Pemilihan barang masuk atau keluar.

Setelah scan:
1. Cari barcode.
2. Tampilkan nama barang.
3. Tampilkan SKU.
4. Tampilkan stok terakhir yang diketahui.
5. Input quantity.
6. Konfirmasi transaksi.

Gunakan HTTPS dan minta izin kamera dengan benar.

## 14. KARTU STOK

Buat kartu stok per SKU.

Kolom:

- Tanggal.
- Nomor transaksi.
- Nomor dokumen.
- Keterangan.
- SKU.
- Nama barang.
- Qty masuk.
- Harga masuk.
- Nilai masuk.
- Qty keluar.
- HPP per unit.
- Nilai keluar.
- Saldo qty.
- Average cost.
- Saldo nilai.

Fitur:
- Filter SKU.
- Filter nama barang.
- Filter tanggal.
- Saldo awal.
- Saldo akhir.
- Detail transaksi.
- Export Excel.

Kartu stok harus dapat ditelusuri ke transaksi sumber.

## 15. LAPORAN PERSEDIAAN

Buat laporan:

### A. Stock Summary
- SKU.
- Nama barang.
- Kategori.
- Quantity akhir.
- Average cost.
- Inventory value.
- Minimum stock.
- Status stok.

### B. Inventory Valuation
- Quantity.
- Average cost.
- Nilai persediaan.
- Total nilai persediaan.

### C. Stock Movement
- Total quantity masuk.
- Total nilai masuk.
- Total quantity keluar.
- Total HPP.
- Saldo akhir.

### D. Low Stock Report
- Barang di bawah minimum stock.

### E. Zero Stock Report
- Barang tanpa saldo kuantitas.

### F. Transaction History
- Semua transaksi masuk dan keluar.
- Filter tanggal.
- Filter pengguna.
- Filter jenis transaksi.

Semua laporan harus dapat diekspor ke Excel.

## 16. DASHBOARD

Tampilkan:

- Total SKU aktif.
- Total kuantitas stok.
- Total nilai persediaan.
- Barang masuk hari ini.
- Barang keluar hari ini.
- Jumlah transaksi pending.
- Low stock.
- Zero stock.
- Aktivitas terakhir.
- Status koneksi dan sinkronisasi.

Jangan menampilkan transaksi pending sebagai transaksi yang sudah dibukukan.

## 17. EXCEL EXPORT

Buat export:

1. Master barang.
2. Saldo stok.
3. Kartu stok.
4. Inventory valuation.
5. Barang masuk.
6. Barang keluar.
7. Transaction history.
8. Low stock.
9. Audit trail sesuai hak akses.

Gunakan nama file dengan periode laporan.

Pastikan:
- SKU dan barcode tetap berupa teks.
- Format tanggal benar.
- Format rupiah konsisten.
- Kolom quantity dan value tidak tertukar.
- Total laporan dapat direkonsiliasi dengan database.

## 18. BACKUP DAN RESTORE

Sediakan:

- Backup master barang.
- Backup transaksi.
- Backup seluruh histori mutasi.
- Backup database.
- Restore data.
- Export Excel.

Backup penuh harus dapat memulihkan relasi transaksi dan saldo secara konsisten.

Restore hanya dapat dilakukan ADMIN.

Sediakan validasi integritas sebelum dan sesudah restore.

Bedakan backup cloud dari export Excel.

Jangan mengklaim backup otomatis tersedia jika belum benar-benar dikonfigurasi di Supabase.

## 19. UI/UX DESIGN

Gunakan desain:
- Modern.
- Profesional.
- Minimalis.
- Mobile-first.
- Responsif.
- Mudah digunakan satu tangan.

Identitas:
- Nama aplikasi WHISTLE dan tagline "Smart Stock. Accurate Value. Total Control" tampil pada judul halaman, layar login, header, dan nama PWA (manifest).

Warna:
- Navy blue.
- White.
- Light grey.

Menu:
1. Dashboard.
2. Master Barang.
3. Barang Masuk.
4. Barang Keluar.
5. Kartu Stok.
6. Laporan.
7. Import/Export.
8. Pengaturan.

Tampilkan navigasi yang sesuai role pengguna.

Sediakan notifikasi:
- Berhasil.
- Gagal.
- Pending.
- Conflict.
- Stok tidak mencukupi.
- SKU tidak ditemukan.

## 20. GITHUB DAN DEPLOYMENT

Buat repository bernama:

whistle

Struktur project minimal:

- public/
- src/components/
- src/pages/
- src/services/
- src/database/
- src/hooks/
- src/types/
- src/utils/
- supabase/migrations/
- tests/
- .github/workflows/
- README.md
- .env.example
- package.json

Buat GitHub Actions untuk:
- Build.
- Type checking.
- Unit testing.
- Deployment.

Gunakan GitHub Pages sebagai hosting frontend.

Konfigurasikan Vite base path dengan benar.

Gunakan GitHub Secrets untuk environment variables deployment.

Jangan pernah memasukkan password, database secret, atau Service Role Key ke repository.

Pastikan aplikasi dapat diakses melalui HTTPS.

## 21. TESTING DAN ACCEPTANCE CRITERIA

Buat pengujian otomatis dan manual.

### Database dan keamanan
- Login beberapa pengguna.
- Validasi role.
- Pengujian RLS.
- User nonaktif tidak dapat transaksi.
- Tidak ada akses tidak sah.

### Master barang
- Import 1.000 SKU.
- SKU duplikat ditolak.
- Barcode duplikat ditolak.
- Data Excel valid.
- Opening inventory benar.

### Inventory accounting
- Pengujian saldo awal.
- Pembelian dengan harga berbeda.
- Perhitungan Moving Average.
- HPP barang keluar.
- Saldo akhir.
- Penolakan stok negatif.
- Pengujian pembulatan.
- Rekonsiliasi ledger dengan stock balances.

### Multi-user
- Dua pengguna mengeluarkan stok bersamaan.
- Tidak boleh terjadi overselling.
- Tidak boleh terjadi double posting.
- Retry transaksi tidak boleh menggandakan transaksi.

### Hybrid
- Transaksi offline.
- Sinkronisasi.
- Konflik stok.
- Kegagalan jaringan.
- Pemulihan setelah koneksi kembali.

### Excel
- Download template.
- Import massal.
- Preview.
- Error report.
- Export kartu stok.
- Export valuation.

### Android
- Install PWA.
- Kamera.
- Scan barcode.
- Scan QR.
- Input manual SKU.
- Pengujian offline.

Buat test case dengan expected result dan actual result.

Jangan menyatakan fitur selesai sebelum pengujian berhasil.

## 22. TAHAPAN PENGEMBANGAN

Kerjakan secara berurutan.

FASE 1 — Arsitektur dan repository GitHub.

FASE 2 — Supabase database, migration, authentication, dan RLS.

FASE 3 — Master barang dan Excel import/export.

FASE 4 — Moving Weighted Average engine.

FASE 5 — Transaksi masuk dan keluar.

FASE 6 — Barcode dan QR scanner.

FASE 7 — Kartu stok dan laporan.

FASE 8 — IndexedDB dan hybrid synchronization.

FASE 9 — Backup, restore, dan audit trail.

FASE 10 — Testing dan deployment Android PWA.

Setiap fase wajib memiliki hasil yang dapat diuji.

Kerjakan satu fase per sesi. Bagian spesifikasi yang dibaca pada tiap fase:

| Fase | Bagian |
|---|---|
| 1 | 1, 2, 3, 20, 22 |
| 2 | 4, 5, 21 (Database dan keamanan) |
| 3 | 6, 7, 17 (export master barang), 19 |
| 4 | 4 (tabel F, G, H), 8, 9, 10, 11 |
| 5 | 8, 9, 19 |
| 6 | 13 |
| 7 | 14, 15, 16, 17 |
| 8 | 3, 12, 16 |
| 9 | 4 (tabel I), 11, 17 (audit trail), 18 |
| 10 | 20, 21, 23 |

Jangan melanjutkan jika fase sebelumnya memiliki kesalahan kritis.

## 23. OUTPUT AKHIR YANG WAJIB

Hasil pengembangan harus mencakup:

1. Repository GitHub lengkap.
2. Source code.
3. Database schema.
4. SQL migrations.
5. RLS policies.
6. Excel template.
7. Excel import/export.
8. Moving Average engine.
9. Barcode dan QR scanner.
10. Multi-user login.
11. Hybrid offline synchronization.
12. Kartu stok.
13. Laporan persediaan.
14. Backup dan restore.
15. Unit testing.
16. README dan panduan penggunaan (diawali nama WHISTLE, kepanjangan, dan tagline).
17. URL aplikasi yang berhasil di-deploy.

## 24. INSTRUKSI PERTAMA UNTUK AI CODING AGENT

Kerjakan hanya fase yang diminta pengguna dan baca hanya bagian yang ditunjuk pada tabel Bagian 22 dan CLAUDE.md.

Perencanaan di bawah ini hanya dilakukan pada FASE 1. Pada fase berikutnya langsung ke implementasi.

Sebelum membuat kode pada FASE 1:
1. Tampilkan arsitektur aplikasi.
2. Tampilkan diagram aliran data.
3. Tampilkan rancangan database.
4. Tampilkan struktur repository.
5. Tampilkan mekanisme Moving Weighted Average.
6. Tampilkan mekanisme offline synchronization.
7. Identifikasi risiko teknis.
8. Buat daftar tahapan implementasi.

Setelah itu, mulai implementasi secara nyata.

Jika membutuhkan akses GitHub atau Supabase, minta koneksi dan otorisasi yang diperlukan.

Jangan mengklaim sudah membuat repository, mengubah file, menjalankan testing, atau melakukan deployment sebelum tindakan tersebut benar-benar berhasil.

Jika ada keterbatasan teknis, jelaskan dan berikan solusi alternatif yang paling sederhana.

**PRINSIP AKHIR: Aplikasi harus akurat secara akuntansi, aman secara database, konsisten untuk multi-user, dan mudah digunakan melalui Android.**