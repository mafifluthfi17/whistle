import * as XLSX from 'xlsx'
import { averageCost, numberToDecimalString, parseDecimal, valueMatchesAverage } from './decimal'

export const SHEET_MASTER = 'MASTER_BARANG'
export const SHEET_GUIDE = 'PETUNJUK'
export const MAX_IMPORT_ROWS = 5000

export const COLUMNS = [
  'SKU',
  'BARCODE',
  'NAMA_BARANG',
  'KATEGORI',
  'MEREK',
  'SATUAN',
  'LOKASI_GUDANG',
  'STOK_AWAL',
  'NILAI_PERSEDIAAN_AWAL',
  'HARGA_RATA_RATA_AWAL',
  'MINIMUM_STOCK',
] as const
export type ColumnKey = (typeof COLUMNS)[number]

const TEXT_COLUMNS: ColumnKey[] = ['SKU', 'BARCODE', 'NAMA_BARANG', 'KATEGORI', 'MEREK', 'SATUAN', 'LOKASI_GUDANG']
const MAX_LEN: Record<string, number> = { SKU: 64, BARCODE: 64, NAMA_BARANG: 200, KATEGORI: 100, MEREK: 100, SATUAN: 20, LOKASI_GUDANG: 100 }

export type ImportMode = 'NEW' | 'UPDATE'

export interface RawRow {
  /** Nomor baris di Excel (header = baris 1) */
  rowNumber: number
  cells: Partial<Record<ColumnKey, string | number>>
  /** Kolom teks yang di Excel berupa angka (nol di depan mungkin sudah hilang) */
  numericTextColumns: ColumnKey[]
  cellErrors: string[]
}

export interface ParsedWorkbook {
  errors: string[]
  warnings: string[]
  rows: RawRow[]
}

/** Payload yang dikirim ke fungsi database import_products. Semua nilai berupa string. */
export interface ImportPayloadRow {
  sku: string
  barcode?: string
  product_name?: string
  category?: string
  brand?: string
  unit?: string
  location?: string
  minimum_stock?: string
  opening_quantity?: string
  opening_value?: string
}

export interface RowResult {
  rowNumber: number
  sku: string
  errors: string[]
  warnings: string[]
  payload?: ImportPayloadRow
  /** Hanya untuk pratinjau */
  derivedAverage?: string
}

export interface ExistingKeys {
  skus: Set<string>
  /** barcode -> SKU pemiliknya */
  barcodes: Map<string, string>
}

// ---------------------------------------------------------------------------
// Membaca workbook
// ---------------------------------------------------------------------------
export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const result: ParsedWorkbook = { errors: [], warnings: [], rows: [] }
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(data, { type: 'array', cellDates: false })
  } catch {
    result.errors.push('File tidak dapat dibaca. Pastikan formatnya .xlsx.')
    return result
  }
  const ws = wb.Sheets[SHEET_MASTER]
  if (!ws || !ws['!ref']) {
    result.errors.push(`Sheet "${SHEET_MASTER}" tidak ditemukan. Gunakan template dari tombol Download Template.`)
    return result
  }
  const range = XLSX.utils.decode_range(ws['!ref'])

  // Header (baris pertama)
  const colIndex = new Map<ColumnKey, number>()
  const unknown: string[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })]
    const name = cell ? String(cell.v).trim().toUpperCase() : ''
    if (!name) continue
    if ((COLUMNS as readonly string[]).includes(name)) {
      if (colIndex.has(name as ColumnKey)) result.errors.push(`Kolom "${name}" muncul lebih dari sekali`)
      else colIndex.set(name as ColumnKey, c)
    } else unknown.push(name)
  }
  const missing = COLUMNS.filter((c) => !colIndex.has(c))
  if (missing.length) result.errors.push(`Kolom wajib tidak ditemukan: ${missing.join(', ')}`)
  if (unknown.length) result.warnings.push(`Kolom tidak dikenal diabaikan: ${unknown.join(', ')}`)
  if (result.errors.length) return result

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cells: RawRow['cells'] = {}
    const numericTextColumns: ColumnKey[] = []
    const cellErrors: string[] = []
    let empty = true
    for (const [key, c] of colIndex) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (!cell || cell.v === undefined || cell.v === null || String(cell.v).trim() === '') continue
      empty = false
      if (cell.t === 'e') {
        cellErrors.push(`${key}: sel berisi error Excel`)
        continue
      }
      if (cell.t === 'd') {
        cellErrors.push(`${key}: format tanggal tidak diizinkan`)
        continue
      }
      if (TEXT_COLUMNS.includes(key)) {
        if (cell.t === 'n') {
          // Angka di kolom teks: ambil nilainya apa adanya (tanpa notasi ilmiah)
          cells[key] = numberToDecimalString(Number(cell.v))
          numericTextColumns.push(key)
        } else cells[key] = String(cell.v).trim()
      } else {
        cells[key] = cell.t === 'n' ? Number(cell.v) : String(cell.v).trim()
      }
    }
    if (empty) continue
    result.rows.push({ rowNumber: r + 1, cells, numericTextColumns, cellErrors })
    if (result.rows.length > MAX_IMPORT_ROWS) {
      result.errors.push(`Maksimal ${MAX_IMPORT_ROWS} baris per import`)
      result.rows = []
      return result
    }
  }
  if (result.rows.length === 0) result.errors.push('Tidak ada data pada sheet MASTER_BARANG')
  return result
}

// ---------------------------------------------------------------------------
// Validasi
// ---------------------------------------------------------------------------
export function validateRows(rows: RawRow[], mode: ImportMode, existing: ExistingKeys): RowResult[] {
  const results: RowResult[] = rows.map((row) => validateRow(row, mode))

  // Duplikat di dalam file dan bentrok dengan database
  const seenSku = new Map<string, number>()
  const seenBarcode = new Map<string, number>()
  for (const res of results) {
    if (!res.sku) continue
    const sku = res.sku
    const barcode = res.payload?.barcode

    if (seenSku.has(sku)) res.errors.push(`SKU "${sku}" duplikat dengan baris ${seenSku.get(sku)}`)
    else seenSku.set(sku, res.rowNumber)

    if (mode === 'NEW' && existing.skus.has(sku)) {
      res.errors.push(`SKU "${sku}" sudah terdaftar (gunakan mode Update master)`)
    }
    if (mode === 'UPDATE' && !existing.skus.has(sku)) {
      res.errors.push(`SKU "${sku}" belum terdaftar (gunakan mode Barang baru)`)
    }

    if (barcode) {
      if (seenBarcode.has(barcode)) res.errors.push(`Barcode "${barcode}" duplikat dengan baris ${seenBarcode.get(barcode)}`)
      else seenBarcode.set(barcode, res.rowNumber)
      const owner = existing.barcodes.get(barcode)
      if (owner !== undefined && owner !== sku) {
        res.errors.push(`Barcode "${barcode}" sudah dipakai SKU "${owner}"`)
      }
    }
  }
  return results
}

function validateRow(row: RawRow, mode: ImportMode): RowResult {
  const errors: string[] = [...row.cellErrors]
  const warnings: string[] = []
  const c = row.cells

  const text = (key: ColumnKey): string => (c[key] === undefined ? '' : String(c[key]).trim())
  for (const key of TEXT_COLUMNS) {
    if (text(key).length > MAX_LEN[key]) errors.push(`${key}: maksimal ${MAX_LEN[key]} karakter`)
  }
  for (const key of row.numericTextColumns) {
    if (key === 'SKU' || key === 'BARCODE') {
      warnings.push(`${key} berupa angka di Excel; nol di depan mungkin hilang. Format sel sebagai Teks.`)
    }
  }

  const sku = text('SKU')
  if (!sku) errors.push('SKU wajib diisi')
  else if (/[\u0000-\u001f]/.test(sku)) errors.push('SKU mengandung karakter tidak valid')

  if (mode === 'NEW') {
    if (!text('NAMA_BARANG')) errors.push('NAMA_BARANG wajib diisi')
    if (!text('SATUAN')) errors.push('SATUAN wajib diisi')
  }

  const num = (key: ColumnKey, maxScale: number, maxIntDigits: number): string | undefined => {
    const v = c[key]
    if (v === undefined || (typeof v === 'string' && v.trim() === '')) return undefined
    const r = parseDecimal(v, { maxScale, maxIntDigits })
    if (!r.ok) {
      errors.push(`${key}: ${r.error}`)
      return undefined
    }
    return r.value
  }

  const minimum = num('MINIMUM_STOCK', 4, 16)
  const qty = num('STOK_AWAL', 4, 16)
  const value = num('NILAI_PERSEDIAAN_AWAL', 2, 18)
  const avg = num('HARGA_RATA_RATA_AWAL', 6, 14)

  let opening: { qty: string; value: string } | undefined
  let derivedAverage: string | undefined

  if (mode === 'UPDATE') {
    if (qty !== undefined || value !== undefined || avg !== undefined) {
      warnings.push('Kolom stok awal diabaikan pada mode Update (saldo tidak diubah)')
    }
  } else {
    const q = qty ?? '0'
    const isPositive = /[1-9]/.test(q)
    if (isPositive) {
      if (value === undefined) {
        if (!errors.some((e) => e.startsWith('NILAI_PERSEDIAAN_AWAL'))) {
          errors.push('NILAI_PERSEDIAAN_AWAL wajib diisi jika STOK_AWAL lebih dari 0')
        }
      } else {
        derivedAverage = averageCost(value, q)
        if (avg !== undefined && !valueMatchesAverage(value, q, avg)) {
          errors.push(`NILAI_PERSEDIAAN_AWAL tidak sama dengan STOK_AWAL × HARGA_RATA_RATA_AWAL (rata-rata seharusnya ${derivedAverage})`)
        }
        opening = { qty: q, value }
      }
    } else {
      if (value !== undefined && /[1-9]/.test(value)) errors.push('NILAI_PERSEDIAAN_AWAL harus 0 jika STOK_AWAL 0')
      if (avg !== undefined && /[1-9]/.test(avg)) errors.push('HARGA_RATA_RATA_AWAL harus 0 jika STOK_AWAL 0')
    }
  }

  const payload: ImportPayloadRow = { sku }
  const put = (field: keyof ImportPayloadRow, key: ColumnKey) => {
    const v = text(key)
    if (v) payload[field] = v
  }
  put('barcode', 'BARCODE')
  put('product_name', 'NAMA_BARANG')
  put('category', 'KATEGORI')
  put('brand', 'MEREK')
  put('unit', 'SATUAN')
  put('location', 'LOKASI_GUDANG')
  if (minimum !== undefined) payload.minimum_stock = minimum
  if (opening) {
    payload.opening_quantity = opening.qty
    payload.opening_value = opening.value
  }

  return { rowNumber: row.rowNumber, sku, errors, warnings, payload, derivedAverage }
}

export function summarize(results: RowResult[]) {
  const invalid = results.filter((r) => r.errors.length > 0).length
  return { total: results.length, valid: results.length - invalid, invalid }
}
