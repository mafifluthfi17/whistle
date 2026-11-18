import type { ImportMode, ImportPayloadRow, ExistingKeys } from '../utils/productImport'
import type { Product, ProductInput } from '../types'
import { supabase } from './supabase'

export type StatusFilter = 'all' | 'active' | 'inactive'

export interface ProductQuery {
  search: string
  category: string
  status: StatusFilter
  page: number
  pageSize: number
}

function client() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi (isi .env.local)')
  return supabase
}

/** Pesan error yang ramah dalam bahasa Indonesia. */
export function friendlyError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return 'Terjadi kesalahan'
  const msg = err.message ?? ''
  if (err.code === '23505') {
    if (/barcode/i.test(msg)) return 'Barcode sudah dipakai barang lain'
    if (/sku/i.test(msg)) return 'SKU sudah dipakai barang lain'
    return 'Data duplikat: SKU atau barcode sudah ada'
  }
  if (err.code === '23503') return 'Barang memiliki histori transaksi atau saldo sehingga tidak dapat dihapus. Nonaktifkan saja.'
  if (err.code === '42501') return 'Anda tidak memiliki hak untuk tindakan ini'
  return msg || 'Terjadi kesalahan'
}

/** Buang karakter yang mengganggu sintaks filter PostgREST. */
function sanitizeSearch(s: string): string {
  return s.replace(/[,()*%\\:"']/g, ' ').trim()
}

export async function listProducts(q: ProductQuery): Promise<{ rows: Product[]; total: number }> {
  let query = client().from('products').select('*', { count: 'exact' })
  const term = sanitizeSearch(q.search)
  if (term) {
    query = query.or(`sku.ilike.*${term}*,barcode.ilike.*${term}*,product_name.ilike.*${term}*`)
  }
  if (q.category) query = query.eq('category', q.category)
  if (q.status === 'active') query = query.eq('is_active', true)
  if (q.status === 'inactive') query = query.eq('is_active', false)
  const from = (q.page - 1) * q.pageSize
  const { data, count, error } = await query.order('sku').range(from, from + q.pageSize - 1)
  if (error) throw new Error(friendlyError(error))
  return { rows: (data ?? []) as Product[], total: count ?? 0 }
}

export async function listCategories(): Promise<string[]> {
  const { data, error } = await client().from('products').select('category').not('category', 'is', null)
  if (error) throw new Error(friendlyError(error))
  return [...new Set((data ?? []).map((r) => r.category as string))].sort((a, b) => a.localeCompare(b))
}

export async function createProduct(input: ProductInput): Promise<void> {
  const { error } = await client().from('products').insert(input)
  if (error) throw new Error(friendlyError(error))
}

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  const { error } = await client().from('products').update(input).eq('id', id)
  if (error) throw new Error(friendlyError(error))
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  const { error } = await client().from('products').update({ is_active: active }).eq('id', id)
  if (error) throw new Error(friendlyError(error))
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await client().from('products').delete().eq('id', id)
  if (error) throw new Error(friendlyError(error))
}

const PAGE = 1000

/** Seluruh barang (untuk export dan pengecekan duplikat saat import). */
export async function fetchAllProducts(): Promise<Product[]> {
  const out: Product[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client().from('products').select('*').order('sku').range(from, from + PAGE - 1)
    if (error) throw new Error(friendlyError(error))
    out.push(...((data ?? []) as Product[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

export async function fetchExistingKeys(): Promise<ExistingKeys> {
  const all = await fetchAllProducts()
  const keys: ExistingKeys = { skus: new Set(), barcodes: new Map() }
  for (const p of all) {
    keys.skus.add(p.sku)
    if (p.barcode) keys.barcodes.set(p.barcode, p.sku)
  }
  return keys
}

export interface ImportResult {
  mode: ImportMode
  rows: number
  inserted: number
  updated: number
  openings_staged: number
}

/** Simpan atomik lewat fungsi database: gagal satu baris = batal semua. */
export async function importProducts(rows: ImportPayloadRow[], mode: ImportMode): Promise<ImportResult> {
  const { data, error } = await client().rpc('import_products', { p_rows: rows, p_mode: mode })
  if (error) throw new Error(friendlyError(error))
  return data as ImportResult
}
