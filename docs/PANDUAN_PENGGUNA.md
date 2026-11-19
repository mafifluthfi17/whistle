# WHISTLE: Panduan Pengguna Singkat

**Warehouse Inventory, Stock Tracking & Ledger Engine**

*Smart Stock. Accurate Value. Total Control*

Alamat aplikasi: https://whistle-id.github.io/whistle/

## 1. Masuk dan peran

Masuk dengan email dan password yang dibuat ADMIN. Menu yang tampil mengikuti peran:

| Peran | Dapat |
|---|---|
| ADMIN | Semua menu: master, transaksi, import/export, audit trail, pengaturan (backup/restore) |
| WAREHOUSE | Dashboard, master (baca), Barang Masuk, Barang Keluar, Antrean Offline, Kartu Stok, Laporan |
| VIEWER | Hanya membaca: Dashboard, master, Kartu Stok, Laporan |

Akun yang dinonaktifkan tidak dapat masuk atau bertransaksi.

## 2. Memasang di Android

1. Buka alamat aplikasi di Chrome.
2. Menu ⋮ > **Pasang aplikasi** (atau Tambahkan ke layar utama).
3. Buka dari ikon WHISTLE. Izinkan kamera saat diminta (kamera hanya jalan lewat HTTPS).

Sebelum bekerja offline, buka aplikasi sekali saat online agar data barang tersimpan di perangkat.

## 3. Barang Masuk (pembelian)

1. Menu **Barang Masuk**. Isi tanggal, nomor dokumen, supplier.
2. Cari barang (SKU, barcode, nama) atau tekan **Scan Barcode / QR dengan Kamera**; boleh juga ketik SKU manual.
3. Isi **Quantity** dan **Harga beli per unit** untuk tiap barang. Satu dokumen boleh banyak barang.
4. **Pratinjau** lalu **Posting**. Angka di pratinjau hanya perkiraan; angka resmi (average cost baru, saldo) dihitung server dan tampil setelah posting.

Average cost baru = (nilai persediaan + nilai pembelian) ÷ (qty lama + qty masuk).

## 4. Barang Keluar (penjualan/pemakaian)

Alurnya sama, tanpa harga: nilai keluar (HPP) memakai average cost saat itu. Jumlah yang melebihi stok ditolak. Tekan Posting sekali saja; jika terjadi retry karena jaringan, transaksi tidak akan ganda.

Tanggal mundur hanya dapat diposting ADMIN dengan persetujuan, dan tercatat di audit trail.

## 5. Bekerja offline

- Tanpa internet, transaksi yang diposting masuk **Antrean Offline** dengan status **PENDING**. Itu **belum resmi** dan belum mengubah saldo.
- Saat internet kembali, antrean terkirim otomatis dan berurutan. Status: PENDING → SYNCING → SYNCED.
- Server dapat menolak (FAILED/CONFLICT), misalnya stok sudah dipakai di perangkat lain. Data lokal **tidak dihapus otomatis**: buka **Antrean Offline**, tekan **Perbaiki** (ubah isian) atau **Batalkan**.
- Transaksi berikutnya untuk barang yang sama ditahan sampai yang sebelumnya selesai, agar urutan terjaga.
- Dashboard, Laporan, Kartu Stok, dan Master hanya tersedia saat online.
- Keluar (logout) saat masih ada antrean akan diberi peringatan; datanya tetap tersimpan di perangkat.

## 6. Master barang dan Excel (ADMIN)

- **Master Barang**: tambah, edit, nonaktifkan, cari, filter. Barang yang sudah punya histori tidak dapat dihapus.
- **Import/Export**: unduh template, isi, unggah. Lihat pratinjau dan laporan galat; import bersifat atomik (satu baris salah = seluruh import batal). Mode **Barang baru** (dapat memuat stok awal) atau **Update master**.
- SKU dan barcode diperlakukan sebagai teks (nol di depan terjaga).

## 7. Kartu stok dan laporan

- **Kartu Stok**: pilih SKU dan periode; klik nomor transaksi untuk detail.
- **Laporan**: Stock Summary, Inventory Valuation, Stock Movement, Low Stock, Zero Stock, Transaction History. Semua dapat diekspor ke Excel.
- **Dashboard**: total SKU, qty, nilai persediaan, masuk/keluar hari ini, low/zero stock, aktivitas terakhir.

Transaksi PENDING tidak pernah dihitung sebagai saldo.

## 8. Backup dan restore (ADMIN)

Menu **Pengaturan**:

1. **Buat backup** (FULL disarankan). File JSON terunduh; catat SHA-256-nya. Simpan di luar aplikasi.
2. **Cek integritas** untuk memastikan saldo sama dengan ledger.
3. **Restore**: pilih file > **Validasi file** > ketik `PULIHKAN` > **Pulihkan sekarang**. Seluruh proses atomik; sebelum mengganti, sistem membuat **titik pemulihan** otomatis (5 terbaru, dapat diunduh untuk membatalkan restore).

Penting: backup otomatis Supabase tidak aktif pada Free Plan, jadi backup manual berkala adalah satu-satunya salinan. Backup berbeda dari export Excel (Excel untuk dibaca, backup untuk memulihkan).

## 9. Audit trail (ADMIN)

Menu **Audit Trail** mencatat perubahan master, posting, reversal, adjustment, import, perubahan role, backup, dan restore (pelaku, waktu, nilai lama/baru). Dapat difilter dan diekspor; tidak dapat diubah.

## 10. Masalah umum

| Gejala | Tindakan |
|---|---|
| "Stok tidak mencukupi" | Kurangi quantity atau periksa stok terbaru di Kartu Stok |
| Antrean berstatus FAILED/CONFLICT | Buka Antrean Offline > Perbaiki atau Batalkan |
| Kamera tidak terbuka | Pastikan lewat HTTPS dan izin kamera aktif di setelan situs; gunakan input manual SKU |
| Akun dinonaktifkan / tanpa role | Hubungi ADMIN |
| Aplikasi tidak memuat versi terbaru | Tutup dan buka ulang aplikasi; versi baru dimuat otomatis |
