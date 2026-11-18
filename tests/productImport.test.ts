import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { averageCost, parseDecimal, valueMatchesAverage } from '../src/utils/decimal'
import {
  COLUMNS,
  parseWorkbook,
  summarize,
  validateRows,
  type ExistingKeys,
  type ImportMode,
  type RawRow,
} from '../src/utils/productImport'
import {
  buildProductsWorkbook,
  buildTemplateWorkbook,
  exportFileName,
  jakartaDate,
  workbookToBuffer,
  type ExportProduct,
} from '../src/utils/productExcel'

const NO_EXISTING: ExistingKeys = { skus: new Set(), barcodes: new Map() }

/** Buat file xlsx dari baris-baris sel (sel string selalu teks). */
function makeXlsx(rows: (string | number | undefined)[][], header: readonly string[] = COLUMNS): Uint8Array {
  const aoa = [[...header], ...rows]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'MASTER_BARANG')
  return workbookToBuffer(wb)
}

function row(over: Partial<Record<(typeof COLUMNS)[number], string | number>> = {}): (string | number | undefined)[] {
  const base: Record<string, string | number | undefined> = {
    SKU: 'SKU-1', BARCODE: undefined, NAMA_BARANG: 'Barang', KATEGORI: undefined, MEREK: undefined,
    SATUAN: 'PCS', LOKASI_GUDANG: undefined, STOK_AWAL: undefined, NILAI_PERSEDIAAN_AWAL: undefined,
    HARGA_RATA_RATA_AWAL: undefined, MINIMUM_STOCK: undefined, ...over,
  }
  return COLUMNS.map((c) => base[c])
}

function validate(rows: (string | number | undefined)[][], mode: ImportMode = 'NEW', existing = NO_EXISTING) {
  const parsed = parseWorkbook(makeXlsx(rows))
  expect(parsed.errors).toEqual([])
  return validateRows(parsed.rows, mode, existing)
}

describe('decimal', () => {
  it('menghitung rata-rata awal presisi 6 desimal tanpa float', () => {
    expect(averageCost('1600000', '150')).toBe('10666.666667')
    expect(averageCost('1000000', '100')).toBe('10000.000000')
    expect(averageCost('1', '3')).toBe('0.333333')
    expect(averageCost('2', '3')).toBe('0.666667')
  })

  it('menerima angka valid dan menolak format ambigu atau rusak', () => {
    const o = { maxScale: 4, maxIntDigits: 16 }
    expect(parseDecimal('10,5', o)).toEqual({ ok: true, value: '10.5' })
    expect(parseDecimal(10.5, o)).toEqual({ ok: true, value: '10.5' })
    expect(parseDecimal('1.50000', o)).toEqual({ ok: true, value: '1.5' })
    expect(parseDecimal(0.1 + 0.2, { maxScale: 6, maxIntDigits: 10 })).toEqual({ ok: true, value: '0.3' })
    expect(parseDecimal('1.000', o).ok).toBe(false) // ribuan atau desimal?
    expect(parseDecimal('1.234.567', o).ok).toBe(false)
    expect(parseDecimal('abc', o).ok).toBe(false)
    expect(parseDecimal('-1', o).ok).toBe(false)
    expect(parseDecimal('1.23456', o).ok).toBe(false)
    expect(parseDecimal('1e5', o).ok).toBe(false)
    expect(parseDecimal('9'.repeat(17), o).ok).toBe(false)
  })

  it('memeriksa kesesuaian nilai dengan qty × rata-rata dalam toleransi pembulatan', () => {
    expect(valueMatchesAverage('1600000', '150', '10666.666667')).toBe(true)
    expect(valueMatchesAverage('1600000', '150', '10666.67')).toBe(true)
    expect(valueMatchesAverage('1600000', '150', '11000')).toBe(false)
  })
})

describe('template Excel', () => {
  const wb = buildTemplateWorkbook()

  it('memiliki dua sheet: MASTER_BARANG dan PETUNJUK', () => {
    expect(wb.SheetNames).toEqual(['MASTER_BARANG', 'PETUNJUK'])
  })

  it('kolom MASTER_BARANG sesuai spesifikasi dan berurutan', () => {
    const ws = wb.Sheets.MASTER_BARANG
    const header = COLUMNS.map((_, c) => ws[XLSX.utils.encode_cell({ r: 0, c })].v)
    expect(header).toEqual([
      'SKU', 'BARCODE', 'NAMA_BARANG', 'KATEGORI', 'MEREK', 'SATUAN', 'LOKASI_GUDANG',
      'STOK_AWAL', 'NILAI_PERSEDIAAN_AWAL', 'HARGA_RATA_RATA_AWAL', 'MINIMUM_STOCK',
    ])
  })

  it('kolom SKU dan BARCODE sudah berformat Teks', () => {
    const ws = wb.Sheets.MASTER_BARANG
    expect(ws.A2.z).toBe('@')
    expect(ws.B2.z).toBe('@')
    expect(ws.A1001.t).toBe('s')
  })

  it('PETUNJUK memuat petunjuk, contoh, format, kolom wajib, dan validasi', () => {
    const text = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets.PETUNJUK, { header: 1 }))
    for (const k of ['PETUNJUK UMUM', 'FORMAT', 'WAJIB', 'VALIDASI DATA', 'CONTOH DATA', 'NILAI_PERSEDIAAN_AWAL']) {
      expect(text).toContain(k)
    }
  })

  it('template kosong dapat dibaca kembali dan hasilnya tidak ada baris', () => {
    const parsed = parseWorkbook(workbookToBuffer(wb))
    expect(parsed.errors).toEqual(['Tidak ada data pada sheet MASTER_BARANG'])
  })
})

describe('parseWorkbook', () => {
  it('mempertahankan SKU dan barcode bernol di depan sebagai teks', () => {
    const parsed = parseWorkbook(makeXlsx([row({ SKU: '00123', BARCODE: '0001234567890' })]))
    expect(parsed.rows[0].cells.SKU).toBe('00123')
    expect(parsed.rows[0].cells.BARCODE).toBe('0001234567890')
    expect(parsed.rows[0].numericTextColumns).toEqual([])
  })

  it('SKU/barcode angka murni tidak berubah menjadi notasi ilmiah dan diberi peringatan', () => {
    const [r] = validate([row({ SKU: 123, BARCODE: 8999999000011 })])
    expect(r.payload?.sku).toBe('123')
    expect(r.payload?.barcode).toBe('8999999000011')
    expect(r.warnings.join(' ')).toMatch(/nol di depan/)
  })

  it('menolak file tanpa sheet MASTER_BARANG', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A']]), 'Sheet1')
    const parsed = parseWorkbook(workbookToBuffer(wb))
    expect(parsed.errors[0]).toMatch(/MASTER_BARANG.*tidak ditemukan/)
  })

  it('menolak kolom yang hilang dan memperingatkan kolom tak dikenal', () => {
    const parsed = parseWorkbook(makeXlsx([['A', 'B']], ['SKU', 'NAMA_BARANG']))
    expect(parsed.errors[0]).toMatch(/Kolom wajib tidak ditemukan.*BARCODE/)
    const extra = parseWorkbook(makeXlsx([row()].map((r) => [...r, 'x']), [...COLUMNS, 'CATATAN']))
    expect(extra.errors).toEqual([])
    expect(extra.warnings[0]).toMatch(/CATATAN/)
  })

  it('header tidak peka huruf besar/kecil dan urutan kolom bebas', () => {
    const header = ['nama_barang', ' sku ', 'Satuan', 'barcode', 'kategori', 'merek', 'lokasi_gudang', 'stok_awal', 'nilai_persediaan_awal', 'harga_rata_rata_awal', 'minimum_stock']
    const parsed = parseWorkbook(makeXlsx([['Nama', 'S-1', 'PCS']], header))
    expect(parsed.errors).toEqual([])
    expect(parsed.rows[0].cells).toMatchObject({ SKU: 'S-1', NAMA_BARANG: 'Nama', SATUAN: 'PCS' })
  })

  it('melewati baris kosong dan memberi nomor baris Excel yang benar', () => {
    const parsed = parseWorkbook(makeXlsx([row({ SKU: 'A' }), [], row({ SKU: 'B' })]))
    expect(parsed.rows.map((r) => [r.cells.SKU, r.rowNumber])).toEqual([['A', 2], ['B', 4]])
  })

  it('file rusak ditolak dengan pesan yang jelas', () => {
    const parsed = parseWorkbook(new Uint8Array([1, 2, 3, 4]))
    expect(parsed.errors.length).toBe(1)
  })
})

describe('validateRows: mode barang baru', () => {
  it('baris valid menghasilkan payload bersih', () => {
    const [r] = validate([row({ SKU: ' 00123 ', BARCODE: '899', KATEGORI: 'Minuman', MINIMUM_STOCK: 5 })])
    expect(r.errors).toEqual([])
    expect(r.payload).toEqual({ sku: '00123', barcode: '899', product_name: 'Barang', category: 'Minuman', unit: 'PCS', minimum_stock: '5' })
  })

  it('SKU, NAMA_BARANG, dan SATUAN wajib', () => {
    const [r] = validate([row({ SKU: '', NAMA_BARANG: '', SATUAN: '', KATEGORI: 'Minuman' })])
    expect(r.errors).toEqual(expect.arrayContaining(['SKU wajib diisi', 'NAMA_BARANG wajib diisi', 'SATUAN wajib diisi']))
  })

  it('SKU duplikat dan barcode duplikat di dalam file ditandai di baris kedua', () => {
    const res = validate([row({ SKU: 'A', BARCODE: '1' }), row({ SKU: 'A', BARCODE: '2' }), row({ SKU: 'B', BARCODE: '1' })])
    expect(res[0].errors).toEqual([])
    expect(res[1].errors.join()).toMatch(/SKU "A" duplikat dengan baris 2/)
    expect(res[2].errors.join()).toMatch(/Barcode "1" duplikat dengan baris 2/)
  })

  it('bentrok dengan data yang sudah ada di database', () => {
    const existing: ExistingKeys = { skus: new Set(['ADA']), barcodes: new Map([['999', 'LAIN']]) }
    const res = validate([row({ SKU: 'ADA' }), row({ SKU: 'BARU', BARCODE: '999' })], 'NEW', existing)
    expect(res[0].errors.join()).toMatch(/sudah terdaftar/)
    expect(res[1].errors.join()).toMatch(/sudah dipakai SKU "LAIN"/)
  })

  it('angka tidak valid ditolak dengan nama kolom', () => {
    const [r] = validate([row({ MINIMUM_STOCK: 'abc', STOK_AWAL: -1 })])
    expect(r.errors.join()).toMatch(/MINIMUM_STOCK.*format angka/)
    expect(r.errors.join()).toMatch(/STOK_AWAL.*negatif/)
  })

  it('panjang berlebih dan sel error Excel ditolak', () => {
    const [r] = validate([row({ SKU: 'x'.repeat(65) })])
    expect(r.errors.join()).toMatch(/SKU: maksimal 64/)
  })
})

describe('validateRows: aturan stok awal (opening inventory)', () => {
  it('stok > 0 wajib punya nilai persediaan', () => {
    const [r] = validate([row({ STOK_AWAL: 10 })])
    expect(r.errors.join()).toMatch(/NILAI_PERSEDIAAN_AWAL wajib/)
  })

  it('rata-rata awal = nilai / stok (contoh 150 unit, Rp1.600.000)', () => {
    const [r] = validate([row({ STOK_AWAL: 150, NILAI_PERSEDIAAN_AWAL: 1600000 })])
    expect(r.errors).toEqual([])
    expect(r.derivedAverage).toBe('10666.666667')
    expect(r.payload).toMatchObject({ opening_quantity: '150', opening_value: '1600000' })
  })

  it('HARGA_RATA_RATA_AWAL yang diisi harus konsisten', () => {
    expect(validate([row({ STOK_AWAL: 150, NILAI_PERSEDIAAN_AWAL: 1600000, HARGA_RATA_RATA_AWAL: 10666.666667 })])[0].errors).toEqual([])
    const bad = validate([row({ STOK_AWAL: 150, NILAI_PERSEDIAAN_AWAL: 1600000, HARGA_RATA_RATA_AWAL: 12000 })])[0]
    expect(bad.errors.join()).toMatch(/tidak sama dengan STOK_AWAL × HARGA_RATA_RATA_AWAL/)
  })

  it('stok 0 atau kosong mensyaratkan nilai 0', () => {
    expect(validate([row({ STOK_AWAL: 0, NILAI_PERSEDIAAN_AWAL: 0 })])[0].errors).toEqual([])
    expect(validate([row()])[0].payload?.opening_quantity).toBeUndefined()
    expect(validate([row({ STOK_AWAL: 0, NILAI_PERSEDIAAN_AWAL: 500 })])[0].errors.join()).toMatch(/harus 0 jika STOK_AWAL 0/)
    expect(validate([row({ NILAI_PERSEDIAAN_AWAL: 500 })])[0].errors.join()).toMatch(/harus 0/)
  })

  it('nilai persediaan negatif ditolak', () => {
    expect(validate([row({ STOK_AWAL: 5, NILAI_PERSEDIAAN_AWAL: -100 })])[0].errors.join()).toMatch(/negatif/)
  })

  it('pecahan qty dan nilai dipertahankan presisinya', () => {
    const [r] = validate([row({ STOK_AWAL: '2,5', NILAI_PERSEDIAAN_AWAL: '25000,5' })])
    expect(r.errors).toEqual([])
    expect(r.payload).toMatchObject({ opening_quantity: '2.5', opening_value: '25000.5' })
  })
})

describe('validateRows: mode update master', () => {
  const existing: ExistingKeys = { skus: new Set(['A', 'B']), barcodes: new Map([['111', 'A']]) }

  it('hanya SKU yang wajib; kolom kosong tidak dikirim', () => {
    const [r] = validate([row({ SKU: 'A', NAMA_BARANG: '', SATUAN: '', KATEGORI: 'Baru' })], 'UPDATE', existing)
    expect(r.errors).toEqual([])
    expect(r.payload).toEqual({ sku: 'A', category: 'Baru' })
  })

  it('SKU yang belum terdaftar ditolak', () => {
    const [r] = validate([row({ SKU: 'Z' })], 'UPDATE', existing)
    expect(r.errors.join()).toMatch(/belum terdaftar/)
  })

  it('kolom stok awal diabaikan dengan peringatan dan tidak masuk payload', () => {
    const [r] = validate([row({ SKU: 'A', STOK_AWAL: 99, NILAI_PERSEDIAAN_AWAL: 999 })], 'UPDATE', existing)
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toMatch(/diabaikan/)
    expect(r.payload?.opening_quantity).toBeUndefined()
    expect(r.payload?.opening_value).toBeUndefined()
  })

  it('barcode milik SKU yang sama boleh, milik SKU lain ditolak', () => {
    expect(validate([row({ SKU: 'A', BARCODE: '111' })], 'UPDATE', existing)[0].errors).toEqual([])
    expect(validate([row({ SKU: 'B', BARCODE: '111' })], 'UPDATE', existing)[0].errors.join()).toMatch(/sudah dipakai SKU "A"/)
  })
})

describe('1.000 SKU', () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const k = String(i + 1).padStart(5, '0')
      return row({ SKU: `SKU-${k}`, BARCODE: `89990000${k}`, KATEGORI: `Kat ${i % 10}`, STOK_AWAL: 10, NILAI_PERSEDIAAN_AWAL: 100000 })
    })

  it('1.000 baris valid dibaca dan divalidasi cepat tanpa error', () => {
    const start = Date.now()
    const parsed = parseWorkbook(makeXlsx(make(1000)))
    const res = validateRows(parsed.rows, 'NEW', NO_EXISTING)
    expect(summarize(res)).toEqual({ total: 1000, valid: 1000, invalid: 0 })
    expect(Date.now() - start).toBeLessThan(10_000)
  })

  it('duplikat di antara 1.000 baris terdeteksi dan baris lain tetap valid', () => {
    const rows = make(1000)
    rows[500] = row({ SKU: 'SKU-00001', BARCODE: '5' }) // SKU duplikat baris 2
    rows[900] = row({ SKU: 'UNIK', BARCODE: '89990000' + '00002' }) // barcode duplikat
    const res = validateRows(parseWorkbook(makeXlsx(rows)).rows, 'NEW', NO_EXISTING)
    expect(summarize(res)).toEqual({ total: 1000, valid: 998, invalid: 2 })
    expect(res[500].errors.join()).toMatch(/SKU "SKU-00001" duplikat dengan baris 2/)
    expect(res[900].errors.join()).toMatch(/Barcode.*duplikat/)
  })

  it('lebih dari 5000 baris ditolak', () => {
    const parsed = parseWorkbook(makeXlsx(Array.from({ length: 5001 }, (_, i) => row({ SKU: `S${i}` }))))
    expect(parsed.errors[0]).toMatch(/Maksimal 5000/)
  })
})

describe('export master barang', () => {
  const products: ExportProduct[] = [
    { sku: '00123', barcode: '0001234567890', product_name: 'Air Mineral', category: 'Minuman', brand: null, unit: 'PCS', location: 'A-01', minimum_stock: '20.5', is_active: true },
    { sku: '1E5', barcode: null, product_name: 'Barang SKU Angka', category: null, brand: 'X', unit: 'DUS', location: null, minimum_stock: 0, is_active: false },
  ]

  it('SKU dan barcode tetap teks dengan nol di depan', () => {
    const ws = buildProductsWorkbook(products).Sheets.MASTER_BARANG
    expect(ws.A2).toMatchObject({ t: 's', v: '00123', z: '@' })
    expect(ws.B2).toMatchObject({ t: 's', v: '0001234567890', z: '@' })
    expect(ws.A3).toMatchObject({ t: 's', v: '1E5' }) // tidak dibaca sebagai 1×10^5
  })

  it('kolom angka bertipe numerik dan status terpisah dari kuantitas', () => {
    const ws = buildProductsWorkbook(products).Sheets.MASTER_BARANG
    expect(ws.H2).toMatchObject({ t: 'n', v: 20.5 })
    expect(ws.I2.v).toBe('AKTIF')
    expect(ws.I3.v).toBe('NONAKTIF')
  })

  it('hasil export dapat dibaca kembali sama persis (round-trip)', () => {
    const buf = workbookToBuffer(buildProductsWorkbook(products))
    const wb = XLSX.read(buf, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets.MASTER_BARANG, { raw: true })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ SKU: '00123', BARCODE: '0001234567890', MINIMUM_STOCK: 20.5, STATUS: 'AKTIF' })
    expect(rows[1].SKU).toBe('1E5')
  })

  it('nama file memuat tanggal Asia/Jakarta', () => {
    // 2026-11-18 20:00 UTC = 19 Nov 03:00 WIB
    expect(jakartaDate(new Date('2026-11-18T20:00:00Z'))).toBe('2026-11-19')
    expect(exportFileName(new Date('2026-11-18T20:00:00Z'))).toBe('WHISTLE_Master_Barang_2026-11-19.xlsx')
  })

  it('export dengan 1.000 produk memiliki jumlah baris yang sama', () => {
    const many: ExportProduct[] = Array.from({ length: 1000 }, (_, i) => ({
      sku: String(i).padStart(6, '0'), barcode: null, product_name: `B${i}`, category: null, brand: null,
      unit: 'PCS', location: null, minimum_stock: 0, is_active: true,
    }))
    const wb = XLSX.read(workbookToBuffer(buildProductsWorkbook(many)), { type: 'array' })
    expect(XLSX.utils.sheet_to_json(wb.Sheets.MASTER_BARANG)).toHaveLength(1000)
  })
})

// Pastikan tipe RawRow tetap diekspor untuk komponen UI
export type _Unused = RawRow
