import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import {
  createBackup,
  getRestorePoint,
  listRestorePoints,
  restoreDatabase,
  validateBackup,
  verifyIntegrity,
} from '../services/backup'
import type { BackupMeta, BackupScope, BackupValidation, IntegrityCheck, IntegrityReport, RestorePoint, RestoreResult } from '../types/backup'
import {
  LARGE_BACKUP_BYTES,
  SCOPE_INFO,
  backupFileName,
  downloadText,
  formatBytes,
  readBackupMeta,
  sha256Hex,
} from '../utils/backupFile'
import { dateTime } from '../utils/formatReport'

const btn = 'rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50'
const card = 'rounded-lg bg-white p-4 shadow-sm'

function Checks({ checks }: { checks: IntegrityCheck[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {checks.map((c) => (
        <li key={c.name} className="flex items-start gap-2">
          <span aria-hidden className={c.ok ? 'text-emerald-600' : 'text-red-600'}>{c.ok ? '✔' : '✘'}</span>
          <span className={c.ok ? '' : 'font-medium text-red-700'}>
            {c.label ?? c.name}
            {c.count !== undefined && c.count > 0 && !c.ok ? ` (${c.count} masalah)` : ''}
            {c.detail ? <span className="block text-xs text-slate-500">{c.detail}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function Pengaturan() {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Pengaturan: Backup, Restore, dan Integritas</h2>
      <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
        <b>Backup</b> (file JSON dari database) adalah salinan untuk <b>memulihkan</b> data. <b>Export Excel</b> (menu Laporan dan Import/Export) adalah laporan untuk <b>dibaca</b> dan bukan pengganti backup.
        Aplikasi ini <b>tidak</b> mengaktifkan atau memastikan backup otomatis. Per pemeriksaan di dashboard Supabase pada 19 November 2026, project ini memakai Free Plan yang
        <b> tidak menyertakan backup project</b> (backup harian otomatis baru tersedia di paket Pro), jadi backup manual di halaman ini adalah <b>satu-satunya salinan</b>.
        Buat backup lengkap secara berkala (mis. harian atau sebelum stock opname) dan simpan file serta SHA-256-nya di tempat aman di luar aplikasi. Status paket dapat berubah; periksa di Supabase &gt; Database &gt; Backups.
      </div>
      <IntegritySection />
      <BackupSection />
      <RestoreSection />
      <RestorePointsSection />
    </section>
  )
}

// ----------------------------------------------------------------- integritas
function IntegritySection() {
  const toast = useToast()
  const [rep, setRep] = useState<IntegrityReport | null>(null)
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      setRep(await verifyIntegrity())
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={card}>
      <h3 className="font-semibold">Cek integritas database</h3>
      <p className="text-sm text-slate-600">Memeriksa rantai saldo ledger, kecocokan saldo dengan replay ledger, relasi transaksi, status, dan urutan.</p>
      <button className={`${btn} mt-2 border border-[#0b1f4d] text-[#0b1f4d]`} disabled={busy} onClick={() => void run()}>{busy ? 'Memeriksa…' : 'Periksa sekarang'}</button>
      {rep && (
        <div className="mt-3 space-y-2">
          <p className={`rounded p-2 text-sm font-medium ${rep.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`} role="status">
            {rep.ok ? 'Integritas SESUAI: seluruh pemeriksaan lulus.' : 'Ada pemeriksaan yang GAGAL. Jangan melanjutkan transaksi sebelum diselidiki.'}
            {rep.checked_at ? ` (${dateTime(rep.checked_at)})` : ''}
          </p>
          <Checks checks={rep.checks} />
          {rep.counts && <p className="text-xs text-slate-500">{rep.counts.products} barang · {rep.counts.transactions} transaksi · {rep.counts.movements} mutasi · {rep.counts.balances} saldo</p>}
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------- backup
function BackupSection() {
  const toast = useToast()
  const [scope, setScope] = useState<BackupScope>('FULL')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ file: string; size: number; sha: string; meta: BackupMeta | null } | null>(null)

  async function make() {
    setBusy(true)
    try {
      const text = await createBackup(scope, note.trim() || undefined)
      const file = backupFileName(scope)
      downloadText(text, file)
      const m = readBackupMeta(text)
      setLast({ file, size: new TextEncoder().encode(text).length, sha: await sha256Hex(text), meta: m.ok ? m.meta : null })
      toast('success', `Backup ${scope} dibuat dan diunduh`)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const info = SCOPE_INFO[scope]
  return (
    <div className={card}>
      <h3 className="font-semibold">Buat backup</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">Jenis backup
          <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base" value={scope} onChange={(e) => setScope(e.target.value as BackupScope)}>
            {(Object.keys(SCOPE_INFO) as BackupScope[]).map((s) => <option key={s} value={s}>{SCOPE_INFO[s].label}</option>)}
          </select>
        </label>
        <label className="text-sm">Catatan (opsional)
          <input className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base" value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. sebelum stock opname" />
        </label>
      </div>
      <p className="mt-2 text-sm text-slate-600">{info.description}</p>
      {!info.restorable && <p className="mt-1 text-xs text-amber-800">Backup jenis ini hanya untuk arsip dan tidak dapat dipulihkan sendiri.</p>}
      <button className={`${btn} mt-3 bg-[#0b1f4d] text-white`} disabled={busy} onClick={() => void make()}>{busy ? 'Membuat backup…' : 'Buat dan unduh backup'}</button>
      {last && (
        <div className="mt-3 rounded bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-medium">{last.file} · {formatBytes(last.size)}</p>
          <p className="break-all">SHA-256: <span className="font-mono">{last.sha}</span></p>
          {last.meta && <p>Isi: {Object.entries(last.meta.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>}
          <p className="mt-1 text-slate-500">Catat SHA-256 ini untuk memastikan file tidak berubah saat disimpan atau dipindahkan.</p>
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------------------- restore
function RestoreSection() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [sha, setSha] = useState('')
  const [meta, setMeta] = useState<BackupMeta | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [report, setReport] = useState<BackupValidation | null>(null)
  const [remap, setRemap] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    setReport(null)
    setResult(null)
    setRestoreError(null)
    setPhrase('')
    setRemap(false)
    if (!file) return
    const t = await file.text()
    setText(t)
    setFileName(file.name)
    setSha(await sha256Hex(t))
    const m = readBackupMeta(t)
    setMeta(m.ok ? m.meta : null)
    setFileError(m.ok ? null : m.error)
  }

  async function check(remapUsers = remap) {
    if (!text) return
    setBusy(true)
    setRestoreError(null)
    try {
      setReport(await validateBackup(text, remapUsers))
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    if (!text) return
    setBusy(true)
    setRestoreError(null)
    try {
      const r = await restoreDatabase(text, phrase, remap)
      setResult(r)
      toast('success', 'Pemulihan berhasil dan lolos pemeriksaan integritas')
      setReport(null)
      setPhrase('')
    } catch (e) {
      setRestoreError((e as Error).message)
      toast('error', 'Pemulihan dibatalkan; data tidak berubah')
    } finally {
      setBusy(false)
    }
  }

  const full = meta?.scope === 'FULL'
  const ready = Boolean(report?.restorable) && phrase === 'PULIHKAN'
  return (
    <div className={card}>
      <h3 className="font-semibold">Restore (pulihkan dari file backup)</h3>
      <p className="text-sm text-slate-600">Hanya ADMIN. Alur: pilih file → validasi integritas file → konfirmasi → pulihkan → pemeriksaan integritas ulang otomatis.</p>
      <input ref={fileRef} type="file" accept=".json,application/json" className="mt-2 block w-full text-sm" aria-label="Pilih file backup" onChange={(e) => void onFile(e.target.files?.[0])} />

      {fileError && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">{fileError}</p>}
      {text && meta && (
        <div className="mt-3 space-y-2 text-sm">
          <div className="rounded bg-slate-50 p-3 text-xs">
            <p className="font-medium">{fileName} · {formatBytes(new TextEncoder().encode(text).length)} · {SCOPE_INFO[meta.scope].label}</p>
            <p>Dibuat {dateTime(meta.created_at)}{meta.note ? ` · catatan: ${meta.note}` : ''}</p>
            <p>Isi: {Object.entries(meta.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
            <p className="break-all">SHA-256: <span className="font-mono">{sha}</span></p>
          </div>
          {new TextEncoder().encode(text).length > LARGE_BACKUP_BYTES && (
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">File besar ({formatBytes(new TextEncoder().encode(text).length)}). Pengiriman bisa ditolak oleh batas ukuran permintaan server; bila gagal, pulihkan lewat SQL Editor Supabase.</p>
          )}
          <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={busy} onClick={() => void check()}>{busy && !report ? 'Memvalidasi…' : 'Validasi file'}</button>
        </div>
      )}

      {report && (
        <div className="mt-3 space-y-2">
          <p role="status" className={`rounded p-2 text-sm font-medium ${report.restorable ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
            {report.restorable ? 'File lolos validasi dan dapat dipulihkan.' : 'File TIDAK dapat dipulihkan. Perbaiki penyebab di bawah atau gunakan file lain.'}
          </p>
          <Checks checks={report.checks} />
          {(report.missing_users ?? 0) > 0 && (
            <label className="flex items-start gap-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
              <input type="checkbox" className="mt-1" checked={remap} onChange={(e) => { setRemap(e.target.checked); void check(e.target.checked) }} />
              <span>{report.missing_users} pengguna pembuat transaksi tidak ada di database ini. Petakan transaksinya ke ADMIN yang memulihkan (dicatat di audit trail).</span>
            </label>
          )}
          {report.restorable && (
            <div className="space-y-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">{full ? 'PERHATIAN: restore lengkap MENGGANTI seluruh data persediaan.' : 'Restore master memperbarui master barang dan gudang.'}</p>
              {full ? (
                <ul className="list-disc pl-5 text-xs">
                  <li>Master, transaksi, ledger, saldo, dan stok awal diganti dengan isi file. Transaksi setelah waktu backup akan hilang.</li>
                  <li>Sistem otomatis membuat titik pemulihan sebelum mengganti, sehingga restore dapat dibatalkan.</li>
                  <li>Pengguna/role dan audit trail tidak diganti; restore dicatat di audit trail.</li>
                  <li>Seluruh proses atomik: bila ada kegagalan atau integritas tidak lolos, semuanya dibatalkan.</li>
                  <li>Posting transaksi ditahan sebentar selama proses berjalan.</li>
                </ul>
              ) : (
                <p className="text-xs">Transaksi, ledger, dan saldo tidak disentuh. Barang di database yang tidak ada di backup tidak dihapus.</p>
              )}
              <label className="block">Ketik <b>PULIHKAN</b> untuk melanjutkan
                <input className="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 text-base text-slate-900" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" aria-label="Konfirmasi PULIHKAN" />
              </label>
              <button className={`${btn} bg-red-700 text-white`} disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Memulihkan…' : 'Pulihkan sekarang'}</button>
            </div>
          )}
        </div>
      )}

      {restoreError && <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-800">Pemulihan dibatalkan dan data tidak berubah. Penyebab: {restoreError}</p>}
      {result && (
        <div className="mt-3 space-y-2 rounded bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
          <p className="font-semibold">Pemulihan {result.scope} berhasil.</p>
          <p className="text-xs">{Object.entries(result.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}{result.remapped_transactions ? ` · ${result.remapped_transactions} transaksi dipetakan ke ADMIN` : ''}</p>
          <p className="text-xs">Titik pemulihan sebelum restore: {result.restore_point_id.slice(0, 8)}… (lihat daftar di bawah untuk membatalkan restore).</p>
          <Checks checks={result.post_check.checks} />
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------- titik pemulihan
function RestorePointsSection() {
  const toast = useToast()
  const [points, setPoints] = useState<RestorePoint[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      setPoints(await listRestorePoints())
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }, [toast])
  useEffect(() => { void load() }, [load])

  async function download(p: RestorePoint) {
    setBusyId(p.id)
    try {
      const text = await getRestorePoint(p.id)
      downloadText(text, `WHISTLE_Titik_Pemulihan_${p.created_at.slice(0, 19).replace(/[:T]/g, '-')}.json`)
      toast('success', 'Titik pemulihan diunduh. Untuk memulihkannya, unggah file ini di bagian Restore.')
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusyId(null)
    }
  }
  return (
    <div className={card}>
      <h3 className="font-semibold">Titik pemulihan otomatis (5 terbaru)</h3>
      <p className="text-sm text-slate-600">Dibuat otomatis sebelum setiap restore. Unduh lalu unggah lewat Restore untuk membatalkan restore.</p>
      {points === null ? <p className="mt-2 text-sm text-slate-500">Memuat…</p> : points.length === 0 ? <p className="mt-2 text-sm text-slate-500">Belum ada titik pemulihan.</p> : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {points.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{dateTime(p.created_at)} · {p.created_by_name ?? '-'} · {formatBytes(p.size_bytes)}
                <span className="block text-xs text-slate-500">{p.reason} · {Object.entries(p.counts).filter(([k]) => ['products', 'inventory_transactions', 'inventory_movements'].includes(k)).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
              </span>
              <button className={`${btn} border border-[#0b1f4d] py-1 text-[#0b1f4d]`} disabled={busyId === p.id} onClick={() => void download(p)}>{busyId === p.id ? 'Mengunduh…' : 'Unduh'}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
