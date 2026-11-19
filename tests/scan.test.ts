import { describe, expect, it } from 'vitest'
import { BarcodeFormat } from '@zxing/library'
import { addQuantities } from '../src/utils/decimal'
import {
  cleanScan,
  describeCameraError,
  expandUpcE,
  extractFromQr,
  isValidGtin,
  pickBestMatch,
  scanCandidates,
} from '../src/utils/scanLogic'
import { buildScanHints, formatName, rearCameraConstraints, SUPPORTED_FORMATS } from '../src/utils/scanner'
import { DecodeHintType } from '@zxing/library'

describe('format yang didukung (Bagian 13)', () => {
  it('tepat 7 format: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, QR', () => {
    expect(SUPPORTED_FORMATS.map(formatName).sort()).toEqual(
      ['CODE_128', 'CODE_39', 'EAN_13', 'EAN_8', 'QR_CODE', 'UPC_A', 'UPC_E'],
    )
    const hints = buildScanHints()
    expect(hints.get(DecodeHintType.POSSIBLE_FORMATS)).toEqual(SUPPORTED_FORMATS)
    expect(SUPPORTED_FORMATS).not.toContain(BarcodeFormat.PDF_417)
  })

  it('kamera belakang menjadi default dan dapat memilih kamera tertentu', () => {
    expect(rearCameraConstraints()).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } })
    expect(rearCameraConstraints('abc')).toMatchObject({ video: { deviceId: { exact: 'abc' } } })
  })
})

describe('cleanScan dan QR', () => {
  it('membuang karakter kontrol dan spasi di tepi', () => {
    expect(cleanScan('  8999999000011\r\n')).toBe('8999999000011')
    expect(cleanScan('AB\u001d12')).toBe('AB12')
  })

  it('teks biasa dipakai apa adanya', () => {
    expect(extractFromQr('SKU-0001')).toBe('SKU-0001')
    expect(extractFromQr('00123')).toBe('00123')
  })

  it('URL berparameter sku/barcode dan JSON diambil nilainya', () => {
    expect(extractFromQr('https://gudang.example/p?sku=SKU-77&x=1')).toBe('SKU-77')
    expect(extractFromQr('https://gudang.example/p?barcode=0001234567890')).toBe('0001234567890')
    expect(extractFromQr('{"sku":"SKU-9","qty":3}')).toBe('SKU-9')
    expect(extractFromQr('{"Barcode": 8999999000011}')).toBe('8999999000011')
  })

  it('URL tanpa parameter dikenali atau JSON rusak tidak melempar error', () => {
    expect(extractFromQr('https://example.com/halaman')).toBe('https://example.com/halaman')
    expect(extractFromQr('{rusak')).toBe('{rusak')
  })
})

describe('GTIN dan UPC-E', () => {
  it('digit pemeriksa EAN-13, EAN-8, UPC-A', () => {
    expect(isValidGtin('4006381333931')).toBe(true) // EAN-13
    expect(isValidGtin('4006381333932')).toBe(false)
    expect(isValidGtin('96385074')).toBe(true) // EAN-8
    expect(isValidGtin('042100005264')).toBe(true) // UPC-A
    expect(isValidGtin('12345')).toBe(false)
    expect(isValidGtin('abcd1234')).toBe(false)
  })

  it('UPC-E diperluas ke UPC-A untuk setiap aturan digit terakhir', () => {
    expect(expandUpcE('04252614')).toBe('042100005264') // akhiran 0-2
    expect(expandUpcE('01234565')).toBe('012345000065') // akhiran 5-9
    expect(expandUpcE('01234531')).toBe('012300000451') // akhiran 3
    expect(expandUpcE('01234543')).toBe('012340000053') // akhiran 4
    for (const e of ['04252614', '01234565', '01234531', '01234543']) {
      expect(isValidGtin(expandUpcE(e)!)).toBe(true)
    }
  })

  it('UPC-E tidak valid ditolak', () => {
    expect(expandUpcE('04252615')).toBeNull() // check digit salah
    expect(expandUpcE('24252614')).toBeNull() // number system 2 tidak valid
    expect(expandUpcE('123')).toBeNull()
  })
})

describe('scanCandidates', () => {
  it('UPC-A (12) juga dicari sebagai EAN-13 berawalan 0, dan sebaliknya', () => {
    expect(scanCandidates('042100005264')).toEqual(['042100005264', '0042100005264'])
    expect(scanCandidates('0042100005264')).toEqual(['0042100005264', '042100005264'])
  })

  it('EAN-13 tanpa awalan 0 dan teks SKU tidak diubah', () => {
    expect(scanCandidates('4006381333931')).toEqual(['4006381333931'])
    expect(scanCandidates('SKU-0001')).toEqual(['SKU-0001'])
  })

  it('UPC-E dicari sebagai UPC-E, UPC-A, dan EAN-13', () => {
    expect(scanCandidates('04252614')).toEqual(['04252614', '042100005264', '0042100005264'])
  })

  it('EAN-8 yang bukan UPC-E valid hanya dicari apa adanya', () => {
    expect(scanCandidates('96385074')).toEqual(['96385074'])
  })

  it('nol di depan SKU numerik tidak dihapus; kosong menghasilkan daftar kosong', () => {
    expect(scanCandidates('00123')).toEqual(['00123'])
    expect(scanCandidates('  \r\n')).toEqual([])
  })

  it('QR berisi URL/JSON dicari memakai nilainya', () => {
    expect(scanCandidates('{"sku":"SKU-9"}')).toEqual(['SKU-9'])
  })
})

describe('pickBestMatch: memilih barang dari hasil scan', () => {
  const rows = [
    { sku: 'SKU-1', barcode: '8999999000011', name: 'A' },
    { sku: '00123', barcode: '0001234567890', name: 'B' },
    { sku: 'ABC-9', barcode: null, name: 'C' },
    { sku: '042100005264', barcode: null, name: 'D' },
  ]

  it('barcode persis', () => {
    const r = pickBestMatch(['8999999000011'], rows)
    expect(r).toMatchObject({ kind: 'match', matchedBy: 'barcode', product: { name: 'A' } })
  })

  it('SKU persis, termasuk SKU numerik bernol di depan', () => {
    expect(pickBestMatch(['00123'], rows)).toMatchObject({ kind: 'match', matchedBy: 'sku', product: { name: 'B' } })
  })

  it('SKU tidak peka huruf besar/kecil (Code 39 hanya huruf besar)', () => {
    const r = pickBestMatch(['abc-9'], rows)
    expect(r).toMatchObject({ kind: 'match', matchedBy: 'sku', caseInsensitive: true, product: { name: 'C' } })
  })

  it('kandidat berurutan: UPC-A hasil scan ditemukan lewat kandidat EAN-13 tersimpan', () => {
    const stored = [{ sku: 'X', barcode: '0042100005264', name: 'E' }]
    expect(pickBestMatch(scanCandidates('042100005264'), stored)).toMatchObject({ kind: 'match', product: { name: 'E' } })
    const asUpcA = [{ sku: 'Y', barcode: '042100005264', name: 'F' }]
    expect(pickBestMatch(scanCandidates('0042100005264'), asUpcA)).toMatchObject({ kind: 'match', product: { name: 'F' } })
  })

  it('barcode lebih diutamakan daripada SKU yang kebetulan sama dengan barcode produk lain', () => {
    const clash = [
      { sku: '12345678', barcode: null, name: 'sku' },
      { sku: 'Z', barcode: '12345678', name: 'barcode' },
    ]
    expect(pickBestMatch(['12345678'], clash)).toMatchObject({ matchedBy: 'barcode', product: { name: 'barcode' } })
  })

  it('tidak ada kecocokan', () => {
    expect(pickBestMatch(['TIDAK-ADA'], rows)).toEqual({ kind: 'none' })
    expect(pickBestMatch([], rows)).toEqual({ kind: 'none' })
  })

  it('hasil ganda ditandai ambigu, bukan memilih sembarang', () => {
    const dup = [
      { sku: 'ab', barcode: null, name: '1' },
      { sku: 'AB', barcode: null, name: '2' },
    ]
    expect(pickBestMatch(['Ab'], dup)).toEqual({ kind: 'ambiguous', candidate: 'Ab' })
    // tetapi persis tetap dikenali
    expect(pickBestMatch(['AB'], dup)).toMatchObject({ kind: 'match', product: { name: '2' } })
  })

  it('wildcard ilike (_) tidak menghasilkan kecocokan palsu', () => {
    const r = pickBestMatch(['ABC_1'], [{ sku: 'ABCX1', barcode: null, name: 'salah' }])
    expect(r).toEqual({ kind: 'none' })
  })
})

describe('describeCameraError: pesan izin kamera dan error', () => {
  const ok = { secure: true, hasMediaDevices: true }

  it('konteks tidak aman (bukan HTTPS) dijelaskan lebih dulu', () => {
    expect(describeCameraError(new Error('x'), { secure: false, hasMediaDevices: false }).kind).toBe('insecure')
    expect(describeCameraError(null, { secure: false, hasMediaDevices: true }).message).toMatch(/HTTPS/)
  })

  it('browser tanpa mediaDevices', () => {
    expect(describeCameraError(null, { secure: true, hasMediaDevices: false }).kind).toBe('unsupported')
  })

  it('izin ditolak, kamera tidak ada, kamera sibuk, constraint, tidak dikenal', () => {
    const e = (name: string) => describeCameraError({ name }, ok)
    expect(e('NotAllowedError').kind).toBe('denied')
    expect(e('NotAllowedError').message).toMatch(/Izin kamera ditolak/)
    expect(e('NotFoundError').kind).toBe('nodevice')
    expect(e('NotReadableError').kind).toBe('busy')
    expect(e('OverconstrainedError').kind).toBe('constraint')
    expect(e('AnehError')).toEqual({ kind: 'unknown', message: expect.stringContaining('AnehError') })
  })
})

describe('addQuantities (menggabungkan baris SKU yang sama)', () => {
  it('menjumlah tanpa float dan merapikan nol di belakang', () => {
    expect(addQuantities('1.5', '2.5')).toBe('4')
    expect(addQuantities('0.1', '0.2')).toBe('0.3')
    expect(addQuantities('10', '0.0001')).toBe('10.0001')
    expect(addQuantities('0', '0')).toBe('0')
  })
})
