import Dexie, { type EntityTable } from 'dexie'
import type { CachedBalance, CachedItem, MetaRow, OutboxTxn } from '../types'

/**
 * IndexedDB lokal: cache master barang, cache saldo, antrean transaksi offline, dan metadata.
 * Supabase tetap sumber kebenaran; isi cache hanyalah "terakhir yang diketahui".
 */
export class WhistleDB extends Dexie {
  items!: EntityTable<CachedItem, 'sku'>
  balances!: EntityTable<CachedBalance, 'sku'>
  outbox!: EntityTable<OutboxTxn, 'seq'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor(name = 'whistle') {
    super(name)
    // v1 (FASE 1): kerangka awal, belum dipakai untuk data nyata
    this.version(1).stores({
      items: 'sku, barcode, name, category',
      balances: 'sku',
      pendingTransactions: 'clientTransactionId, status, sku, createdAt',
    })
    // v2 (FASE 8): antrean offline sungguhan + metadata
    this.version(2).stores({
      items: 'sku, barcode, name, category',
      balances: 'sku',
      pendingTransactions: null,
      outbox: '++seq, &id, &clientTransactionId, status, userId, createdAt, *skus',
      meta: 'key',
    })
  }
}

export const db = new WhistleDB()
