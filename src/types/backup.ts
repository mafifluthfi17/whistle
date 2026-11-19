export type BackupScope = 'FULL' | 'MASTER' | 'TRANSACTIONS' | 'MOVEMENTS'

export interface BackupMeta {
  format: string
  version: number
  schema_version: string
  app: string
  scope: BackupScope
  created_at: string
  created_by: string | null
  note: string | null
  counts: Record<string, number>
  md5: Record<string, string>
  totals: { inventory_value?: string; quantity?: string }
}

export interface IntegrityCheck {
  name: string
  label?: string
  ok: boolean
  count?: number
  detail?: string | null
}

export interface IntegrityReport {
  ok: boolean
  checks: IntegrityCheck[]
  checked_at?: string
  counts?: { products: number; transactions: number; movements: number; balances: number }
}

export interface BackupValidation {
  ok: boolean
  restorable: boolean
  meta: BackupMeta | null
  checks: IntegrityCheck[]
  missing_users?: number
}

export interface RestoreResult {
  ok: boolean
  scope: BackupScope
  restore_point_id: string
  counts: Record<string, number>
  remapped_transactions: number
  post_check: IntegrityReport
}

export interface RestorePoint {
  id: string
  created_at: string
  scope: string
  reason: string
  counts: Record<string, number>
  size_bytes: number
  created_by_name: string | null
}

export interface AuditRow {
  id: string
  created_at: string
  user_id: string | null
  user_name: string | null
  action: string
  table_name: string
  record_id: string | null
  old_value: unknown
  new_value: unknown
}

export interface AuditPage {
  rows: AuditRow[]
  total_count: number
}

export interface AuditFilters {
  actions: string[]
  tables: string[]
  users: { id: string; name: string }[]
}
