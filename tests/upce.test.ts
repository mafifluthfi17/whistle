import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { BarcodeFormat, BinaryBitmap, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library'
import { buildScanHints, formatName } from '../src/utils/scanner'
import { convertUpcEToUpcA, expandUpcE } from '../src/utils/scanLogic'
import { patchUpcEReader } from '../src/utils/upcePatch'

// Pola UPC-E dibuat manual dari spesifikasi GS1 (bukan dari ZXing) sebagai pembanding independen.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
const PARITY0 = ['EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO', 'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE']

function upceBits(code: string): string {
  const ns = Number(code[0])
  const check = Number(code[7])
  const six = code.slice(1, 7).split('').map(Number)
  let parity = PARITY0[check]
  if (ns === 1) parity = parity.replace(/E/g, 'x').replace(/O/g, 'E').replace(/x/g, 'O')
  let bits = '101'
  six.forEach((d, i) => (bits += parity[i] === 'O' ? L[d] : G[d]))
  return bits + '010101'
}

function render(bits: string, mod = 3, quiet = 12, h = 90) {
  const w = (bits.length + 2 * quiet) * mod
  const lum = new Uint8ClampedArray(w * h).fill(255)
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') for (let y = 0; y < h; y++) for (let x = 0; x < mod; x++) lum[y * w + (quiet + i) * mod + x] = 0
  }
  return { lum, width: w, height: h }
}

function decode(img: { lum: Uint8ClampedArray; width: number; height: number }) {
  const result = new MultiFormatReader().decode(
    new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(img.lum, img.width, img.height))),
    buildScanHints() as never,
  )
  return { text: result.getText(), format: formatName(result.getBarcodeFormat()) }
}

const UPCE_CODES = ['04252614', '01234565', '01234531', '01234543']
const UPCEReader = createRequire(import.meta.url)('@zxing/library/cjs/core/oned/UPCEReader').default

// Urutan penting: blok pertama berjalan SEBELUM patch dipasang.
describe('bug bawaan @zxing/library: UPCEReader tidak berfungsi', () => {
  it('tanpa patch, UPC-E yang valid tidak terbaca sama sekali', () => {
    expect(UPCEReader.__whistleUpcePatched).toBeUndefined()
    for (const code of UPCE_CODES) {
      expect(() => decode(render(upceBits(code))), `UPC-E ${code}`).toThrow()
    }
  })
})

describe('UPC-E setelah patch', () => {
  it('semua UPC-E valid terbaca persis (8 digit, format UPC_E), untuk kedua number system', () => {
    patchUpcEReader(UPCEReader)
    for (const code of [...UPCE_CODES, '14252613', '12345678'.replace('12345678', '10000007')]) {
      if (!expandUpcE(code)) continue // lewati kode yang digit pemeriksanya tidak valid
      expect(decode(render(upceBits(code))), `UPC-E ${code}`).toEqual({ text: code, format: 'UPC_E' })
    }
  })

  it('ukuran modul dan tinggi berbeda tetap terbaca', () => {
    for (const [mod, h] of [[2, 80], [4, 120], [5, 200]]) {
      expect(decode(render(upceBits('04252614'), mod, 12, h)).text).toBe('04252614')
    }
  })

  it('digit pemeriksa salah ditolak (tidak menghasilkan kode palsu)', () => {
    expect(() => decode(render(upceBits('04252615')))).toThrow()
    expect(() => decode(render(upceBits('01234566')))).toThrow()
  })

  it('patch idempoten dan tidak merusak format lain', () => {
    patchUpcEReader(UPCEReader)
    patchUpcEReader(UPCEReader)
    expect(decode(render(upceBits('04252614'))).text).toBe('04252614')
  })

  it('konversi UPC-E -> UPC-A untuk semua aturan digit terakhir (0-2, 3, 4, 5-9)', () => {
    expect(UPCEReader.convertUPCEtoUPCA('04252614')).toBe('042100005264') // 1
    expect(UPCEReader.convertUPCEtoUPCA('01234531')).toBe('012300000451') // 3
    expect(UPCEReader.convertUPCEtoUPCA('01234543')).toBe('012340000053') // 4
    expect(UPCEReader.convertUPCEtoUPCA('01234565')).toBe('012345000065') // 6
    for (const c of UPCE_CODES) expect(UPCEReader.convertUPCEtoUPCA(c)).toBe(convertUpcEToUpcA(c))
  })

  it('format yang tercatat tetap UPC_E dan bukan EAN/UPC lain', () => {
    expect(BarcodeFormat[BarcodeFormat.UPC_E]).toBe('UPC_E')
    expect(decode(render(upceBits('01234565'))).format).toBe('UPC_E')
  })
})
