import { supabase } from './supabase'
import type {
  DashboardSummary,
  MovementReport,
  StockCard,
  StockSummary,
  TransactionDetail,
  TransactionHistory,
  TransactionLines,
  Valuation,
} from '../types/reports'

function client() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi (isi .env.local)')
  return supabase
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(fn, args)
  if (error) {
    if (error.code === '42501') throw new Error('Anda tidak berhak melihat laporan ini')
    throw new Error(error.message)
  }
  return data as T
}

export const fetchDashboard = () => call<DashboardSummary>('dashboard_summary', {})

export const fetchStockCard = (sku: string, from: string | null, to: string | null) =>
  call<StockCard>('stock_card', { p_sku: sku, p_from: from || null, p_to: to || null })

export const fetchTransactionDetail = (id: string) => call<TransactionDetail>('transaction_detail', { p_id: id })

export interface SummaryFilter {
  search?: string
  category?: string
  status?: 'LOW' | 'ZERO' | 'HABIS' | 'RENDAH' | 'AMAN' | ''
  includeInactive?: boolean
}
export const fetchStockSummary = (f: SummaryFilter = {}) =>
  call<StockSummary>('report_stock_summary', {
    p_search: f.search || null,
    p_category: f.category || null,
    p_status: f.status || null,
    p_include_inactive: f.includeInactive ?? false,
  })

export const fetchValuation = (category?: string, includeZero = false) =>
  call<Valuation>('report_valuation', { p_category: category || null, p_include_zero: includeZero })

export const fetchMovement = (from: string, to: string, category?: string) =>
  call<MovementReport>('report_movement', { p_from: from, p_to: to, p_category: category || null })

export interface HistoryFilter {
  from?: string
  to?: string
  user?: string
  type?: string
  status?: string
  search?: string
  limit?: number | null
  offset?: number
}
export const fetchTransactions = (f: HistoryFilter = {}) =>
  call<TransactionHistory>('report_transactions', {
    p_from: f.from || null,
    p_to: f.to || null,
    p_user: f.user || null,
    p_type: f.type || null,
    p_status: f.status || null,
    p_search: f.search || null,
    p_limit: f.limit === undefined ? 50 : f.limit,
    p_offset: f.offset ?? 0,
  })

export const fetchTransactionLines = (type: 'IN' | 'OUT', from: string, to: string) =>
  call<TransactionLines>('report_transaction_lines', { p_type: type, p_from: from, p_to: to })

export const fetchTransactionUsers = () => call<{ id: string; name: string }[]>('report_transaction_users', {})
