import { supabase } from './supabase'
import type {
  AuditFilters,
  AuditPage,
  BackupScope,
  BackupValidation,
  IntegrityReport,
  RestorePoint,
  RestoreResult,
} from '../types/backup'

function client() {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi (isi .env.local)')
  return supabase
}

const NETWORK = /failed to fetch|network|load failed/i

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Tidak ada koneksi internet. Fitur ini hanya tersedia saat online.')
  }
  let res
  try {
    res = await client().rpc(fn, args)
  } catch (e) {
    throw new Error(NETWORK.test((e as Error).message) ? 'Tidak dapat terhubung ke server.' : (e as Error).message)
  }
  if (res.error) {
    if (res.error.code === '42501') throw new Error('Hanya ADMIN yang boleh melakukan ini')
    if (!res.error.code && NETWORK.test(res.error.message)) throw new Error('Tidak dapat terhubung ke server.')
    throw new Error(res.error.message)
  }
  return res.data as T
}

/** Backup dikembalikan sebagai TEKS JSON utuh (angka NUMERIC tidak melewati float JavaScript). */
export const createBackup = (scope: BackupScope, note?: string) => call<string>('create_backup', { p_scope: scope, p_note: note || null })

export const validateBackup = (payload: string, remapUsers = false) =>
  call<BackupValidation>('validate_backup', { p_payload: payload, p_remap_users: remapUsers })

export const restoreDatabase = (payload: string, confirm: string, remapUsers = false) =>
  call<RestoreResult>('restore_database', { p_payload: payload, p_confirm: confirm, p_remap_users: remapUsers })

export const verifyIntegrity = () => call<IntegrityReport>('verify_integrity', {})
export const listRestorePoints = () => call<RestorePoint[]>('list_restore_points', {})
export const getRestorePoint = (id: string) => call<string>('get_restore_point', { p_id: id })

export interface AuditQuery {
  from?: string
  to?: string
  user?: string
  action?: string
  table?: string
  search?: string
  limit?: number | null
  offset?: number
}
export const fetchAuditTrail = (f: AuditQuery = {}) =>
  call<AuditPage>('audit_trail', {
    p_from: f.from || null,
    p_to: f.to || null,
    p_user: f.user || null,
    p_action: f.action || null,
    p_table: f.table || null,
    p_search: f.search || null,
    p_limit: f.limit === undefined ? 50 : f.limit,
    p_offset: f.offset ?? 0,
  })
export const fetchAuditFilters = () => call<AuditFilters>('audit_filters', {})
