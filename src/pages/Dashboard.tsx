import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { fetchDashboard } from '../services/reports'
import type { DashboardSummary } from '../types/reports'
import { STATUS_STYLE, dateTime, qty, rupiah } from '../utils/formatReport'

function Card({ title, value, sub, tone = 'bg-white' }: { title: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`rounded-lg p-4 shadow-sm ${tone}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-xl font-semibold text-[#0b1f4d]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  )
}

export default function Dashboard({ onNavigate }: { onNavigate: (r: string) => void }) {
  const toast = useToast()
  const online = useOnlineStatus()
  const [d, setD] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setD(await fetchDashboard())
    } catch (e) {
      setError((e as Error).message)
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50" disabled={loading} onClick={() => void load()}>
          {loading ? 'Memuat…' : 'Muat ulang'}
        </button>
      </div>

      {error && <p role="alert" className="rounded bg-red-100 p-3 text-sm text-red-800">{error}</p>}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card title="Total SKU aktif" value={d.active_sku.toLocaleString('id-ID')} />
            <Card title="Total kuantitas stok" value={qty(d.total_qty)} sub="Seluruh saldo resmi" />
            <Card title="Total nilai persediaan" value={rupiah(d.total_value)} sub="Hanya transaksi POSTED" />
            <Card title="Transaksi menunggu posting" value={String(d.pending_count)} sub="PENDING di server: belum dibukukan" tone={d.pending_count ? 'bg-amber-50' : 'bg-white'} />
            <Card title="Barang masuk hari ini" value={qty(d.in_today.qty)} sub={`${rupiah(d.in_today.value)} · ${d.in_today.count} transaksi`} />
            <Card title="Barang keluar hari ini" value={qty(d.out_today.qty)} sub={`HPP ${rupiah(d.out_today.value)} · ${d.out_today.count} transaksi`} />
            <button className="text-left" onClick={() => onNavigate('laporan')}>
              <Card title="Low stock" value={String(d.low_stock_count)} sub="Di bawah minimum stock" tone={d.low_stock_count ? 'bg-amber-50' : 'bg-white'} />
            </button>
            <button className="text-left" onClick={() => onNavigate('laporan')}>
              <Card title="Zero stock" value={String(d.zero_stock_count)} sub="Tanpa saldo kuantitas" tone={d.zero_stock_count ? 'bg-red-50' : 'bg-white'} />
            </button>
          </div>

          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">Status koneksi dan sinkronisasi</h3>
            <ul className="space-y-1 text-sm">
              <li>
                Koneksi: <span className={`rounded px-2 py-0.5 text-xs ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{online ? 'Online' : 'Offline'}</span>
              </li>
              <li className="text-slate-600">Antrean offline di perangkat ini: 0 (sinkronisasi offline tersedia di FASE 8).</li>
              <li className="text-slate-600">Data pada layar ini dimuat langsung dari server (tanggal {d.today}).</li>
            </ul>
          </div>

          <div className="rounded-lg bg-white shadow-sm">
            <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Aktivitas terakhir</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Waktu</th><th className="px-3 py-2">No. Transaksi</th><th className="px-3 py-2">Jenis</th>
                    <th className="px-3 py-2">Status</th><th className="px-3 py-2">Pengguna</th><th className="px-3 py-2 text-right">Item</th><th className="px-3 py-2 text-right">Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2">{dateTime(r.transaction_date)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.transaction_number}</td>
                      <td className="px-3 py-2">{r.transaction_type}</td>
                      <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[r.status] ?? ''}`}>{r.status}</span></td>
                      <td className="px-3 py-2">{r.user_name ?? '-'}</td>
                      <td className="px-3 py-2 text-right">{r.item_count}</td>
                      <td className="px-3 py-2 text-right">{rupiah(r.total_value)}</td>
                    </tr>
                  ))}
                  {d.recent.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">Belum ada aktivitas.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
