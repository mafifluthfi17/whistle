// Bentuk JSON dari fungsi laporan di database. Semua NUMERIC berupa string agar presisi utuh.

export interface StockCardRow {
  movement_sequence: number
  movement_id: string
  movement_date: string
  transaction_id: string
  transaction_number: string
  movement_type: string
  transaction_status: string
  reference_number: string | null
  notes: string | null
  supplier_or_recipient: string | null
  reason: string | null
  sku: string
  product_name: string
  qty_in: string
  unit_cost_in: string | null
  value_in: string
  qty_out: string
  unit_cost_out: string | null
  value_out: string
  balance_qty: string
  average_cost: string
  balance_value: string
  user_name: string | null
}

export interface StockCard {
  product: { sku: string; product_name: string; unit: string; category: string | null; brand: string | null; is_active: boolean; minimum_stock: string }
  from: string | null
  to: string | null
  opening: { qty: string; value: string; average_cost: string }
  rows: StockCardRow[]
  totals: { qty_in: string; value_in: string; qty_out: string; value_out: string }
  closing: { qty: string; value: string; average_cost: string }
}

export interface StockSummaryRow {
  sku: string
  barcode: string | null
  product_name: string
  category: string | null
  brand: string | null
  unit: string
  location: string | null
  is_active: boolean
  quantity: string
  average_cost: string
  inventory_value: string
  minimum_stock: string
  shortage: string
  status: 'HABIS' | 'RENDAH' | 'AMAN'
}
export interface StockSummary {
  rows: StockSummaryRow[]
  totals: { count: number; total_qty: string; total_value: string }
}

export interface ValuationRow {
  sku: string
  product_name: string
  category: string | null
  unit: string
  quantity: string
  average_cost: string
  inventory_value: string
}
export interface Valuation {
  rows: ValuationRow[]
  totals: {
    count: number
    total_qty: string
    total_value: string
    all_balance_qty: string
    all_balance_value: string
    ledger_qty: string
    ledger_value: string
    reconciled: boolean
  }
}

export interface MovementRow {
  sku: string
  product_name: string
  category: string | null
  unit: string
  opening_qty: string
  opening_value: string
  qty_in: string
  value_in: string
  qty_out: string
  value_out: string
  closing_qty: string
  closing_value: string
}
export interface MovementReport {
  from: string
  to: string
  rows: MovementRow[]
  totals: {
    count: number
    opening_qty: string
    opening_value: string
    qty_in: string
    value_in: string
    qty_out: string
    value_out: string
    closing_qty: string
    closing_value: string
    by_type: { movement_type: string; count: number; qty_in: string; value_in: string; qty_out: string; value_out: string }[]
  }
}

export interface TransactionRow {
  id: string
  transaction_number: string
  transaction_type: string
  status: string
  transaction_date: string
  posted_at: string | null
  reference_number: string | null
  supplier_or_recipient: string | null
  notes: string | null
  reason: string | null
  created_by: string
  created_by_name: string | null
  approved_by_name: string | null
  item_count: number
  total_value: string
  reversal_of_number: string | null
}
export interface TransactionHistory {
  rows: TransactionRow[]
  total_count: number
  totals: { posted_total_value: string }
}

export interface TransactionLine {
  transaction_date: string
  transaction_number: string
  status: string
  reference_number: string | null
  supplier_or_recipient: string | null
  notes: string | null
  sku: string
  product_name: string
  unit: string
  quantity: string
  unit_cost: string
  total_value: string
  created_by_name: string | null
}
export interface TransactionLines {
  from: string
  to: string
  type: 'IN' | 'OUT'
  rows: TransactionLine[]
  totals: { count: number; total_qty: string; total_value: string; excluded_count: number }
}

export interface TransactionDetail {
  id: string
  transaction_number: string
  transaction_type: string
  status: string
  transaction_date: string
  posted_at: string | null
  posting_sequence: number | null
  reference_number: string | null
  supplier_or_recipient: string | null
  notes: string | null
  reason: string | null
  created_by_name: string | null
  approved_by_name: string | null
  reversal_of_number: string | null
  reversed_by_number: string | null
  items: {
    sku: string
    product_name: string
    unit: string
    quantity: string
    unit_cost: string
    total_value: string
    average_cost_before: string | null
    average_cost_after: string | null
    movement_type: string | null
    qty_in: string | null
    qty_out: string | null
    value_in: string | null
    value_out: string | null
    balance_qty: string | null
    balance_value: string | null
  }[]
}

export interface DashboardSummary {
  today: string
  active_sku: number
  total_qty: string
  total_value: string
  in_today: { count: number; qty: string; value: string }
  out_today: { count: number; qty: string; value: string }
  pending_count: number
  low_stock_count: number
  zero_stock_count: number
  recent: {
    id: string
    transaction_number: string
    transaction_type: string
    status: string
    transaction_date: string
    user_name: string | null
    item_count: number
    total_value: string
    reference_number: string | null
  }[]
}
