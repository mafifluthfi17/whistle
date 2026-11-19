// Membuat tests/TEST_CASES.md dari hasil NYATA vitest.
//   npx vitest run --reporter=json --outputFile=tests/.out/vitest.json
//   node scripts/gen-test-cases.mjs
// "Actual result" hanya berasal dari berkas JSON itu (otomatis) atau dari kolom Hasil yang diisi
// manusia pada tests/MANUAL_*.md (manual). Kolom yang kosong ditulis BELUM DIUJI, tidak pernah ditebak.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const jsonPath = process.argv[2] ?? join(root, 'tests/.out/vitest.json')
const outPath = join(root, 'tests/TEST_CASES.md')
if (!existsSync(jsonPath)) {
  console.error(`Tidak ada ${jsonPath}. Jalankan vitest dengan --reporter=json --outputFile dahulu.`)
  process.exit(2)
}
const report = JSON.parse(readFileSync(jsonPath, 'utf8'))
const BS = String.fromCharCode(92)
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** Semua kasus otomatis. */
const cases = []
for (const f of report.testResults) {
  const file = f.name.split(BS).join('/').split('/tests/')[1] ?? f.name
  for (const t of f.assertionResults) {
    cases.push({
      file,
      group: t.ancestorTitles.join(' > '),
      title: t.title,
      status: t.status === 'passed' ? 'LULUS' : t.status === 'failed' ? 'GAGAL' : 'DILEWATI',
      ms: Math.round(t.duration ?? 0),
      key: `${file} | ${t.ancestorTitles.join(' > ')} | ${t.title}`,
    })
  }
}

// ---- matriks kriteria Bagian 21 ------------------------------------------
// auto: ekspresi reguler atas "berkas | grup | judul". partial: bagian yang butuh perangkat/akun nyata.
const M = [
  ['Database dan keamanan', [
    ['Login beberapa pengguna', /rls\.test.*pengguna baru|rls\.test.*role dan pengguna|app\.test.*login/i],
    ['Validasi role', /rls\.test.*(hanya ADMIN|role dan pengguna|transaksi >)|engine\.test.*hak akses|app\.test.*menu menurut role/i],
    ['Pengujian RLS', /db\/rls\.test/],
    ['User nonaktif tidak dapat transaksi', /pengguna nonaktif|nonaktif, tanpa sesi|app\.test.*dinonaktifkan/i],
    ['Tidak ada akses tidak sah', /anon|tanpa sesi|tidak dapat ditulis langsung|VIEWER ditolak|hanya ADMIN yang boleh/i],
  ]],
  ['Master barang', [
    ['Import 1.000 SKU', /import\.test.*1\.000 SKU/],
    ['SKU duplikat ditolak', /SKU ganda|SKU yang sudah ada ditolak|SKU dan barcode duplikat/i],
    ['Barcode duplikat ditolak', /barcode duplikat|barcode bentrok/i],
    ['Data Excel valid', /productImport\.test/],
    ['Opening inventory benar', /OPENING|stok awal/],
  ]],
  ['Inventory accounting', [
    ['Pengujian saldo awal', /saldo awal \(OPENING\)/],
    ['Pembelian dengan harga berbeda', /contoh perhitungan wajib|campuran IN\/OUT/],
    ['Perhitungan Moving Average', /contoh perhitungan wajib|avg 6 desimal|rekonsiliasi ledger dengan stock_balances/],
    ['HPP barang keluar', /HPP/],
    ['Saldo akhir', /saldo akhir|kartu stok > saldo/i],
    ['Penolakan stok negatif', /menolak keluar melebihi stok|stok negatif|penolakan stok kurang/],
    ['Pengujian pembulatan', /pembulatan/],
    ['Rekonsiliasi ledger dengan stock balances', /rekonsiliasi/i],
  ]],
  ['Multi-user', [
    ['Dua pengguna mengeluarkan stok bersamaan', /dua OUT bersamaan|25 OUT/],
    ['Tidak boleh terjadi overselling', /tidak terjadi oversell|tepat 10 berhasil/],
    ['Tidak boleh terjadi double posting', /retry paralel|klik Posting dua kali/],
    ['Retry transaksi tidak menggandakan transaksi', /idempotensi|retry/i],
  ]],
  ['Hybrid', [
    ['Transaksi offline', /transaction\.test.*offline: dokumen masuk antrean|outbox\.test.*antrean offline: data yang disimpan/],
    ['Sinkronisasi', /db\/sync\.test/],
    ['Konflik stok', /db\/sync\.test.*(konflik|conflict|insufficient|stok)/i],
    ['Kegagalan jaringan', /jaringan/i],
    ['Pemulihan setelah koneksi kembali', /db\/sync\.test.*(pulih|kembali|retry|ulang|SYNCING|lanjut)/i],
  ]],
  ['Excel', [
    ['Download template', /template/i],
    ['Import massal', /productImport\.test/],
    ['Preview', /pratinjau|preview/i],
    ['Error report', /productImport\.test.*(galat|error|ditolak|invalid|tidak valid)/i],
    ['Export kartu stok', /(reportExcel|reports\.test).*Kartu Stok/i],
    ['Export valuation', /(reportExcel|reports\.test).*Valuation/i],
  ]],
]
const MANUAL_ONLY = [
  ['Android', 'Install PWA', /manifest memakai identitas WHISTLE|app shell dapat dibuka saat offline/, 'Konfigurasi manifest/ikon/service worker lulus tes dan smoke test situs live; PEMASANGAN di Android belum dicoba (MANUAL_ANDROID E1, MANUAL_OFFLINE A1).'],
  ['Android', 'Kamera', null, 'Izin dan pembukaan kamera di HP belum diuji (MANUAL_ANDROID A1-A8).'],
  ['Android', 'Scan barcode', /scanDecode\.test|upce\.test/, 'Decode dari gambar barcode sintetis lulus; pembacaan dari kamera/label fisik belum diuji (MANUAL_ANDROID B1-B10).'],
  ['Android', 'Scan QR', /scanDecode\.test.*QR/i, 'Decode QR dari gambar sintetis lulus; kamera nyata belum diuji (MANUAL_ANDROID B7-B9).'],
  ['Android', 'Input manual SKU', /transaction\.test.*(SKU tidak ditemukan saat mengetik manual|tidak ditambahkan dua kali)/, 'Perilaku input manual lulus tes UI (jsdom); belum dicoba di HP.'],
  ['Android', 'Pengujian offline', /transaction\.test.*(offline|jaringan putus)|catalog\.test/, 'Logika offline lulus tes (fake-indexeddb/jsdom); mode pesawat di perangkat nyata belum diuji (MANUAL_OFFLINE).'],
]

function evalCriterion(re) {
  const hit = re ? cases.filter((c) => re.test(c.key)) : []
  const failed = hit.filter((c) => c.status === 'GAGAL').length
  return { n: hit.length, failed, status: !hit.length ? 'BELUM DIUJI' : failed ? 'GAGAL' : 'LULUS' }
}

// ---- kasus manual dari berkas MANUAL_*.md ------------------------------------
function manualCases(rel, label) {
  const p = join(root, rel)
  if (!existsSync(p)) return []
  const out = []
  let section = ''
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const h = line.match(/^## (.+)/)
    if (h) section = h[1].trim()
    const m = line.match(/^\| ([A-Z]\d+) \|(.+)\|\s*$/)
    if (!m) continue
    const cells = m[2].split(/(?<!\\)\|/).map((s) => s.trim())
    let step, expected, actual
    if (cells.length >= 5) {
      // tabel format barcode: Format | Nilai uji | Terbaca? | Nilai tampil | Hasil
      step = `${cells[0]} ${cells[1]}`
      expected = cells[2] || `Terbaca sebagai ${cells[1]}`
      actual = cells[4] || cells[3]
    } else {
      ;[step, expected, actual] = [cells[0], cells[1], cells[2]]
    }
    out.push({ id: m[1], label, section, step, expected, actual: actual && actual.length ? actual : '' })
  }
  return out
}
const manual = [...manualCases('tests/MANUAL_ANDROID.md', 'Android'), ...manualCases('tests/MANUAL_OFFLINE.md', 'Offline')]

// ---- tulis dokumen -------------------------------------------------------------
const total = cases.length
const passed = cases.filter((c) => c.status === 'LULUS').length
const failedN = cases.filter((c) => c.status === 'GAGAL').length
const when = new Date(report.startTime ?? Date.now()).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' })
const byFile = new Map()
for (const c of cases) byFile.set(c.file, [...(byFile.get(c.file) ?? []), c])

const L = []
L.push('# WHISTLE: Test Case dan Hasil Pengujian', '')
L.push('**Warehouse Inventory, Stock Tracking & Ledger Engine**', '', '*Smart Stock. Accurate Value. Total Control*', '')
L.push('> Dokumen ini DIBUAT OTOMATIS oleh `scripts/gen-test-cases.mjs` dari hasil nyata `vitest`. Jangan diedit tangan: ubah tes atau kolom Hasil di `tests/MANUAL_*.md`, lalu buat ulang.', '')
L.push('## 1. Ringkasan', '')
L.push(`- Dijalankan: ${when} (Asia/Jakarta)`)
L.push(`- Tes otomatis: **${passed} lulus dari ${total}**, ${failedN} gagal, ${total - passed - failedN} dilewati, ${byFile.size} berkas`)
const mTested = manual.filter((m) => m.actual).length
L.push(`- Kasus manual (perangkat nyata): **${mTested} dari ${manual.length} sudah diisi hasilnya**; sisanya BELUM DIUJI`)
L.push('- Perintah: `npm test` (Vitest). Tes database memakai PostgreSQL sungguhan (embedded-postgres) dan PGlite; tes UI memakai jsdom + Testing Library dengan layanan jaringan di-mock.')
L.push('- Cara membaca: pada kasus otomatis, **judul kasus = expected result** (perilaku yang ditegaskan tes) dan **actual result = status hasil proses tes**. Status: LULUS, GAGAL, SEBAGIAN (bagian otomatis lulus, bagian perangkat nyata belum), BELUM DIUJI.', '')

L.push('## 2. Matriks kriteria penerimaan (MASTER_PROMPT Bagian 21)', '')
L.push('| Area | Kriteria | Expected result | Actual result | Jumlah tes |', '|---|---|---|---|---|')
for (const [area, items] of M) {
  for (const [name, re] of items) {
    const r = evalCriterion(re)
    L.push(`| ${area} | ${name} | Seluruh tes terkait lulus | ${r.status} | ${r.n} |`)
  }
}
for (const [area, name, re, note] of MANUAL_ONLY) {
  const r = evalCriterion(re)
  const status = r.failed ? 'GAGAL' : r.n ? 'SEBAGIAN' : 'BELUM DIUJI'
  L.push(`| ${area} | ${name} | Berfungsi di perangkat Android | ${status}: ${esc(note)} | ${r.n} |`)
}
L.push('')

L.push('## 3. Kasus uji manual (perangkat Android nyata)', '')
L.push('Langkah lengkap ada di [MANUAL_ANDROID.md](MANUAL_ANDROID.md) dan [MANUAL_OFFLINE.md](MANUAL_OFFLINE.md). Hasil di bawah hanya yang benar-benar diisi pada berkas itu; kosong = **BELUM DIUJI**.', '')
L.push('| Berkas | ID | Bagian | Langkah | Expected result | Actual result |', '|---|---|---|---|---|---|')
for (const m of manual) {
  L.push(`| ${m.label} | ${m.id} | ${esc(m.section)} | ${esc(m.step)} | ${esc(m.expected)} | ${m.actual ? esc(m.actual) : 'BELUM DIUJI'} |`)
}
L.push('')

L.push('## 4. Seluruh kasus uji otomatis', '')
for (const [file, list] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
  const ok = list.filter((c) => c.status === 'LULUS').length
  L.push(`### ${file} (${ok}/${list.length} lulus)`, '')
  L.push('| No | Kelompok | Expected result | Actual result |', '|---|---|---|---|')
  list.forEach((c, i) => L.push(`| ${i + 1} | ${esc(c.group)} | ${esc(c.title)} | ${c.status} (${c.ms} ms) |`))
  L.push('')
}

L.push('## 5. Yang belum teruji', '')
L.push('- Layar dengan login sungguhan ke Supabase produksi (tes UI memakai layanan palsu; alur database diuji terpisah pada Postgres sungguhan).')
L.push('- Layar Kartu Stok, Laporan, Audit Trail, dan Import/Export belum punya tes antarmuka; logika datanya (SQL dan Excel) teruji.')
L.push('- Kamera dan scanner di HP, instalasi PWA di Android, mode pesawat, dan dua perangkat bersamaan (lihat bagian 3).')
L.push('- Restore dari file backup sangat besar (di atas sekitar 8 MB) lewat RPC; batas ukuran permintaan server belum diukur.')
L.push('- Backup otomatis Supabase tidak aktif (Free Plan); hanya backup manual dari aplikasi.')
writeFileSync(outPath, L.join('\n') + '\n', 'utf8')
console.log(`Ditulis ${outPath}: ${total} kasus otomatis, ${manual.length} kasus manual`)
