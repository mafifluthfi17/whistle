# Uji manual offline dan sinkronisasi (FASE 8)

Logika antrean, sinkronisasi, konflik, dan idempotensi sudah diuji otomatis (`npm test`, termasuk terhadap
Postgres sungguhan). Yang **hanya bisa diuji di perangkat nyata**: mode pesawat, service worker pada PWA
terpasang, penyimpanan IndexedDB browser, dan dua perangkat yang bekerja bersamaan.

**Persiapan**
- Buka https://mafifluthfi17.github.io/whistle/ di Chrome Android dan di komputer.
- Login sebagai ADMIN/WAREHOUSE. Siapkan minimal 3 barang bersaldo (mis. A stok 10, B stok 10, C stok 0).
- **Sambungkan ke internet dulu dan buka menu Antrean Offline**: pastikan "Data barang di perangkat" terisi
  (jumlah > 0 dan ada waktu pembaruan). Tanpa ini pencarian offline tidak punya data.
- Catat versi Chrome dan tipe HP. Isi kolom Hasil: LULUS / GAGAL + catatan. Jangan isi LULUS untuk yang tidak dicoba.

## A. Membuka aplikasi tanpa internet

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| A1 | Pasang aplikasi (Tambahkan ke layar utama). Aktifkan mode pesawat, buka aplikasi dari ikon | Aplikasi terbuka, TIDAK diminta login ulang, nama dan role tampil, badge "Offline" | |
| A2 | Buka juga di tab browser biasa (bukan PWA) dalam mode pesawat | Halaman terbuka dari cache; menu berfungsi | |
| A3 | Mode pesawat, buka Dashboard / Laporan / Kartu Stok | Pesan jelas "hanya tersedia saat online"; tidak crash | |
| A4 | Mode pesawat, buka Master Barang | Pesan error koneksi jelas (master hanya online) | |
| A5 | Mode pesawat, jangan pernah login sebelumnya (data browser bersih) | Layar login; pesan bahwa masuk memerlukan koneksi | |

## B. Mencatat transaksi offline

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| B1 | Mode pesawat. Barang Masuk: cari barang A, isi qty 5 dan harga 1000, Pratinjau, Posting | Muncul "tersimpan di antrean offline (PENDING)"; badge header "1 pending" | |
| B2 | Barang Keluar barang A qty 3 (stok tampil menurut cache) | Tersimpan PENDING; stok yang ditampilkan memperhitungkan masuk yang menunggu | |
| B3 | Scan barcode barang B dengan kamera (offline) lalu catat keluar 2 | Barang ditemukan dari cache; tersimpan PENDING | |
| B4 | Barang Keluar barang A qty 100 (melebihi stok) saat offline | Peringatan stok, tetapi tetap dapat disimpan (server memutuskan nanti) | |
| B5 | Buka Antrean Offline | Semua transaksi tampil berurutan dengan status PENDING dan isi yang benar | |
| B6 | Tutup paksa aplikasi lalu buka lagi (masih offline) | Antrean tetap ada, tidak ada yang hilang | |
| B7 | Dashboard (offline tidak bisa) lalu online: lihat kartu antrean | Antrean lokal ditampilkan terpisah dan tidak masuk saldo/jumlah hari ini | |

## C. Sinkronisasi saat koneksi pulih

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| C1 | Matikan mode pesawat | Dalam beberapa detik antrean terkirim otomatis, notifikasi "N transaksi offline berhasil diposting" | |
| C2 | Periksa Transaction History / Kartu Stok barang A | Transaksi muncul sekali, bernomor resmi, urutan sesuai pencatatan | |
| C3 | Saldo dan average cost barang A | Sesuai perhitungan server (bukan angka lokal) | |
| C4 | Putus internet tepat saat sinkronisasi (nyalakan pesawat di tengah) lalu pulihkan | Tidak ada transaksi ganda; yang belum terkirim tetap PENDING lalu terkirim | |
| C5 | Cek badge header setelah semua terkirim | "Tersinkron" | |

## D. Konflik dan kegagalan (butuh dua perangkat)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| D1 | Perangkat 1 offline: catat keluar barang C 8 unit (stok cache 10). Perangkat 2 online: keluarkan 5 unit barang C. Perangkat 1 online | Transaksi perangkat 1 berstatus **CONFLICT** dengan alasan "Stok tidak mencukupi... tersedia 5, diminta 8"; jumlah TIDAK berubah sendiri | |
| D2 | Catat transaksi lain untuk barang C yang sama setelahnya (offline) | Ditahan (PENDING, "ditahan karena transaksi sebelumnya"); transaksi barang lain tetap terkirim | |
| D3 | Perbaiki D1: ubah qty ke 5, simpan | Status kembali PENDING lalu terkirim; transaksi yang ditahan ikut terkirim | |
| D4 | Ulangi D1 lalu pilih Batalkan | Entri hilang dari antrean; transaksi yang ditahan terkirim | |
| D5 | Nonaktifkan barang di Master (online) padahal ada antreannya | CONFLICT dengan penyebab barang nonaktif | |
| D6 | Login pengguna lain di perangkat yang sama (ada antrean pengguna pertama) | Antrean pengguna pertama TIDAK dikirim atas nama pengguna kedua; muncul catatan antrean milik pengguna lain | |
| D7 | Keluar (logout) saat ada antrean | Peringatan; data tetap ada dan terkirim setelah login kembali | |

## E. Service worker dan pembaruan

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| E1 | Chrome DevTools > Application > Service Workers | Terdaftar dan aktif | |
| E2 | Application > Cache Storage | Hanya berisi berkas aplikasi (JS/CSS/HTML/ikon); tidak ada respons dari supabase.co | |
| E3 | Application > IndexedDB > whistle | Tabel items, balances, outbox, meta ada; outbox berisi transaksi antrean | |
| E4 | Deploy versi baru lalu buka aplikasi | Versi baru termuat otomatis; antrean di IndexedDB tidak hilang | |

## Catatan perangkat

- HP / Android: 
- Versi Chrome: 
- Tanggal uji: 
- Penguji: 
- Temuan / masalah: 
