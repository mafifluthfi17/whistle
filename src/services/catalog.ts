import { LocalCache } from '../database/cache'
import { db } from '../database/db'
import { Outbox } from '../database/outbox'
import {
  fetchAllStocked,
  fetchStock,
  findProductByScan,
  searchProducts,
  type ScanLookup,
  type StockedProduct,
} from './transactions'

/** Satu instans untuk seluruh aplikasi. */
export const outbox = new Outbox(db)
export const localCache = new LocalCache(db)

/** Kesalahan jaringan (bukan penolakan dari server). */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false
  const err = e as { name?: string; message?: string; code?: string }
  if (err.code) return false // error dari server punya kode
  return err.name === 'TypeError' || /failed to fetch|network|load failed|fetch failed|timeout/i.test(err.message ?? '')
}

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine

export type Source = 'server' | 'cache'

/** Jalankan ke server; bila offline atau jaringan gagal, pakai cache lokal. */
async function withFallback<T>(remote: () => Promise<T>, local: () => Promise<T>): Promise<{ value: T; source: Source }> {
  if (!isOnline()) return { value: await local(), source: 'cache' }
  try {
    return { value: await remote(), source: 'server' }
  } catch (e) {
    if (isNetworkError(e)) return { value: await local(), source: 'cache' }
    throw e
  }
}

export const searchCatalog = (term: string, limit = 8) =>
  withFallback(() => searchProducts(term, limit), () => localCache.search(term, limit))

export const lookupCatalog = (raw: string) =>
  withFallback<ScanLookup>(() => findProductByScan(raw), () => localCache.findByScan(raw))

export const stockCatalog = (skus: string[]) =>
  withFallback<Map<string, StockedProduct>>(() => fetchStock(skus), () => localCache.stockFor(skus))

/** Isi ulang cache dari server. Mengembalikan jumlah barang. */
export async function refreshCache(): Promise<number> {
  const all = await fetchAllStocked()
  const now = new Date().toISOString()
  await localCache.replaceAll(
    all.map((p) => ({ sku: p.sku, barcode: p.barcode, name: p.product_name, category: p.category ?? null, unit: p.unit, active: p.is_active })),
    all.map((p) => ({ sku: p.sku, qty: p.quantity, averageCost: p.average_cost, value: p.inventory_value, updatedAt: now })),
  )
  return all.length
}
