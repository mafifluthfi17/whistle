import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { fetchAuditFilters, fetchAuditTrail } from '../services/backup'
import type { AuditFilters, AuditPage, AuditRow } from '../types/backup'
import { dateTime, firstOfMonth } from '../utils/formatReport'
import { jakartaToday } from '../utils/transactionForm'

const PAGE = 25
const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base'

export default function AuditTrail() {
  const toast = useToast()
  const today = jakartaToday()
  const [from, setFrom] = useState(firstOfMonth(today))
  const [to, setTo] = useState(today)
  const [user, setUser] = useState('')
  const [action, setAction] = useState('')
  const [table, setTable] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState<AuditFilters | null>(null)
  const [data, setData] = useState<AuditPage | null>(null)
  const [detail, setDetail] = useState<AuditRow | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { fetchAuditFilters().then(setFilters).catch((e) => toast('error', (e as Error).message)) }, [toast])
  useEffect(() => { setPage(1) }, [from, to, user, action, table, search])

  const load = useCallback(async () => {
    try {
      setData(await fetchAuditTrail({ from, to, user, action, table, search, limit: PAGE, offset: (page - 1) * PAGE }))
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }, [from, to, user, action, table, search, page, toast])
  useEffect(() => {
    const h = setTimeout(() => void load(), 250)
    return () => clearTimeout(h)
  }, [load])

  async function exportExcel() {
    setBusy(true)
    try {
      const all = await fetchAuditTrail({ from, to, user, action, table, search, limit: null })
      const m = await import('../utils/reportExcel')
      m.downloadReport(m.auditWorkbook(all.rows, from || null, to || null))
      toast('success', `${all.rows.length} catatan audit diekspor`)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pages = Math.max(1, Math.ceil((data?.total_count ?? 0) / PAGE))
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Audit Trail</h2>
      <p className="text-sm text-slate-600">Catatan perubahan master, posting, reversal, adjustment, import, role, backup, dan restore. Hanya ADMIN yang dapat melihatnya, dan catatan tidak dapat diubah atau dihapus.</p>

      <div className="grid gap-2 rounded-lg bg-white p-3 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-sm">Dari<input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Sampai<input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-sm">Pengguna
          <select className={input} value={user} onChange={(e) => setUser(e.target.value)}><option value="">Semua</option>{filters?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        </label>
        <label className="text-sm">Aksi
          <select className={input} value={action} onChange={(e) => setAction(e.target.value)}><option value="">Semua</option>{filters?.actions.map((a) => <option key={a}>{a}</option>)}</select>
        </label>
        <label className="text-sm">Tabel
          <select className={input} value={table} onChange={(e) => setTable(e.target.value)}><option value="">Semua</option>{filters?.tables.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label className="text-sm">Cari<input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID, aksi, isi" /></label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">{data ? `${data.total_count.toLocaleString('id-ID')} catatan` : 'Memuat…'}</span>
        <button className="rounded-md border border-[#0b1f4d] px-4 py-2 text-sm font-semibold text-[#0b1f4d] disabled:opacity-50" disabled={busy || !data} onClick={() => void exportExcel()}>
          {busy ? 'Menyiapkan…' : 'Export Excel'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Waktu</th><th className="px-3 py-2">Pengguna</th><th className="px-3 py-2">Aksi</th><th className="px-3 py-2">Tabel</th><th className="px-3 py-2">ID record</th><th className="px-3 py-2">Detail</th></tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2">{dateTime(r.created_at)}</td>
                <td className="px-3 py-2">{r.user_name ?? '-'}</td>
                <td className="px-3 py-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{r.action}</span></td>
                <td className="px-3 py-2">{r.table_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.record_id ? (r.record_id.length > 14 ? `${r.record_id.slice(0, 8)}…` : r.record_id) : '-'}</td>
                <td className="px-3 py-2"><button className="text-sky-700 underline" onClick={() => setDetail(r)}>Lihat</button></td>
              </tr>
            ))}
            {data && data.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Tidak ada catatan.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span>Halaman {page} dari {pages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Sebelumnya</button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Berikutnya</button>
        </div>
      </div>

      {detail && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label="Detail audit">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold">{detail.action} · {detail.table_name}</h3>
                <p className="text-xs text-slate-500">{dateTime(detail.created_at)} · {detail.user_name ?? 'sistem'} · <span className="font-mono">{detail.record_id ?? '-'}</span></p>
              </div>
              <button className="text-sm underline" onClick={() => setDetail(null)}>Tutup</button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs font-semibold uppercase text-slate-500">Nilai lama</p><pre className="mt-1 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{detail.old_value ? JSON.stringify(detail.old_value, null, 2) : '-'}</pre></div>
              <div><p className="text-xs font-semibold uppercase text-slate-500">Nilai baru</p><pre className="mt-1 max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{detail.new_value ? JSON.stringify(detail.new_value, null, 2) : '-'}</pre></div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
