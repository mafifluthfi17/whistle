import * as XLSX from 'xlsx'
import { COLUMNS, SHEET_GUIDE, SHEET_MASTER } from './productImport'

const TEMPLATE_PREFORMATTED_ROWS = 1000

/** Tanggal (YYYY-MM-DD) dalam zona waktu Asia/Jakarta, untuk nama file. */
export function jakartaDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)
}

function textCell(v: string): XLSX.CellObject {
  return { t: 's', v, z: '@' }
}

// ---------------------------------------------------------------------------
// Template import
// ---------------------------------------------------------------------------
export function buildTemplateWorkbook(): XLSX.WorkBook {
  const master: XLSX.WorkSheet = {}
  COLUMNS.forEach((name, c) => {
    master[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: name }
  })
  // Kolom SKU dan BARCODE diformat Teks agar nol di depan tidak hilang saat diketik
  for (let r = 1; r <= TEMPLATE_PREFORMATTED_ROWS; r++) {
    for (const key of ['SKU', 'BARCODE'] as const) {
      master[XLSX.utils.encode_cell({ r, c: COLUMNS.indexOf(key) })] = textCell('')
    }
  }
  master['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: TEMPLATE_PREFORMATTED_ROWS, c: COLUMNS.length - 1 } })
  master['!cols'] = COLUMNS.map((n) => ({ wch: Math.max(14, n.length + 2) }))

  const guide = XLSX.utils.aoa_to_sheet([
    ['PETUNJUK PENGISIAN: WHISTLE (Smart Stock. Accurate Value. Total Control)'],
    [],
    ['PETUNJUK UMUM'],
    ['1. Isi data pada sheet MASTER_BARANG mulai baris 2. Jangan mengubah, menambah, atau menghapus nama kolom di baris 1.'],
    ['2. Kolom SKU dan BARCODE sudah berformat Teks. Jangan diubah menjadi Angka agar nol di depan tidak hilang.'],
    ['3. Simpan sebagai .xlsx lalu unggah di menu Import/Export. Anda akan melihat pratinjau dan error per baris sebelum data disimpan.'],
    ['4. Mode "Barang baru" menambah barang. Mode "Update master" mengubah barang yang sudah ada dan TIDAK mengubah saldo persediaan.'],
    ['5. Pada mode Update master, sel yang dikosongkan berarti data tidak diubah.'],
    [],
    ['KOLOM', 'WAJIB', 'FORMAT', 'KETERANGAN'],
    ['SKU', 'Ya', 'Teks, maks 64 karakter', 'Kode unik barang. Tidak boleh duplikat.'],
    ['BARCODE', 'Tidak', 'Teks, maks 64 karakter', 'Unik jika diisi. Biarkan kosong jika tidak ada.'],
    ['NAMA_BARANG', 'Ya (barang baru)', 'Teks, maks 200 karakter', ''],
    ['KATEGORI', 'Tidak', 'Teks', ''],
    ['MEREK', 'Tidak', 'Teks', ''],
    ['SATUAN', 'Ya (barang baru)', 'Teks, mis. PCS, DUS, KG', ''],
    ['LOKASI_GUDANG', 'Tidak', 'Teks', 'Mis. rak atau lorong.'],
    ['STOK_AWAL', 'Tidak', 'Angka ≥ 0, maks 4 desimal', 'Kosong dianggap 0. Hanya untuk barang baru.'],
    ['NILAI_PERSEDIAAN_AWAL', 'Ya jika STOK_AWAL > 0', 'Angka ≥ 0, maks 2 desimal', 'Total nilai (Rp), bukan harga satuan. Harus 0 jika STOK_AWAL 0.'],
    ['HARGA_RATA_RATA_AWAL', 'Tidak', 'Angka ≥ 0, maks 6 desimal', 'Opsional. Dihitung otomatis = NILAI / STOK. Jika diisi harus sesuai.'],
    ['MINIMUM_STOCK', 'Tidak', 'Angka ≥ 0, maks 4 desimal', 'Batas stok minimum untuk laporan Low Stock. Kosong dianggap 0.'],
    [],
    ['VALIDASI DATA'],
    ['• SKU dan barcode tidak boleh duplikat, baik di dalam file maupun terhadap data yang sudah ada.'],
    ['• Angka ditulis tanpa pemisah ribuan. Gunakan titik atau koma untuk desimal (mis. 10.5).'],
    ['• Nilai persediaan tidak boleh negatif.'],
    ['• Setiap SKU hanya memiliki satu saldo awal. Saldo awal diposting sebagai transaksi OPENING setelah mesin Moving Average aktif.'],
    ['• Maksimal 5000 baris per file.'],
    [],
    ['CONTOH DATA'],
    [...COLUMNS],
    ['00123', '8999999000011', 'Air Mineral 600ml', 'Minuman', 'AquaX', 'PCS', 'A-01', 100, 1000000, '', 20],
    ['SKU-0002', '', 'Kopi Sachet', 'Minuman', 'KopiKu', 'DUS', 'B-02', 0, 0, '', 5],
    ['SKU-0003', '8999999000028', 'Gula Pasir 1kg', 'Sembako', '', 'KG', 'C-03', 50, 750000, 15000, 10],
  ])
  guide['!cols'] = [{ wch: 26 }, { wch: 22 }, { wch: 28 }, { wch: 70 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, master, SHEET_MASTER)
  XLSX.utils.book_append_sheet(wb, guide, SHEET_GUIDE)
  return wb
}

// ---------------------------------------------------------------------------
// Export master barang
// ---------------------------------------------------------------------------
export interface ExportProduct {
  sku: string
  barcode: string | null
  product_name: string
  category: string | null
  brand: string | null
  unit: string
  location: string | null
  minimum_stock: number | string
  is_active: boolean
}

export const EXPORT_COLUMNS = [
  'SKU',
  'BARCODE',
  'NAMA_BARANG',
  'KATEGORI',
  'MEREK',
  'SATUAN',
  'LOKASI_GUDANG',
  'MINIMUM_STOCK',
  'STATUS',
] as const

export function exportFileName(date = new Date()): string {
  return `WHISTLE_Master_Barang_${jakartaDate(date)}.xlsx`
}

export function buildProductsWorkbook(products: ExportProduct[]): XLSX.WorkBook {
  const ws: XLSX.WorkSheet = {}
  EXPORT_COLUMNS.forEach((name, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: name }
  })
  products.forEach((p, i) => {
    const r = i + 1
    const put = (c: number, cell: XLSX.CellObject | null) => {
      if (cell) ws[XLSX.utils.encode_cell({ r, c })] = cell
    }
    const str = (v: string | null) => (v === null || v === '' ? null : { t: 's', v } as XLSX.CellObject)
    put(0, textCell(p.sku))
    put(1, p.barcode ? textCell(p.barcode) : null)
    put(2, str(p.product_name))
    put(3, str(p.category))
    put(4, str(p.brand))
    put(5, str(p.unit))
    put(6, str(p.location))
    put(7, { t: 'n', v: Number(p.minimum_stock), z: '#,##0.####' })
    put(8, { t: 's', v: p.is_active ? 'AKTIF' : 'NONAKTIF' })
  })
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: products.length, c: EXPORT_COLUMNS.length - 1 } })
  ws['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'MASTER_BARANG')
  return wb
}

/** Unduh workbook di browser. */
export function downloadWorkbook(wb: XLSX.WorkBook, fileName: string): void {
  XLSX.writeFile(wb, fileName)
}

export function workbookToBuffer(wb: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}
