import { describe, expect, it } from 'vitest'
import { compareDecimal, multiplyRound } from '../src/utils/decimal'
import {
  buildItems,
  estimateValue,
  jakartaToday,
  mapPostError,
  resolveTransactionDate,
  sumEstimates,
  validateLines,
  type TxLine,
} from '../src/utils/transactionForm'

const line = (over: Partial<TxLine> = {}): TxLine => ({
  sku: 'SKU-1', name: 'Barang', unit: 'PCS', quantity: '10', unitCost: '12000', ...over,
})

describe('decimal: perkiraan nilai untuk pratinjau', () => {
  it('qty × harga dibulatkan setengah ke atas pada 2 desimal', () => {
    expect(multiplyRound('50', '12000')).toBe('600000.00')
    expect(multiplyRound('30', '10666.666667')).toBe('320000.00')
    expect(multiplyRound('2.5', '1234.567891')).toBe('3086.42')
    expect(multiplyRound('3', '3.333333')).toBe('10.00')
    expect(multiplyRound('0.0001', '0.01')).toBe('0.00')
  })

  it('membandingkan desimal tanpa float', () => {
    expect(compareDecimal('120', '120.0000')).toBe(0)
    expect(compareDecimal('120.0001', '120')).toBe(1)
    expect(compareDecimal('9.9999', '10')).toBe(-1)
  })
})

describe('validateLines: Barang Masuk', () => {
  it('dokumen kosong ditolak', () => {
    expect(validateLines('IN', [])).toEqual([{ index: -1, field: 'line', message: 'Tambahkan minimal satu barang' }])
  })

  it('baris valid tanpa masalah', () => {
    expect(validateLines('IN', [line(), line({ sku: 'SKU-2', quantity: '2,5', unitCost: '0' })])).toEqual([])
  })

  it('quantity wajib, harus > 0, maks 4 desimal, bukan angka ambigu', () => {
    const msg = (quantity: string) => validateLines('IN', [line({ quantity })])[0]?.message
    expect(msg('')).toMatch(/wajib/)
    expect(msg('0')).toMatch(/lebih dari 0/)
    expect(msg('0,0000')).toMatch(/lebih dari 0/)
    expect(msg('-1')).toMatch(/negatif/)
    expect(msg('1.00001')).toMatch(/maksimal 4/)
    expect(msg('1.000')).toMatch(/ambigu/)
    expect(msg('abc')).toMatch(/tidak valid/)
  })

  it('harga beli wajib (boleh 0), maks 6 desimal', () => {
    const msg = (unitCost: string) => validateLines('IN', [line({ unitCost })])[0]?.message
    expect(msg('')).toMatch(/Harga beli wajib/)
    expect(msg('10.1234567')).toMatch(/maksimal 6/)
    expect(msg('-5')).toMatch(/negatif/)
    expect(msg('0')).toBeUndefined()
  })

  it('SKU ganda dalam satu dokumen ditandai', () => {
    const issues = validateLines('IN', [line(), line()])
    expect(issues).toEqual([{ index: 1, field: 'line', message: 'SKU SKU-1 sudah ada di daftar' }])
  })
})

describe('validateLines: Barang Keluar', () => {
  it('harga beli tidak diminta', () => {
    expect(validateLines('OUT', [line({ unitCost: '', available: '50' })])).toEqual([])
  })

  it('melebihi stok tersedia menurut server ditandai sebelum posting', () => {
    expect(validateLines('OUT', [line({ quantity: '50', available: '50' })])).toEqual([])
    const issues = validateLines('OUT', [line({ quantity: '50.0001', available: '50' })])
    expect(issues).toEqual([{ index: 0, field: 'quantity', message: 'Melebihi stok tersedia (50)' }])
  })

  it('stok tidak diketahui tidak memblokir (server tetap menolak jika kurang)', () => {
    expect(validateLines('OUT', [line({ quantity: '999999' })])).toEqual([])
  })
})

describe('buildItems: payload ke post_transaction', () => {
  it('IN memuat quantity dan unit_cost kanonik berupa teks', () => {
    expect(buildItems('IN', [line({ quantity: '2,5', unitCost: '12.500000' })])).toEqual([
      { sku: 'SKU-1', quantity: '2.5', unit_cost: '12.5' },
    ])
  })

  it('OUT hanya memuat quantity (HPP dihitung server)', () => {
    expect(buildItems('OUT', [line({ quantity: '30', unitCost: '999' })])).toEqual([{ sku: 'SKU-1', quantity: '30' }])
  })

  it('SKU dan angka tidak berubah format (nol di depan tetap)', () => {
    expect(buildItems('OUT', [line({ sku: '00123', quantity: '007' })])).toEqual([{ sku: '00123', quantity: '7' }])
  })

  it('melempar error jika dipakai pada data tidak valid', () => {
    expect(() => buildItems('IN', [line({ quantity: 'x' })])).toThrow(/tidak valid/)
  })
})

describe('estimateValue dan sumEstimates (pratinjau)', () => {
  it('IN = qty × harga beli', () => {
    expect(estimateValue('IN', line({ quantity: '50', unitCost: '12000' }))).toBe('600000.00')
  })

  it('OUT = qty × average cost dari server (estimasi HPP)', () => {
    expect(estimateValue('OUT', line({ quantity: '30', available: '150', averageCost: '10666.666667', inventoryValue: '1600000' }))).toBe('320000.00')
  })

  it('OUT seluruh stok memakai seluruh nilai persediaan (tidak ada sisa pembulatan)', () => {
    expect(estimateValue('OUT', line({ quantity: '3', available: '3', averageCost: '33.333333', inventoryValue: '100.00' }))).toBe('100.00')
    // PostgREST mengirim numeric sebagai number (tanpa desimal) -> tetap diformat 2 desimal
    expect(estimateValue('OUT', line({ quantity: '3', available: '3', averageCost: '33.333333', inventoryValue: '100' }))).toBe('100.00')
    expect(estimateValue('OUT', line({ quantity: '3', available: '3', averageCost: '33.333333', inventoryValue: '1280000.5' }))).toBe('1280000.50')
  })

  it('tanpa data average cost, estimasi tidak ditampilkan', () => {
    expect(estimateValue('OUT', line({ quantity: '3' }))).toBeNull()
    expect(estimateValue('IN', line({ unitCost: '' }))).toBeNull()
  })

  it('total estimasi dijumlahkan tanpa float', () => {
    expect(sumEstimates(['0.10', '0.20'])).toBe('0.30')
    expect(sumEstimates(['600000.00', '1280000'])).toBe('1880000.00')
    expect(sumEstimates(['1.00', null])).toBeNull()
  })
})

describe('resolveTransactionDate (kalender Asia/Jakarta)', () => {
  const now = new Date('2026-11-18T20:00:00Z') // 19 Nov 2026 03:00 WIB

  it('tanggal hari ini (WIB) memakai waktu sekarang', () => {
    expect(jakartaToday(now)).toBe('2026-11-19')
    expect(resolveTransactionDate('2026-11-19', now)).toEqual({ iso: now.toISOString(), relation: 'today' })
  })

  it('tanggal lalu dan depan memakai pukul 12:00 WIB', () => {
    expect(resolveTransactionDate('2026-11-17', now)).toEqual({ iso: '2026-11-17T05:00:00.000Z', relation: 'past' })
    expect(resolveTransactionDate('2026-11-25', now).relation).toBe('future')
  })

  it('format tidak valid terdeteksi', () => {
    expect(resolveTransactionDate('19/11/2026', now).relation).toBe('invalid')
    expect(resolveTransactionDate('2026-13-45', now).relation).toBe('invalid')
  })
})

describe('mapPostError: notifikasi sesuai kode error server', () => {
  it('stok tidak mencukupi', () => {
    expect(mapPostError({ code: 'WS001', message: 'Stok tidak mencukupi untuk SKU A: tersedia 5, diminta 6' })).toEqual({
      kind: 'insufficient', message: 'Stok tidak mencukupi untuk SKU A: tersedia 5, diminta 6',
    })
  })

  it('SKU tidak ditemukan dan barang nonaktif', () => {
    expect(mapPostError({ code: 'WS003', message: 'Baris 2: SKU XYZ tidak ditemukan' }).kind).toBe('notfound')
    expect(mapPostError({ code: 'WS003', message: 'Baris 1: barang A tidak aktif' }).kind).toBe('inactive')
    expect(mapPostError({ code: 'WS003', message: 'Baris 1: quantity harus lebih dari 0' }).kind).toBe('validation')
  })

  it('tanggal mundur, hak akses, offline, dan tidak dikenal', () => {
    expect(mapPostError({ code: 'WS002', message: 'Transaksi bertanggal mundur' }).kind).toBe('backdated')
    expect(mapPostError({ code: '42501', message: 'Anda tidak berhak' }).kind).toBe('forbidden')
    expect(mapPostError({ message: 'TypeError: Failed to fetch' }).kind).toBe('offline')
    expect(mapPostError({ code: 'XX000', message: 'boom' })).toEqual({ kind: 'unknown', message: 'boom' })
    expect(mapPostError(null).kind).toBe('unknown')
  })
})
