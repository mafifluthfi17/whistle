import type { BackupMeta, BackupScope } from '../types/backup'

export const SCOPE_INFO: Record<BackupScope, { label: string; restorable: boolean; description: string }> = {
  FULL: {
    label: 'Backup database (lengkap)',
    restorable: true,
    description: 'Master barang, transaksi, seluruh histori mutasi, saldo, dan stok awal, ditambah salinan pengguna/role dan audit trail sebagai arsip. Dapat dipulihkan (Restore) dan menjaga relasi transaksi serta saldo tetap konsisten.',
  },
  MASTER: {
    label: 'Backup master barang',
    restorable: true,
    description: 'Master barang, gudang, dan stok awal. Restore hanya memperbarui/menambah master; tidak menyentuh transaksi, ledger, dan saldo.',
  },
  TRANSACTIONS: {
    label: 'Backup transaksi',
    restorable: false,
    description: 'Dokumen transaksi beserta itemnya. Untuk arsip; tidak dapat dipulihkan sendiri agar saldo tidak tidak sinkron.',
  },
  MOVEMENTS: {
    label: 'Backup histori mutasi',
    restorable: false,
    description: 'Seluruh histori mutasi (ledger) dan saldo. Untuk arsip; tidak dapat dipulihkan sendiri. Gunakan backup lengkap untuk memulihkan.',
  },
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Nama file memuat lingkup dan tanggal-jam (Asia/Jakarta). */
export function backupFileName(scope: BackupScope, now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const g = (t: string) => p.find((x) => x.type === t)!.value
  return `WHISTLE_Backup_${scope}_${g('year')}-${g('month')}-${g('day')}_${pad(Number(g('hour')))}${g('minute')}.json`
}

/** SHA-256 heksadesimal dari isi file, untuk memverifikasi file tidak berubah saat disimpan atau dipindahkan. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type MetaRead = { ok: true; meta: BackupMeta } | { ok: false; error: string }

/**
 * Baca metadata untuk pratinjau. Hanya untuk tampilan: file asli TIDAK diubah, dan restore selalu
 * mengirim teks aslinya ke server (JSON.parse di browser dapat membulatkan angka besar).
 */
export function readBackupMeta(text: string): MetaRead {
  let obj: { meta?: Partial<BackupMeta> }
  try {
    obj = JSON.parse(text)
  } catch {
    return { ok: false, error: 'File bukan JSON yang valid' }
  }
  const m = obj?.meta
  if (!m || m.format !== 'whistle-backup') return { ok: false, error: 'Ini bukan file backup WHISTLE' }
  if (!m.scope || !(m.scope in SCOPE_INFO)) return { ok: false, error: 'Lingkup backup tidak dikenal' }
  return { ok: true, meta: m as BackupMeta }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Unduh teks sebagai file (tanpa mengubah isi). */
export function downloadText(text: string, fileName: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Peringatan ukuran: kiriman besar dapat ditolak oleh batas permintaan server. */
export const LARGE_BACKUP_BYTES = 8 * 1024 * 1024
