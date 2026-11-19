// Aritmetika desimal berbasis string/BigInt. Hanya untuk validasi dan pratinjau di UI;
// nilai resmi selalu dihitung oleh database (NUMERIC).

export type DecimalResult = { ok: true; value: string } | { ok: false; error: string }

/** Ubah number JS menjadi string desimal tanpa notasi eksponen dan tanpa sisa error float. */
export function numberToDecimalString(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  let s = String(Number(n.toPrecision(15)))
  if (/e/i.test(s)) s = n.toFixed(10).replace(/\.?0+$/, '')
  return s
}

function trimFraction(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/**
 * Validasi desimal tidak negatif.
 * Menolak format ambigu seperti "1.000" (ribuan atau desimal?). Gunakan angka murni.
 */
export function parseDecimal(
  input: string | number,
  opts: { maxScale: number; maxIntDigits: number },
): DecimalResult {
  let s = typeof input === 'number' ? numberToDecimalString(input) : input.trim()
  if (s === '') return { ok: false, error: 'kosong' }
  if (/^-/.test(s)) return { ok: false, error: 'tidak boleh negatif' }
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return { ok: false, error: `format "${s}" ambigu, tulis angka tanpa pemisah ribuan` }
  }
  if (/,/.test(s)) {
    if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.')
    else return { ok: false, error: `format angka "${s}" tidak valid` }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: `format angka "${s}" tidak valid` }
  s = trimFraction(s).replace(/^0+(?=\d)/, '')
  const [int, frac = ''] = s.split('.')
  if (int.length > opts.maxIntDigits) return { ok: false, error: 'angka terlalu besar' }
  if (frac.length > opts.maxScale) {
    return { ok: false, error: `maksimal ${opts.maxScale} angka di belakang koma` }
  }
  return { ok: true, value: s }
}

export function toScaled(value: string, scale: number): bigint {
  const [int, frac = ''] = value.split('.')
  return BigInt(int + frac.padEnd(scale, '0').slice(0, scale))
}

export function formatScaled(v: bigint, scale: number): string {
  const neg = v < 0n
  const digits = (neg ? -v : v).toString().padStart(scale + 1, '0')
  const int = digits.slice(0, digits.length - scale)
  const frac = digits.slice(digits.length - scale)
  return `${neg ? '-' : ''}${int}${scale > 0 ? '.' + frac : ''}`
}

/** Harga rata-rata awal = nilai / qty, dibulatkan setengah ke atas pada 6 desimal. */
export function averageCost(value: string, qty: string): string {
  const V = toScaled(value, 2) // skala 2
  const Q = toScaled(qty, 4) // skala 4
  if (Q === 0n) return '0.000000'
  // avg * 10^6 = V * 10^8 / Q
  const scaled = (V * 10n ** 8n * 2n + Q) / (2n * Q)
  return formatScaled(scaled, 6)
}

/**
 * Perkiraan nilai = qty × harga, dibulatkan setengah ke atas pada 2 desimal.
 * HANYA untuk pratinjau di UI; nilai resmi dihitung oleh database.
 */
export function multiplyRound(qty: string, price: string): string {
  const Q = toScaled(qty, 4)
  const P = toScaled(price, 6)
  return formatScaled((Q * P + 5n * 10n ** 7n) / 10n ** 8n, 2) // skala 10 -> 2
}

/** Bandingkan dua desimal non-negatif: -1, 0, atau 1. */
export function compareDecimal(a: string, b: string): number {
  const A = toScaled(a, 6)
  const B = toScaled(b, 6)
  return A < B ? -1 : A > B ? 1 : 0
}

/** Apakah |value - qty*avg| masih dalam toleransi pembulatan? */
export function valueMatchesAverage(value: string, qty: string, avg: string): boolean {
  const V = toScaled(value, 2) * 10n ** 8n // skala 10
  const Q = toScaled(qty, 4)
  const A = toScaled(avg, 6)
  const diff = V - Q * A
  const abs = diff < 0n ? -diff : diff
  return abs <= 5n * 10n ** 7n + Q * 5000n
}
