import { useEffect, useState } from 'react'
import { useToast } from '../components/Toast'
import { fetchStockCard, fetchTransactionDetail } from '../services/reports'
import { searchProducts, type StockedProduct } from '../services/transactions'
import type { StockCard, TransactionDetail } from '../types/reports'
import { STATUS_STYLE, dateTime, firstOfMonth, qty, rupiah } from '../utils/formatReport'
import { jakartaToday } from '../utils/transactionForm'

export default function KartuStok() {
  const toast = useToast()
  const today = jakartaToday()
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<StockedProduct[]>([])
  const [sku, setSku] = useState('')
  const [from, setFrom] = useState(firstOfMonth(today))
  const [to, setTo] = useState(today)
  const [card, setCard] = useState<StockCard | null>(null)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<TransactionDetail | null>(null)
  const [excelBusy, setExcelBusy] = useState(false)

  // Pencarian SKU/nama (debounce)
  useEffect(() => {
    const t = term.trim()
    if (!t) return setHits([])
    const h = setTimeout(() => {
      searchProducts(t, 8).then(setHits).catch((e) => toast('error', (e as Error).message))
    }, 300)
    return () => clearTimeout(h)
  }, [term, toast])

  async function load(s = sku) {
    if (!s) return toast('error', 'Pilih barang terlebih dahulu')
    if (from && to && from > to) return toast('error', 'Tanggal awal tidak boleh setelah tanggal akhir')
    setLoading(true)
    try {
      setCard(await fetchStockCard(s, from || null, to || null))
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function open(id: string) {
    try {
      setDetail(await fetchTransactionDetail(id))
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  async function exportExcel() {
    if (!card) return
    setExcelBusy(true)
    try {
      const { stockCardWorkbook, downloadReport } = await import('../utils/reportExcel')
      downloadReport(stockCardWorkbook(card))
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setExcelBusy(false)
    }
  }

  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base'
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Kartu Stok</h2>

      <div className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="ks-cari" className="text-sm">Cari barang (SKU atau nama)</label>
          <input id="ks-cari" className={input} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={sku ? `Terpilih: ${sku}` : 'Ketik SKU atau nama barang'} autoComplete="off" />
          {hits.length > 0 && (
            <ul className="mt-1 divide-y divide-slate-100 rounded border border-slate-200" role="listbox" aria-label="Hasil pencarian">
              {hits.map((p) => (
                <li key={p.id}>
                  <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => { setSku(p.sku); setTerm(''); setHits([]); void load(p.sku) }}>
                    <span><span className="font-mono">{p.sku}</span> · {p.product_name}</span>
                    <span className="shrink-0 text-xs text-slate-500">Stok {qty(p.quantity)} {p.unit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="text-sm">Dari tanggal<input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Sampai tanggal<input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2 sm:col-span-4">
          <button className="rounded-md bg-[#0b1f4d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={loading || !sku} onClick={() => void load()}>
            {loading ? 'Memuat…' : sku ? `Tampilkan ${sku}` : 'Tampilkan'}
          </button>
          <button className="rounded-md border border-[#0b1f4d] px-4 py-2 text-sm font-semibold text-[#0b1f4d] disabled:opacity-50" disabled={!card || excelBusy} onClick={() => void exportExcel()}>
            Export Excel
          </button>
        </div>
      </div>

      {card && (
        <>
          <div className="grid gap-3 rounded-lg bg-white p-4 text-sm shadow-sm sm:grid-cols-3">
            <div>
              <p className="font-mono text-base font-semibold">{card.product.sku}</p>
              <p>{card.product.product_name}</p>
              <p className="text-xs text-slate-500">{card.product.category ?? '-'} · {card.product.unit}{card.product.is_active ? '' : ' · NONAKTIF'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Saldo awal</p>
              <p className="font-semibold">{qty(card.opening.qty)} {card.product.unit}</p>
              <p>{rupiah(card.opening.value)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Saldo akhir</p>
              <p className="font-semibold">{qty(card.closing.qty)} {card.product.unit}</p>
              <p>{rupiah(card.closing.value)} · avg {rupiah(card.closing.average_cost, 6)}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Tanggal</th><th className="px-2 py-2">No. Transaksi</th><th className="px-2 py-2">No. Dokumen</th>
                  <th className="px-2 py-2">Keterangan</th>
                  <th className="px-2 py-2 text-right">Qty masuk</th><th className="px-2 py-2 text-right">Harga masuk</th><th className="px-2 py-2 text-right">Nilai masuk</th>
                  <th className="px-2 py-2 text-right">Qty keluar</th><th className="px-2 py-2 text-right">HPP/unit</th><th className="px-2 py-2 text-right">Nilai keluar</th>
                  <th className="px-2 py-2 text-right">Saldo qty</th><th className="px-2 py-2 text-right">Avg cost</th><th className="px-2 py-2 text-right">Saldo nilai</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-slate-50 font-medium">
                  <td className="px-2 py-2" colSpan={4}>SALDO AWAL</td>
                  <td colSpan={6} />
                  <td className="px-2 py-2 text-right">{qty(card.opening.qty)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(card.opening.average_cost, 6)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(card.opening.value)}</td>
                </tr>
                {card.rows.map((r) => (
                  <tr key={r.movement_id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-2 py-2">{dateTime(r.movement_date)}</td>
                    <td className="px-2 py-2">
                      <button className="font-mono text-sky-700 underline" onClick={() => void open(r.transaction_id)}>{r.transaction_number}</button>
                      <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[r.transaction_status] ?? ''}`}>{r.movement_type}{r.transaction_status === 'REVERSED' ? ' · REVERSED' : ''}</span>
                    </td>
                    <td className="px-2 py-2">{r.reference_number ?? '-'}</td>
                    <td className="px-2 py-2">{[r.supplier_or_recipient, r.notes, r.reason].filter(Boolean).join(' | ') || '-'}</td>
                    <td className="px-2 py-2 text-right">{Number(r.qty_in) ? qty(r.qty_in) : ''}</td>
                    <td className="px-2 py-2 text-right">{r.unit_cost_in ? rupiah(r.unit_cost_in, 6) : ''}</td>
                    <td className="px-2 py-2 text-right">{Number(r.value_in) ? rupiah(r.value_in) : ''}</td>
                    <td className="px-2 py-2 text-right">{Number(r.qty_out) ? qty(r.qty_out) : ''}</td>
                    <td className="px-2 py-2 text-right">{r.unit_cost_out ? rupiah(r.unit_cost_out, 6) : ''}</td>
                    <td className="px-2 py-2 text-right">{Number(r.value_out) ? rupiah(r.value_out) : ''}</td>
                    <td className="px-2 py-2 text-right">{qty(r.balance_qty)}</td>
                    <td className="px-2 py-2 text-right">{rupiah(r.average_cost, 6)}</td>
                    <td className="px-2 py-2 text-right">{rupiah(r.balance_value)}</td>
                  </tr>
                ))}
                {card.rows.length === 0 && <tr><td colSpan={13} className="px-3 py-6 text-center text-slate-500">Tidak ada mutasi pada periode ini.</td></tr>}
                <tr className="border-t border-slate-300 bg-slate-50 font-medium">
                  <td className="px-2 py-2" colSpan={4}>TOTAL PERIODE</td>
                  <td className="px-2 py-2 text-right">{qty(card.totals.qty_in)}</td><td />
                  <td className="px-2 py-2 text-right">{rupiah(card.totals.value_in)}</td>
                  <td className="px-2 py-2 text-right">{qty(card.totals.qty_out)}</td><td />
                  <td className="px-2 py-2 text-right">{rupiah(card.totals.value_out)}</td><td colSpan={3} />
                </tr>
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-2 py-2" colSpan={4}>SALDO AKHIR</td><td colSpan={6} />
                  <td className="px-2 py-2 text-right">{qty(card.closing.qty)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(card.closing.average_cost, 6)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(card.closing.value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">Saldo awal = jumlah mutasi sebelum tanggal awal. Klik nomor transaksi untuk melihat detail dan menelusuri sumbernya.</p>
        </>
      )}

      {detail && <DetailModal d={detail} onClose={() => setDetail(null)} />}
    </section>
  )
}

function DetailModal({ d, onClose }: { d: TransactionDetail; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label="Detail transaksi">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">{d.transaction_number}</h3>
            <p className="text-sm text-slate-600">
              {d.transaction_type} · <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[d.status] ?? ''}`}>{d.status}</span>
              {d.posting_sequence !== null && <> · urutan posting #{d.posting_sequence}</>}
            </p>
          </div>
          <button className="text-sm underline" onClick={onClose}>Tutup</button>
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-slate-500">Tanggal: </dt><dd className="inline">{dateTime(d.transaction_date)}</dd></div>
          <div><dt className="inline text-slate-500">No. dokumen: </dt><dd className="inline">{d.reference_number ?? '-'}</dd></div>
          <div><dt className="inline text-slate-500">Supplier/penerima: </dt><dd className="inline">{d.supplier_or_recipient ?? '-'}</dd></div>
          <div><dt className="inline text-slate-500">Dibuat oleh: </dt><dd className="inline">{d.created_by_name ?? '-'}</dd></div>
          <div><dt className="inline text-slate-500">Disetujui oleh: </dt><dd className="inline">{d.approved_by_name ?? '-'}</dd></div>
          <div><dt className="inline text-slate-500">Keterangan: </dt><dd className="inline">{d.notes ?? '-'}</dd></div>
          {d.reason && <div className="sm:col-span-2"><dt className="inline text-slate-500">Alasan: </dt><dd className="inline">{d.reason}</dd></div>}
          {d.reversal_of_number && <div className="sm:col-span-2 font-medium text-orange-700">Reversal dari {d.reversal_of_number}</div>}
          {d.reversed_by_number && <div className="sm:col-span-2 font-medium text-orange-700">Sudah direversal oleh {d.reversed_by_number}</div>}
        </dl>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr><th className="px-2 py-2">SKU</th><th className="px-2 py-2 text-right">Qty</th><th className="px-2 py-2 text-right">Biaya/unit</th><th className="px-2 py-2 text-right">Nilai</th><th className="px-2 py-2 text-right">Avg sebelum</th><th className="px-2 py-2 text-right">Avg sesudah</th><th className="px-2 py-2 text-right">Saldo qty</th><th className="px-2 py-2 text-right">Saldo nilai</th></tr>
            </thead>
            <tbody>
              {d.items.map((i, k) => (
                <tr key={`${i.sku}-${k}`} className="border-t border-slate-100">
                  <td className="px-2 py-2"><span className="font-mono">{i.sku}</span><br /><span className="text-slate-500">{i.product_name}</span></td>
                  <td className="px-2 py-2 text-right">{qty(i.quantity)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(i.unit_cost, 6)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(i.total_value)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(i.average_cost_before, 6)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(i.average_cost_after, 6)}</td>
                  <td className="px-2 py-2 text-right">{qty(i.balance_qty)}</td>
                  <td className="px-2 py-2 text-right">{rupiah(i.balance_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
