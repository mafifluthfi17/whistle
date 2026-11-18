// Nilai NUMERIC dari Postgres diterima sebagai string agar tidak kehilangan presisi.
export type Numeric = string

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT'
export type TransactionType = 'OPENING' | 'IN' | 'OUT' | 'ADJUSTMENT' | 'REVERSAL'

export interface CachedItem {
  sku: string
  barcode: string | null
  name: string
  category: string | null
  unit: string | null
  active: boolean
}

export interface CachedBalance {
  sku: string
  qty: Numeric
  averageCost: Numeric
  value: Numeric
  updatedAt: string
}

export interface PendingTransaction {
  clientTransactionId: string
  type: TransactionType
  sku: string
  qty: Numeric
  unitCost?: Numeric
  documentNo?: string
  note?: string
  createdAt: string
  status: SyncStatus
  error?: string
}
