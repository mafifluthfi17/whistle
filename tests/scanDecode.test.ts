import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import bwipjs from 'bwip-js'
import { PNG } from 'pngjs'
import { BarcodeFormat, BinaryBitmap, HybridBinarizer, MultiFormatReader, QRCodeWriter, RGBLuminanceSource } from '@zxing/library'
import { buildScanHints, formatName } from '../src/utils/scanner'
import { pickBestMatch, scanCandidates } from '../src/utils/scanLogic'
import { patchUpcEReader } from '../src/utils/upcePatch'

// Pada aplikasi, perbaikan UPC-E dipasang oleh scannerSetup.ts (build ESM). Di Node memakai build CJS.
const UPCEReaderCjs = createRequire(import.meta.url)('@zxing/library/cjs/core/oned/UPCEReader').default
beforeAll(() => patchUpcEReader(UPCEReaderCjs))

/** QR dibuat oleh penulis QR milik ZXing sendiri (untuk isi panjang seperti URL). */
function qrImage(text: string) {
  const m = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 300, 300, new Map())
  const s = 2
  const w = m.getWidth() * s
  const h = m.getHeight() * s
  const lum = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = m.get(Math.floor(x / s), Math.floor(y / s)) ? 0 : 255
  return { lum, width: w, height: h }
}

/**
 * Barcode dibuat oleh generator independen (bwip-js), dirender ke PNG, lalu di-decode memakai
 * konfigurasi ZXing yang sama dengan scanner kamera di aplikasi (buildScanHints).
 */
async function makeImage(bcid: string, text: string, extra: Record<string, unknown> = {}) {
  const png = await bwipjs.toBuffer({ bcid, text, scale: 3, height: 15, paddingwidth: 12, paddingheight: 12, backgroundcolor: 'FFFFFF', ...extra })
  const img = PNG.sync.read(png)
  const lum = new Uint8ClampedArray(img.width * img.height)
  for (let i = 0; i < lum.length; i++) {
    const r = img.data[i * 4]
    const g = img.data[i * 4 + 1]
    const b = img.data[i * 4 + 2]
    lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return { lum, width: img.width, height: img.height }
}

function decodeImage(img: { lum: Uint8ClampedArray; width: number; height: number }) {
  // Sama seperti @zxing/browser: hints dikirim pada setiap decode (decode() tanpa hints mereset ke semua format)
  const reader = new MultiFormatReader()
  const result = reader.decode(
    new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(img.lum, img.width, img.height))),
    buildScanHints() as never,
  )
  return { text: result.getText(), format: formatName(result.getBarcodeFormat()) }
}

const scan = async (bcid: string, text: string, extra?: Record<string, unknown>) => decodeImage(await makeImage(bcid, text, extra))

describe('decode ketujuh format dengan konfigurasi scanner yang sama', () => {
  it.each([
    ['ean13', '4006381333931', '4006381333931', 'EAN_13'],
    ['ean8', '96385074', '96385074', 'EAN_8'],
    ['upca', '042100005264', '042100005264', 'UPC_A'],
    ['upce', '04252614', '04252614', 'UPC_E'],
    ['code128', 'SKU-0001', 'SKU-0001', 'CODE_128'],
    ['code39', 'ABC-123', 'ABC-123', 'CODE_39'],
  ])('%s', async (bcid, input, text, format) => {
    expect(await scan(bcid, input)).toEqual({ text, format })
  })

  it('QR Code (teks, URL, dan JSON)', async () => {
    // Penulis QR ZXing: teks dan URL. (Keluaran penulis ZXing untuk string JSON ini tidak terbaca oleh
    // pembacanya sendiri, sedangkan encoder independen bwip-js terbaca, jadi JSON diuji lewat bwip-js.)
    for (const value of ['SKU-0001', 'https://gudang.example/p?sku=SKU-77']) {
      expect(decodeImage(qrImage(value))).toEqual({ text: value, format: 'QR_CODE' })
    }
    // Generator independen (bwip-js): teks dan JSON
    for (const value of ['SKU-0001', '{"sku":"SKU-9"}']) {
      expect(await scan('qrcode', value)).toEqual({ text: value, format: 'QR_CODE' })
    }
  })

  it('Code 128 dengan SKU bernol di depan dan karakter campuran', async () => {
    expect(await scan('code128', '00123-A/B')).toEqual({ text: '00123-A/B', format: 'CODE_128' })
  })

  it('format di luar daftar (ITF-14/Data Matrix) tidak dikenali', async () => {
    await expect(scan('interleaved2of5', '12345670')).rejects.toThrow()
    await expect(scan('datamatrix', 'SKU-0001')).rejects.toThrow()
  })
})

describe('hasil decode -> pencarian barang', () => {
  const products = [
    { sku: 'SKU-1', barcode: '4006381333931' },
    { sku: 'UPC-ITEM', barcode: '0042100005264' }, // tersimpan sebagai EAN-13 berawalan 0
    { sku: 'ABC-123', barcode: null },
    { sku: 'SKU-9', barcode: null },
  ]
  const find = (raw: string) => pickBestMatch(scanCandidates(raw), products)
  let results: Record<string, { text: string; format: string }>

  beforeAll(async () => {
    results = {
      ean13: await scan('ean13', '4006381333931'),
      upca: await scan('upca', '042100005264'),
      upce: await scan('upce', '04252614'),
      code39: await scan('code39', 'ABC-123'),
      qrJson: await scan('qrcode', '{"sku":"SKU-9"}'),
      unknown: await scan('code128', 'TIDAK-ADA'),
    }
  })

  it('EAN-13 -> barcode', () => {
    expect(find(results.ean13.text)).toMatchObject({ kind: 'match', matchedBy: 'barcode', product: { sku: 'SKU-1' } })
  })

  it('UPC-A hasil scan menemukan barang yang tersimpan sebagai EAN-13 berawalan 0', () => {
    expect(find(results.upca.text)).toMatchObject({ kind: 'match', product: { sku: 'UPC-ITEM' } })
  })

  it('UPC-E hasil scan diperluas dan menemukan barang yang sama', () => {
    expect(find(results.upce.text)).toMatchObject({ kind: 'match', product: { sku: 'UPC-ITEM' } })
  })

  it('Code 39 (huruf besar) -> SKU', () => {
    expect(find(results.code39.text)).toMatchObject({ kind: 'match', matchedBy: 'sku', product: { sku: 'ABC-123' } })
  })

  it('QR berisi JSON -> SKU', () => {
    expect(find(results.qrJson.text)).toMatchObject({ kind: 'match', product: { sku: 'SKU-9' } })
  })

  it('kode yang tidak terdaftar -> tidak ditemukan', () => {
    expect(find(results.unknown.text)).toEqual({ kind: 'none' })
  })
})
