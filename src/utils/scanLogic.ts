// Logika murni untuk hasil scan barcode/QR. Tidak bergantung pada kamera atau DOM agar mudah diuji.

/** Hapus karakter kontrol (mis. FNC Code 128, CR/LF dari scanner) dan spasi di tepi. */
export function cleanScan(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

const QR_KEYS = ['sku', 'barcode', 'kode', 'code']

/**
 * Isi QR bisa berupa teks biasa (SKU/barcode), URL berparameter (?sku=...), atau JSON ({"sku":"..."}).
 * Selain itu dipakai apa adanya.
 */
export function extractFromQr(raw: string): string {
  const s = cleanScan(raw)
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>
      for (const k of QR_KEYS) {
        const v = Object.entries(obj).find(([key]) => key.toLowerCase() === k)?.[1]
        if (typeof v === 'string' || typeof v === 'number') return cleanScan(String(v))
      }
    } catch {
      /* bukan JSON valid: pakai teks asli */
    }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s)
      for (const k of QR_KEYS) {
        const v = u.searchParams.get(k)
        if (v) return cleanScan(v)
      }
    } catch {
      /* URL tidak valid */
    }
  }
  return s
}

/** Validasi digit pemeriksa GTIN (EAN-8, UPC-A/12, EAN-13, GTIN-14). */
export function isValidGtin(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false
  const body = digits.slice(0, -1)
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i])
    sum += i % 2 === 0 ? d * 3 : d
  }
  return (10 - (sum % 10)) % 10 === Number(digits.slice(-1))
}

/** Ubah UPC-E (8 digit) menjadi UPC-A (12 digit) tanpa memeriksa digit pemeriksa. */
export function convertUpcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const ns = code[0]
  const d = code.slice(1, 7).split('')
  const check = code[7]
  let body: string
  switch (d[5]) {
    case '0':
    case '1':
    case '2':
      body = `${d[0]}${d[1]}${d[5]}00` + `00${d[2]}${d[3]}${d[4]}`
      break
    case '3':
      body = `${d[0]}${d[1]}${d[2]}00` + `000${d[3]}${d[4]}`
      break
    case '4':
      body = `${d[0]}${d[1]}${d[2]}${d[3]}0` + `0000${d[4]}`
      break
    default:
      body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}` + `0000${d[5]}`
  }
  return `${ns}${body}${check}`
}

/** Ubah UPC-E (8 digit) menjadi UPC-A (12 digit). Mengembalikan null jika bukan UPC-E yang valid. */
export function expandUpcE(code: string): string | null {
  const upcA = convertUpcEToUpcA(code)
  return upcA && isValidGtin(upcA) ? upcA : null
}

/**
 * Daftar kunci pencarian untuk satu hasil scan, berurutan dari yang paling spesifik.
 * Satu produk bisa tersimpan sebagai UPC-A (12), EAN-13 berawalan 0, atau UPC-E diperluas.
 */
export function scanCandidates(raw: string): string[] {
  const base = extractFromQr(raw)
  if (!base) return []
  const out: string[] = [base]
  if (/^\d+$/.test(base)) {
    if (base.length === 8) {
      const expanded = expandUpcE(base)
      if (expanded) out.push(expanded, `0${expanded}`)
    } else if (base.length === 12) {
      out.push(`0${base}`)
    } else if (base.length === 13 && base.startsWith('0')) {
      out.push(base.slice(1))
    }
  }
  return [...new Set(out)]
}

export interface MatchableProduct {
  sku: string
  barcode: string | null
}

export type PickResult<T extends MatchableProduct> =
  | { kind: 'match'; product: T; matchedBy: 'barcode' | 'sku'; candidate: string; caseInsensitive: boolean }
  | { kind: 'ambiguous'; candidate: string }
  | { kind: 'none' }

/**
 * Pilih barang untuk hasil scan. Urutan: setiap kandidat berurutan; per kandidat
 * barcode persis, lalu SKU persis, lalu SKU tanpa membedakan huruf (Code 39 hanya huruf besar).
 */
export function pickBestMatch<T extends MatchableProduct>(candidates: string[], rows: T[]): PickResult<T> {
  for (const c of candidates) {
    const byBarcode = rows.filter((r) => r.barcode === c)
    if (byBarcode.length === 1) return { kind: 'match', product: byBarcode[0], matchedBy: 'barcode', candidate: c, caseInsensitive: false }
    if (byBarcode.length > 1) return { kind: 'ambiguous', candidate: c }

    const bySku = rows.filter((r) => r.sku === c)
    if (bySku.length === 1) return { kind: 'match', product: bySku[0], matchedBy: 'sku', candidate: c, caseInsensitive: false }
    if (bySku.length > 1) return { kind: 'ambiguous', candidate: c }

    const lower = c.toLowerCase()
    const ci = rows.filter((r) => r.sku.toLowerCase() === lower)
    if (ci.length === 1) return { kind: 'match', product: ci[0], matchedBy: 'sku', candidate: c, caseInsensitive: true }
    if (ci.length > 1) return { kind: 'ambiguous', candidate: c }
  }
  return { kind: 'none' }
}

// ---------------------------------------------------------------------------
// Error kamera
// ---------------------------------------------------------------------------
export type CameraErrorKind = 'insecure' | 'unsupported' | 'denied' | 'nodevice' | 'busy' | 'constraint' | 'unknown'

export interface CameraError {
  kind: CameraErrorKind
  message: string
}

export function describeCameraError(
  err: unknown,
  env: { secure: boolean; hasMediaDevices: boolean },
): CameraError {
  if (!env.secure) {
    return { kind: 'insecure', message: 'Kamera hanya dapat dipakai lewat HTTPS. Buka aplikasi dari alamat https:// lalu coba lagi.' }
  }
  if (!env.hasMediaDevices) {
    return { kind: 'unsupported', message: 'Browser ini tidak mendukung akses kamera. Gunakan Chrome terbaru atau ketik SKU secara manual.' }
  }
  const name = (err as { name?: string } | null)?.name ?? ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { kind: 'denied', message: 'Izin kamera ditolak. Buka pengaturan situs di browser, izinkan Kamera untuk aplikasi ini, lalu tekan Mulai Scan lagi.' }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { kind: 'nodevice', message: 'Kamera tidak ditemukan di perangkat ini. Ketik SKU atau barcode secara manual.' }
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'busy', message: 'Kamera tidak dapat dibuka karena sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.' }
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { kind: 'constraint', message: 'Kamera yang diminta tidak tersedia.' }
    default:
      return { kind: 'unknown', message: `Kamera gagal dibuka${name ? ` (${name})` : ''}. Coba lagi atau ketik SKU secara manual.` }
  }
}
