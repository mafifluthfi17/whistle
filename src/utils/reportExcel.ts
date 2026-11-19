import * as XLSX from 'xlsx'
import type { AuditRow } from '../types/backup'
import type {
  MovementReport,
  StockCard,
  StockSummary,
  TransactionHistory,
  TransactionLines,
  Valuation,
} from '../types/reports'

// ---------------------------------------------------------------------------
// Format sel (konsisten di semua laporan)
// ---------------------------------------------------------------------------
export const FMT = {
  text: '@',
  qty: '#,##0.0000',
  rupiah: '"Rp "#,##0.00',
  cost: '"Rp "#,##0.000000',
  int: '0',
  datetime: 'dd/mm/yyyy hh:mm',
  date: 'dd/mm/yyyy',
} as const

export type ColType = 'text' | 'sku' | 'qty' | 'rupiah' | 'cost' | 'int' | 'datetime' | 'date'

export interface Col<T> {
  header: string
  type: ColType
  width: number
  value: (row: T) => string | number | null | undefined
}

const JAKARTA_OFFSET_MS = 7 * 3600_000

/** ISO timestamp -> nomor seri Excel pada jam dinding Asia/Jakarta (tanpa ketergantungan zona waktu pembaca). */
export function excelSerialJakarta(iso: string): number {
  const ms = new Date(iso).getTime() + JAKARTA_OFFSET_MS
  return ms / 86_400_000 + 25569
}

/** 'YYYY-MM-DD' -> nomor seri Excel (tanggal saja). */
export function excelSerialDate(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25569
}

function makeCell(type: ColType, v: string | number | null | undefined): XLSX.CellObject | null {
  if (v === null || v === undefined || v === '') return null
  switch (type) {
    case 'sku':
      return { t: 's', v: String(v), z: FMT.text } // SKU/barcode selalu teks
    case 'text':
      return { t: 's', v: String(v) }
    case 'qty':
      return { t: 'n', v: Number(v), z: FMT.qty }
    case 'rupiah':
      return { t: 'n', v: Number(v), z: FMT.rupiah }
    case 'cost':
      return { t: 'n', v: Number(v), z: FMT.cost }
    case 'int':
      return { t: 'n', v: Number(v), z: FMT.int }
    case 'datetime':
      return { t: 'n', v: excelSerialJakarta(String(v)), z: FMT.datetime }
    case 'date':
      return { t: 'n', v: excelSerialDate(String(v).slice(0, 10)), z: FMT.date }
  }
}

export interface SheetSpec<T> {
  cols: Col<T>[]
  rows: T[]
  /** Baris tambahan (mis. saldo awal/akhir dan total) dalam urutan yang sama dengan cols */
  extraTop?: Record<number, string | number | null>[]
  extraBottom?: Record<number, string | number | null>[]
}

/** Bangun worksheet: header di baris 1, data mulai baris 2. Baris tambahan ditulis per indeks kolom. */
export function buildSheet<T>(spec: SheetSpec<T>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  spec.cols.forEach((c, ci) => {
    ws[XLSX.utils.encode_cell({ r: 0, c: ci })] = { t: 's', v: c.header }
  })
  let r = 1
  const writeExtra = (extra: Record<number, string | number | null>) => {
    spec.cols.forEach((c, ci) => {
      const cell = makeCell(c.type === 'sku' ? 'text' : c.type, extra[ci])
      if (cell) ws[XLSX.utils.encode_cell({ r, c: ci })] = cell
    })
    r++
  }
  spec.extraTop?.forEach(writeExtra)
  for (const row of spec.rows) {
    spec.cols.forEach((c, ci) => {
      const cell = makeCell(c.type, c.value(row))
      if (cell) ws[XLSX.utils.encode_cell({ r, c: ci })] = cell
    })
    r++
  }
  spec.extraBottom?.forEach(writeExtra)
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 0), c: spec.cols.length - 1 } })
  ws['!cols'] = spec.cols.map((c) => ({ wch: c.width }))
  return ws
}

function workbook(sheets: [string, XLSX.WorkSheet][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, ws] of sheets) XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}

/** Baris info (label, nilai) sebagai sheet RINGKASAN. */
function infoSheet(rows: [string, string | number | null][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows.map(([k, v]) => [k, v ?? '']))
}

export function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return 'semua_periode'
  return `${from ?? 'awal'}_sd_${to ?? 'akhir'}`
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_')

// ---------------------------------------------------------------------------
// 3. Kartu stok
// ---------------------------------------------------------------------------
export const STOCK_CARD_HEADERS = [
  'Tanggal', 'No. Transaksi', 'No. Dokumen', 'Keterangan', 'SKU', 'Nama Barang',
  'Qty Masuk', 'Harga Masuk', 'Nilai Masuk', 'Qty Keluar', 'HPP per Unit', 'Nilai Keluar',
  'Saldo Qty', 'Average Cost', 'Saldo Nilai', 'Jenis', 'Status',
] as const

type CardRow = StockCard['rows'][number]

export function stockCardWorkbook(card: StockCard): { wb: XLSX.WorkBook; fileName: string } {
  const keterangan = (r: CardRow) =>
    [r.supplier_or_recipient, r.notes, r.reason ? `Alasan: ${r.reason}` : null].filter(Boolean).join(' | ') || null
  const cols: Col<CardRow>[] = [
    { header: STOCK_CARD_HEADERS[0], type: 'datetime', width: 17, value: (r) => r.movement_date },
    { header: STOCK_CARD_HEADERS[1], type: 'text', width: 20, value: (r) => r.transaction_number },
    { header: STOCK_CARD_HEADERS[2], type: 'text', width: 16, value: (r) => r.reference_number },
    { header: STOCK_CARD_HEADERS[3], type: 'text', width: 30, value: keterangan },
    { header: STOCK_CARD_HEADERS[4], type: 'sku', width: 16, value: (r) => r.sku },
    { header: STOCK_CARD_HEADERS[5], type: 'text', width: 30, value: (r) => r.product_name },
    { header: STOCK_CARD_HEADERS[6], type: 'qty', width: 14, value: (r) => r.qty_in },
    { header: STOCK_CARD_HEADERS[7], type: 'cost', width: 20, value: (r) => r.unit_cost_in },
    { header: STOCK_CARD_HEADERS[8], type: 'rupiah', width: 20, value: (r) => r.value_in },
    { header: STOCK_CARD_HEADERS[9], type: 'qty', width: 14, value: (r) => r.qty_out },
    { header: STOCK_CARD_HEADERS[10], type: 'cost', width: 20, value: (r) => r.unit_cost_out },
    { header: STOCK_CARD_HEADERS[11], type: 'rupiah', width: 20, value: (r) => r.value_out },
    { header: STOCK_CARD_HEADERS[12], type: 'qty', width: 14, value: (r) => r.balance_qty },
    { header: STOCK_CARD_HEADERS[13], type: 'cost', width: 20, value: (r) => r.average_cost },
    { header: STOCK_CARD_HEADERS[14], type: 'rupiah', width: 20, value: (r) => r.balance_value },
    { header: STOCK_CARD_HEADERS[15], type: 'text', width: 12, value: (r) => r.movement_type },
    { header: STOCK_CARD_HEADERS[16], type: 'text', width: 12, value: (r) => r.transaction_status },
  ]
  const p = card.product
  const ws = buildSheet<CardRow>({
    cols,
    rows: card.rows,
    // indeks kolom: 3 Keterangan, 4 SKU, 5 Nama, 6-8 masuk, 9-11 keluar, 12-14 saldo
    extraTop: [{ 3: 'SALDO AWAL', 4: p.sku, 5: p.product_name, 12: card.opening.qty, 13: card.opening.average_cost, 14: card.opening.value }],
    extraBottom: [
      {
        3: 'TOTAL PERIODE', 4: p.sku, 5: p.product_name,
        6: card.totals.qty_in, 8: card.totals.value_in, 9: card.totals.qty_out, 11: card.totals.value_out,
      },
      { 3: 'SALDO AKHIR', 4: p.sku, 5: p.product_name, 12: card.closing.qty, 13: card.closing.average_cost, 14: card.closing.value },
    ],
  })
  const info = infoSheet([
    ['SKU', p.sku], ['Nama barang', p.product_name], ['Satuan', p.unit],
    ['Periode', `${card.from ?? 'awal'} s.d. ${card.to ?? 'akhir'}`],
    ['Saldo awal (qty)', card.opening.qty], ['Saldo awal (nilai)', card.opening.value],
    ['Qty masuk', card.totals.qty_in], ['Nilai masuk', card.totals.value_in],
    ['Qty keluar', card.totals.qty_out], ['HPP (nilai keluar)', card.totals.value_out],
    ['Saldo akhir (qty)', card.closing.qty], ['Saldo akhir (nilai)', card.closing.value],
  ])
  return {
    wb: workbook([['KARTU_STOK', ws], ['RINGKASAN', info]]),
    fileName: `WHISTLE_Kartu_Stok_${safe(p.sku)}_${periodLabel(card.from, card.to)}.xlsx`,
  }
}

// ---------------------------------------------------------------------------
// 2. Saldo stok, 8. Low stock (dan zero stock)
// ---------------------------------------------------------------------------
type SumRow = StockSummary['rows'][number]

function summaryCols(withShortage: boolean): Col<SumRow>[] {
  const cols: Col<SumRow>[] = [
    { header: 'SKU', type: 'sku', width: 16, value: (r) => r.sku },
    { header: 'Barcode', type: 'sku', width: 18, value: (r) => r.barcode },
    { header: 'Nama Barang', type: 'text', width: 32, value: (r) => r.product_name },
    { header: 'Kategori', type: 'text', width: 16, value: (r) => r.category },
    { header: 'Merek', type: 'text', width: 16, value: (r) => r.brand },
    { header: 'Satuan', type: 'text', width: 9, value: (r) => r.unit },
    { header: 'Lokasi', type: 'text', width: 14, value: (r) => r.location },
    { header: 'Quantity', type: 'qty', width: 14, value: (r) => r.quantity },
    { header: 'Average Cost', type: 'cost', width: 20, value: (r) => r.average_cost },
    { header: 'Nilai Persediaan', type: 'rupiah', width: 20, value: (r) => r.inventory_value },
    { header: 'Minimum Stock', type: 'qty', width: 14, value: (r) => r.minimum_stock },
  ]
  if (withShortage) cols.push({ header: 'Kekurangan', type: 'qty', width: 14, value: (r) => r.shortage })
  cols.push({ header: 'Status Stok', type: 'text', width: 12, value: (r) => r.status })
  return cols
}

export function stockSummaryWorkbook(
  report: StockSummary,
  asOf: string,
  kind: 'summary' | 'low' | 'zero' = 'summary',
): { wb: XLSX.WorkBook; fileName: string } {
  const withShortage = kind === 'low'
  const cols = summaryCols(withShortage)
  const ws = buildSheet<SumRow>({
    cols,
    rows: report.rows,
    extraBottom: [{ 2: 'TOTAL', 7: report.totals.total_qty, 9: report.totals.total_value }],
  })
  const title = { summary: 'SALDO_STOK', low: 'LOW_STOCK', zero: 'ZERO_STOCK' }[kind]
  const file = { summary: 'Saldo_Stok', low: 'Low_Stock', zero: 'Zero_Stock' }[kind]
  return { wb: workbook([[title, ws]]), fileName: `WHISTLE_${file}_${asOf}.xlsx` }
}

// ---------------------------------------------------------------------------
// 4. Inventory valuation
// ---------------------------------------------------------------------------
type ValRow = Valuation['rows'][number]

export function valuationWorkbook(report: Valuation, asOf: string): { wb: XLSX.WorkBook; fileName: string } {
  const cols: Col<ValRow>[] = [
    { header: 'SKU', type: 'sku', width: 16, value: (r) => r.sku },
    { header: 'Nama Barang', type: 'text', width: 32, value: (r) => r.product_name },
    { header: 'Kategori', type: 'text', width: 16, value: (r) => r.category },
    { header: 'Satuan', type: 'text', width: 9, value: (r) => r.unit },
    { header: 'Quantity', type: 'qty', width: 14, value: (r) => r.quantity },
    { header: 'Average Cost', type: 'cost', width: 20, value: (r) => r.average_cost },
    { header: 'Nilai Persediaan', type: 'rupiah', width: 20, value: (r) => r.inventory_value },
  ]
  const ws = buildSheet<ValRow>({
    cols,
    rows: report.rows,
    extraBottom: [{ 1: 'TOTAL NILAI PERSEDIAAN', 4: report.totals.total_qty, 6: report.totals.total_value }],
  })
  const t = report.totals
  const info = infoSheet([
    ['Per tanggal', asOf],
    ['Total qty (laporan)', t.total_qty], ['Total nilai (laporan)', t.total_value],
    ['Saldo resmi (semua barang) qty', t.all_balance_qty], ['Saldo resmi (semua barang) nilai', t.all_balance_value],
    ['Ledger qty', t.ledger_qty], ['Ledger nilai', t.ledger_value],
    ['Rekonsiliasi saldo vs ledger', t.reconciled ? 'SESUAI' : 'TIDAK SESUAI'],
  ])
  return { wb: workbook([['VALUATION', ws], ['REKONSILIASI', info]]), fileName: `WHISTLE_Inventory_Valuation_${asOf}.xlsx` }
}

// ---------------------------------------------------------------------------
// Stock movement per periode
// ---------------------------------------------------------------------------
type MovRow = MovementReport['rows'][number]

export function movementWorkbook(report: MovementReport): { wb: XLSX.WorkBook; fileName: string } {
  const cols: Col<MovRow>[] = [
    { header: 'SKU', type: 'sku', width: 16, value: (r) => r.sku },
    { header: 'Nama Barang', type: 'text', width: 32, value: (r) => r.product_name },
    { header: 'Kategori', type: 'text', width: 16, value: (r) => r.category },
    { header: 'Satuan', type: 'text', width: 9, value: (r) => r.unit },
    { header: 'Saldo Awal Qty', type: 'qty', width: 16, value: (r) => r.opening_qty },
    { header: 'Saldo Awal Nilai', type: 'rupiah', width: 20, value: (r) => r.opening_value },
    { header: 'Qty Masuk', type: 'qty', width: 14, value: (r) => r.qty_in },
    { header: 'Nilai Masuk', type: 'rupiah', width: 20, value: (r) => r.value_in },
    { header: 'Qty Keluar', type: 'qty', width: 14, value: (r) => r.qty_out },
    { header: 'HPP (Nilai Keluar)', type: 'rupiah', width: 20, value: (r) => r.value_out },
    { header: 'Saldo Akhir Qty', type: 'qty', width: 16, value: (r) => r.closing_qty },
    { header: 'Saldo Akhir Nilai', type: 'rupiah', width: 20, value: (r) => r.closing_value },
  ]
  const t = report.totals
  const ws = buildSheet<MovRow>({
    cols,
    rows: report.rows,
    extraBottom: [{
      1: 'TOTAL', 4: t.opening_qty, 5: t.opening_value, 6: t.qty_in, 7: t.value_in, 8: t.qty_out, 9: t.value_out,
      10: t.closing_qty, 11: t.closing_value,
    }],
  })
  const types = XLSX.utils.aoa_to_sheet([
    ['Jenis Mutasi', 'Jumlah', 'Qty Masuk', 'Nilai Masuk', 'Qty Keluar', 'Nilai Keluar'],
    ...t.by_type.map((x) => [x.movement_type, x.count, Number(x.qty_in), Number(x.value_in), Number(x.qty_out), Number(x.value_out)]),
  ])
  return {
    wb: workbook([['STOCK_MOVEMENT', ws], ['PER_JENIS', types]]),
    fileName: `WHISTLE_Stock_Movement_${periodLabel(report.from, report.to)}.xlsx`,
  }
}

// ---------------------------------------------------------------------------
// 5/6. Barang masuk dan Barang keluar (baris item)
// ---------------------------------------------------------------------------
type LineRow = TransactionLines['rows'][number]

export function transactionLinesWorkbook(report: TransactionLines): { wb: XLSX.WorkBook; fileName: string } {
  const isIn = report.type === 'IN'
  const cols: Col<LineRow>[] = [
    { header: 'Tanggal', type: 'datetime', width: 17, value: (r) => r.transaction_date },
    { header: 'No. Transaksi', type: 'text', width: 20, value: (r) => r.transaction_number },
    { header: 'No. Dokumen', type: 'text', width: 16, value: (r) => r.reference_number },
    { header: isIn ? 'Supplier' : 'Penerima/Tujuan', type: 'text', width: 22, value: (r) => r.supplier_or_recipient },
    { header: 'SKU', type: 'sku', width: 16, value: (r) => r.sku },
    { header: 'Nama Barang', type: 'text', width: 32, value: (r) => r.product_name },
    { header: 'Satuan', type: 'text', width: 9, value: (r) => r.unit },
    { header: 'Quantity', type: 'qty', width: 14, value: (r) => r.quantity },
    { header: isIn ? 'Harga Beli per Unit' : 'HPP per Unit', type: 'cost', width: 20, value: (r) => r.unit_cost },
    { header: isIn ? 'Nilai Masuk' : 'Nilai Keluar (HPP)', type: 'rupiah', width: 20, value: (r) => r.total_value },
    { header: 'Keterangan', type: 'text', width: 28, value: (r) => r.notes },
    { header: 'Pengguna', type: 'text', width: 18, value: (r) => r.created_by_name },
    { header: 'Status', type: 'text', width: 12, value: (r) => r.status },
  ]
  const ws = buildSheet<LineRow>({
    cols,
    rows: report.rows,
    extraBottom: [{ 5: 'TOTAL (hanya status POSTED)', 7: report.totals.total_qty, 9: report.totals.total_value }],
  })
  return {
    wb: workbook([[isIn ? 'BARANG_MASUK' : 'BARANG_KELUAR', ws]]),
    fileName: `WHISTLE_${isIn ? 'Barang_Masuk' : 'Barang_Keluar'}_${periodLabel(report.from, report.to)}.xlsx`,
  }
}

// ---------------------------------------------------------------------------
// 7. Transaction history
// ---------------------------------------------------------------------------
type HistRow = TransactionHistory['rows'][number]

export function transactionHistoryWorkbook(
  report: TransactionHistory,
  from: string | null,
  to: string | null,
): { wb: XLSX.WorkBook; fileName: string } {
  const cols: Col<HistRow>[] = [
    { header: 'Tanggal', type: 'datetime', width: 17, value: (r) => r.transaction_date },
    { header: 'No. Transaksi', type: 'text', width: 20, value: (r) => r.transaction_number },
    { header: 'Jenis', type: 'text', width: 12, value: (r) => r.transaction_type },
    { header: 'Status', type: 'text', width: 12, value: (r) => r.status },
    { header: 'No. Dokumen', type: 'text', width: 16, value: (r) => r.reference_number },
    { header: 'Supplier/Penerima', type: 'text', width: 22, value: (r) => r.supplier_or_recipient },
    { header: 'Jumlah Item', type: 'int', width: 12, value: (r) => r.item_count },
    { header: 'Total Nilai', type: 'rupiah', width: 20, value: (r) => r.total_value },
    { header: 'Keterangan', type: 'text', width: 28, value: (r) => r.notes },
    { header: 'Alasan', type: 'text', width: 22, value: (r) => r.reason },
    { header: 'Reversal dari', type: 'text', width: 20, value: (r) => r.reversal_of_number },
    { header: 'Dibuat oleh', type: 'text', width: 18, value: (r) => r.created_by_name },
    { header: 'Disetujui oleh', type: 'text', width: 18, value: (r) => r.approved_by_name },
  ]
  const ws = buildSheet<HistRow>({
    cols,
    rows: report.rows,
    extraBottom: [{ 5: 'TOTAL NILAI (hanya status POSTED)', 7: report.totals.posted_total_value }],
  })
  return {
    wb: workbook([['TRANSACTION_HISTORY', ws]]),
    fileName: `WHISTLE_Transaction_History_${periodLabel(from, to)}.xlsx`,
  }
}

// ---------------------------------------------------------------------------
// Unduh / serialisasi
// ---------------------------------------------------------------------------
export function downloadReport(r: { wb: XLSX.WorkBook; fileName: string }): void {
  XLSX.writeFile(r.wb, r.fileName)
}

export function reportToBuffer(wb: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

// ---------------------------------------------------------------------------
// 9. Audit trail (hanya ADMIN yang dapat membacanya, jadi hanya ADMIN yang dapat mengekspornya)
// ---------------------------------------------------------------------------

/** Batas sel Excel adalah 32.767 karakter. */
export const EXCEL_CELL_LIMIT = 32000

export function jsonCell(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = JSON.stringify(v)
  return s.length > EXCEL_CELL_LIMIT ? `${s.slice(0, EXCEL_CELL_LIMIT)}… (dipotong; isi lengkap di aplikasi)` : s
}

export function auditWorkbook(rows: AuditRow[], from: string | null, to: string | null): { wb: XLSX.WorkBook; fileName: string } {
  const cols: Col<AuditRow>[] = [
    { header: 'Waktu', type: 'datetime', width: 17, value: (r) => r.created_at },
    { header: 'Pengguna', type: 'text', width: 22, value: (r) => r.user_name },
    { header: 'Aksi', type: 'text', width: 16, value: (r) => r.action },
    { header: 'Tabel', type: 'text', width: 24, value: (r) => r.table_name },
    { header: 'ID Record', type: 'sku', width: 38, value: (r) => r.record_id },
    { header: 'Nilai Lama', type: 'text', width: 60, value: (r) => jsonCell(r.old_value) },
    { header: 'Nilai Baru', type: 'text', width: 60, value: (r) => jsonCell(r.new_value) },
  ]
  const ws = buildSheet<AuditRow>({ cols, rows })
  return {
    wb: workbook([['AUDIT_TRAIL', ws]]),
    fileName: `WHISTLE_Audit_Trail_${periodLabel(from, to)}.xlsx`,
  }
}
