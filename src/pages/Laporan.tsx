import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useToast } from '../components/Toast'
import {
  fetchMovement,
  fetchStockSummary,
  fetchTransactionLines,
  fetchTransactionUsers,
  fetchTransactions,
  fetchValuation,
} from '../services/reports'
import type { MovementReport, StockSummary, TransactionHistory, Valuation } from '../types/reports'
import { STATUS_STYLE, dateTime, firstOfMonth, qty, rupiah } from '../utils/formatReport'
import { jakartaToday } from '../utils/transactionForm'

type Tab = 'summary' | 'valuation' | 'movement' | 'low' | 'zero' | 'history'
const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Stock Summary' },
  { id: 'valuation', label: 'Inventory Valuation' },
  { id: 'movement', label: 'Stock Movement' },
  { id: 'low', label: 'Low Stock' },
  { id: 'zero', label: 'Zero Stock' },
  { id: 'history', label: 'Transaction History' },
]

const input = 'rounded-md border border-slate-300 px-3 py-2 text-base'
const btn = 'rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50'

async function excel<T>(toast: ReturnType<typeof useToast>, build: () => Promise<T>, finish: (x: T, m: typeof import('../utils/reportExcel')) => void) {
  try {
    const m = await import('../utils/reportExcel')
    finish(await build(), m)
  } catch (e) {
    toast('error', (e as Error).message)
  }
}

function Table({ head, children, empty }: { head: ReactNode; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">{head}</thead>
        <tbody>{children}</tbody>
      </table>
      {empty && <p className="p-4 text-center text-sm text-slate-500">{empty}</p>}
    </div>
  )
}
const th = 'px-3 py-2'
const thr = 'px-3 py-2 text-right'
const td = 'px-3 py-2'
const tdr = 'px-3 py-2 text-right'

export default function Laporan() {
  const [tab, setTab] = useState<Tab>('summary')
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Laporan Persediaan</h2>
      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Jenis laporan">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${tab === t.id ? 'bg-[#0b1f4d] font-semibold text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab kind="summary" />}
      {tab === 'low' && <SummaryTab kind="low" />}
      {tab === 'zero' && <SummaryTab kind="zero" />}
      {tab === 'valuation' && <ValuationTab />}
      {tab === 'movement' && <MovementTab />}
      {tab === 'history' && <HistoryTab />}
    </section>
  )
}

// ----------------------------------------------------------------- A, D, E
function SummaryTab({ kind }: { kind: 'summary' | 'low' | 'zero' }) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [inactive, setInactive] = useState(false)
  const [data, setData] = useState<StockSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const status = kind === 'low' ? 'LOW' : kind === 'zero' ? 'ZERO' : ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetchStockSummary({ search, category, status, includeInactive: inactive }))
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [search, category, status, inactive, toast])

  useEffect(() => {
    const h = setTimeout(() => void load(), 250)
    return () => clearTimeout(h)
  }, [load])

  const categories = [...new Set((data?.rows ?? []).map((r) => r.category).filter(Boolean))] as string[]
  const title = { summary: 'Stock Summary', low: 'Low Stock: di bawah minimum stock', zero: 'Zero Stock: tanpa saldo kuantitas' }[kind]
  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg bg-white p-3 shadow-sm sm:grid-cols-4">
        <input className={input} placeholder="Cari SKU, barcode, nama…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari" />
        <input className={input} placeholder="Kategori" list="lap-kategori" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori" />
        <datalist id="lap-kategori">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Sertakan barang nonaktif</label>
        <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={!data}
          onClick={() => void excel(toast, async () => data!, (d, m) => m.downloadReport(m.stockSummaryWorkbook(d, jakartaToday(), kind)))}>
          Export Excel
        </button>
      </div>
      <p className="text-sm font-medium">{title}</p>
      {data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded bg-white px-3 py-1 shadow-sm">{data.totals.count} barang</span>
          <span className="rounded bg-white px-3 py-1 shadow-sm">Total qty {qty(data.totals.total_qty)}</span>
          <span className="rounded bg-white px-3 py-1 shadow-sm">Total nilai {rupiah(data.totals.total_value)}</span>
        </div>
      )}
      <Table head={<tr><th className={th}>SKU</th><th className={th}>Nama</th><th className={th}>Kategori</th><th className={thr}>Qty akhir</th><th className={thr}>Avg cost</th><th className={thr}>Nilai</th><th className={thr}>Min. stok</th>{kind === 'low' && <th className={thr}>Kurang</th>}<th className={th}>Status</th></tr>}
        empty={data && data.rows.length === 0 ? 'Tidak ada data.' : loading ? 'Memuat…' : undefined}>
        {(data?.rows ?? []).map((r) => (
          <tr key={r.sku} className="border-t border-slate-100">
            <td className={`${td} font-mono`}>{r.sku}</td><td className={td}>{r.product_name}{r.is_active ? '' : ' (nonaktif)'}</td><td className={td}>{r.category ?? '-'}</td>
            <td className={tdr}>{qty(r.quantity)} {r.unit}</td><td className={tdr}>{rupiah(r.average_cost, 6)}</td><td className={tdr}>{rupiah(r.inventory_value)}</td>
            <td className={tdr}>{qty(r.minimum_stock)}</td>{kind === 'low' && <td className={tdr}>{qty(r.shortage)}</td>}
            <td className={td}><span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

// ------------------------------------------------------------------- B
function ValuationTab() {
  const toast = useToast()
  const [category, setCategory] = useState('')
  const [zero, setZero] = useState(false)
  const [data, setData] = useState<Valuation | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await fetchValuation(category, zero))
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }, [category, zero, toast])
  useEffect(() => {
    const h = setTimeout(() => void load(), 250)
    return () => clearTimeout(h)
  }, [load])

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg bg-white p-3 shadow-sm sm:grid-cols-3">
        <input className={input} placeholder="Kategori" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Sertakan saldo nol</label>
        <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={!data}
          onClick={() => void excel(toast, async () => data!, (d, m) => m.downloadReport(m.valuationWorkbook(d, jakartaToday())))}>Export Excel</button>
      </div>
      {data && (
        <>
          <div className={`rounded-lg p-3 text-sm ${data.totals.reconciled ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`} role="status">
            {data.totals.reconciled
              ? `Rekonsiliasi SESUAI: saldo resmi (${rupiah(data.totals.all_balance_value)}) sama dengan jumlah mutasi ledger.`
              : `Rekonsiliasi TIDAK SESUAI: saldo ${rupiah(data.totals.all_balance_value)} vs ledger ${rupiah(data.totals.ledger_value)}. Hubungi ADMIN.`}
          </div>
          <Table head={<tr><th className={th}>SKU</th><th className={th}>Nama</th><th className={thr}>Quantity</th><th className={thr}>Average cost</th><th className={thr}>Nilai persediaan</th></tr>}>
            {data.rows.map((r) => (
              <tr key={r.sku} className="border-t border-slate-100">
                <td className={`${td} font-mono`}>{r.sku}</td><td className={td}>{r.product_name}</td><td className={tdr}>{qty(r.quantity)} {r.unit}</td>
                <td className={tdr}>{rupiah(r.average_cost, 6)}</td><td className={tdr}>{rupiah(r.inventory_value)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
              <td className={td} colSpan={2}>TOTAL NILAI PERSEDIAAN ({data.totals.count} barang)</td><td className={tdr}>{qty(data.totals.total_qty)}</td><td /><td className={tdr}>{rupiah(data.totals.total_value)}</td>
            </tr>
          </Table>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- C
function MovementTab() {
  const toast = useToast()
  const today = jakartaToday()
  const [from, setFrom] = useState(firstOfMonth(today))
  const [to, setTo] = useState(today)
  const [category, setCategory] = useState('')
  const [data, setData] = useState<MovementReport | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (from > to) return toast('error', 'Tanggal awal tidak boleh setelah tanggal akhir')
    setLoading(true)
    try {
      setData(await fetchMovement(from, to, category))
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg bg-white p-3 shadow-sm sm:grid-cols-5">
        <label className="text-sm">Dari<input type="date" className={`${input} w-full`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Sampai<input type="date" className={`${input} w-full`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-sm">Kategori<input className={`${input} w-full`} value={category} onChange={(e) => setCategory(e.target.value)} /></label>
        <button className={`${btn} self-end bg-[#0b1f4d] text-white`} disabled={loading} onClick={() => void load()}>{loading ? 'Memuat…' : 'Tampilkan'}</button>
        <button className={`${btn} self-end border border-[#0b1f4d] text-[#0b1f4d]`} disabled={!data}
          onClick={() => void excel(toast, async () => data!, (d, m) => m.downloadReport(m.movementWorkbook(d)))}>Export Excel</button>
      </div>
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
            <div className="rounded-lg bg-white p-3 shadow-sm">Qty masuk<br /><b>{qty(data.totals.qty_in)}</b></div>
            <div className="rounded-lg bg-white p-3 shadow-sm">Nilai masuk<br /><b>{rupiah(data.totals.value_in)}</b></div>
            <div className="rounded-lg bg-white p-3 shadow-sm">Qty keluar<br /><b>{qty(data.totals.qty_out)}</b></div>
            <div className="rounded-lg bg-white p-3 shadow-sm">Total HPP<br /><b>{rupiah(data.totals.value_out)}</b></div>
          </div>
          <Table head={<tr><th className={th}>SKU</th><th className={th}>Nama</th><th className={thr}>Saldo awal</th><th className={thr}>Masuk</th><th className={thr}>Nilai masuk</th><th className={thr}>Keluar</th><th className={thr}>HPP</th><th className={thr}>Saldo akhir</th><th className={thr}>Nilai akhir</th></tr>}
            empty={data.rows.length === 0 ? 'Tidak ada mutasi pada periode ini.' : undefined}>
            {data.rows.map((r) => (
              <tr key={r.sku} className="border-t border-slate-100">
                <td className={`${td} font-mono`}>{r.sku}</td><td className={td}>{r.product_name}</td><td className={tdr}>{qty(r.opening_qty)}</td>
                <td className={tdr}>{qty(r.qty_in)}</td><td className={tdr}>{rupiah(r.value_in)}</td><td className={tdr}>{qty(r.qty_out)}</td><td className={tdr}>{rupiah(r.value_out)}</td>
                <td className={tdr}>{qty(r.closing_qty)}</td><td className={tdr}>{rupiah(r.closing_value)}</td>
              </tr>
            ))}
            {data.rows.length > 0 && (
              <tr className="border-t border-slate-300 bg-slate-50 font-semibold">
                <td className={td} colSpan={2}>TOTAL</td><td className={tdr}>{qty(data.totals.opening_qty)}</td><td className={tdr}>{qty(data.totals.qty_in)}</td><td className={tdr}>{rupiah(data.totals.value_in)}</td>
                <td className={tdr}>{qty(data.totals.qty_out)}</td><td className={tdr}>{rupiah(data.totals.value_out)}</td><td className={tdr}>{qty(data.totals.closing_qty)}</td><td className={tdr}>{rupiah(data.totals.closing_value)}</td>
              </tr>
            )}
          </Table>
          <p className="text-xs text-slate-500">&quot;Masuk&quot; mencakup seluruh mutasi masuk (saldo awal, pembelian, penyesuaian, dan koreksi reversal). Rincian per jenis ada di file Excel (lembar PER_JENIS).</p>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------- F
const PAGE = 20

function HistoryTab() {
  const toast = useToast()
  const today = jakartaToday()
  const [from, setFrom] = useState(firstOfMonth(today))
  const [to, setTo] = useState(today)
  const [user, setUser] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [data, setData] = useState<TransactionHistory | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { fetchTransactionUsers().then(setUsers).catch(() => {}) }, [])
  useEffect(() => { setPage(1) }, [from, to, user, type, status, search])

  const load = useCallback(async () => {
    try {
      setData(await fetchTransactions({ from, to, user, type, status, search, limit: PAGE, offset: (page - 1) * PAGE }))
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }, [from, to, user, type, status, search, page, toast])
  useEffect(() => {
    const h = setTimeout(() => void load(), 250)
    return () => clearTimeout(h)
  }, [load])

  const pages = Math.max(1, Math.ceil((data?.total_count ?? 0) / PAGE))

  async function exportHistory() {
    setBusy(true)
    await excel(toast, () => fetchTransactions({ from, to, user, type, status, search, limit: null }), (d, m) => m.downloadReport(m.transactionHistoryWorkbook(d, from || null, to || null)))
    setBusy(false)
  }
  async function exportLines(kind: 'IN' | 'OUT') {
    if (!from || !to) return toast('error', 'Isi tanggal dari dan sampai untuk export ini')
    setBusy(true)
    await excel(toast, () => fetchTransactionLines(kind, from, to), (d, m) => m.downloadReport(m.transactionLinesWorkbook(d)))
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg bg-white p-3 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-sm">Dari<input type="date" className={`${input} w-full`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Sampai<input type="date" className={`${input} w-full`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-sm">Pengguna
          <select className={`${input} w-full`} value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">Semua</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Jenis
          <select className={`${input} w-full`} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Semua</option>{['IN', 'OUT', 'OPENING', 'ADJUSTMENT', 'REVERSAL'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="text-sm">Status
          <select className={`${input} w-full`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua</option>{['POSTED', 'PENDING', 'REVERSED', 'REJECTED', 'DRAFT'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="text-sm">Cari<input className={`${input} w-full`} placeholder="No. / dokumen / pihak" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={busy} onClick={() => void exportHistory()}>Export Transaction History</button>
        <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={busy} onClick={() => void exportLines('IN')}>Export Barang Masuk</button>
        <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={busy} onClick={() => void exportLines('OUT')}>Export Barang Keluar</button>
      </div>
      {data && (
        <p className="text-sm">{data.total_count.toLocaleString('id-ID')} transaksi · total nilai POSTED {rupiah(data.totals.posted_total_value)} (PENDING/REVERSED tidak dihitung)</p>
      )}
      <Table head={<tr><th className={th}>Waktu</th><th className={th}>No. Transaksi</th><th className={th}>Jenis</th><th className={th}>Status</th><th className={th}>Dokumen</th><th className={th}>Pihak</th><th className={thr}>Item</th><th className={thr}>Nilai</th><th className={th}>Pengguna</th></tr>}
        empty={data && data.rows.length === 0 ? 'Tidak ada transaksi.' : undefined}>
        {(data?.rows ?? []).map((r) => (
          <tr key={r.id} className="border-t border-slate-100">
            <td className={`${td} whitespace-nowrap`}>{dateTime(r.transaction_date)}</td><td className={`${td} font-mono text-xs`}>{r.transaction_number}</td><td className={td}>{r.transaction_type}</td>
            <td className={td}><span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[r.status] ?? ''}`}>{r.status}</span></td>
            <td className={td}>{r.reference_number ?? '-'}</td><td className={td}>{r.supplier_or_recipient ?? '-'}</td><td className={tdr}>{r.item_count}</td><td className={tdr}>{rupiah(r.total_value)}</td><td className={td}>{r.created_by_name ?? '-'}</td>
          </tr>
        ))}
      </Table>
      <div className="flex items-center justify-between text-sm">
        <span>Halaman {page} dari {pages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Sebelumnya</button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Berikutnya</button>
        </div>
      </div>
    </div>
  )
}
