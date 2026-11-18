// Nilai NUMERIC dari Postgres diterima sebagai string agar tidak kehilangan presisi.
export type Numeric = string

export type Role = 'ADMIN' | 'WAREHOUSE' | 'VIEWER'
export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT'
export type TransactionType = 'OPENING' | 'IN' | 'OUT' | 'ADJUSTMENT' | 'REVERSAL'

export interface Product {
  id: string
  sku: string
  barcode: string | null
  product_name: string
  category: string | null
  brand: string | null
  unit: string
  location: string | null
  minimum_stock: number
  is_active: boolean
}

export interface ProductInput {
  sku: string
  barcode: string | null
  product_name: string
  category: string | null
  brand: string | null
  unit: string
  location: string | null
  minimum_stock: number
  is_active: boolean
}

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
