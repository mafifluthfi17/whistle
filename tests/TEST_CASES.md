# WHISTLE: Test Case dan Hasil Pengujian

**Warehouse Inventory, Stock Tracking & Ledger Engine**

*Smart Stock. Accurate Value. Total Control*

> Dokumen ini DIBUAT OTOMATIS oleh `scripts/gen-test-cases.mjs` dari hasil nyata `vitest`. Jangan diedit tangan: ubah tes atau kolom Hasil di `tests/MANUAL_*.md`, lalu buat ulang.

## 1. Ringkasan

- Dijalankan: 19 November 2026 pukul 21.05 (Asia/Jakarta)
- Tes otomatis: **462 lulus dari 462**, 0 gagal, 0 dilewati, 23 berkas
- Kasus manual (perangkat nyata): **0 dari 63 sudah diisi hasilnya**; sisanya BELUM DIUJI
- Perintah: `npm test` (Vitest). Tes database memakai PostgreSQL sungguhan (embedded-postgres) dan PGlite; tes UI memakai jsdom + Testing Library dengan layanan jaringan di-mock.
- Cara membaca: pada kasus otomatis, **judul kasus = expected result** (perilaku yang ditegaskan tes) dan **actual result = status hasil proses tes**. Status: LULUS, GAGAL, SEBAGIAN (bagian otomatis lulus, bagian perangkat nyata belum), BELUM DIUJI.

## 2. Matriks kriteria penerimaan (MASTER_PROMPT Bagian 21)

| Area | Kriteria | Expected result | Actual result | Jumlah tes |
|---|---|---|---|---|
| Database dan keamanan | Login beberapa pengguna | Seluruh tes terkait lulus | LULUS | 10 |
| Database dan keamanan | Validasi role | Seluruh tes terkait lulus | LULUS | 20 |
| Database dan keamanan | Pengujian RLS | Seluruh tes terkait lulus | LULUS | 42 |
| Database dan keamanan | User nonaktif tidak dapat transaksi | Seluruh tes terkait lulus | LULUS | 5 |
| Database dan keamanan | Tidak ada akses tidak sah | Seluruh tes terkait lulus | LULUS | 14 |
| Master barang | Import 1.000 SKU | Seluruh tes terkait lulus | LULUS | 2 |
| Master barang | SKU duplikat ditolak | Seluruh tes terkait lulus | LULUS | 4 |
| Master barang | Barcode duplikat ditolak | Seluruh tes terkait lulus | LULUS | 4 |
| Master barang | Data Excel valid | Seluruh tes terkait lulus | LULUS | 39 |
| Master barang | Opening inventory benar | Seluruh tes terkait lulus | LULUS | 22 |
| Inventory accounting | Pengujian saldo awal | Seluruh tes terkait lulus | LULUS | 4 |
| Inventory accounting | Pembelian dengan harga berbeda | Seluruh tes terkait lulus | LULUS | 3 |
| Inventory accounting | Perhitungan Moving Average | Seluruh tes terkait lulus | LULUS | 4 |
| Inventory accounting | HPP barang keluar | Seluruh tes terkait lulus | LULUS | 12 |
| Inventory accounting | Saldo akhir | Seluruh tes terkait lulus | LULUS | 12 |
| Inventory accounting | Penolakan stok negatif | Seluruh tes terkait lulus | LULUS | 8 |
| Inventory accounting | Pengujian pembulatan | Seluruh tes terkait lulus | LULUS | 6 |
| Inventory accounting | Rekonsiliasi ledger dengan stock balances | Seluruh tes terkait lulus | LULUS | 12 |
| Multi-user | Dua pengguna mengeluarkan stok bersamaan | Seluruh tes terkait lulus | LULUS | 2 |
| Multi-user | Tidak boleh terjadi overselling | Seluruh tes terkait lulus | LULUS | 2 |
| Multi-user | Tidak boleh terjadi double posting | Seluruh tes terkait lulus | LULUS | 2 |
| Multi-user | Retry transaksi tidak menggandakan transaksi | Seluruh tes terkait lulus | LULUS | 7 |
| Hybrid | Transaksi offline | Seluruh tes terkait lulus | LULUS | 6 |
| Hybrid | Sinkronisasi | Seluruh tes terkait lulus | LULUS | 22 |
| Hybrid | Konflik stok | Seluruh tes terkait lulus | LULUS | 8 |
| Hybrid | Kegagalan jaringan | Seluruh tes terkait lulus | LULUS | 14 |
| Hybrid | Pemulihan setelah koneksi kembali | Seluruh tes terkait lulus | LULUS | 5 |
| Excel | Download template | Seluruh tes terkait lulus | LULUS | 5 |
| Excel | Import massal | Seluruh tes terkait lulus | LULUS | 39 |
| Excel | Preview | Seluruh tes terkait lulus | LULUS | 10 |
| Excel | Error report | Seluruh tes terkait lulus | LULUS | 8 |
| Excel | Export kartu stok | Seluruh tes terkait lulus | LULUS | 21 |
| Excel | Export valuation | Seluruh tes terkait lulus | LULUS | 5 |
| Android | Install PWA | Berfungsi di perangkat Android | SEBAGIAN: Konfigurasi manifest/ikon/service worker lulus tes dan smoke test situs live; PEMASANGAN di Android belum dicoba (MANUAL_ANDROID E1, MANUAL_OFFLINE A1). | 2 |
| Android | Kamera | Berfungsi di perangkat Android | BELUM DIUJI: Izin dan pembukaan kamera di HP belum diuji (MANUAL_ANDROID A1-A8). | 0 |
| Android | Scan barcode | Berfungsi di perangkat Android | SEBAGIAN: Decode dari gambar barcode sintetis lulus; pembacaan dari kamera/label fisik belum diuji (MANUAL_ANDROID B1-B10). | 22 |
| Android | Scan QR | Berfungsi di perangkat Android | SEBAGIAN: Decode QR dari gambar sintetis lulus; kamera nyata belum diuji (MANUAL_ANDROID B7-B9). | 2 |
| Android | Input manual SKU | Berfungsi di perangkat Android | SEBAGIAN: Perilaku input manual lulus tes UI (jsdom); belum dicoba di HP. | 2 |
| Android | Pengujian offline | Berfungsi di perangkat Android | SEBAGIAN: Logika offline lulus tes (fake-indexeddb/jsdom); mode pesawat di perangkat nyata belum diuji (MANUAL_OFFLINE). | 17 |

## 3. Kasus uji manual (perangkat Android nyata)

Langkah lengkap ada di [MANUAL_ANDROID.md](MANUAL_ANDROID.md) dan [MANUAL_OFFLINE.md](MANUAL_OFFLINE.md). Hasil di bawah hanya yang benar-benar diisi pada berkas itu; kosong = **BELUM DIUJI**.

| Berkas | ID | Bagian | Langkah | Expected result | Actual result |
|---|---|---|---|---|---|
| Android | A1 | A. Izin dan pembukaan kamera | Barang Masuk > "Scan Barcode / QR dengan Kamera" > Mulai Scan, pertama kali | Browser meminta izin kamera; setelah Izinkan, pratinjau kamera tampil | BELUM DIUJI |
| Android | A2 | A. Izin dan pembukaan kamera | Periksa kamera yang terbuka | Kamera **belakang** terbuka secara default | BELUM DIUJI |
| Android | A3 | A. Izin dan pembukaan kamera | Tolak izin kamera (Blokir) lalu Mulai Scan | Pesan "Izin kamera ditolak..." muncul; kolom ketik SKU manual tetap tersedia | BELUM DIUJI |
| Android | A4 | A. Izin dan pembukaan kamera | Setelan situs > izinkan Kamera, tekan Coba Lagi | Kamera terbuka tanpa muat ulang halaman | BELUM DIUJI |
| Android | A5 | A. Izin dan pembukaan kamera | Buka aplikasi lewat http:// (bukan https) atau dari alamat IP lokal | Pesan "hanya dapat dipakai lewat HTTPS" | BELUM DIUJI |
| Android | A6 | A. Izin dan pembukaan kamera | Buka aplikasi lain yang memakai kamera, lalu Mulai Scan | Pesan kamera sedang dipakai aplikasi lain | BELUM DIUJI |
| Android | A7 | A. Izin dan pembukaan kamera | Hentikan Scan, lalu tutup panel | Indikator kamera Android (titik hijau) hilang; kamera tidak menyala di latar | BELUM DIUJI |
| Android | A8 | A. Izin dan pembukaan kamera | Pindah aplikasi/kunci layar saat scan, lalu kembali | Kamera dapat dilanjutkan dengan Mulai Scan; tidak ada error | BELUM DIUJI |
| Android | B1 | B. Format barcode (arahkan kamera 10-20 cm dari label) | EAN-13 4006381333931 | Terbaca sebagai 4006381333931 | BELUM DIUJI |
| Android | B2 | B. Format barcode (arahkan kamera 10-20 cm dari label) | EAN-8 96385074 | Terbaca sebagai 96385074 | BELUM DIUJI |
| Android | B3 | B. Format barcode (arahkan kamera 10-20 cm dari label) | UPC-A 042100005264 | Terbaca sebagai 042100005264 | BELUM DIUJI |
| Android | B4 | B. Format barcode (arahkan kamera 10-20 cm dari label) | UPC-E 04252614 | Terbaca sebagai 04252614 | BELUM DIUJI |
| Android | B5 | B. Format barcode (arahkan kamera 10-20 cm dari label) | Code 128 SKU-0001 | Terbaca sebagai SKU-0001 | BELUM DIUJI |
| Android | B6 | B. Format barcode (arahkan kamera 10-20 cm dari label) | Code 39 ABC-123 | Terbaca sebagai ABC-123 | BELUM DIUJI |
| Android | B7 | B. Format barcode (arahkan kamera 10-20 cm dari label) | QR Code (teks) SKU-0001 | Terbaca sebagai SKU-0001 | BELUM DIUJI |
| Android | B8 | B. Format barcode (arahkan kamera 10-20 cm dari label) | QR Code (JSON) {"sku":"SKU-9"} | Terbaca sebagai {"sku":"SKU-9"} | BELUM DIUJI |
| Android | B9 | B. Format barcode (arahkan kamera 10-20 cm dari label) | QR Code (URL) https://contoh.id/p?sku=SKU-77 | Terbaca sebagai https://contoh.id/p?sku=SKU-77 | BELUM DIUJI |
| Android | B10 | B. Format barcode (arahkan kamera 10-20 cm dari label) | Barcode ITF / Data Matrix (format tidak didukung) | Tidak terbaca (diabaikan) | BELUM DIUJI |
| Android | C1 | C. Alur setelah scan | Scan barcode barang yang terdaftar | Muncul nama barang, SKU, dan stok terakhir; kolom quantity siap diisi | BELUM DIUJI |
| Android | C2 | C. Alur setelah scan | Pada Barang Keluar, scan barang yang punya stok | Average cost tampil; isi quantity > stok menampilkan "Melebihi stok tersedia" | BELUM DIUJI |
| Android | C3 | C. Alur setelah scan | Isi quantity (dan harga beli di Barang Masuk), tekan Tambahkan ke dokumen | Barang masuk ke daftar dokumen; kamera siap memindai barang berikutnya | BELUM DIUJI |
| Android | C4 | C. Alur setelah scan | Scan barang yang sama dua kali | Quantity digabung pada satu baris, bukan baris ganda | BELUM DIUJI |
| Android | C5 | C. Alur setelah scan | Scan kode yang tidak terdaftar | Notifikasi "SKU atau barcode ... tidak ditemukan"; scanner tetap berjalan | BELUM DIUJI |
| Android | C6 | C. Alur setelah scan | Scan barang nonaktif | Notifikasi barang nonaktif; tidak dapat ditambahkan | BELUM DIUJI |
| Android | C7 | C. Alur setelah scan | Scan UPC-A yang di master tersimpan sebagai EAN-13 berawalan 0 (atau sebaliknya) | Barang tetap ditemukan | BELUM DIUJI |
| Android | C8 | C. Alur setelah scan | Scan Code 39 untuk SKU yang di master memakai huruf kecil | Barang ditemukan (pencarian tidak peka huruf) | BELUM DIUJI |
| Android | C9 | C. Alur setelah scan | Scan satu label terus menerus selama 3 detik | Hanya satu pencarian/bunyi per kode (tidak berulang-ulang) | BELUM DIUJI |
| Android | C10 | C. Alur setelah scan | Lanjutkan Pratinjau lalu Posting | Transaksi terposting; saldo di hasil sama dengan yang diharapkan | BELUM DIUJI |
| Android | D1 | D. Senter, kamera lain, dan kondisi sulit | Ruangan gelap: periksa tombol Nyalakan Senter | Tombol tampil bila HP mendukung; senter menyala/mati. Bila tidak didukung, tombol tidak tampil | BELUM DIUJI |
| Android | D2 | D. Senter, kamera lain, dan kondisi sulit | HP dengan beberapa kamera: pilih kamera dari daftar | Pilihan kamera muncul; berpindah kamera berhasil | BELUM DIUJI |
| Android | D3 | D. Senter, kamera lain, dan kondisi sulit | Label kusut/silau/miring | Tetap terbaca dalam beberapa detik atau tidak menghasilkan kode salah | BELUM DIUJI |
| Android | D4 | D. Senter, kamera lain, dan kondisi sulit | Putar HP landscape/portrait | Pratinjau tetap benar dan scan berfungsi | BELUM DIUJI |
| Android | D5 | D. Senter, kamera lain, dan kondisi sulit | Matikan internet lalu scan | Scan tetap membuka kamera; pencarian gagal dengan pesan jelas (offline penuh di FASE 8) | BELUM DIUJI |
| Android | D6 | D. Senter, kamera lain, dan kondisi sulit | Input manual: ketik SKU/barcode di kolom manual | Barang ditemukan sama seperti hasil scan | BELUM DIUJI |
| Android | E1 | E. PWA (dipakai bersama FASE 10) | Pasang aplikasi ke layar utama lalu buka sebagai PWA | Kamera tetap dapat diizinkan dan berfungsi di mode PWA | BELUM DIUJI |
| Offline | A1 | A. Membuka aplikasi tanpa internet | Pasang aplikasi (Tambahkan ke layar utama). Aktifkan mode pesawat, buka aplikasi dari ikon | Aplikasi terbuka, TIDAK diminta login ulang, nama dan role tampil, badge "Offline" | BELUM DIUJI |
| Offline | A2 | A. Membuka aplikasi tanpa internet | Buka juga di tab browser biasa (bukan PWA) dalam mode pesawat | Halaman terbuka dari cache; menu berfungsi | BELUM DIUJI |
| Offline | A3 | A. Membuka aplikasi tanpa internet | Mode pesawat, buka Dashboard / Laporan / Kartu Stok | Pesan jelas "hanya tersedia saat online"; tidak crash | BELUM DIUJI |
| Offline | A4 | A. Membuka aplikasi tanpa internet | Mode pesawat, buka Master Barang | Pesan error koneksi jelas (master hanya online) | BELUM DIUJI |
| Offline | A5 | A. Membuka aplikasi tanpa internet | Mode pesawat, jangan pernah login sebelumnya (data browser bersih) | Layar login; pesan bahwa masuk memerlukan koneksi | BELUM DIUJI |
| Offline | B1 | B. Mencatat transaksi offline | Mode pesawat. Barang Masuk: cari barang A, isi qty 5 dan harga 1000, Pratinjau, Posting | Muncul "tersimpan di antrean offline (PENDING)"; badge header "1 pending" | BELUM DIUJI |
| Offline | B2 | B. Mencatat transaksi offline | Barang Keluar barang A qty 3 (stok tampil menurut cache) | Tersimpan PENDING; stok yang ditampilkan memperhitungkan masuk yang menunggu | BELUM DIUJI |
| Offline | B3 | B. Mencatat transaksi offline | Scan barcode barang B dengan kamera (offline) lalu catat keluar 2 | Barang ditemukan dari cache; tersimpan PENDING | BELUM DIUJI |
| Offline | B4 | B. Mencatat transaksi offline | Barang Keluar barang A qty 100 (melebihi stok) saat offline | Peringatan stok, tetapi tetap dapat disimpan (server memutuskan nanti) | BELUM DIUJI |
| Offline | B5 | B. Mencatat transaksi offline | Buka Antrean Offline | Semua transaksi tampil berurutan dengan status PENDING dan isi yang benar | BELUM DIUJI |
| Offline | B6 | B. Mencatat transaksi offline | Tutup paksa aplikasi lalu buka lagi (masih offline) | Antrean tetap ada, tidak ada yang hilang | BELUM DIUJI |
| Offline | B7 | B. Mencatat transaksi offline | Dashboard (offline tidak bisa) lalu online: lihat kartu antrean | Antrean lokal ditampilkan terpisah dan tidak masuk saldo/jumlah hari ini | BELUM DIUJI |
| Offline | C1 | C. Sinkronisasi saat koneksi pulih | Matikan mode pesawat | Dalam beberapa detik antrean terkirim otomatis, notifikasi "N transaksi offline berhasil diposting" | BELUM DIUJI |
| Offline | C2 | C. Sinkronisasi saat koneksi pulih | Periksa Transaction History / Kartu Stok barang A | Transaksi muncul sekali, bernomor resmi, urutan sesuai pencatatan | BELUM DIUJI |
| Offline | C3 | C. Sinkronisasi saat koneksi pulih | Saldo dan average cost barang A | Sesuai perhitungan server (bukan angka lokal) | BELUM DIUJI |
| Offline | C4 | C. Sinkronisasi saat koneksi pulih | Putus internet tepat saat sinkronisasi (nyalakan pesawat di tengah) lalu pulihkan | Tidak ada transaksi ganda; yang belum terkirim tetap PENDING lalu terkirim | BELUM DIUJI |
| Offline | C5 | C. Sinkronisasi saat koneksi pulih | Cek badge header setelah semua terkirim | "Tersinkron" | BELUM DIUJI |
| Offline | D1 | D. Konflik dan kegagalan (butuh dua perangkat) | Perangkat 1 offline: catat keluar barang C 8 unit (stok cache 10). Perangkat 2 online: keluarkan 5 unit barang C. Perangkat 1 online | Transaksi perangkat 1 berstatus **CONFLICT** dengan alasan "Stok tidak mencukupi... tersedia 5, diminta 8"; jumlah TIDAK berubah sendiri | BELUM DIUJI |
| Offline | D2 | D. Konflik dan kegagalan (butuh dua perangkat) | Catat transaksi lain untuk barang C yang sama setelahnya (offline) | Ditahan (PENDING, "ditahan karena transaksi sebelumnya"); transaksi barang lain tetap terkirim | BELUM DIUJI |
| Offline | D3 | D. Konflik dan kegagalan (butuh dua perangkat) | Perbaiki D1: ubah qty ke 5, simpan | Status kembali PENDING lalu terkirim; transaksi yang ditahan ikut terkirim | BELUM DIUJI |
| Offline | D4 | D. Konflik dan kegagalan (butuh dua perangkat) | Ulangi D1 lalu pilih Batalkan | Entri hilang dari antrean; transaksi yang ditahan terkirim | BELUM DIUJI |
| Offline | D5 | D. Konflik dan kegagalan (butuh dua perangkat) | Nonaktifkan barang di Master (online) padahal ada antreannya | CONFLICT dengan penyebab barang nonaktif | BELUM DIUJI |
| Offline | D6 | D. Konflik dan kegagalan (butuh dua perangkat) | Login pengguna lain di perangkat yang sama (ada antrean pengguna pertama) | Antrean pengguna pertama TIDAK dikirim atas nama pengguna kedua; muncul catatan antrean milik pengguna lain | BELUM DIUJI |
| Offline | D7 | D. Konflik dan kegagalan (butuh dua perangkat) | Keluar (logout) saat ada antrean | Peringatan; data tetap ada dan terkirim setelah login kembali | BELUM DIUJI |
| Offline | E1 | E. Service worker dan pembaruan | Chrome DevTools > Application > Service Workers | Terdaftar dan aktif | BELUM DIUJI |
| Offline | E2 | E. Service worker dan pembaruan | Application > Cache Storage | Hanya berisi berkas aplikasi (JS/CSS/HTML/ikon); tidak ada respons dari supabase.co | BELUM DIUJI |
| Offline | E3 | E. Service worker dan pembaruan | Application > IndexedDB > whistle | Tabel items, balances, outbox, meta ada; outbox berisi transaksi antrean | BELUM DIUJI |
| Offline | E4 | E. Service worker dan pembaruan | Deploy versi baru lalu buka aplikasi | Versi baru termuat otomatis; antrean di IndexedDB tidak hilang | BELUM DIUJI |

## 4. Seluruh kasus uji otomatis

### backupFile.test.ts (11/11 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | nama file backup | memuat lingkup serta tanggal dan jam Asia/Jakarta | LULUS (25 ms) |
| 2 | SHA-256 file | sesuai vektor uji standar dan berubah jika satu karakter berubah | LULUS (8 ms) |
| 3 | readBackupMeta | membaca metadata backup WHISTLE | LULUS (1 ms) |
| 4 | readBackupMeta | menolak bukan JSON, bukan backup WHISTLE, dan lingkup tidak dikenal | LULUS (1 ms) |
| 5 | lingkup backup | hanya FULL dan MASTER yang dapat dipulihkan; semua jenis dari Bagian 18 tersedia | LULUS (1 ms) |
| 6 | formatBytes | satuan B, KB, MB | LULUS (0 ms) |
| 7 | export Excel audit trail | kolom, nilai, dan nama file memuat periode | LULUS (28 ms) |
| 8 | export Excel audit trail | waktu berupa tanggal Excel pada jam Jakarta | LULUS (1 ms) |
| 9 | export Excel audit trail | ID record tetap teks (nol di depan) | LULUS (0 ms) |
| 10 | export Excel audit trail | JSON sangat panjang dipotong agar tidak melewati batas sel Excel | LULUS (11 ms) |
| 11 | export Excel audit trail | 1.000 catatan tetap dihasilkan | LULUS (129 ms) |

### brand.test.ts (2/2 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | identitas aplikasi | memakai nama dan tagline WHISTLE | LULUS (2 ms) |
| 2 | format | memformat rupiah | LULUS (2 ms) |

### catalog.test.ts (12/12 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | isNetworkError | mengenali kegagalan fetch dan TypeError, bukan penolakan server | LULUS (18 ms) |
| 2 | katalog yang sadar offline | online: memakai server dan tidak menyentuh cache | LULUS (3 ms) |
| 3 | katalog yang sadar offline | offline: langsung memakai cache tanpa memanggil server | LULUS (8 ms) |
| 4 | katalog yang sadar offline | terlihat online tetapi jaringan gagal: jatuh ke cache | LULUS (5 ms) |
| 5 | katalog yang sadar offline | penolakan server (bukan jaringan) tidak disamarkan dengan cache | LULUS (6 ms) |
| 6 | katalog yang sadar offline | barang yang tidak ada di cache dilaporkan tidak ditemukan saat offline | LULUS (3 ms) |
| 7 | penyegaran cache dari server | mengganti seluruh isi cache dan mencatat waktunya | LULUS (8 ms) |
| 8 | penyegaran cache dari server | gagal mengambil dari server: cache lama tetap utuh | LULUS (3 ms) |
| 9 | konfigurasi PWA: service worker hanya untuk app shell dan aset | tidak ada runtimeCaching sehingga panggilan API tidak pernah di-cache | LULUS (2 ms) |
| 10 | konfigurasi PWA: service worker hanya untuk app shell dan aset | hanya aset statis yang di-precache | LULUS (2 ms) |
| 11 | konfigurasi PWA: service worker hanya untuk app shell dan aset | app shell dapat dibuka saat offline pada path GitHub Pages | LULUS (1 ms) |
| 12 | konfigurasi PWA: service worker hanya untuk app shell dan aset | manifest memakai identitas WHISTLE dan dapat dipasang (start_url, scope, ikon) | LULUS (1 ms) |

### db/backup.test.ts (29/29 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | membuat backup | backup FULL memuat metadata, jumlah baris, checksum per tabel, dan total; angka tetap persis (teks) | LULUS (35 ms) |
| 2 | membuat backup | lingkup MASTER, TRANSACTIONS, MOVEMENTS hanya memuat tabelnya; lingkup tidak valid ditolak | LULUS (25 ms) |
| 3 | membuat backup | setiap backup dicatat di audit trail | LULUS (10 ms) |
| 4 | validasi integritas SEBELUM restore | backup yang utuh lolos semua pemeriksaan dan dapat dipulihkan | LULUS (105 ms) |
| 5 | validasi integritas SEBELUM restore | file diubah tanpa menghitung ulang checksum ditolak (checksum tabel) | LULUS (21 ms) |
| 6 | validasi integritas SEBELUM restore | isi diubah dengan checksum "dirapikan": rantai saldo ledger tetap tertangkap | LULUS (84 ms) |
| 7 | validasi integritas SEBELUM restore | saldo resmi yang tidak sama dengan ledger tertangkap | LULUS (83 ms) |
| 8 | validasi integritas SEBELUM restore | relasi putus (item tanpa transaksi) dan kunci ganda tertangkap | LULUS (158 ms) |
| 9 | validasi integritas SEBELUM restore | format, versi skema, dan teks bukan JSON ditolak | LULUS (37 ms) |
| 10 | validasi integritas SEBELUM restore | backup TRANSACTIONS/MOVEMENTS valid sebagai arsip tetapi tidak dapat dipulihkan | LULUS (26 ms) |
| 11 | validasi integritas SEBELUM restore | pengguna yang tidak dikenal database tujuan: ditolak, kecuali dipetakan ke ADMIN pemulih | LULUS (147 ms) |
| 12 | restore penuh: round trip persis sama | backup -> ubah banyak hal -> restore = keadaan semula (seluruh tabel identik), saldo dan ledger konsisten | LULUS (153 ms) |
| 13 | restore penuh: round trip persis sama | setelah restore: integritas sempurna dan pembukuan berikutnya berjalan normal (urutan lanjut, tanpa bentrok) | LULUS (20 ms) |
| 14 | restore penuh: round trip persis sama | restore point otomatis menyimpan keadaan sebelum restore, dapat diunduh, dan dapat dipulihkan (batal restore) | LULUS (240 ms) |
| 15 | restore penuh: round trip persis sama | titik pemulihan dibatasi 5 terbaru | LULUS (565 ms) |
| 16 | restore penuh: round trip persis sama | backup yang tidak lolos validasi ditolak dan database TIDAK berubah | LULUS (78 ms) |
| 17 | restore penuh: round trip persis sama | kegagalan di tengah restore membatalkan SEMUANYA, gerbang bersih, ledger tetap terlindungi | LULUS (453 ms) |
| 18 | restore penuh: round trip persis sama | pemetaan pengguna: backup dari lingkungan lain dapat dipulihkan dengan pemetaan ke ADMIN dan tercatat | LULUS (1025 ms) |
| 19 | restore master barang | MASTER mengembalikan master tanpa menyentuh transaksi, ledger, dan saldo | LULUS (89 ms) |
| 20 | hak akses dan konfirmasi | hanya ADMIN yang boleh membuat, memvalidasi, memulihkan, memeriksa, dan melihat titik pemulihan/audit | LULUS (92 ms) |
| 21 | hak akses dan konfirmasi | kalimat konfirmasi wajib PULIHKAN; salah = ditolak tanpa efek | LULUS (53 ms) |
| 22 | hak akses dan konfirmasi | gerbang restore tidak dapat dipalsukan: pengguna tidak punya akses, dan ledger tetap terkunci | LULUS (14 ms) |
| 23 | cek integritas database | mendeteksi saldo yang menyimpang dari ledger | LULUS (32 ms) |
| 24 | cek integritas database | melaporkan jumlah data dan waktu pemeriksaan | LULUS (12 ms) |
| 25 | audit trail | mencatat posting, reversal, adjustment, import, perubahan master, role, backup, dan restore | LULUS (9 ms) |
| 26 | audit trail | setiap entri memuat pelaku, waktu, tabel, dan nilai lama/baru | LULUS (8 ms) |
| 27 | audit trail | filter tanggal, pengguna, aksi, tabel, pencarian, dan pagination | LULUS (45 ms) |
| 28 | audit trail | filter untuk dropdown dan audit trail tidak dapat diubah | LULUS (121 ms) |
| 29 | skala: 1.000 SKU | backup, validasi, ubah, dan restore data besar tetap identik dan cepat | LULUS (6427 ms) |

### db/engine.test.ts (40/40 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | contoh perhitungan wajib (Bagian 10) | 100 unit @10.000 + beli 50 @12.000 = 150 unit, Rp1.600.000, avg 10.666,666667; keluar 30 = HPP Rp320.000 | LULUS (90 ms) |
| 2 | contoh perhitungan wajib (Bagian 10) | HPP tersimpan permanen di item transaksi dan ledger | LULUS (16 ms) |
| 3 | pembulatan | avg 6 desimal, nilai 2 desimal, HPP per detail, sisa pembulatan tidak tertinggal | LULUS (20 ms) |
| 4 | pembulatan | nilai pembelian dibulatkan 2 desimal dan avg baru dari nilai yang dibukukan | LULUS (11 ms) |
| 5 | pembulatan | pecahan quantity (4 desimal) dan harga (6 desimal) diterima, lebih dari itu ditolak | LULUS (15 ms) |
| 6 | stok negatif dan atomik | menolak keluar melebihi stok dan tidak mengubah apa pun | LULUS (21 ms) |
| 7 | stok negatif dan atomik | satu detail gagal membatalkan seluruh dokumen | LULUS (21 ms) |
| 8 | stok negatif dan atomik | SKU yang sama dua kali dalam satu dokumen dihitung berurutan dan tetap tidak boleh minus | LULUS (14 ms) |
| 9 | idempotensi (retry tidak menggandakan) | client_transaction_id yang sama mengembalikan transaksi yang sama dan saldo hanya berubah sekali | LULUS (26 ms) |
| 10 | idempotensi (retry tidak menggandakan) | client_transaction_id milik pengguna lain ditolak | LULUS (15 ms) |
| 11 | hak akses dan validasi | VIEWER tidak boleh memposting apa pun; WAREHOUSE hanya IN/OUT | LULUS (34 ms) |
| 12 | hak akses dan validasi | pengguna nonaktif, tanpa sesi, dan anon ditolak | LULUS (27 ms) |
| 13 | hak akses dan validasi | fungsi internal tidak dapat dipanggil langsung oleh pengguna | LULUS (8 ms) |
| 14 | hak akses dan validasi | validasi item: SKU tidak ada, barang nonaktif, qty tidak valid, angka rusak, dokumen kosong | LULUS (42 ms) |
| 15 | hak akses dan validasi | nomor transaksi dan posting_sequence dibuat server, unik, dan naik | LULUS (19 ms) |
| 16 | transaksi bertanggal mundur | ditolak untuk WAREHOUSE dan ADMIN tanpa persetujuan; diizinkan ADMIN dengan persetujuan + audit | LULUS (43 ms) |
| 17 | transaksi bertanggal mundur | tanggal yang sama (jam lebih awal) boleh; tanggal di masa depan ditolak | LULUS (42 ms) |
| 18 | transaksi bertanggal mundur | OPENING tidak terkena pemeriksaan tanggal mundur | LULUS (7 ms) |
| 19 | adjustment | wajib alasan dan referensi, hanya ADMIN, tercatat dengan penyetuju | LULUS (30 ms) |
| 20 | adjustment | adjustment masuk tanpa harga memakai average cost; wajib harga jika stok nol | LULUS (17 ms) |
| 21 | saldo awal (OPENING) | hanya satu kali per SKU dan hanya sebelum ada mutasi lain | LULUS (25 ms) |
| 22 | saldo awal (OPENING) | import Excel membuat satu transaksi OPENING per SKU secara atomik | LULUS (24 ms) |
| 23 | saldo awal (OPENING) | import yang gagal di tengah tidak meninggalkan OPENING sebagian | LULUS (15 ms) |
| 24 | saldo awal (OPENING) | post_pending_openings memposting stok awal hasil FASE 3 yang tertinggal, sekali saja | LULUS (19 ms) |
| 25 | reversal dengan replay | membalik transaksi HISTORIS memperhitungkan dampak ke HPP setelahnya (bukan sekadar membalik saldo) | LULUS (59 ms) |
| 26 | reversal dengan replay | reversal transaksi terakhir mengembalikan saldo persis seperti sebelum transaksi | LULUS (41 ms) |
| 27 | reversal dengan replay | reversal yang membuat stok minus pada mutasi setelahnya ditolak dan tidak mengubah apa pun | LULUS (27 ms) |
| 28 | reversal dengan replay | hanya ADMIN, wajib alasan, tidak dua kali, dan hanya jenis IN/OUT/ADJUSTMENT | LULUS (43 ms) |
| 29 | reversal dengan replay | adjustment dapat direversal | LULUS (17 ms) |
| 30 | reversal dengan replay | reversal dokumen multi-SKU memproses semua SKU terdampak | LULUS (24 ms) |
| 31 | transaksi POSTED tidak boleh diedit atau dihapus langsung | trigger memblokir update/delete transaksi dan item (bahkan superuser); hanya POSTED->REVERSED lewat reversal | LULUS (534 ms) |
| 32 | transaksi POSTED tidak boleh diedit atau dihapus langsung | pengguna tidak dapat menulis saldo atau ledger secara langsung | LULUS (93 ms) |
| 33 | rekonsiliasi ledger dengan stock_balances (urutan acak, 200 operasi) | saldo = replay ledger efektif = jumlah mutasi ledger, untuk setiap SKU | LULUS (1026 ms) |
| 34 | konkurensi (koneksi paralel sungguhan) | dua OUT bersamaan atas stok yang hanya cukup untuk satu: tidak terjadi oversell | LULUS (212 ms) |
| 35 | konkurensi (koneksi paralel sungguhan) | 25 OUT @1 bersamaan atas stok 10: tepat 10 berhasil dan stok berakhir 0 | LULUS (1173 ms) |
| 36 | konkurensi (koneksi paralel sungguhan) | dokumen dengan urutan SKU berlawanan bersamaan tidak deadlock | LULUS (810 ms) |
| 37 | konkurensi (koneksi paralel sungguhan) | retry paralel dengan client_transaction_id yang sama hanya membuat satu transaksi | LULUS (45 ms) |
| 38 | konkurensi (koneksi paralel sungguhan) | campuran IN/OUT paralel: urutan ledger per SKU konsisten dan rekonsiliasi lulus | LULUS (129 ms) |
| 39 | konkurensi (koneksi paralel sungguhan) | reversal paralel atas transaksi yang sama: hanya satu yang berhasil | LULUS (23 ms) |
| 40 | integritas keseluruhan setelah semua skenario | seluruh SKU lolos rekonsiliasi, tidak ada saldo negatif, dan HPP/saldo tidak tertukar | LULUS (20 ms) |

### db/import.test.ts (24/24 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | import_products: hak akses | hanya ADMIN yang boleh import | LULUS (29 ms) |
| 2 | import_products: hak akses | pengguna ADMIN yang nonaktif ditolak | LULUS (12 ms) |
| 3 | import_products: hak akses | mode tidak valid dan data kosong ditolak | LULUS (9 ms) |
| 4 | import_products: mode NEW | menyimpan barang baru, menjaga nol di depan SKU/barcode, dan mencatat audit | LULUS (19 ms) |
| 5 | import_products: mode NEW | stok awal tersimpan di penampung dan rata-rata dihitung dari nilai / qty | LULUS (46 ms) |
| 6 | import_products: mode NEW | memposting OPENING satu per SKU: transaksi, ledger, dan saldo dibuat bersama impor | LULUS (7 ms) |
| 7 | import_products: mode NEW | stok 0 dan nilai 0 tidak membuat baris stok awal | LULUS (7 ms) |
| 8 | import_products: mode NEW | SKU yang sudah ada ditolak di mode NEW | LULUS (7 ms) |
| 9 | import_products: atomik (gagal sebagian = batal semua) | barcode duplikat di baris ke-3 membatalkan baris 1-2 | LULUS (23 ms) |
| 10 | import_products: atomik (gagal sebagian = batal semua) | SKU ganda di dalam file membatalkan semuanya | LULUS (18 ms) |
| 11 | import_products: atomik (gagal sebagian = batal semua) | barcode bentrok dengan data yang sudah ada membatalkan semuanya | LULUS (19 ms) |
| 12 | import_products: atomik (gagal sebagian = batal semua) | stok awal > 0 tanpa nilai membatalkan semuanya | LULUS (11 ms) |
| 13 | import_products: atomik (gagal sebagian = batal semua) | stok awal 0 dengan nilai > 0 ditolak | LULUS (9 ms) |
| 14 | import_products: atomik (gagal sebagian = batal semua) | stok awal negatif atau angka rusak ditolak | LULUS (17 ms) |
| 15 | import_products: atomik (gagal sebagian = batal semua) | SKU kosong ditolak | LULUS (3 ms) |
| 16 | import_products: mode UPDATE | mengubah master tetapi tidak menyentuh saldo maupun stok awal | LULUS (8 ms) |
| 17 | import_products: mode UPDATE | sel kosong berarti tidak diubah | LULUS (4 ms) |
| 18 | import_products: mode UPDATE | SKU tidak terdaftar membatalkan seluruh update | LULUS (6 ms) |
| 19 | import_products: mode UPDATE | barcode yang bentrok saat update ditolak dan membatalkan semuanya | LULUS (6 ms) |
| 20 | master barang: penghapusan dan histori | barang yang punya histori transaksi tidak dapat dihapus, yang tidak punya dapat dihapus | LULUS (19 ms) |
| 21 | master barang: penghapusan dan histori | perubahan nama dan kategori tidak mengubah histori ledger | LULUS (6 ms) |
| 22 | import_products: 1.000 SKU | mengimpor 1.000 SKU (dengan stok awal) dalam satu transaksi | LULUS (1418 ms) |
| 23 | import_products: 1.000 SKU | duplikat di baris terakhir dari 1.000 membatalkan seluruh impor | LULUS (256 ms) |
| 24 | stok awal tidak terbaca oleh anon, terbaca oleh role aktif | VIEWER dapat membaca; tidak ada yang dapat menulis langsung | LULUS (20 ms) |

### db/posting.test.ts (16/16 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | alur Barang Masuk lalu Barang Keluar (kode UI terhadap database) | WAREHOUSE memposting IN dan OUT; hasil resmi berasal dari server | LULUS (107 ms) |
| 2 | alur Barang Masuk lalu Barang Keluar (kode UI terhadap database) | dokumen multi-SKU diposting dalam satu transaksi | LULUS (28 ms) |
| 3 | alur Barang Masuk lalu Barang Keluar (kode UI terhadap database) | parameter RPC bernama cocok dengan fungsi database (kontrak UI-DB) | LULUS (17 ms) |
| 4 | penolakan stok kurang | OUT melebihi stok: error "stok tidak mencukupi" dan tidak ada yang berubah | LULUS (28 ms) |
| 5 | penolakan stok kurang | prefilter UI dan server sepakat: qty = stok diterima, qty > stok ditolak | LULUS (17 ms) |
| 6 | penolakan stok kurang | UI yang memakai stok usang tetap dilindungi server (stok sudah dipakai pengguna lain) | LULUS (16 ms) |
| 7 | penolakan stok kurang | satu barang kurang membatalkan seluruh dokumen multi-SKU | LULUS (19 ms) |
| 8 | notifikasi untuk kesalahan lain | SKU tidak ditemukan dan barang nonaktif | LULUS (8 ms) |
| 9 | notifikasi untuk kesalahan lain | VIEWER ditolak (forbidden); nonaktif ditolak | LULUS (13 ms) |
| 10 | notifikasi untuk kesalahan lain | tanggal mundur: WAREHOUSE ditolak, ADMIN dengan persetujuan berhasil | LULUS (18 ms) |
| 11 | notifikasi untuk kesalahan lain | tanggal di masa depan ditolak oleh server | LULUS (9 ms) |
| 12 | retry dokumen yang sama (kunci idempotensi dari UI) | klik Posting dua kali / retry jaringan tidak menggandakan transaksi | LULUS (16 ms) |
| 13 | retry dokumen yang sama (kunci idempotensi dari UI) | setelah transaksi gagal, retry dengan kunci yang sama tetap aman dan berhasil saat stok tersedia | LULUS (19 ms) |
| 14 | pratinjau UI vs hasil server | estimasi HPP/nilai di pratinjau sama dengan angka resmi server pada kasus pembulatan | LULUS (53 ms) |
| 15 | pratinjau UI vs hasil server | estimasi nilai pembelian sama dengan nilai resmi server | LULUS (31 ms) |
| 16 | hak baca untuk layar transaksi | WAREHOUSE melihat barang beserta stok dan average cost; VIEWER hanya membaca | LULUS (11 ms) |

### db/reports.test.ts (36/36 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | kartu stok | semua kolom terisi benar dan tidak tertukar (masuk/keluar, harga, HPP, nilai, saldo) | LULUS (10 ms) |
| 2 | kartu stok | saldo akhir = saldo resmi di stock_balances | LULUS (7 ms) |
| 3 | kartu stok | setiap baris dapat ditelusuri ke transaksi sumber (transaction_id, nomor, detail) | LULUS (26 ms) |
| 4 | kartu stok | filter tanggal: saldo awal, mutasi periode, dan saldo akhir | LULUS (5 ms) |
| 5 | kartu stok | periode tanpa mutasi: saldo awal = saldo akhir; periode hari ini saja | LULUS (8 ms) |
| 6 | kartu stok | identitas saldo awal + masuk - keluar = saldo akhir berlaku untuk semua jendela tanggal | LULUS (277 ms) |
| 7 | kartu stok | transaksi mundur (ADMIN): urutan ledger tetap, identitas aritmetika tetap berlaku | LULUS (8 ms) |
| 8 | kartu stok | transaksi yang direversal tetap tampil beserta koreksinya dan saldo tetap benar | LULUS (7 ms) |
| 9 | kartu stok | pengecualian: SKU tidak ada, rentang terbalik, anon, dan pengguna nonaktif | LULUS (12 ms) |
| 10 | kartu stok | transaksi PENDING tidak muncul di kartu stok | LULUS (2 ms) |
| 11 | A. Stock Summary, Low Stock, dan Zero Stock | total = jumlah saldo resmi untuk barang aktif; nonaktif dikecualikan kecuali diminta | LULUS (8 ms) |
| 12 | A. Stock Summary, Low Stock, dan Zero Stock | status stok dan kolom: HABIS, RENDAH, AMAN | LULUS (3 ms) |
| 13 | A. Stock Summary, Low Stock, dan Zero Stock | Low Stock (qty < minimum, termasuk habis) dan Zero Stock | LULUS (8 ms) |
| 14 | A. Stock Summary, Low Stock, dan Zero Stock | filter kategori dan pencarian; wildcard % dan _ dianggap huruf biasa | LULUS (14 ms) |
| 15 | B. Inventory Valuation dan rekonsiliasi ledger | hanya barang bernilai/bersaldo, total = jumlah baris = saldo resmi | LULUS (5 ms) |
| 16 | B. Inventory Valuation dan rekonsiliasi ledger | totals.reconciled benar bila saldo = ledger, dan salah bila saldo menyimpang | LULUS (8 ms) |
| 17 | B. Inventory Valuation dan rekonsiliasi ledger | include_zero menyertakan barang bersaldo nol; filter kategori | LULUS (5 ms) |
| 18 | C. Stock Movement per periode | periode penuh: saldo akhir = saldo resmi dan totals = jumlah baris | LULUS (11 ms) |
| 19 | C. Stock Movement per periode | setiap SKU: saldo awal + masuk - keluar = saldo akhir, dan cocok dengan kartu stok | LULUS (16 ms) |
| 20 | C. Stock Movement per periode | rincian per jenis mutasi dan HPP produk A | LULUS (5 ms) |
| 21 | C. Stock Movement per periode | filter kategori, validasi periode, dan hak akses | LULUS (8 ms) |
| 22 | F. Transaction History dan transaksi masuk/keluar | filter jenis, pengguna, status, tanggal, dan pencarian | LULUS (19 ms) |
| 23 | F. Transaction History dan transaksi masuk/keluar | transaksi PENDING tampil sebagai PENDING dan tidak dihitung dalam total nilai atau saldo | LULUS (6 ms) |
| 24 | F. Transaction History dan transaksi masuk/keluar | pagination: jumlah total tetap, halaman tidak tumpang tindih, urutan terbaru dahulu | LULUS (6 ms) |
| 25 | F. Transaction History dan transaksi masuk/keluar | hak: jenis/status tidak valid ditolak; anon ditolak; daftar pengguna | LULUS (6 ms) |
| 26 | F. Transaction History dan transaksi masuk/keluar | baris item Barang Masuk dan Keluar: total hanya transaksi POSTED, tertukar tidak mungkin | LULUS (15 ms) |
| 27 | Dashboard | total sama dengan saldo resmi; pending dipisah dan tidak dibukukan | LULUS (7 ms) |
| 28 | Dashboard | barang masuk/keluar hari ini hanya dari transaksi POSTED jenis IN/OUT | LULUS (4 ms) |
| 29 | Dashboard | low stock dan zero stock sama dengan laporan | LULUS (7 ms) |
| 30 | Dashboard | aktivitas terakhir: maks. 10, terbaru dahulu, pending berstatus PENDING | LULUS (5 ms) |
| 31 | Dashboard | anon ditolak; WAREHOUSE dan ADMIN dapat membaca | LULUS (9 ms) |
| 32 | Excel dari data database (total dapat direkonsiliasi) | Saldo Stok: total Excel = saldo resmi di database | LULUS (45 ms) |
| 33 | Excel dari data database (total dapat direkonsiliasi) | Inventory Valuation: lembar rekonsiliasi SESUAI dan total = jumlah ledger | LULUS (14 ms) |
| 34 | Excel dari data database (total dapat direkonsiliasi) | Kartu Stok: baris, total, dan saldo akhir sama dengan database | LULUS (15 ms) |
| 35 | Excel dari data database (total dapat direkonsiliasi) | Stock Movement: total saldo akhir Excel = total saldo resmi | LULUS (12 ms) |
| 36 | Excel dari data database (total dapat direkonsiliasi) | Barang Masuk / Keluar / Transaction History: total hanya transaksi POSTED | LULUS (39 ms) |

### db/rls.test.ts (42/42 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | pengguna baru | membuat profil dan role VIEWER otomatis | LULUS (9 ms) |
| 2 | pengguna baru | gudang awal tersedia dan hanya satu gudang aktif | LULUS (6 ms) |
| 3 | akses baca | ADMIN dapat membaca master barang | LULUS (6 ms) |
| 4 | akses baca | WAREHOUSE dapat membaca master barang | LULUS (3 ms) |
| 5 | akses baca | VIEWER dapat membaca master barang | LULUS (2 ms) |
| 6 | akses baca | anon tidak punya akses ke tabel mana pun | LULUS (16 ms) |
| 7 | akses baca | pengguna tanpa sesi (uid kosong) tidak melihat data | LULUS (4 ms) |
| 8 | master barang: hanya ADMIN yang menulis | WAREHOUSE ditolak menambah barang | LULUS (3 ms) |
| 9 | master barang: hanya ADMIN yang menulis | VIEWER ditolak menambah barang | LULUS (3 ms) |
| 10 | master barang: hanya ADMIN yang menulis | WAREHOUSE tidak dapat mengubah atau menghapus barang (0 baris terpengaruh) | LULUS (5 ms) |
| 11 | master barang: hanya ADMIN yang menulis | ADMIN dapat menambah dan mengubah barang | LULUS (7 ms) |
| 12 | role dan pengguna | pengguna tidak dapat menaikkan role sendiri | LULUS (6 ms) |
| 13 | role dan pengguna | pengguna biasa hanya melihat role dan profil sendiri | LULUS (8 ms) |
| 14 | role dan pengguna | ADMIN dapat melihat semua dan mengubah role pengguna lain | LULUS (12 ms) |
| 15 | role dan pengguna | pengguna biasa boleh mengubah nama sendiri tetapi bukan is_active atau email | LULUS (16 ms) |
| 16 | role dan pengguna | pengguna tidak dapat mengubah profil pengguna lain | LULUS (3 ms) |
| 17 | role dan pengguna | ADMIN dapat menonaktifkan pengguna | LULUS (9 ms) |
| 18 | pengguna nonaktif | tidak dapat membaca data maupun membuat transaksi | LULUS (16 ms) |
| 19 | pengguna nonaktif | ADMIN nonaktif kehilangan hak admin | LULUS (10 ms) |
| 20 | transaksi | WAREHOUSE dan ADMIN boleh membuat transaksi PENDING atas nama sendiri | LULUS (6 ms) |
| 21 | transaksi | VIEWER tidak dapat membuat transaksi | LULUS (3 ms) |
| 22 | transaksi | tidak dapat membuat transaksi atas nama orang lain | LULUS (3 ms) |
| 23 | transaksi | tidak dapat membuat transaksi berstatus POSTED lewat insert langsung | LULUS (3 ms) |
| 24 | transaksi | OPENING, ADJUSTMENT, REVERSAL hanya untuk ADMIN | LULUS (17 ms) |
| 25 | transaksi | transaksi tidak dapat diubah atau dihapus langsung oleh pengguna | LULUS (8 ms) |
| 26 | transaksi | item hanya dapat ditambah ke transaksi milik sendiri yang belum POSTED | LULUS (24 ms) |
| 27 | transaksi | status POSTED mewajibkan posted_at dan posting_sequence | LULUS (3 ms) |
| 28 | transaksi | client_transaction_id harus unik (idempotency) | LULUS (3 ms) |
| 29 | saldo dan ledger | stock_balances tidak dapat ditulis langsung oleh role mana pun | LULUS (11 ms) |
| 30 | saldo dan ledger | inventory_movements tidak dapat ditulis langsung oleh pengguna | LULUS (3 ms) |
| 31 | saldo dan ledger | UPDATE, DELETE, dan TRUNCATE pada ledger diblokir, bahkan untuk superuser | LULUS (14 ms) |
| 32 | saldo dan ledger | ledger tidak dapat diubah lewat sesi ADMIN | LULUS (9 ms) |
| 33 | saldo dan ledger | semua role aktif dapat membaca saldo dan ledger | LULUS (10 ms) |
| 34 | saldo dan ledger | stok negatif ditolak oleh constraint | LULUS (3 ms) |
| 35 | saldo dan ledger | satu baris saldo per gudang dan barang | LULUS (4 ms) |
| 36 | audit trail | perubahan master dan role tercatat otomatis dengan pelaku | LULUS (7 ms) |
| 37 | audit trail | hanya ADMIN yang dapat membaca audit_logs | LULUS (11 ms) |
| 38 | audit trail | audit_logs tidak dapat ditulis atau diubah pengguna, dan append-only untuk semua | LULUS (5 ms) |
| 39 | integritas data | SKU dan barcode duplikat ditolak, barcode kosong (NULL) boleh banyak | LULUS (6 ms) |
| 40 | integritas data | SKU dan barcode tersimpan sebagai teks dengan nol di depan | LULUS (2 ms) |
| 41 | integritas data | tidak ada kolom FLOAT/DOUBLE dan presisi NUMERIC sesuai spesifikasi | LULUS (21 ms) |
| 42 | integritas data | quantity item harus positif | LULUS (3 ms) |

### db/sync.test.ts (22/22 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | klasifikasi kegagalan | jaringan/server sementara = transient; kondisi server berubah = conflict; data/hak salah = failed | LULUS (2 ms) |
| 2 | transaksi offline lalu sinkronisasi | transaksi masuk dan keluar offline diposting berurutan; hasil resmi dari server; cache diperbarui | LULUS (126 ms) |
| 3 | transaksi offline lalu sinkronisasi | urutan dijaga: keluar yang bergantung pada masuk sebelumnya tidak ditolak karena stok | LULUS (37 ms) |
| 4 | transaksi offline lalu sinkronisasi | SYNCED tidak pernah dikirim ulang pada sinkronisasi berikutnya | LULUS (27 ms) |
| 5 | transaksi offline lalu sinkronisasi | sinkronisasi bersamaan hanya satu proses (tidak mengirim ganda) | LULUS (59 ms) |
| 6 | transaksi offline lalu sinkronisasi | transaksi yang dicatat saat sinkronisasi berjalan ikut terkirim | LULUS (28 ms) |
| 7 | konflik stok (perangkat lain mengubah stok) | CONFLICT dengan penyebab jelas; data lokal tidak berubah dan tidak dikirim ulang otomatis | LULUS (25 ms) |
| 8 | konflik stok (perangkat lain mengubah stok) | perbaikan oleh pengguna (kuantitas dikurangi) lalu sinkronisasi berhasil | LULUS (26 ms) |
| 9 | konflik stok (perangkat lain mengubah stok) | transaksi berikutnya pada SKU yang sama ditahan; SKU lain tetap berjalan | LULUS (49 ms) |
| 10 | konflik stok (perangkat lain mengubah stok) | dokumen multi-SKU: satu SKU kurang membatalkan seluruh dokumen di server dan menahan kedua SKU | LULUS (24 ms) |
| 11 | konflik stok (perangkat lain mengubah stok) | tanggal mundur bentrok dengan mutasi terbaru = CONFLICT; ADMIN dapat menyetujui lewat perbaikan | LULUS (28 ms) |
| 12 | konflik stok (perangkat lain mengubah stok) | barang yang dinonaktifkan atau tidak ada = CONFLICT (bukan FAILED) | LULUS (25 ms) |
| 13 | kegagalan jaringan dan pemulihan koneksi | jaringan putus di tengah: yang sudah terkirim tetap SYNCED, sisanya PENDING utuh dan urut, lalu pulih | LULUS (46 ms) |
| 14 | kegagalan jaringan dan pemulihan koneksi | RESPONS HILANG: server sudah memposting tetapi klien tidak menerima jawaban; retry tidak menggandakan | LULUS (28 ms) |
| 15 | kegagalan jaringan dan pemulihan koneksi | hasil duplikat tidak menimpa cache dengan saldo usang | LULUS (21 ms) |
| 16 | kegagalan jaringan dan pemulihan koneksi | aplikasi mati saat mengirim (SYNCING): pulih ke PENDING dan dikirim ulang dengan kunci yang sama tanpa duplikat | LULUS (18 ms) |
| 17 | kegagalan jaringan dan pemulihan koneksi | error server sementara: tetap PENDING; setelah 5 percobaan berubah FAILED agar tidak berputar selamanya | LULUS (22 ms) |
| 18 | kegagalan validasi dan hak akses | data tidak valid ditolak server sebagai FAILED dan tidak diubah otomatis | LULUS (16 ms) |
| 19 | kegagalan validasi dan hak akses | pengguna yang dinonaktifkan: FAILED (forbidden), tidak ada yang diposting | LULUS (15 ms) |
| 20 | kegagalan validasi dan hak akses | WAREHOUSE tidak dapat menyetujui transaksi mundur lewat antrean (forbidden) | LULUS (13 ms) |
| 21 | banyak pengguna di satu perangkat | transaksi milik pengguna lain tidak dikirim atas nama pengguna yang sedang login | LULUS (30 ms) |
| 22 | ringkasan akhir: tidak ada transaksi ganda di server | setiap client_transaction_id yang tersinkron muncul tepat satu kali | LULUS (2 ms) |

### outbox.test.ts (23/23 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | antrean offline: data yang disimpan | setiap transaksi memiliki UUID, client_transaction_id, waktu, pengguna, jenis, payload, dan status PENDING | LULUS (25 ms) |
| 2 | antrean offline: data yang disimpan | urutan pencatatan lokal (seq) naik dan listAll menurut urutan itu | LULUS (8 ms) |
| 3 | antrean offline: data yang disimpan | data tetap ada setelah aplikasi ditutup dan dibuka lagi (database yang sama) | LULUS (6 ms) |
| 4 | antrean offline: data yang disimpan | client_transaction_id yang sama tidak membuat entri ganda | LULUS (5 ms) |
| 5 | antrean offline: data yang disimpan | permintaan posting dibangun dari entri tanpa mengubah isinya | LULUS (4 ms) |
| 6 | antrean offline: status dan pemulihan | SYNCING yang tertinggal (aplikasi mati saat mengirim) dikembalikan ke PENDING dengan kunci yang sama | LULUS (9 ms) |
| 7 | antrean offline: status dan pemulihan | counts per status dan per pengguna | LULUS (6 ms) |
| 8 | antrean offline: status dan pemulihan | penolakan server menyimpan penyebab dan TIDAK mengubah isi transaksi | LULUS (5 ms) |
| 9 | antrean offline: status dan pemulihan | gangguan jaringan mengembalikan ke PENDING dengan catatan, bukan FAILED | LULUS (13 ms) |
| 10 | perbaikan dan pembatalan oleh pengguna | edit hanya untuk FAILED/CONFLICT: kunci baru, urutan dipertahankan, status PENDING | LULUS (8 ms) |
| 11 | perbaikan dan pembatalan oleh pengguna | edit memperbarui daftar SKU (indeks ketergantungan) | LULUS (4 ms) |
| 12 | perbaikan dan pembatalan oleh pengguna | SYNCED tidak dapat diedit atau dibatalkan; SYNCING tidak dapat dibatalkan | LULUS (7 ms) |
| 13 | perbaikan dan pembatalan oleh pengguna | pembatalan menghapus hanya entri itu | LULUS (6 ms) |
| 14 | perbaikan dan pembatalan oleh pengguna | riwayat SYNCED lama dibersihkan, yang baru dan yang belum selesai dipertahankan | LULUS (5 ms) |
| 15 | urutan antar transaksi dan proyeksi stok | hasUnsyncedFor: hanya milik pengguna itu dan hanya untuk SKU yang sama | LULUS (7 ms) |
| 16 | urutan antar transaksi dan proyeksi stok | queuedDelta menjumlah masuk dan keluar yang menunggu tanpa float | LULUS (6 ms) |
| 17 | cache lokal: pencarian dan scan offline | menyimpan waktu cache dan jumlah barang | LULUS (7 ms) |
| 18 | cache lokal: pencarian dan scan offline | cari menurut SKU, barcode, dan nama; hanya barang aktif; stok terakhir ikut tampil | LULUS (5 ms) |
| 19 | cache lokal: pencarian dan scan offline | barang tanpa saldo di cache dianggap stok 0 | LULUS (3 ms) |
| 20 | cache lokal: pencarian dan scan offline | scan: barcode, SKU bernol di depan, UPC-A -> EAN-13, huruf kecil, tidak ditemukan, nonaktif | LULUS (7 ms) |
| 21 | cache lokal: pencarian dan scan offline | replaceAll mengganti seluruh isi: barang yang hilang di server ikut hilang | LULUS (5 ms) |
| 22 | cache lokal: pencarian dan scan offline | saldo dari hasil posting memperbarui cache; hasil tanpa saldo diabaikan | LULUS (4 ms) |
| 23 | cache lokal: pencarian dan scan offline | clear mengosongkan cache tetapi TIDAK menyentuh antrean | LULUS (7 ms) |

### productImport.test.ts (39/39 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | decimal | menghitung rata-rata awal presisi 6 desimal tanpa float | LULUS (3 ms) |
| 2 | decimal | menerima angka valid dan menolak format ambigu atau rusak | LULUS (2 ms) |
| 3 | decimal | memeriksa kesesuaian nilai dengan qty × rata-rata dalam toleransi pembulatan | LULUS (0 ms) |
| 4 | template Excel | memiliki dua sheet: MASTER_BARANG dan PETUNJUK | LULUS (0 ms) |
| 5 | template Excel | kolom MASTER_BARANG sesuai spesifikasi dan berurutan | LULUS (0 ms) |
| 6 | template Excel | kolom SKU dan BARCODE sudah berformat Teks | LULUS (0 ms) |
| 7 | template Excel | PETUNJUK memuat petunjuk, contoh, format, kolom wajib, dan validasi | LULUS (1 ms) |
| 8 | template Excel | template kosong dapat dibaca kembali dan hasilnya tidak ada baris | LULUS (61 ms) |
| 9 | parseWorkbook | mempertahankan SKU dan barcode bernol di depan sebagai teks | LULUS (9 ms) |
| 10 | parseWorkbook | SKU/barcode angka murni tidak berubah menjadi notasi ilmiah dan diberi peringatan | LULUS (7 ms) |
| 11 | parseWorkbook | menolak file tanpa sheet MASTER_BARANG | LULUS (4 ms) |
| 12 | parseWorkbook | menolak kolom yang hilang dan memperingatkan kolom tak dikenal | LULUS (10 ms) |
| 13 | parseWorkbook | header tidak peka huruf besar/kecil dan urutan kolom bebas | LULUS (6 ms) |
| 14 | parseWorkbook | melewati baris kosong dan memberi nomor baris Excel yang benar | LULUS (4 ms) |
| 15 | parseWorkbook | file rusak ditolak dengan pesan yang jelas | LULUS (2 ms) |
| 16 | validateRows: mode barang baru | baris valid menghasilkan payload bersih | LULUS (6 ms) |
| 17 | validateRows: mode barang baru | SKU, NAMA_BARANG, dan SATUAN wajib | LULUS (6 ms) |
| 18 | validateRows: mode barang baru | SKU duplikat dan barcode duplikat di dalam file ditandai di baris kedua | LULUS (4 ms) |
| 19 | validateRows: mode barang baru | bentrok dengan data yang sudah ada di database | LULUS (4 ms) |
| 20 | validateRows: mode barang baru | angka tidak valid ditolak dengan nama kolom | LULUS (3 ms) |
| 21 | validateRows: mode barang baru | panjang berlebih dan sel error Excel ditolak | LULUS (3 ms) |
| 22 | validateRows: aturan stok awal (opening inventory) | stok > 0 wajib punya nilai persediaan | LULUS (4 ms) |
| 23 | validateRows: aturan stok awal (opening inventory) | rata-rata awal = nilai / stok (contoh 150 unit, Rp1.600.000) | LULUS (3 ms) |
| 24 | validateRows: aturan stok awal (opening inventory) | HARGA_RATA_RATA_AWAL yang diisi harus konsisten | LULUS (7 ms) |
| 25 | validateRows: aturan stok awal (opening inventory) | stok 0 atau kosong mensyaratkan nilai 0 | LULUS (13 ms) |
| 26 | validateRows: aturan stok awal (opening inventory) | nilai persediaan negatif ditolak | LULUS (3 ms) |
| 27 | validateRows: aturan stok awal (opening inventory) | pecahan qty dan nilai dipertahankan presisinya | LULUS (3 ms) |
| 28 | validateRows: mode update master | hanya SKU yang wajib; kolom kosong tidak dikirim | LULUS (4 ms) |
| 29 | validateRows: mode update master | SKU yang belum terdaftar ditolak | LULUS (4 ms) |
| 30 | validateRows: mode update master | kolom stok awal diabaikan dengan peringatan dan tidak masuk payload | LULUS (3 ms) |
| 31 | validateRows: mode update master | barcode milik SKU yang sama boleh, milik SKU lain ditolak | LULUS (5 ms) |
| 32 | 1.000 SKU | 1.000 baris valid dibaca dan divalidasi cepat tanpa error | LULUS (99 ms) |
| 33 | 1.000 SKU | duplikat di antara 1.000 baris terdeteksi dan baris lain tetap valid | LULUS (86 ms) |
| 34 | 1.000 SKU | lebih dari 5000 baris ditolak | LULUS (214 ms) |
| 35 | export master barang | SKU dan barcode tetap teks dengan nol di depan | LULUS (1 ms) |
| 36 | export master barang | kolom angka bertipe numerik dan status terpisah dari kuantitas | LULUS (0 ms) |
| 37 | export master barang | hasil export dapat dibaca kembali sama persis (round-trip) | LULUS (8 ms) |
| 38 | export master barang | nama file memuat tanggal Asia/Jakarta | LULUS (24 ms) |
| 39 | export master barang | export dengan 1.000 produk memiliki jumlah baris yang sama | LULUS (66 ms) |

### reportExcel.test.ts (23/23 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | kartu stok Excel | nama file memuat SKU dan periode | LULUS (3 ms) |
| 2 | kartu stok Excel | kolom sesuai Bagian 14 dan urutannya tetap | LULUS (2 ms) |
| 3 | kartu stok Excel | nilai berada di kolom yang benar (qty vs nilai tidak tertukar) pada baris masuk dan keluar | LULUS (34 ms) |
| 4 | kartu stok Excel | SKU tetap teks (nol di depan) dan sel bertipe string dengan format teks | LULUS (10 ms) |
| 5 | kartu stok Excel | tanggal berupa nomor seri Excel pada jam Jakarta dengan format tanggal | LULUS (1 ms) |
| 6 | kartu stok Excel | format rupiah dan angka konsisten per jenis kolom | LULUS (0 ms) |
| 7 | kartu stok Excel | saldo awal, total periode, dan saldo akhir ada di lembar dan cocok dengan server | LULUS (8 ms) |
| 8 | kartu stok Excel | total periode = jumlah baris, dan saldo awal + masuk - keluar = saldo akhir | LULUS (2 ms) |
| 9 | kartu stok Excel | lembar RINGKASAN memuat SKU, periode, dan saldo | LULUS (8 ms) |
| 10 | saldo stok, low stock, dan zero stock | kolom, tipe, dan total | LULUS (8 ms) |
| 11 | saldo stok, low stock, dan zero stock | SKU seperti "1E5" dan barcode bernol di depan tidak berubah menjadi angka | LULUS (6 ms) |
| 12 | saldo stok, low stock, dan zero stock | total server = jumlah baris | LULUS (0 ms) |
| 13 | saldo stok, low stock, dan zero stock | Low Stock memuat kolom Kekurangan; Zero Stock dan nama file sendiri | LULUS (10 ms) |
| 14 | saldo stok, low stock, dan zero stock | laporan kosong tetap valid dengan satu baris TOTAL | LULUS (5 ms) |
| 15 | inventory valuation | total nilai persediaan dan lembar rekonsiliasi | LULUS (15 ms) |
| 16 | stock movement | kolom masuk/keluar/HPP/saldo akhir dan total tidak tertukar | LULUS (13 ms) |
| 17 | stock movement | identitas per baris dan total (saldo awal + masuk - keluar = saldo akhir) | LULUS (1 ms) |
| 18 | stock movement | rincian per jenis mutasi ada di lembar PER_JENIS | LULUS (6 ms) |
| 19 | barang masuk, barang keluar, dan transaction history | Barang Masuk: judul kolom, total hanya POSTED, nama file periode | LULUS (5 ms) |
| 20 | barang masuk, barang keluar, dan transaction history | Barang Keluar memakai judul HPP | LULUS (4 ms) |
| 21 | barang masuk, barang keluar, dan transaction history | Transaction History: kolom, tipe, total POSTED, dan nama file | LULUS (5 ms) |
| 22 | utilitas | periodLabel | LULUS (0 ms) |
| 23 | utilitas | 1.000 baris tetap dihasilkan dengan benar dan total sama dengan jumlah baris | LULUS (119 ms) |

### scan.test.ts (27/27 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | format yang didukung (Bagian 13) | tepat 7 format: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, QR | LULUS (3 ms) |
| 2 | format yang didukung (Bagian 13) | kamera belakang menjadi default dan dapat memilih kamera tertentu | LULUS (1 ms) |
| 3 | cleanScan dan QR | membuang karakter kontrol dan spasi di tepi | LULUS (1 ms) |
| 4 | cleanScan dan QR | teks biasa dipakai apa adanya | LULUS (1 ms) |
| 5 | cleanScan dan QR | URL berparameter sku/barcode dan JSON diambil nilainya | LULUS (2 ms) |
| 6 | cleanScan dan QR | URL tanpa parameter dikenali atau JSON rusak tidak melempar error | LULUS (1 ms) |
| 7 | GTIN dan UPC-E | digit pemeriksa EAN-13, EAN-8, UPC-A | LULUS (1 ms) |
| 8 | GTIN dan UPC-E | UPC-E diperluas ke UPC-A untuk setiap aturan digit terakhir | LULUS (1 ms) |
| 9 | GTIN dan UPC-E | UPC-E tidak valid ditolak | LULUS (0 ms) |
| 10 | scanCandidates | UPC-A (12) juga dicari sebagai EAN-13 berawalan 0, dan sebaliknya | LULUS (1 ms) |
| 11 | scanCandidates | EAN-13 tanpa awalan 0 dan teks SKU tidak diubah | LULUS (0 ms) |
| 12 | scanCandidates | UPC-E dicari sebagai UPC-E, UPC-A, dan EAN-13 | LULUS (0 ms) |
| 13 | scanCandidates | EAN-8 yang bukan UPC-E valid hanya dicari apa adanya | LULUS (0 ms) |
| 14 | scanCandidates | nol di depan SKU numerik tidak dihapus; kosong menghasilkan daftar kosong | LULUS (0 ms) |
| 15 | scanCandidates | QR berisi URL/JSON dicari memakai nilainya | LULUS (0 ms) |
| 16 | pickBestMatch: memilih barang dari hasil scan | barcode persis | LULUS (0 ms) |
| 17 | pickBestMatch: memilih barang dari hasil scan | SKU persis, termasuk SKU numerik bernol di depan | LULUS (0 ms) |
| 18 | pickBestMatch: memilih barang dari hasil scan | SKU tidak peka huruf besar/kecil (Code 39 hanya huruf besar) | LULUS (0 ms) |
| 19 | pickBestMatch: memilih barang dari hasil scan | kandidat berurutan: UPC-A hasil scan ditemukan lewat kandidat EAN-13 tersimpan | LULUS (0 ms) |
| 20 | pickBestMatch: memilih barang dari hasil scan | barcode lebih diutamakan daripada SKU yang kebetulan sama dengan barcode produk lain | LULUS (0 ms) |
| 21 | pickBestMatch: memilih barang dari hasil scan | tidak ada kecocokan | LULUS (0 ms) |
| 22 | pickBestMatch: memilih barang dari hasil scan | hasil ganda ditandai ambigu, bukan memilih sembarang | LULUS (0 ms) |
| 23 | pickBestMatch: memilih barang dari hasil scan | wildcard ilike (_) tidak menghasilkan kecocokan palsu | LULUS (0 ms) |
| 24 | describeCameraError: pesan izin kamera dan error | konteks tidak aman (bukan HTTPS) dijelaskan lebih dulu | LULUS (0 ms) |
| 25 | describeCameraError: pesan izin kamera dan error | browser tanpa mediaDevices | LULUS (0 ms) |
| 26 | describeCameraError: pesan izin kamera dan error | izin ditolak, kamera tidak ada, kamera sibuk, constraint, tidak dikenal | LULUS (1 ms) |
| 27 | addQuantities (menggabungkan baris SKU yang sama) | menjumlah tanpa float dan merapikan nol di belakang | LULUS (0 ms) |

### scanDecode.test.ts (15/15 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | decode ketujuh format dengan konfigurasi scanner yang sama | ean13 | LULUS (47 ms) |
| 2 | decode ketujuh format dengan konfigurasi scanner yang sama | ean8 | LULUS (16 ms) |
| 3 | decode ketujuh format dengan konfigurasi scanner yang sama | upca | LULUS (11 ms) |
| 4 | decode ketujuh format dengan konfigurasi scanner yang sama | upce | LULUS (9 ms) |
| 5 | decode ketujuh format dengan konfigurasi scanner yang sama | code128 | LULUS (16 ms) |
| 6 | decode ketujuh format dengan konfigurasi scanner yang sama | code39 | LULUS (15 ms) |
| 7 | decode ketujuh format dengan konfigurasi scanner yang sama | QR Code (teks, URL, dan JSON) | LULUS (94 ms) |
| 8 | decode ketujuh format dengan konfigurasi scanner yang sama | Code 128 dengan SKU bernol di depan dan karakter campuran | LULUS (11 ms) |
| 9 | decode ketujuh format dengan konfigurasi scanner yang sama | format di luar daftar (ITF-14/Data Matrix) tidak dikenali | LULUS (268 ms) |
| 10 | hasil decode -> pencarian barang | EAN-13 -> barcode | LULUS (1 ms) |
| 11 | hasil decode -> pencarian barang | UPC-A hasil scan menemukan barang yang tersimpan sebagai EAN-13 berawalan 0 | LULUS (0 ms) |
| 12 | hasil decode -> pencarian barang | UPC-E hasil scan diperluas dan menemukan barang yang sama | LULUS (0 ms) |
| 13 | hasil decode -> pencarian barang | Code 39 (huruf besar) -> SKU | LULUS (0 ms) |
| 14 | hasil decode -> pencarian barang | QR berisi JSON -> SKU | LULUS (1 ms) |
| 15 | hasil decode -> pencarian barang | kode yang tidak terdaftar -> tidak ditemukan | LULUS (1 ms) |

### transactionForm.test.ts (25/25 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | decimal: perkiraan nilai untuk pratinjau | qty × harga dibulatkan setengah ke atas pada 2 desimal | LULUS (2 ms) |
| 2 | decimal: perkiraan nilai untuk pratinjau | membandingkan desimal tanpa float | LULUS (0 ms) |
| 3 | validateLines: Barang Masuk | dokumen kosong ditolak | LULUS (1 ms) |
| 4 | validateLines: Barang Masuk | baris valid tanpa masalah | LULUS (1 ms) |
| 5 | validateLines: Barang Masuk | quantity wajib, harus > 0, maks 4 desimal, bukan angka ambigu | LULUS (1 ms) |
| 6 | validateLines: Barang Masuk | harga beli wajib (boleh 0), maks 6 desimal | LULUS (1 ms) |
| 7 | validateLines: Barang Masuk | SKU ganda dalam satu dokumen ditandai | LULUS (1 ms) |
| 8 | validateLines: Barang Keluar | harga beli tidak diminta | LULUS (1 ms) |
| 9 | validateLines: Barang Keluar | melebihi stok tersedia menurut server ditandai sebelum posting | LULUS (1 ms) |
| 10 | validateLines: Barang Keluar | stok tidak diketahui tidak memblokir (server tetap menolak jika kurang) | LULUS (0 ms) |
| 11 | buildItems: payload ke post_transaction | IN memuat quantity dan unit_cost kanonik berupa teks | LULUS (0 ms) |
| 12 | buildItems: payload ke post_transaction | OUT hanya memuat quantity (HPP dihitung server) | LULUS (0 ms) |
| 13 | buildItems: payload ke post_transaction | SKU dan angka tidak berubah format (nol di depan tetap) | LULUS (0 ms) |
| 14 | buildItems: payload ke post_transaction | melempar error jika dipakai pada data tidak valid | LULUS (1 ms) |
| 15 | estimateValue dan sumEstimates (pratinjau) | IN = qty × harga beli | LULUS (0 ms) |
| 16 | estimateValue dan sumEstimates (pratinjau) | OUT = qty × average cost dari server (estimasi HPP) | LULUS (0 ms) |
| 17 | estimateValue dan sumEstimates (pratinjau) | OUT seluruh stok memakai seluruh nilai persediaan (tidak ada sisa pembulatan) | LULUS (1 ms) |
| 18 | estimateValue dan sumEstimates (pratinjau) | tanpa data average cost, estimasi tidak ditampilkan | LULUS (0 ms) |
| 19 | estimateValue dan sumEstimates (pratinjau) | total estimasi dijumlahkan tanpa float | LULUS (0 ms) |
| 20 | resolveTransactionDate (kalender Asia/Jakarta) | tanggal hari ini (WIB) memakai waktu sekarang | LULUS (25 ms) |
| 21 | resolveTransactionDate (kalender Asia/Jakarta) | tanggal lalu dan depan memakai pukul 12:00 WIB | LULUS (1 ms) |
| 22 | resolveTransactionDate (kalender Asia/Jakarta) | format tidak valid terdeteksi | LULUS (0 ms) |
| 23 | mapPostError: notifikasi sesuai kode error server | stok tidak mencukupi | LULUS (0 ms) |
| 24 | mapPostError: notifikasi sesuai kode error server | SKU tidak ditemukan dan barang nonaktif | LULUS (0 ms) |
| 25 | mapPostError: notifikasi sesuai kode error server | tanggal mundur, hak akses, offline, dan tidak dikenal | LULUS (0 ms) |

### ui/antrean.test.tsx (10/10 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | Antrean Offline | kosong: pesan semua tersinkron; info cache dan catatan tidak dijamin | LULUS (129 ms) |
| 2 | Antrean Offline | PENDING tampil sebagai belum resmi dengan tombol Batalkan; hanya milik pengguna ini | LULUS (98 ms) |
| 3 | Antrean Offline | tombol sinkronisasi nonaktif saat offline | LULUS (30 ms) |
| 4 | Antrean Offline | batalkan: konfirmasi ditolak = data tetap; diterima = data lokal dihapus | LULUS (155 ms) |
| 5 | Antrean Offline | batalkan transaksi yang pernah dicoba kirim memberi peringatan mungkin sudah diposting | LULUS (90 ms) |
| 6 | Antrean Offline | FAILED: penyebab tampil, Perbaiki -> ubah qty -> simpan -> kembali PENDING dengan data baru | LULUS (236 ms) |
| 7 | Antrean Offline | perbaikan dengan angka tidak valid ditolak dan data tidak berubah | LULUS (394 ms) |
| 8 | Antrean Offline | persetujuan tanggal mundur di dialog Perbaiki hanya muncul untuk ADMIN | LULUS (168 ms) |
| 9 | Antrean Offline | SYNCING tidak dapat dibatalkan; SYNCED muncul di riwayat dengan nomor transaksi | LULUS (29 ms) |
| 10 | Antrean Offline | transaksi ditahan menampilkan alasan urutan | LULUS (19 ms) |

### ui/app.test.tsx (16/16 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | menu menurut role (Bagian 19) | ADMIN melihat semua menu | LULUS (5 ms) |
| 2 | menu menurut role (Bagian 19) | WAREHOUSE: transaksi dan antrean, tanpa import/audit/pengaturan | LULUS (1 ms) |
| 3 | menu menurut role (Bagian 19) | VIEWER: hanya baca | LULUS (1 ms) |
| 4 | menu menurut role (Bagian 19) | tanpa role tidak ada menu | LULUS (1 ms) |
| 5 | gerbang akses App | memuat: tampil "Memuat…" dengan nama aplikasi | LULUS (129 ms) |
| 6 | gerbang akses App | belum masuk: layar login memuat nama, kepanjangan, dan tagline | LULUS (22 ms) |
| 7 | gerbang akses App | akun dinonaktifkan: ditolak dengan pesan, tombol keluar berfungsi | LULUS (55 ms) |
| 8 | gerbang akses App | akun tanpa role: ditolak | LULUS (6 ms) |
| 9 | gerbang akses App | halaman awal = menu pertama; navigasi mengganti halaman | LULUS (77 ms) |
| 10 | gerbang akses App | VIEWER yang membuka rute ADMIN (#/audit) dialihkan ke menu pertamanya | LULUS (19 ms) |
| 11 | gerbang akses App | WAREHOUSE tidak melihat Import/Export tetapi melihat Barang Masuk | LULUS (16 ms) |
| 12 | gerbang akses App | Import/Export (lazy) terbuka untuk ADMIN | LULUS (319 ms) |
| 13 | header: status koneksi, sinkronisasi, logout | Online/Offline mengikuti jaringan; badge antrean dan "perlu tindakan" | LULUS (24 ms) |
| 14 | header: status koneksi, sinkronisasi, logout | logout dengan antrean tersisa meminta konfirmasi; batal = tetap masuk | LULUS (132 ms) |
| 15 | header: status koneksi, sinkronisasi, logout | logout tanpa antrean langsung keluar tanpa konfirmasi | LULUS (86 ms) |
| 16 | layar login | kredensial dikirim (email dipangkas); galat ditampilkan; tombol nonaktif bila belum dikonfigurasi | LULUS (333 ms) |

### ui/dashboard.test.tsx (6/6 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | Dashboard | menampilkan angka resmi dari server apa adanya (format Indonesia, Rupiah) | LULUS (87 ms) |
| 2 | Dashboard | antrean lokal ditampilkan terpisah dan tidak masuk ke angka resmi | LULUS (20 ms) |
| 3 | Dashboard | PENDING di server diberi tanda dan penjelasan bukan saldo | LULUS (28 ms) |
| 4 | Dashboard | kartu Low/Zero stock dan "Buka antrean" menavigasi | LULUS (200 ms) |
| 5 | Dashboard | tanpa aktivitas: pesan kosong. Galat server: tampil dan tidak ada angka palsu | LULUS (48 ms) |
| 6 | Dashboard | "Muat ulang" mengambil data lagi; status koneksi mengikuti jaringan | LULUS (55 ms) |

### ui/master.test.tsx (10/10 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | Master Barang | daftar tampil; "-" untuk kosong; nonaktif diberi label; jumlah dan halaman | LULUS (104 ms) |
| 2 | Master Barang | VIEWER/WAREHOUSE: tidak ada tambah/edit/nonaktifkan/hapus | LULUS (96 ms) |
| 3 | Master Barang | cari (debounce) dan filter mengirim parameter ke layanan dan kembali ke halaman 1 | LULUS (619 ms) |
| 4 | Master Barang | paginasi: total 45 = 3 halaman; Berikutnya meminta halaman 2 | LULUS (92 ms) |
| 5 | Master Barang | kosong: pesan tidak ada barang; galat server ditampilkan | LULUS (45 ms) |
| 6 | Master Barang | tambah barang: validasi wajib isi, lalu simpan dengan nilai dipangkas dan kosong = null | LULUS (809 ms) |
| 7 | Master Barang | SKU/barcode ganda ditolak server: pesan tampil dan formulir tetap terbuka | LULUS (336 ms) |
| 8 | Master Barang | edit: formulir terisi data barang dan memanggil updateProduct dengan id | LULUS (347 ms) |
| 9 | Master Barang | nonaktifkan/aktifkan membalik status; hapus meminta konfirmasi | LULUS (212 ms) |
| 10 | Master Barang | hapus barang berhistori ditolak server: pesan galat, tidak ada klaim sukses | LULUS (57 ms) |

### ui/pengaturan.test.tsx (14/14 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | Pengaturan: pernyataan jujur tentang backup | menyatakan backup otomatis Supabase tidak aktif (Free Plan) dan backup Excel bukan pengganti | LULUS (76 ms) |
| 2 | cek integritas | lulus: tanda hijau; gagal: pesan peringatan dan jumlah masalah | LULUS (164 ms) |
| 3 | cek integritas | galat jaringan ditampilkan sebagai notifikasi | LULUS (57 ms) |
| 4 | buat backup | memanggil RPC dengan lingkup + catatan, mengunduh file, dan menampilkan SHA-256 | LULUS (345 ms) |
| 5 | buat backup | jenis arsip (TRANSACTIONS) diberi catatan tidak dapat dipulihkan sendiri | LULUS (60 ms) |
| 6 | buat backup | kegagalan server: notifikasi galat, tidak ada unduhan | LULUS (68 ms) |
| 7 | restore: alur bertahap | file bukan JSON / bukan backup WHISTLE ditolak di klien tanpa memanggil server | LULUS (30 ms) |
| 8 | restore: alur bertahap | urutan wajib: pilih -> validasi -> ketik PULIHKAN -> pulihkan; tombol terkunci sebelum frasa tepat | LULUS (431 ms) |
| 9 | restore: alur bertahap | file gagal validasi: tidak ada tombol pulihkan dan penyebab terlihat | LULUS (57 ms) |
| 10 | restore: alur bertahap | restore MASTER memakai teks yang tidak menakut-nakuti tetapi tetap meminta konfirmasi | LULUS (88 ms) |
| 11 | restore: alur bertahap | server menolak saat memulihkan: pesan "data tidak berubah" dan hasil sukses tidak muncul | LULUS (238 ms) |
| 12 | restore: alur bertahap | pengguna pembuat tidak ada: opsi pemetaan memicu validasi ulang dan diteruskan ke restore | LULUS (340 ms) |
| 13 | restore: alur bertahap | memilih file lain mengosongkan hasil validasi sebelumnya | LULUS (87 ms) |
| 14 | titik pemulihan | menampilkan daftar dan mengunduh titik tertentu | LULUS (55 ms) |

### ui/transaction.test.tsx (13/13 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | Barang Masuk: alur online | cari -> isi -> pratinjau (perkiraan) -> posting -> hasil resmi dari server | LULUS (1230 ms) |
| 2 | Barang Masuk: alur online | validasi: dokumen kosong dan angka tidak valid ditandai, tidak ada yang dikirim | LULUS (717 ms) |
| 3 | Barang Masuk: alur online | SKU yang sama tidak ditambahkan dua kali | LULUS (946 ms) |
| 4 | Barang Masuk: alur online | "Transaksi baru" mengosongkan form dan memakai kunci idempotensi baru | LULUS (1573 ms) |
| 5 | Barang Keluar: stok dan penolakan | melebihi stok tersedia (data server) diblokir sebelum posting | LULUS (560 ms) |
| 6 | Barang Keluar: stok dan penolakan | server menolak "stok tidak mencukupi": notifikasi jelas, kembali ke form, tidak masuk antrean | LULUS (684 ms) |
| 7 | Barang Keluar: stok dan penolakan | SKU tidak ditemukan saat mengetik manual memberi notifikasi | LULUS (143 ms) |
| 8 | mode offline dan antrean | offline: dokumen masuk antrean PENDING (belum resmi), tidak memanggil server | LULUS (689 ms) |
| 9 | mode offline dan antrean | jaringan putus saat mengirim: diantre dengan client_transaction_id yang SAMA dengan percobaan online | LULUS (708 ms) |
| 10 | mode offline dan antrean | masih ada antrean untuk SKU yang sama: dokumen baru ikut antrean agar urutan terjaga | LULUS (635 ms) |
| 11 | mode offline dan antrean | offline: stok kurang menurut cache hanya peringatan, transaksi tetap dapat disimpan (server yang memutuskan) | LULUS (597 ms) |
| 12 | mode offline dan antrean | tanggal mundur: kotak persetujuan hanya untuk ADMIN | LULUS (486 ms) |
| 13 | daftar barang di dokumen | hapus baris mengosongkan dokumen | LULUS (502 ms) |

### upce.test.ts (7/7 lulus)

| No | Kelompok | Expected result | Actual result |
|---|---|---|---|
| 1 | bug bawaan @zxing/library: UPCEReader tidak berfungsi | tanpa patch, UPC-E yang valid tidak terbaca sama sekali | LULUS (282 ms) |
| 2 | UPC-E setelah patch | semua UPC-E valid terbaca persis (8 digit, format UPC_E), untuk kedua number system | LULUS (8 ms) |
| 3 | UPC-E setelah patch | ukuran modul dan tinggi berbeda tetap terbaca | LULUS (5 ms) |
| 4 | UPC-E setelah patch | digit pemeriksa salah ditolak (tidak menghasilkan kode palsu) | LULUS (112 ms) |
| 5 | UPC-E setelah patch | patch idempoten dan tidak merusak format lain | LULUS (2 ms) |
| 6 | UPC-E setelah patch | konversi UPC-E -> UPC-A untuk semua aturan digit terakhir (0-2, 3, 4, 5-9) | LULUS (1 ms) |
| 7 | UPC-E setelah patch | format yang tercatat tetap UPC_E dan bukan EAN/UPC lain | LULUS (2 ms) |

## 5. Yang belum teruji

- Layar dengan login sungguhan ke Supabase produksi (tes UI memakai layanan palsu; alur database diuji terpisah pada Postgres sungguhan).
- Layar Kartu Stok, Laporan, Audit Trail, dan Import/Export belum punya tes antarmuka; logika datanya (SQL dan Excel) teruji.
- Kamera dan scanner di HP, instalasi PWA di Android, mode pesawat, dan dua perangkat bersamaan (lihat bagian 3).
- Restore dari file backup sangat besar (di atas sekitar 8 MB) lewat RPC; batas ukuran permintaan server belum diukur.
- Backup otomatis Supabase tidak aktif (Free Plan); hanya backup manual dari aplikasi.
