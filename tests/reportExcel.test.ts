import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { formatScaled, toScaled } from '../src/utils/decimal'
import {
  FMT,
  STOCK_CARD_HEADERS,
  excelSerialDate,
  excelSerialJakarta,
  movementWorkbook,
  periodLabel,
  reportToBuffer,
  stockCardWorkbook,
  stockSummaryWorkbook,
  transactionHistoryWorkbook,
  transactionLinesWorkbook,
  valuationWorkbook,
} from '../src/utils/reportExcel'
import type { MovementReport, StockCard, StockSummary, TransactionHistory, TransactionLines, Valuation } from '../src/types/reports'

const roundTrip = (wb: XLSX.WorkBook) => XLSX.read(reportToBuffer(wb), { type: 'array' })
const sheetRows = (wb: XLSX.WorkBook, name: string) =>
  XLSX.utils.sheet_to_json<Record<string, string | number>>(roundTrip(wb).Sheets[name], { raw: true, defval: null })
/** Jumlah desimal tepat (tanpa float) dari kolom string. */
const sum = (values: string[], scale: number) => formatScaled(values.reduce((s, v) => s + toScaled(v, scale), 0n), scale)

// --- Fixture meniru keluaran fungsi database (angka sebagai teks) -------------------------------
const card: StockCard = {
  product: { sku: '00123', product_name: 'Air Mineral 600ml', unit: 'PCS', category: 'Minuman', brand: null, is_active: true, minimum_stock: '20.0000' },
  from: '2026-11-01',
  to: '2026-11-19',
  opening: { qty: '100.0000', value: '1000000.00', average_cost: '10000.000000' },
  rows: [
    {
      movement_sequence: 2, movement_id: 'm2', movement_date: '2026-11-10T05:00:00+00:00', transaction_id: 't2', transaction_number: 'IN-261110-000002',
      movement_type: 'IN', transaction_status: 'POSTED', reference_number: 'PO-001', notes: 'Pembelian rutin', supplier_or_recipient: 'PT Pemasok', reason: null,
      sku: '00123', product_name: 'Air Mineral 600ml',
      qty_in: '50.0000', unit_cost_in: '12000.000000', value_in: '600000.00', qty_out: '0.0000', unit_cost_out: null, value_out: '0.00',
      balance_qty: '150.0000', average_cost: '10666.666667', balance_value: '1600000.00', user_name: 'Admin',
    },
    {
      movement_sequence: 3, movement_id: 'm3', movement_date: '2026-11-12T08:30:00+00:00', transaction_id: 't3', transaction_number: 'OUT-261112-000003',
      movement_type: 'OUT', transaction_status: 'POSTED', reference_number: 'SJ-001', notes: null, supplier_or_recipient: 'Toko A', reason: null,
      sku: '00123', product_name: 'Air Mineral 600ml',
      qty_in: '0.0000', unit_cost_in: null, value_in: '0.00', qty_out: '30.0000', unit_cost_out: '10666.666667', value_out: '320000.00',
      balance_qty: '120.0000', average_cost: '10666.666667', balance_value: '1280000.00', user_name: 'Gudang',
    },
  ],
  totals: { qty_in: '50.0000', value_in: '600000.00', qty_out: '30.0000', value_out: '320000.00' },
  closing: { qty: '120.0000', value: '1280000.00', average_cost: '10666.666667' },
}

describe('kartu stok Excel', () => {
  const { wb, fileName } = stockCardWorkbook(card)

  it('nama file memuat SKU dan periode', () => {
    expect(fileName).toBe('WHISTLE_Kartu_Stok_00123_2026-11-01_sd_2026-11-19.xlsx')
    expect(stockCardWorkbook({ ...card, from: null, to: null }).fileName).toBe('WHISTLE_Kartu_Stok_00123_semua_periode.xlsx')
    expect(stockCardWorkbook({ ...card, product: { ...card.product, sku: 'A/B C' } }).fileName).toBe('WHISTLE_Kartu_Stok_A_B_C_2026-11-01_sd_2026-11-19.xlsx')
  })

  it('kolom sesuai Bagian 14 dan urutannya tetap', () => {
    const ws = wb.Sheets.KARTU_STOK
    const header = STOCK_CARD_HEADERS.map((_, c) => ws[XLSX.utils.encode_cell({ r: 0, c })].v)
    expect(header.slice(0, 15)).toEqual([
      'Tanggal', 'No. Transaksi', 'No. Dokumen', 'Keterangan', 'SKU', 'Nama Barang', 'Qty Masuk', 'Harga Masuk', 'Nilai Masuk',
      'Qty Keluar', 'HPP per Unit', 'Nilai Keluar', 'Saldo Qty', 'Average Cost', 'Saldo Nilai',
    ])
  })

  it('nilai berada di kolom yang benar (qty vs nilai tidak tertukar) pada baris masuk dan keluar', () => {
    const rows = sheetRows(wb, 'KARTU_STOK')
    const buy = rows.find((r) => r['No. Transaksi'] === 'IN-261110-000002')!
    expect(buy).toMatchObject({ 'Qty Masuk': 50, 'Harga Masuk': 12000, 'Nilai Masuk': 600000, 'Qty Keluar': 0, 'HPP per Unit': null, 'Nilai Keluar': 0, 'Saldo Qty': 150, 'Saldo Nilai': 1600000 })
    const sale = rows.find((r) => r['No. Transaksi'] === 'OUT-261112-000003')!
    expect(sale).toMatchObject({ 'Qty Masuk': 0, 'Harga Masuk': null, 'Nilai Masuk': 0, 'Qty Keluar': 30, 'HPP per Unit': 10666.666667, 'Nilai Keluar': 320000, 'Saldo Qty': 120, 'Saldo Nilai': 1280000 })
    expect(sale['Keterangan']).toBe('Toko A')
    expect(buy['Keterangan']).toBe('PT Pemasok | Pembelian rutin')
  })

  it('SKU tetap teks (nol di depan) dan sel bertipe string dengan format teks', () => {
    const ws = wb.Sheets.KARTU_STOK
    const sku = ws[XLSX.utils.encode_cell({ r: 2, c: 4 })]
    expect(sku).toMatchObject({ t: 's', v: '00123', z: '@' })
    expect(sheetRows(wb, 'KARTU_STOK').every((r) => r['SKU'] === '00123')).toBe(true)
  })

  it('tanggal berupa nomor seri Excel pada jam Jakarta dengan format tanggal', () => {
    const ws = wb.Sheets.KARTU_STOK
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c: 0 })] // baris data pertama (setelah saldo awal)
    expect(cell.z).toBe(FMT.datetime)
    // 2026-11-10 05:00 UTC = 12:00 WIB
    expect(cell.v).toBeCloseTo(excelSerialDate('2026-11-10') + 12 / 24, 6)
    expect(XLSX.SSF.format(FMT.datetime, cell.v as number)).toBe('10/11/2026 12:00')
    expect(excelSerialJakarta('2026-11-12T17:30:00+00:00')).toBeCloseTo(excelSerialDate('2026-11-13') + 0.5 / 24, 6) // melewati tengah malam WIB
  })

  it('format rupiah dan angka konsisten per jenis kolom', () => {
    const ws = wb.Sheets.KARTU_STOK
    const at = (c: number) => ws[XLSX.utils.encode_cell({ r: 3, c })]
    expect(at(6).z).toBe(FMT.qty) // qty keluar... baris OUT
    expect(at(9).z).toBe(FMT.qty)
    expect(at(8).z === undefined || at(8).z === FMT.rupiah).toBe(true)
    const buy = (c: number) => ws[XLSX.utils.encode_cell({ r: 2, c })]
    expect(buy(7).z).toBe(FMT.cost)
    expect(buy(8).z).toBe(FMT.rupiah)
    expect(buy(14).z).toBe(FMT.rupiah)
  })

  it('saldo awal, total periode, dan saldo akhir ada di lembar dan cocok dengan server', () => {
    const rows = sheetRows(wb, 'KARTU_STOK')
    const open = rows.find((r) => r['Keterangan'] === 'SALDO AWAL')!
    expect(open).toMatchObject({ 'Saldo Qty': 100, 'Average Cost': 10000, 'Saldo Nilai': 1000000 })
    const tot = rows.find((r) => r['Keterangan'] === 'TOTAL PERIODE')!
    expect(tot).toMatchObject({ 'Qty Masuk': 50, 'Nilai Masuk': 600000, 'Qty Keluar': 30, 'Nilai Keluar': 320000 })
    const close = rows.find((r) => r['Keterangan'] === 'SALDO AKHIR')!
    expect(close).toMatchObject({ 'Saldo Qty': 120, 'Saldo Nilai': 1280000, 'Average Cost': 10666.666667 })
  })

  it('total periode = jumlah baris, dan saldo awal + masuk - keluar = saldo akhir', () => {
    expect(sum(card.rows.map((r) => r.value_in), 2)).toBe(card.totals.value_in)
    expect(sum(card.rows.map((r) => r.qty_out), 4)).toBe(card.totals.qty_out)
    const closeQty = toScaled(card.opening.qty, 4) + toScaled(card.totals.qty_in, 4) - toScaled(card.totals.qty_out, 4)
    expect(formatScaled(closeQty, 4)).toBe(card.closing.qty)
    const closeVal = toScaled(card.opening.value, 2) + toScaled(card.totals.value_in, 2) - toScaled(card.totals.value_out, 2)
    expect(formatScaled(closeVal, 2)).toBe(card.closing.value)
  })

  it('lembar RINGKASAN memuat SKU, periode, dan saldo', () => {
    const info = XLSX.utils.sheet_to_json<string[]>(roundTrip(wb).Sheets.RINGKASAN, { header: 1 })
    const m = Object.fromEntries(info.map((r) => [r[0], r[1]]))
    expect(m['SKU']).toBe('00123')
    expect(m['Periode']).toBe('2026-11-01 s.d. 2026-11-19')
    expect(m['Saldo akhir (nilai)']).toBe('1280000.00')
  })
})

const summaryFixture: StockSummary = {
  rows: [
    { sku: '00123', barcode: '0001234567890', product_name: 'Air Mineral', category: 'Minuman', brand: 'X', unit: 'PCS', location: 'A-01', is_active: true,
      quantity: '120.0000', average_cost: '10666.666667', inventory_value: '1280000.00', minimum_stock: '20.0000', shortage: '0.0000', status: 'AMAN' },
    { sku: '1E5', barcode: null, product_name: 'Kopi', category: null, brand: null, unit: 'DUS', location: null, is_active: true,
      quantity: '3.5000', average_cost: '33.333333', inventory_value: '116.67', minimum_stock: '10.0000', shortage: '6.5000', status: 'RENDAH' },
  ],
  totals: { count: 2, total_qty: '123.5000', total_value: '1280116.67' },
}

describe('saldo stok, low stock, dan zero stock', () => {
  it('kolom, tipe, dan total', () => {
    const { wb, fileName } = stockSummaryWorkbook(summaryFixture, '2026-11-19')
    expect(fileName).toBe('WHISTLE_Saldo_Stok_2026-11-19.xlsx')
    const rows = sheetRows(wb, 'SALDO_STOK')
    expect(rows[0]).toMatchObject({
      SKU: '00123', Barcode: '0001234567890', 'Nama Barang': 'Air Mineral', Quantity: 120, 'Average Cost': 10666.666667,
      'Nilai Persediaan': 1280000, 'Minimum Stock': 20, 'Status Stok': 'AMAN',
    })
    expect(rows[1]).toMatchObject({ SKU: '1E5', Quantity: 3.5, 'Nilai Persediaan': 116.67, 'Status Stok': 'RENDAH' })
    const total = rows.find((r) => r['Nama Barang'] === 'TOTAL')!
    expect(total).toMatchObject({ Quantity: 123.5, 'Nilai Persediaan': 1280116.67 })
  })

  it('SKU seperti "1E5" dan barcode bernol di depan tidak berubah menjadi angka', () => {
    const { wb } = stockSummaryWorkbook(summaryFixture, '2026-11-19')
    const ws = wb.Sheets.SALDO_STOK
    expect(ws.A3).toMatchObject({ t: 's', v: '1E5', z: '@' })
    expect(ws.B2).toMatchObject({ t: 's', v: '0001234567890', z: '@' })
    const re = roundTrip(wb).Sheets.SALDO_STOK
    expect(re.A3.v).toBe('1E5')
    expect(re.B2.v).toBe('0001234567890')
  })

  it('total server = jumlah baris', () => {
    expect(sum(summaryFixture.rows.map((r) => r.quantity), 4)).toBe(summaryFixture.totals.total_qty)
    expect(sum(summaryFixture.rows.map((r) => r.inventory_value), 2)).toBe(summaryFixture.totals.total_value)
  })

  it('Low Stock memuat kolom Kekurangan; Zero Stock dan nama file sendiri', () => {
    const low = stockSummaryWorkbook(summaryFixture, '2026-11-19', 'low')
    expect(low.fileName).toBe('WHISTLE_Low_Stock_2026-11-19.xlsx')
    expect(low.wb.SheetNames).toEqual(['LOW_STOCK'])
    expect(sheetRows(low.wb, 'LOW_STOCK')[1]).toMatchObject({ Kekurangan: 6.5 })
    const zero = stockSummaryWorkbook(summaryFixture, '2026-11-19', 'zero')
    expect(zero.fileName).toBe('WHISTLE_Zero_Stock_2026-11-19.xlsx')
    expect(sheetRows(zero.wb, 'ZERO_STOCK')[0]).not.toHaveProperty('Kekurangan')
  })

  it('laporan kosong tetap valid dengan satu baris TOTAL', () => {
    const { wb } = stockSummaryWorkbook({ rows: [], totals: { count: 0, total_qty: '0.0000', total_value: '0.00' } }, '2026-11-19')
    const rows = sheetRows(wb, 'SALDO_STOK')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ 'Nama Barang': 'TOTAL', 'Nilai Persediaan': 0 })
  })
})

describe('inventory valuation', () => {
  const valuation: Valuation = {
    rows: [
      { sku: 'A', product_name: 'A', category: 'X', unit: 'PCS', quantity: '120.0000', average_cost: '10666.666667', inventory_value: '1280000.00' },
      { sku: 'B', product_name: 'B', category: null, unit: 'PCS', quantity: '3.0000', average_cost: '33.333333', inventory_value: '100.00' },
    ],
    totals: { count: 2, total_qty: '123.0000', total_value: '1280100.00', all_balance_qty: '123.0000', all_balance_value: '1280100.00', ledger_qty: '123.0000', ledger_value: '1280100.00', reconciled: true },
  }

  it('total nilai persediaan dan lembar rekonsiliasi', () => {
    const { wb, fileName } = valuationWorkbook(valuation, '2026-11-19')
    expect(fileName).toBe('WHISTLE_Inventory_Valuation_2026-11-19.xlsx')
    const total = sheetRows(wb, 'VALUATION').find((r) => r['Nama Barang'] === 'TOTAL NILAI PERSEDIAAN')!
    expect(total).toMatchObject({ Quantity: 123, 'Nilai Persediaan': 1280100 })
    expect(sum(valuation.rows.map((r) => r.inventory_value), 2)).toBe(valuation.totals.total_value)
    const info = XLSX.utils.sheet_to_json<string[]>(roundTrip(wb).Sheets.REKONSILIASI, { header: 1 })
    expect(Object.fromEntries(info.map((r) => [r[0], r[1]]))['Rekonsiliasi saldo vs ledger']).toBe('SESUAI')
    const bad = valuationWorkbook({ ...valuation, totals: { ...valuation.totals, reconciled: false } }, '2026-11-19')
    const info2 = XLSX.utils.sheet_to_json<string[]>(roundTrip(bad.wb).Sheets.REKONSILIASI, { header: 1 })
    expect(Object.fromEntries(info2.map((r) => [r[0], r[1]]))['Rekonsiliasi saldo vs ledger']).toBe('TIDAK SESUAI')
  })
})

describe('stock movement', () => {
  const report: MovementReport = {
    from: '2026-11-01',
    to: '2026-11-19',
    rows: [
      { sku: 'A', product_name: 'A', category: 'X', unit: 'PCS', opening_qty: '100.0000', opening_value: '1000000.00', qty_in: '50.0000', value_in: '600000.00', qty_out: '30.0000', value_out: '320000.00', closing_qty: '120.0000', closing_value: '1280000.00' },
      { sku: 'B', product_name: 'B', category: null, unit: 'PCS', opening_qty: '0.0000', opening_value: '0.00', qty_in: '10.0000', value_in: '500.00', qty_out: '0.0000', value_out: '0.00', closing_qty: '10.0000', closing_value: '500.00' },
    ],
    totals: {
      count: 2, opening_qty: '100.0000', opening_value: '1000000.00', qty_in: '60.0000', value_in: '600500.00', qty_out: '30.0000', value_out: '320000.00',
      closing_qty: '130.0000', closing_value: '1280500.00',
      by_type: [{ movement_type: 'IN', count: 2, qty_in: '60.0000', value_in: '600500.00', qty_out: '0.0000', value_out: '0.00' }, { movement_type: 'OUT', count: 1, qty_in: '0.0000', value_in: '0.00', qty_out: '30.0000', value_out: '320000.00' }],
    },
  }

  it('kolom masuk/keluar/HPP/saldo akhir dan total tidak tertukar', () => {
    const { wb, fileName } = movementWorkbook(report)
    expect(fileName).toBe('WHISTLE_Stock_Movement_2026-11-01_sd_2026-11-19.xlsx')
    const a = sheetRows(wb, 'STOCK_MOVEMENT')[0]
    expect(a).toMatchObject({ 'Saldo Awal Qty': 100, 'Saldo Awal Nilai': 1000000, 'Qty Masuk': 50, 'Nilai Masuk': 600000, 'Qty Keluar': 30, 'HPP (Nilai Keluar)': 320000, 'Saldo Akhir Qty': 120, 'Saldo Akhir Nilai': 1280000 })
    const total = sheetRows(wb, 'STOCK_MOVEMENT').find((r) => r['Nama Barang'] === 'TOTAL')!
    expect(total).toMatchObject({ 'Qty Masuk': 60, 'Nilai Masuk': 600500, 'HPP (Nilai Keluar)': 320000, 'Saldo Akhir Nilai': 1280500 })
  })

  it('identitas per baris dan total (saldo awal + masuk - keluar = saldo akhir)', () => {
    for (const r of report.rows) {
      expect(formatScaled(toScaled(r.opening_qty, 4) + toScaled(r.qty_in, 4) - toScaled(r.qty_out, 4), 4)).toBe(r.closing_qty)
      expect(formatScaled(toScaled(r.opening_value, 2) + toScaled(r.value_in, 2) - toScaled(r.value_out, 2), 2)).toBe(r.closing_value)
    }
    expect(sum(report.rows.map((r) => r.closing_value), 2)).toBe(report.totals.closing_value)
    expect(sum(report.rows.map((r) => r.value_out), 2)).toBe(report.totals.value_out)
  })

  it('rincian per jenis mutasi ada di lembar PER_JENIS', () => {
    const { wb } = movementWorkbook(report)
    const types = sheetRows(wb, 'PER_JENIS')
    expect(types.map((x) => x['Jenis Mutasi'])).toEqual(['IN', 'OUT'])
    expect(types[1]).toMatchObject({ 'Qty Keluar': 30, 'Nilai Keluar': 320000 })
  })
})

describe('barang masuk, barang keluar, dan transaction history', () => {
  const lines = (type: 'IN' | 'OUT'): TransactionLines => ({
    from: '2026-11-01', to: '2026-11-19', type,
    rows: [
      { transaction_date: '2026-11-10T05:00:00+00:00', transaction_number: 'N-1', status: 'POSTED', reference_number: 'D-1', supplier_or_recipient: 'Pihak', notes: 'Cat', sku: '00123', product_name: 'Air', unit: 'PCS', quantity: '50.0000', unit_cost: '12000.000000', total_value: '600000.00', created_by_name: 'Admin' },
      { transaction_date: '2026-11-11T05:00:00+00:00', transaction_number: 'N-2', status: 'REVERSED', reference_number: 'D-2', supplier_or_recipient: null, notes: null, sku: '00124', product_name: 'Kopi', unit: 'PCS', quantity: '5.0000', unit_cost: '100.000000', total_value: '500.00', created_by_name: 'Admin' },
    ],
    totals: { count: 1, total_qty: '50.0000', total_value: '600000.00', excluded_count: 1 },
  })

  it('Barang Masuk: judul kolom, total hanya POSTED, nama file periode', () => {
    const { wb, fileName } = transactionLinesWorkbook(lines('IN'))
    expect(fileName).toBe('WHISTLE_Barang_Masuk_2026-11-01_sd_2026-11-19.xlsx')
    expect(wb.SheetNames).toEqual(['BARANG_MASUK'])
    const rows = sheetRows(wb, 'BARANG_MASUK')
    expect(rows[0]).toMatchObject({ Supplier: 'Pihak', SKU: '00123', Quantity: 50, 'Harga Beli per Unit': 12000, 'Nilai Masuk': 600000, Status: 'POSTED' })
    expect(rows[1]).toMatchObject({ Status: 'REVERSED' })
    const total = rows.find((r) => r['Nama Barang'] === 'TOTAL (hanya status POSTED)')!
    expect(total).toMatchObject({ Quantity: 50, 'Nilai Masuk': 600000 })
  })

  it('Barang Keluar memakai judul HPP', () => {
    const { wb, fileName } = transactionLinesWorkbook(lines('OUT'))
    expect(fileName).toBe('WHISTLE_Barang_Keluar_2026-11-01_sd_2026-11-19.xlsx')
    const header = Object.keys(sheetRows(wb, 'BARANG_KELUAR')[0])
    expect(header).toEqual(expect.arrayContaining(['Penerima/Tujuan', 'HPP per Unit', 'Nilai Keluar (HPP)']))
    expect(header).not.toContain('Harga Beli per Unit')
  })

  it('Transaction History: kolom, tipe, total POSTED, dan nama file', () => {
    const history: TransactionHistory = {
      rows: [
        { id: '1', transaction_number: 'IN-1', transaction_type: 'IN', status: 'POSTED', transaction_date: '2026-11-10T05:00:00+00:00', posted_at: null, reference_number: 'PO-1', supplier_or_recipient: 'PT', notes: null, reason: null, created_by: 'u', created_by_name: 'Admin', approved_by_name: null, item_count: 2, total_value: '600000.00', reversal_of_number: null },
        { id: '2', transaction_number: 'REV-1', transaction_type: 'REVERSAL', status: 'POSTED', transaction_date: '2026-11-11T05:00:00+00:00', posted_at: null, reference_number: 'IN-1', supplier_or_recipient: null, notes: 'Reversal IN-1', reason: 'Salah input', created_by: 'u', created_by_name: 'Admin', approved_by_name: 'Admin', item_count: 1, total_value: '500.00', reversal_of_number: 'IN-1' },
      ],
      total_count: 2,
      totals: { posted_total_value: '600500.00' },
    }
    const { wb, fileName } = transactionHistoryWorkbook(history, '2026-11-01', '2026-11-19')
    expect(fileName).toBe('WHISTLE_Transaction_History_2026-11-01_sd_2026-11-19.xlsx')
    const rows = sheetRows(wb, 'TRANSACTION_HISTORY')
    expect(rows[0]).toMatchObject({ 'No. Transaksi': 'IN-1', Jenis: 'IN', 'Jumlah Item': 2, 'Total Nilai': 600000 })
    expect(rows[1]).toMatchObject({ 'Reversal dari': 'IN-1', Alasan: 'Salah input' })
    expect(rows.find((r) => String(r['Supplier/Penerima']).startsWith('TOTAL'))).toMatchObject({ 'Total Nilai': 600500 })
    expect(sum(history.rows.map((r) => r.total_value), 2)).toBe(history.totals.posted_total_value)
    expect(transactionHistoryWorkbook(history, null, null).fileName).toBe('WHISTLE_Transaction_History_semua_periode.xlsx')
  })
})

describe('utilitas', () => {
  it('periodLabel', () => {
    expect(periodLabel('2026-01-01', '2026-01-31')).toBe('2026-01-01_sd_2026-01-31')
    expect(periodLabel(null, '2026-01-31')).toBe('awal_sd_2026-01-31')
    expect(periodLabel('2026-01-01', null)).toBe('2026-01-01_sd_akhir')
    expect(periodLabel(null, null)).toBe('semua_periode')
  })

  it('1.000 baris tetap dihasilkan dengan benar dan total sama dengan jumlah baris', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      sku: String(i).padStart(6, '0'), product_name: `B${i}`, category: null, unit: 'PCS',
      quantity: '1.0000', average_cost: '12.500000', inventory_value: '12.50',
    }))
    const v: Valuation = {
      rows,
      totals: { count: 1000, total_qty: '1000.0000', total_value: '12500.00', all_balance_qty: '1000.0000', all_balance_value: '12500.00', ledger_qty: '1000.0000', ledger_value: '12500.00', reconciled: true },
    }
    expect(sum(rows.map((r) => r.inventory_value), 2)).toBe(v.totals.total_value)
    const { wb } = valuationWorkbook(v, '2026-11-19')
    const out = sheetRows(wb, 'VALUATION')
    expect(out).toHaveLength(1001) // 1000 + baris total
    expect(out[0].SKU).toBe('000000')
    expect(out[999].SKU).toBe('000999')
  })
})
