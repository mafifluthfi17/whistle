import { BarcodeFormat, DecodeHintType } from '@zxing/library'

/** Format yang didukung (Bagian 13). */
export const SUPPORTED_FORMATS: BarcodeFormat[] = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
]

export function buildScanHints(): Map<DecodeHintType, unknown> {
  const hints = new Map<DecodeHintType, unknown>()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS)
  hints.set(DecodeHintType.TRY_HARDER, true)
  return hints
}

export function formatName(format: BarcodeFormat): string {
  return BarcodeFormat[format] ?? String(format)
}

/** Kamera belakang sebagai default; gagal -> dicoba tanpa batasan arah kamera. */
export function rearCameraConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  }
}
