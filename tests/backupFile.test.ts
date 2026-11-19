import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { SCOPE_INFO, backupFileName, formatBytes, readBackupMeta, sha256Hex } from '../src/utils/backupFile'
import { EXCEL_CELL_LIMIT, auditWorkbook, jsonCell, reportToBuffer } from '../src/utils/reportExcel'
import type { AuditRow } from '../src/types/backup'

describe('nama file backup', () => {
  it('memuat lingkup serta tanggal dan jam Asia/Jakarta', () => {
    // 2026-11-18 20:05 UTC = 19 Nov 2026 03:05 WIB
    expect(backupFileName('FULL', new Date('2026-11-18T20:05:00Z'))).toBe('WHISTLE_Backup_FULL_2026-11-19_0305.json')
    expect(backupFileName('MASTER', new Date('2026-01-05T05:30:00Z'))).toBe('WHISTLE_Backup_MASTER_2026-01-05_1230.json')
    expect(backupFileName('MOVEMENTS', new Date('2026-06-30T16:59:00Z'))).toBe('WHISTLE_Backup_MOVEMENTS_2026-06-30_2359.json')
  })
})

describe('SHA-256 file', () => {
  it('sesuai vektor uji standar dan berubah jika satu karakter berubah', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('{"a":1}')).not.toBe(await sha256Hex('{"a":2}'))
    // Unicode dihitung sebagai UTF-8
    expect(await sha256Hex('Kopi ☕')).toHaveLength(64)
  })
})

describe('readBackupMeta', () => {
  const ok = JSON.stringify({ meta: { format: 'whistle-backup', version: 1, scope: 'FULL', counts: { products: 3 } }, tables: {} })

  it('membaca metadata backup WHISTLE', () => {
    const r = readBackupMeta(ok)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.meta).toMatchObject({ scope: 'FULL', counts: { products: 3 } })
  })

  it('menolak bukan JSON, bukan backup WHISTLE, dan lingkup tidak dikenal', () => {
    expect(readBackupMeta('bukan json')).toEqual({ ok: false, error: 'File bukan JSON yang valid' })
    expect(readBackupMeta('{"meta":{"format":"lain"}}')).toEqual({ ok: false, error: 'Ini bukan file backup WHISTLE' })
    expect(readBackupMeta('[]')).toEqual({ ok: false, error: 'Ini bukan file backup WHISTLE' })
    expect(readBackupMeta('{"meta":{"format":"whistle-backup","scope":"XYZ"}}')).toEqual({ ok: false, error: 'Lingkup backup tidak dikenal' })
  })
})

describe('lingkup backup', () => {
  it('hanya FULL dan MASTER yang dapat dipulihkan; semua jenis dari Bagian 18 tersedia', () => {
    expect(Object.fromEntries(Object.entries(SCOPE_INFO).map(([k, v]) => [k, v.restorable]))).toEqual({
      FULL: true, MASTER: true, TRANSACTIONS: false, MOVEMENTS: false,
    })
    expect(SCOPE_INFO.FULL.label).toMatch(/database/i)
    expect(SCOPE_INFO.MASTER.label).toMatch(/master/i)
    expect(SCOPE_INFO.TRANSACTIONS.label).toMatch(/transaksi/i)
    expect(SCOPE_INFO.MOVEMENTS.label).toMatch(/mutasi/i)
  })
})

describe('formatBytes', () => {
  it('satuan B, KB, MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
  })
})

describe('export Excel audit trail', () => {
  const rows: AuditRow[] = [
    { id: '1', created_at: '2026-11-18T20:05:00+00:00', user_id: 'u1', user_name: 'Admin Utama', action: 'UPDATE', table_name: 'products', record_id: '00123',
      old_value: { name: 'Lama' }, new_value: { name: 'Baru', minimum_stock: 5 } },
    { id: '2', created_at: '2026-11-18T21:00:00+00:00', user_id: null, user_name: null, action: 'RESTORE', table_name: 'database', record_id: null, old_value: null, new_value: { scope: 'FULL' } },
  ]

  it('kolom, nilai, dan nama file memuat periode', () => {
    const { wb, fileName } = auditWorkbook(rows, '2026-11-01', '2026-11-19')
    expect(fileName).toBe('WHISTLE_Audit_Trail_2026-11-01_sd_2026-11-19.xlsx')
    const data = XLSX.utils.sheet_to_json<Record<string, string | number>>(XLSX.read(reportToBuffer(wb), { type: 'array' }).Sheets.AUDIT_TRAIL, { raw: true, defval: null })
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({ Pengguna: 'Admin Utama', Aksi: 'UPDATE', Tabel: 'products', 'ID Record': '00123' })
    expect(JSON.parse(String(data[0]['Nilai Lama']))).toEqual({ name: 'Lama' })
    expect(JSON.parse(String(data[0]['Nilai Baru']))).toEqual({ name: 'Baru', minimum_stock: 5 })
    expect(data[1]).toMatchObject({ Pengguna: null, Aksi: 'RESTORE', 'Nilai Lama': null })
  })

  it('waktu berupa tanggal Excel pada jam Jakarta', () => {
    const { wb } = auditWorkbook(rows, null, null)
    const cell = wb.Sheets.AUDIT_TRAIL.A2
    expect(cell.z).toBe('dd/mm/yyyy hh:mm')
    expect(XLSX.SSF.format('dd/mm/yyyy hh:mm', cell.v as number)).toBe('19/11/2026 03:05')
    expect(auditWorkbook(rows, null, null).fileName).toBe('WHISTLE_Audit_Trail_semua_periode.xlsx')
  })

  it('ID record tetap teks (nol di depan)', () => {
    const { wb } = auditWorkbook(rows, null, null)
    expect(wb.Sheets.AUDIT_TRAIL.E2).toMatchObject({ t: 's', v: '00123' })
  })

  it('JSON sangat panjang dipotong agar tidak melewati batas sel Excel', () => {
    const big = { data: 'x'.repeat(EXCEL_CELL_LIMIT + 5000) }
    const s = jsonCell(big)!
    expect(s.length).toBeLessThan(32767)
    expect(s).toMatch(/dipotong/)
    expect(jsonCell({ a: 1 })).toBe('{"a":1}')
    expect(jsonCell(null)).toBeNull()
    const { wb } = auditWorkbook([{ ...rows[0], new_value: big }], null, null)
    expect(String(XLSX.read(reportToBuffer(wb), { type: 'array' }).Sheets.AUDIT_TRAIL.G2.v).length).toBeLessThan(32767)
  })

  it('1.000 catatan tetap dihasilkan', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ ...rows[0], id: String(i), record_id: String(i).padStart(6, '0') }))
    const { wb } = auditWorkbook(many, null, null)
    expect(XLSX.utils.sheet_to_json(XLSX.read(reportToBuffer(wb), { type: 'array' }).Sheets.AUDIT_TRAIL)).toHaveLength(1000)
  })
})
