# Uji manual Android: scanner barcode dan QR (FASE 6)

Dikerjakan di HP Android nyata. Logika pencarian dan pembacaan kode sudah diuji otomatis (`npm test`),
tetapi **kamera, izin, senter, dan fokus hanya dapat diuji di perangkat**.

**Persiapan**
- Buka aplikasi dari alamat HTTPS: https://whistle-id.github.io/whistle/ (kamera tidak berfungsi di http).
- Login sebagai ADMIN atau WAREHOUSE. Siapkan beberapa barang di Master Barang dengan barcode terisi.
- Siapkan label uji untuk setiap format (cetak atau tampilkan di layar lain): EAN-13, EAN-8, UPC-A, UPC-E,
  Code 128, Code 39, QR Code. Generator gratis: https://barcode.tec-it.com atau bwip-js.playground.
- Browser utama: Chrome Android versi terbaru. Catat versi Chrome dan tipe HP di tabel hasil.

Isi kolom **Hasil** dengan LULUS / GAGAL dan catatan. Jangan mengisi LULUS untuk yang tidak dicoba.

## A. Izin dan pembukaan kamera

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| A1 | Barang Masuk > "Scan Barcode / QR dengan Kamera" > Mulai Scan, pertama kali | Browser meminta izin kamera; setelah Izinkan, pratinjau kamera tampil | |
| A2 | Periksa kamera yang terbuka | Kamera **belakang** terbuka secara default | |
| A3 | Tolak izin kamera (Blokir) lalu Mulai Scan | Pesan "Izin kamera ditolak..." muncul; kolom ketik SKU manual tetap tersedia | |
| A4 | Setelan situs > izinkan Kamera, tekan Coba Lagi | Kamera terbuka tanpa muat ulang halaman | |
| A5 | Buka aplikasi lewat http:// (bukan https) atau dari alamat IP lokal | Pesan "hanya dapat dipakai lewat HTTPS" | |
| A6 | Buka aplikasi lain yang memakai kamera, lalu Mulai Scan | Pesan kamera sedang dipakai aplikasi lain | |
| A7 | Hentikan Scan, lalu tutup panel | Indikator kamera Android (titik hijau) hilang; kamera tidak menyala di latar | |
| A8 | Pindah aplikasi/kunci layar saat scan, lalu kembali | Kamera dapat dilanjutkan dengan Mulai Scan; tidak ada error | |

## B. Format barcode (arahkan kamera 10-20 cm dari label)

| # | Format | Nilai uji | Terbaca? | Nilai yang tampil | Hasil |
|---|---|---|---|---|---|
| B1 | EAN-13 | 4006381333931 | | | |
| B2 | EAN-8 | 96385074 | | | |
| B3 | UPC-A | 042100005264 | | | |
| B4 | UPC-E | 04252614 | | | |
| B5 | Code 128 | SKU-0001 | | | |
| B6 | Code 39 | ABC-123 | | | |
| B7 | QR Code (teks) | SKU-0001 | | | |
| B8 | QR Code (JSON) | {"sku":"SKU-9"} | | | |
| B9 | QR Code (URL) | https://contoh.id/p?sku=SKU-77 | | | |
| B10 | Barcode ITF / Data Matrix | (format tidak didukung) | Tidak terbaca (diabaikan) | | |

Catatan UPC-E: pembaca UPC-E bawaan ZXing rusak dan sudah ditambal di aplikasi (`src/utils/upcePatch.ts`).
Hasil patch teruji dengan gambar sintetis, **belum dengan kamera nyata**, jadi B4 wajib dicoba.

## C. Alur setelah scan

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| C1 | Scan barcode barang yang terdaftar | Muncul nama barang, SKU, dan stok terakhir; kolom quantity siap diisi | |
| C2 | Pada Barang Keluar, scan barang yang punya stok | Average cost tampil; isi quantity > stok menampilkan "Melebihi stok tersedia" | |
| C3 | Isi quantity (dan harga beli di Barang Masuk), tekan Tambahkan ke dokumen | Barang masuk ke daftar dokumen; kamera siap memindai barang berikutnya | |
| C4 | Scan barang yang sama dua kali | Quantity digabung pada satu baris, bukan baris ganda | |
| C5 | Scan kode yang tidak terdaftar | Notifikasi "SKU atau barcode ... tidak ditemukan"; scanner tetap berjalan | |
| C6 | Scan barang nonaktif | Notifikasi barang nonaktif; tidak dapat ditambahkan | |
| C7 | Scan UPC-A yang di master tersimpan sebagai EAN-13 berawalan 0 (atau sebaliknya) | Barang tetap ditemukan | |
| C8 | Scan Code 39 untuk SKU yang di master memakai huruf kecil | Barang ditemukan (pencarian tidak peka huruf) | |
| C9 | Scan satu label terus menerus selama 3 detik | Hanya satu pencarian/bunyi per kode (tidak berulang-ulang) | |
| C10 | Lanjutkan Pratinjau lalu Posting | Transaksi terposting; saldo di hasil sama dengan yang diharapkan | |

## D. Senter, kamera lain, dan kondisi sulit

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| D1 | Ruangan gelap: periksa tombol Nyalakan Senter | Tombol tampil bila HP mendukung; senter menyala/mati. Bila tidak didukung, tombol tidak tampil | |
| D2 | HP dengan beberapa kamera: pilih kamera dari daftar | Pilihan kamera muncul; berpindah kamera berhasil | |
| D3 | Label kusut/silau/miring | Tetap terbaca dalam beberapa detik atau tidak menghasilkan kode salah | |
| D4 | Putar HP landscape/portrait | Pratinjau tetap benar dan scan berfungsi | |
| D5 | Matikan internet lalu scan | Scan tetap membuka kamera; pencarian gagal dengan pesan jelas (offline penuh di FASE 8) | |
| D6 | Input manual: ketik SKU/barcode di kolom manual | Barang ditemukan sama seperti hasil scan | |

## E. PWA (dipakai bersama FASE 10)

| # | Langkah | Hasil yang diharapkan | Hasil |
|---|---|---|---|
| E1 | Pasang aplikasi ke layar utama lalu buka sebagai PWA | Kamera tetap dapat diizinkan dan berfungsi di mode PWA | |

## Catatan perangkat

- HP / Android: 
- Versi Chrome: 
- Tanggal uji: 
- Penguji: 
- Temuan / masalah: 
