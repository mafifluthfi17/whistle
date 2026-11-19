import { supabase } from './supabase'
import { mapPostError, toRpcParams, type PostError, type PostRequest } from '../utils/transactionForm'
import { cleanScan, pickBestMatch, scanCandidates } from '../utils/scanLogic'

export type { PostRequest }

function client() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi (isi .env.local)')
  return supabase
}

/** Barang beserta saldo resmi dari server. Nilai hanya untuk informasi/pratinjau. */
export interface StockedProduct {
  id: string
  sku: string
  barcode: string | null
  product_name: string
  unit: string
  is_active: boolean
  quantity: string
  average_cost: string
  inventory_value: string
}

interface ProductRow {
  id: string
  sku: string
  barcode: string | null
  product_name: string
  unit: string
  is_active: boolean
  stock_balances: { quantity: number | string; average_cost: number | string; inventory_value: number | string }[] | { quantity: number | string; average_cost: number | string; inventory_value: number | string } | null
}

const SELECT = 'id,sku,barcode,product_name,unit,is_active,stock_balances(quantity,average_cost,inventory_value)'

function mapRow(r: ProductRow): StockedProduct {
  const sb = Array.isArray(r.stock_balances) ? r.stock_balances[0] : r.stock_balances
  return {
    id: r.id,
    sku: r.sku,
    barcode: r.barcode,
    product_name: r.product_name,
    unit: r.unit,
    is_active: r.is_active,
    quantity: String(sb?.quantity ?? 0),
    average_cost: String(sb?.average_cost ?? 0),
    inventory_value: String(sb?.inventory_value ?? 0),
  }
}

/** Buang karakter yang mengganggu sintaks filter PostgREST. */
function sanitize(s: string): string {
  return s.replace(/[,()*%\\:"']/g, ' ').trim()
}

/** Cari barang aktif (SKU, barcode, atau nama) beserta stok. */
export async function searchProducts(term: string, limit = 8): Promise<StockedProduct[]> {
  const t = sanitize(term)
  if (!t) return []
  const { data, error } = await client()
    .from('products')
    .select(SELECT)
    .eq('is_active', true)
    .or(`sku.ilike.*${t}*,barcode.ilike.*${t}*,product_name.ilike.*${t}*`)
    .order('sku')
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as ProductRow[]).map(mapRow)
}

export type FindResult = { found: StockedProduct; inactive: false } | { found: StockedProduct; inactive: true } | null

/** Cocokkan persis SKU atau barcode (untuk input manual SKU). */
export async function findProductExact(term: string): Promise<FindResult> {
  const t = sanitize(term)
  if (!t) return null
  const { data, error } = await client().from('products').select(SELECT).or(`sku.eq.${t},barcode.eq.${t}`).limit(1)
  if (error) throw new Error(error.message)
  const row = ((data ?? []) as unknown as ProductRow[])[0]
  if (!row) return null
  const p = mapRow(row)
  return { found: p, inactive: !p.is_active } as FindResult
}

export type ScanLookup =
  | { kind: 'found'; product: StockedProduct; matchedBy: 'barcode' | 'sku'; candidate: string }
  | { kind: 'inactive'; product: StockedProduct }
  | { kind: 'ambiguous'; candidate: string }
  | { kind: 'none'; scanned: string }

/**
 * Cari barang dari hasil scan barcode/QR atau ketikan manual.
 * Mencoba beberapa bentuk kode (UPC-A/EAN-13/UPC-E) dan SKU tanpa membedakan huruf.
 */
export async function findProductByScan(raw: string): Promise<ScanLookup> {
  const candidates = scanCandidates(raw).map(sanitize).filter(Boolean)
  const scanned = cleanScan(raw)
  if (candidates.length === 0) return { kind: 'none', scanned }
  const filter = candidates.flatMap((c) => [`sku.eq.${c}`, `barcode.eq.${c}`, `sku.ilike.${c}`]).join(',')
  const { data, error } = await client().from('products').select(SELECT).or(filter).limit(20)
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as unknown as ProductRow[]).map(mapRow)
  const pick = pickBestMatch(candidates, rows)
  if (pick.kind === 'none') return { kind: 'none', scanned }
  if (pick.kind === 'ambiguous') return pick
  if (!pick.product.is_active) return { kind: 'inactive', product: pick.product }
  return { kind: 'found', product: pick.product, matchedBy: pick.matchedBy, candidate: pick.candidate }
}

/** Muat ulang stok resmi untuk beberapa SKU (mis. sebelum posting). */
export async function fetchStock(skus: string[]): Promise<Map<string, StockedProduct>> {
  if (skus.length === 0) return new Map()
  const { data, error } = await client().from('products').select(SELECT).in('sku', skus)
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as unknown as ProductRow[]).map((r) => [r.sku, mapRow(r)]))
}

export interface PostedItem {
  sku: string
  quantity: string
  unit_cost: string
  total_value: string
  average_cost_before: string
  average_cost_after: string
  balance_quantity: string
  balance_value: string
}

export interface PostResult {
  transaction_id: string
  transaction_number: string
  type: string
  status: string
  posting_sequence: number
  duplicate: boolean
  items: PostedItem[]
}

/** Gagal posting dengan jenis error yang sudah dipetakan untuk notifikasi. */
export class PostFailure extends Error {
  readonly kind: PostError['kind']
  constructor(e: PostError) {
    super(e.message)
    this.name = 'PostFailure'
    this.kind = e.kind
  }
}

/**
 * Posting dokumen lewat fungsi database post_transaction.
 * Frontend tidak menghitung saldo: server memvalidasi, menghitung Moving Average, dan membukukan atomik.
 */
export async function postTransaction(req: PostRequest): Promise<PostResult> {
  let res
  try {
    res = await client().rpc('post_transaction', toRpcParams(req))
  } catch (e) {
    throw new PostFailure(mapPostError({ message: (e as Error).message }))
  }
  if (res.error) throw new PostFailure(mapPostError(res.error))
  return res.data as PostResult
}
