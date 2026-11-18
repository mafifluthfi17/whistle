import Dexie, { type EntityTable } from 'dexie'
import type { CachedBalance, CachedItem, PendingTransaction } from '../types'

// Skema awal. Sinkronisasi penuh dikerjakan di FASE 8.
export class WhistleDB extends Dexie {
  items!: EntityTable<CachedItem, 'sku'>
  balances!: EntityTable<CachedBalance, 'sku'>
  pendingTransactions!: EntityTable<PendingTransaction, 'clientTransactionId'>

  constructor() {
    super('whistle')
    this.version(1).stores({
      items: 'sku, barcode, name, category',
      balances: 'sku',
      pendingTransactions: 'clientTransactionId, status, sku, createdAt',
    })
  }
}

export const db = new WhistleDB()
