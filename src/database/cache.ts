import type { WhistleDB } from './db'
import type { CachedBalance, CachedItem } from '../types'
import type { PostedItem, StockedProduct } from '../services/transactions'
import { cleanScan, pickBestMatch, scanCandidates } from '../utils/scanLogic'

export type ScanLocalResult =
  | { kind: 'found'; product: StockedProduct; matchedBy: 'barcode' | 'sku'; candidate: string }
  | { kind: 'inactive'; product: StockedProduct }
  | { kind: 'ambiguous'; candidate: string }
  | { kind: 'none'; scanned: string }

const META_CACHED_AT = 'cachedAt'

function toStocked(i: CachedItem, b: CachedBalance | undefined): StockedProduct {
  return {
    id: i.sku, // id server tidak disimpan di cache; SKU cukup untuk kunci tampilan
    sku: i.sku,
    barcode: i.barcode,
    product_name: i.name,
    unit: i.unit,
    is_active: i.active,
    quantity: b?.qty ?? '0',
    average_cost: b?.averageCost ?? '0',
    inventory_value: b?.value ?? '0',
  }
}

/**
 * Cache lokal master barang dan saldo (terakhir yang diketahui).
 * Dipakai untuk mencari barang dan scan saat offline; BUKAN sumber saldo resmi.
 */
export class LocalCache {
  constructor(private readonly db: WhistleDB) {}

  /** Ganti seluruh cache dalam satu transaksi IndexedDB (barang yang dihapus di server ikut hilang). */
  async replaceAll(items: CachedItem[], balances: CachedBalance[], now = new Date()): Promise<void> {
    await this.db.transaction('rw', this.db.items, this.db.balances, this.db.meta, async () => {
      await this.db.items.clear()
      await this.db.balances.clear()
      await this.db.items.bulkPut(items)
      await this.db.balances.bulkPut(balances)
      await this.db.meta.put({ key: META_CACHED_AT, value: now.toISOString() })
    })
  }

  /** Perbarui saldo dari hasil posting server (saldo setelah transaksi). */
  async applyPostedBalances(items: PostedItem[], now = new Date()): Promise<void> {
    const rows: CachedBalance[] = items
      .filter((i) => i.balance_quantity !== null && i.balance_value !== null)
      .map((i) => ({ sku: i.sku, qty: i.balance_quantity, averageCost: i.average_cost_after, value: i.balance_value, updatedAt: now.toISOString() }))
    if (rows.length) await this.db.balances.bulkPut(rows)
  }

  async cachedAt(): Promise<string | null> {
    return (await this.db.meta.get(META_CACHED_AT))?.value ?? null
  }

  async count(): Promise<number> {
    return this.db.items.count()
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.items, this.db.balances, this.db.meta, async () => {
      await this.db.items.clear()
      await this.db.balances.clear()
      await this.db.meta.delete(META_CACHED_AT)
    })
  }

  async stockFor(skus: string[]): Promise<Map<string, StockedProduct>> {
    const out = new Map<string, StockedProduct>()
    const items = await this.db.items.bulkGet(skus)
    const bals = await this.db.balances.bulkGet(skus)
    items.forEach((it, i) => {
      if (it) out.set(it.sku, toStocked(it, bals[i]))
    })
    return out
  }

  /** Cari barang aktif menurut SKU/barcode/nama (tidak peka huruf besar/kecil). */
  async search(term: string, limit = 8): Promise<StockedProduct[]> {
    const t = term.trim().toLowerCase()
    if (!t) return []
    const items = (await this.db.items.toArray())
      .filter((i) => i.active && (i.sku.toLowerCase().includes(t) || i.name.toLowerCase().includes(t) || (i.barcode ?? '').toLowerCase().includes(t)))
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .slice(0, limit)
    const bals = await this.db.balances.bulkGet(items.map((i) => i.sku))
    return items.map((it, k) => toStocked(it, bals[k]))
  }

  /** Padanan scan/ketikan manual dari cache, dengan aturan pencarian yang sama seperti server. */
  async findByScan(raw: string): Promise<ScanLocalResult> {
    const candidates = scanCandidates(raw)
    const scanned = cleanScan(raw)
    if (candidates.length === 0) return { kind: 'none', scanned }
    const all = await this.db.items.toArray()
    const pick = pickBestMatch(candidates, all.map((i) => ({ sku: i.sku, barcode: i.barcode, item: i })))
    if (pick.kind === 'none') return { kind: 'none', scanned }
    if (pick.kind === 'ambiguous') return pick
    const item = pick.product.item
    const bal = await this.db.balances.get(item.sku)
    const product = toStocked(item, bal)
    if (!item.active) return { kind: 'inactive', product }
    return { kind: 'found', product, matchedBy: pick.matchedBy, candidate: pick.candidate }
  }
}
