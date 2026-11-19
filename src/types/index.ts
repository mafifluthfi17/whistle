import type { PostResult } from '../services/transactions'
import type { PostErrorKind, PostItem } from '../utils/transactionForm'

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

/** Cache master barang di IndexedDB (untuk pencarian dan scan saat offline). */
export interface CachedItem {
  sku: string
  barcode: string | null
  name: string
  category: string | null
  unit: string
  active: boolean
}

/** Cache saldo stok terakhir yang diketahui dari server. Bukan saldo resmi. */
export interface CachedBalance {
  sku: string
  qty: Numeric
  averageCost: Numeric
  value: Numeric
  updatedAt: string
}

export interface MetaRow {
  key: string
  value: string
}

export interface OutboxPayload {
  /** Waktu transaksi dicatat (ISO). Tetap dipakai saat sinkronisasi. */
  dateIso: string
  /** Tanggal pilihan pengguna (YYYY-MM-DD) untuk ditampilkan/diubah. */
  dateInput: string
  reference: string
  party: string
  notes: string
  items: PostItem[]
  allowBackdate: boolean
  /** Nama dan satuan untuk tampilan antrean */
  names: Record<string, { name: string; unit: string }>
}

/** Satu transaksi dalam antrean offline. */
export interface OutboxTxn {
  /** Urutan pencatatan lokal (auto-increment) */
  seq?: number
  id: string
  clientTransactionId: string
  userId: string
  type: 'IN' | 'OUT'
  payload: OutboxPayload
  createdAt: string
  status: SyncStatus
  /** SKU yang disentuh (indeks untuk deteksi ketergantungan) */
  skus: string[]
  attempts: number
  lastAttemptAt?: string
  errorKind?: PostErrorKind
  error?: string
  /** Id transaksi sebelumnya (SKU sama) yang gagal sehingga transaksi ini ditahan */
  blockedBy?: string
  result?: PostResult
  syncedAt?: string
}
