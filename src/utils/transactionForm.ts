import { compareDecimal, formatScaled, multiplyRound, parseDecimal, toScaled } from './decimal'

export type TxType = 'IN' | 'OUT'

export interface TxLine {
  sku: string
  name: string
  unit: string
  /** Input pengguna (teks) */
  quantity: string
  unitCost: string
  /** Data dari server saat barang dipilih/diperbarui (hanya informasi) */
  available?: string
  averageCost?: string
  inventoryValue?: string
}

export interface LineIssue {
  /** -1 = masalah tingkat dokumen */
  index: number
  field: 'quantity' | 'unitCost' | 'line'
  message: string
}

const QTY = { maxScale: 4, maxIntDigits: 16 }
const COST = { maxScale: 6, maxIntDigits: 14 }

export function jakartaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now)
}

export type DateRelation = 'today' | 'past' | 'future' | 'invalid'

/**
 * Tanggal dokumen (YYYY-MM-DD, kalender Jakarta) -> timestamp ISO.
 * Hari ini memakai waktu sekarang; tanggal lain memakai pukul 12:00 WIB.
 */
export function resolveTransactionDate(date: string, now = new Date()): { iso: string; relation: DateRelation } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00+07:00`))) {
    return { iso: now.toISOString(), relation: 'invalid' }
  }
  const today = jakartaToday(now)
  if (date === today) return { iso: now.toISOString(), relation: 'today' }
  return { iso: new Date(`${date}T12:00:00+07:00`).toISOString(), relation: date < today ? 'past' : 'future' }
}

export function validateLines(type: TxType, lines: TxLine[]): LineIssue[] {
  const issues: LineIssue[] = []
  if (lines.length === 0) issues.push({ index: -1, field: 'line', message: 'Tambahkan minimal satu barang' })
  const seen = new Set<string>()
  lines.forEach((l, index) => {
    if (seen.has(l.sku)) issues.push({ index, field: 'line', message: `SKU ${l.sku} sudah ada di daftar` })
    seen.add(l.sku)

    const q = parseDecimal(l.quantity, QTY)
    if (!q.ok) {
      issues.push({ index, field: 'quantity', message: q.error === 'kosong' ? 'Quantity wajib diisi' : `Quantity: ${q.error}` })
    } else if (!/[1-9]/.test(q.value)) {
      issues.push({ index, field: 'quantity', message: 'Quantity harus lebih dari 0' })
    } else if (type === 'OUT' && l.available !== undefined && compareDecimal(q.value, l.available) > 0) {
      issues.push({ index, field: 'quantity', message: `Melebihi stok tersedia (${l.available})` })
    }

    if (type === 'IN') {
      const c = parseDecimal(l.unitCost, COST)
      if (!c.ok) issues.push({ index, field: 'unitCost', message: c.error === 'kosong' ? 'Harga beli wajib diisi' : `Harga beli: ${c.error}` })
    }
  })
  return issues
}

export interface PostItem {
  sku: string
  quantity: string
  unit_cost?: string
}

/** Item siap kirim ke post_transaction. Memerlukan validateLines() kosong. */
export function buildItems(type: TxType, lines: TxLine[]): PostItem[] {
  return lines.map((l) => {
    const q = parseDecimal(l.quantity, QTY)
    if (!q.ok) throw new Error(`Quantity ${l.sku} tidak valid`)
    if (type === 'OUT') return { sku: l.sku, quantity: q.value }
    const c = parseDecimal(l.unitCost, COST)
    if (!c.ok) throw new Error(`Harga beli ${l.sku} tidak valid`)
    return { sku: l.sku, quantity: q.value, unit_cost: c.value }
  })
}

export interface PostRequest {
  type: TxType
  /** Kunci idempotensi: sama untuk setiap retry dokumen yang sama */
  clientTransactionId: string
  dateIso: string
  reference: string
  party: string
  notes: string
  items: PostItem[]
  allowBackdate: boolean
}

/** Parameter bernama untuk RPC public.post_transaction (nama harus sama dengan fungsi di database). */
export function toRpcParams(req: PostRequest) {
  return {
    p_client_transaction_id: req.clientTransactionId,
    p_type: req.type,
    p_date: req.dateIso,
    p_reference: req.reference.trim() || null,
    p_party: req.party.trim() || null,
    p_notes: req.notes.trim() || null,
    p_items: req.items,
    p_reason: null,
    p_allow_backdate: req.allowBackdate,
  }
}

/** Perkiraan nilai baris untuk pratinjau (bukan nilai resmi). */
export function estimateValue(type: TxType, line: TxLine): string | null {
  const q = parseDecimal(line.quantity, QTY)
  if (!q.ok) return null
  if (type === 'IN') {
    const c = parseDecimal(line.unitCost, COST)
    return c.ok ? multiplyRound(q.value, c.value) : null
  }
  if (line.available !== undefined && line.inventoryValue !== undefined && compareDecimal(q.value, line.available) === 0) {
    const v = parseDecimal(line.inventoryValue, { maxScale: 2, maxIntDigits: 18 })
    return v.ok ? formatScaled(toScaled(v.value, 2), 2) : null // selalu 2 desimal seperti nilai server
  }
  if (line.averageCost === undefined) return null
  const a = parseDecimal(line.averageCost, COST)
  return a.ok ? multiplyRound(q.value, a.value) : null
}

export function sumEstimates(values: (string | null)[]): string | null {
  if (values.some((v) => v === null)) return null
  const total = (values as string[]).reduce((s, v) => s + toScaled(v, 2), 0n)
  return formatScaled(total, 2)
}

// ---------------------------------------------------------------------------
// Pemetaan error server ke notifikasi
// ---------------------------------------------------------------------------
export type PostErrorKind =
  | 'insufficient'
  | 'notfound'
  | 'inactive'
  | 'backdated'
  | 'validation'
  | 'forbidden'
  | 'offline'
  | 'unknown'

export interface PostError {
  kind: PostErrorKind
  message: string
}

export function mapPostError(err: { code?: string; message?: string } | null | undefined): PostError {
  const message = err?.message?.trim() || 'Transaksi gagal diposting'
  switch (err?.code) {
    case 'WS001':
      return { kind: 'insufficient', message }
    case 'WS002':
      return { kind: 'backdated', message }
    case 'WS003':
      if (/tidak ditemukan/i.test(message)) return { kind: 'notfound', message }
      if (/tidak aktif/i.test(message)) return { kind: 'inactive', message }
      return { kind: 'validation', message }
    case '42501':
      return { kind: 'forbidden', message: 'Anda tidak berhak mencatat transaksi ini' }
    default:
      if (!err?.code && /failed to fetch|network|load failed/i.test(message)) {
        return { kind: 'offline', message: 'Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.' }
      }
      return { kind: 'unknown', message }
  }
}
