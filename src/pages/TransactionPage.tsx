import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast, type ToastKind } from '../components/Toast'
import { addQuantities, parseDecimal } from '../utils/decimal'

// ZXing cukup besar: dimuat hanya saat panel scan dibuka.
const ScanModal = lazy(() => import('../components/ScanModal'))
import { PostFailure, postTransaction, type PostResult, type StockedProduct } from '../services/transactions'
import { isOnline, lookupCatalog, outbox, searchCatalog, stockCatalog, type Source } from '../services/catalog'
import { useSync } from '../hooks/useSync'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { formatScaled, toScaled } from '../utils/decimal'
import type { OutboxTxn } from '../types'
import {
  buildItems,
  estimateValue,
  jakartaToday,
  resolveTransactionDate,
  sumEstimates,
  validateLines,
  type LineIssue,
  type PostErrorKind,
  type TxLine,
  type TxType,
} from '../utils/transactionForm'

const TITLE: Record<TxType, string> = { IN: 'Barang Masuk', OUT: 'Barang Keluar' }

function newId(): string {
  const c: Crypto = crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const num = (s: string | number, max = 4) => Number(s).toLocaleString('id-ID', { maximumFractionDigits: max })
const rp = (s: string | number, max = 2) => `Rp ${Number(s).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: max })}`

const KIND_TOAST: Record<PostErrorKind, ToastKind> = {
  insufficient: 'insufficient',
  notfound: 'notfound',
  inactive: 'notfound',
  backdated: 'conflict',
  validation: 'error',
  forbidden: 'error',
  offline: 'pending',
  unknown: 'error',
}

type Step = 'edit' | 'preview' | 'done' | 'queued'

/** a + b (b boleh negatif), qty 4 desimal, tanpa float. */
function addSigned(a: string, b: string): string {
  const v = toScaled(a, 4) + (b.startsWith('-') ? -toScaled(b.slice(1), 4) : toScaled(b, 4))
  const neg = v < 0n
  const t = formatScaled(neg ? -v : v, 4)
  return neg ? `-${t}` : t
}

function lineFrom(p: StockedProduct): TxLine {
  return {
    sku: p.sku,
    name: p.product_name,
    unit: p.unit,
    quantity: '',
    unitCost: '',
    available: p.quantity,
    averageCost: p.average_cost,
    inventoryValue: p.inventory_value,
  }
}

export default function TransactionPage({ type }: { type: TxType }) {
  const { role, userId } = useAuth()
  const online = useOnlineStatus()
  const { cachedAt } = useSync()
  const toast = useToast()
  const isIn = type === 'IN'

  const [step, setStep] = useState<Step>('edit')
  const [date, setDate] = useState(jakartaToday())
  const [reference, setReference] = useState('')
  const [party, setParty] = useState('')
  const [notes, setNotes] = useState('')
  const [allowBackdate, setAllowBackdate] = useState(false)
  const [lines, setLines] = useState<TxLine[]>([])
  const [issues, setIssues] = useState<LineIssue[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PostResult | null>(null)
  // Satu kunci idempotensi per dokumen: retry tidak menggandakan transaksi
  const clientId = useRef(newId())

  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<StockedProduct[]>([])
  const [searching, setSearching] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [source, setSource] = useState<Source>('server')
  const [queued, setQueued] = useState<OutboxTxn | null>(null)

  // Pencarian barang (debounce)
  useEffect(() => {
    const t = term.trim()
    if (!t) {
      setHits([])
      return
    }
    setSearching(true)
    const h = setTimeout(() => {
      searchCatalog(t)
        .then((r) => {
          setHits(r.value)
          setSource(r.source)
        })
        .catch((e) => toast('error', (e as Error).message))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(h)
  }, [term, toast])

  const addProduct = useCallback(
    (p: StockedProduct) => {
      setLines((cur) => {
        if (cur.some((l) => l.sku === p.sku)) {
          toast('info', `${p.sku} sudah ada di daftar`)
          return cur
        }
        return [...cur, lineFrom(p)]
      })
      setTerm('')
      setHits([])
    },
    [toast],
  )

  async function submitManual() {
    const t = term.trim()
    if (!t) return
    try {
      const { value: r } = await lookupCatalog(t)
      if (r.kind === 'none') return toast('notfound', `SKU atau barcode "${t}" tidak ditemukan`)
      if (r.kind === 'ambiguous') return toast('error', `Kode "${t}" cocok dengan lebih dari satu barang`)
      if (r.kind === 'inactive') return toast('notfound', `${r.product.sku} berstatus nonaktif`)
      addProduct(r.product)
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  /** Dari hasil scan: tambah baris baru, atau gabungkan quantity jika SKU sudah ada. */
  const addScanned = useCallback(
    (p: StockedProduct, quantity: string, unitCost: string) => {
      setLines((cur) => {
        const i = cur.findIndex((l) => l.sku === p.sku)
        if (i < 0) return [...cur, { ...lineFrom(p), quantity, unitCost }]
        const old = parseDecimal(cur[i].quantity, { maxScale: 4, maxIntDigits: 16 })
        const add = parseDecimal(quantity, { maxScale: 4, maxIntDigits: 16 })
        const merged = old.ok && add.ok ? addQuantities(old.value, add.value) : quantity
        return cur.map((l, k) => (k === i ? { ...l, quantity: merged, unitCost: unitCost || l.unitCost } : l))
      })
      toast('success', `${p.sku} ditambahkan (${quantity})`)
    },
    [toast],
  )

  const dateInfo = useMemo(() => resolveTransactionDate(date), [date])

  function collectIssues(current: TxLine[]): LineIssue[] {
    const list = validateLines(type, current)
    if (dateInfo.relation === 'invalid') list.push({ index: -1, field: 'line', message: 'Tanggal tidak valid' })
    if (dateInfo.relation === 'future') list.push({ index: -1, field: 'line', message: 'Tanggal tidak boleh di masa depan' })
    return list
  }

  async function goPreview() {
    // Stok pada tahap ini bisa usang (dipilih sebelumnya); penilaian stok dilakukan setelah dimuat ulang di bawah.
    const first = collectIssues(lines).filter((i) => !i.message.startsWith('Melebihi stok'))
    setIssues(first)
    if (first.length) return toast('error', 'Periksa kembali isian yang ditandai')
    setBusy(true)
    try {
      // Muat ulang stok resmi dari server agar pratinjau sesuai kondisi terbaru
      const { value: fresh, source: src } = await stockCatalog(lines.map((l) => l.sku))
      setSource(src)
      // Ada antrean offline untuk SKU yang sama? Proyeksikan stok dengan transaksi yang masih menunggu.
      const hasQueue = userId ? await outbox.hasUnsyncedFor(userId, lines.map((l) => l.sku)) : false
      const updated: TxLine[] = []
      for (const l of lines) {
        const p = fresh.get(l.sku)
        if (!p) {
          updated.push(l)
          continue
        }
        const delta = userId ? await outbox.queuedDelta(userId, l.sku) : '0.0000'
        updated.push({
          ...l,
          available: hasQueue || src === 'cache' ? addSigned(p.quantity, delta) : p.quantity,
          averageCost: p.average_cost,
          inventoryValue: p.inventory_value,
        })
      }
      setLines(updated)
      let again = collectIssues(updated)
      // Stok dari cache/antrean hanya perkiraan: peringatan, bukan penghalang. Server yang memutuskan.
      const advisoryOnly = src === 'cache' || hasQueue
      const stockWarn = again.filter((i) => i.message.startsWith('Melebihi stok'))
      if (advisoryOnly && stockWarn.length) {
        again = again.filter((i) => !i.message.startsWith('Melebihi stok'))
        toast('info', 'Stok tampak kurang menurut data terakhir di perangkat. Transaksi tetap dapat disimpan; server akan memvalidasi saat sinkronisasi.')
      }
      setIssues(again)
      if (again.length) {
        const insufficient = again.find((i) => i.message.startsWith('Melebihi stok'))
        return toast(insufficient ? 'insufficient' : 'error', insufficient ? 'Stok tidak mencukupi untuk sebagian barang' : 'Periksa kembali isian yang ditandai')
      }
      setStep('preview')
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Simpan dokumen ke antrean offline (IndexedDB) dengan kunci idempotensi yang sama. */
  async function queueCurrent() {
    if (!userId) throw new Error('Pengguna tidak dikenal; masuk terlebih dahulu')
    const t = await outbox.enqueue({
      userId,
      type,
      clientTransactionId: clientId.current,
      payload: {
        dateIso: dateInfo.iso,
        dateInput: date,
        reference,
        party,
        notes,
        items: buildItems(type, lines),
        allowBackdate: role === 'ADMIN' && allowBackdate,
        names: Object.fromEntries(lines.map((l) => [l.sku, { name: l.name, unit: l.unit }])),
      },
    })
    setQueued(t)
    setStep('queued')
    toast('pending', 'Disimpan di antrean offline (PENDING). Belum menjadi transaksi resmi; akan dikirim otomatis saat online.')
  }

  async function post() {
    setBusy(true)
    try {
      // Offline, atau masih ada antrean untuk SKU yang sama: masuk antrean agar urutan pencatatan terjaga.
      if (!isOnline() || (userId && (await outbox.hasUnsyncedFor(userId, lines.map((l) => l.sku))))) {
        await queueCurrent()
        return
      }
      const res = await postTransaction({
        type,
        clientTransactionId: clientId.current,
        dateIso: dateInfo.iso,
        reference,
        party,
        notes,
        items: buildItems(type, lines),
        allowBackdate: role === 'ADMIN' && allowBackdate,
      })
      setResult(res)
      setStep('done')
      toast(res.duplicate ? 'info' : 'success', res.duplicate ? `Dokumen ${res.transaction_number} sudah diposting sebelumnya` : `Berhasil: ${res.transaction_number} diposting`)
    } catch (e) {
      const f = e as PostFailure
      if (f.kind === 'offline') {
        // Jaringan putus saat mengirim (server mungkin sudah memproses): antre dengan kunci yang SAMA agar retry idempoten.
        try {
          await queueCurrent()
        } catch (qe) {
          toast('error', (qe as Error).message)
        }
        return
      }
      toast(f.kind ? KIND_TOAST[f.kind] : 'error', f.message)
      if (f.kind === 'insufficient' || f.kind === 'notfound' || f.kind === 'inactive' || f.kind === 'validation' || f.kind === 'backdated') {
        // kembali ke form dan segarkan stok server agar pengguna dapat memperbaiki
        setStep('edit')
        stockCatalog(lines.map((l) => l.sku))
          .then(({ value: fresh }) =>
            setLines((cur) =>
              cur.map((l) => {
                const p = fresh.get(l.sku)
                return p ? { ...l, available: p.quantity, averageCost: p.average_cost, inventoryValue: p.inventory_value } : l
              }),
            ),
          )
          .catch(() => {})
      }
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setStep('edit')
    setLines([])
    setIssues([])
    setReference('')
    setParty('')
    setNotes('')
    setAllowBackdate(false)
    setResult(null)
    setQueued(null)
    setDate(jakartaToday())
    clientId.current = newId()
  }

  const setLine = (i: number, patch: Partial<TxLine>) => setLines((cur) => cur.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const issueFor = (i: number, f: LineIssue['field']) => issues.find((x) => x.index === i && x.field === f)?.message
  const docIssues = issues.filter((i) => i.index === -1)

  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base'
  const btn = 'rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-50'

  // ------------------------------------------------------- tersimpan di antrean
  if (step === 'queued' && queued) {
    return (
      <section className="space-y-3">
        <div className="rounded-lg bg-amber-50 p-4 text-amber-900 shadow-sm">
          <h2 className="text-lg font-semibold">{TITLE[type]} tersimpan di antrean offline</h2>
          <p className="text-sm">
            Status <b>PENDING</b>: ini <b>belum</b> menjadi transaksi resmi dan belum mengubah saldo. Dokumen dikirim ke server secara otomatis saat
            koneksi tersedia; server akan memeriksa stok dan urutan.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Qty</th>
                {isIn && <th className="px-3 py-2 text-right">Harga beli</th>}
              </tr>
            </thead>
            <tbody>
              {queued.payload.items.map((i) => (
                <tr key={i.sku} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className="font-mono">{i.sku}</span> <span className="text-slate-500">{queued.payload.names[i.sku]?.name}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {num(i.quantity)} {queued.payload.names[i.sku]?.unit}
                  </td>
                  {isIn && <td className="px-3 py-2 text-right">{rp(i.unit_cost ?? 0, 6)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className={`${btn} bg-[#0b1f4d] text-white`} onClick={reset}>
          Transaksi baru
        </button>
        <p className="text-xs text-slate-500">
          Lihat dan kelola di menu Antrean Offline. Jika stok berubah di perangkat lain, transaksi bisa berstatus CONFLICT dan perlu Anda perbaiki.
        </p>
      </section>
    )
  }

  // ---------------------------------------------------------------- selesai
  if (step === 'done' && result) {
    return (
      <section className="space-y-3">
        <div className="rounded-lg bg-emerald-50 p-4 text-emerald-900 shadow-sm">
          <h2 className="text-lg font-semibold">{TITLE[type]} berhasil diposting</h2>
          <p className="text-sm">
            Nomor <span className="font-mono font-semibold">{result.transaction_number}</span> · urutan posting #{result.posting_sequence}
            {result.duplicate ? ' · (retry: dokumen ini sudah pernah diposting)' : ''}
          </p>
          <p className="mt-1 text-xs">Saldo di bawah adalah hasil resmi dari server.</p>
        </div>
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">{isIn ? 'Nilai masuk' : 'HPP'}</th>
                <th className="px-3 py-2 text-right">Avg sebelum</th>
                <th className="px-3 py-2 text-right">Avg sesudah</th>
                <th className="px-3 py-2 text-right">Saldo qty</th>
                <th className="px-3 py-2 text-right">Saldo nilai</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((it, i) => (
                <tr key={`${it.sku}-${i}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono">{it.sku}</td>
                  <td className="px-3 py-2 text-right">{num(it.quantity)}</td>
                  <td className="px-3 py-2 text-right">{rp(it.total_value)}</td>
                  <td className="px-3 py-2 text-right">{rp(it.average_cost_before, 6)}</td>
                  <td className="px-3 py-2 text-right">{rp(it.average_cost_after, 6)}</td>
                  <td className="px-3 py-2 text-right">{num(it.balance_quantity)}</td>
                  <td className="px-3 py-2 text-right">{rp(it.balance_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className={`${btn} bg-[#0b1f4d] text-white`} onClick={reset}>Transaksi baru</button>
      </section>
    )
  }

  // --------------------------------------------------------------- pratinjau
  if (step === 'preview') {
    const estimates = lines.map((l) => estimateValue(type, l))
    const total = sumEstimates(estimates)
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pratinjau {TITLE[type]}</h2>
        <div className="grid gap-1 rounded-lg bg-white p-4 text-sm shadow-sm sm:grid-cols-2">
          <p><span className="text-slate-500">Tanggal:</span> {date}</p>
          <p><span className="text-slate-500">No. dokumen:</span> {reference || '-'}</p>
          <p><span className="text-slate-500">{isIn ? 'Supplier' : 'Penerima/Tujuan'}:</span> {party || '-'}</p>
          <p><span className="text-slate-500">Keterangan:</span> {notes || '-'}</p>
          {allowBackdate && dateInfo.relation === 'past' && <p className="font-medium text-orange-700 sm:col-span-2">Transaksi mundur disetujui ADMIN</p>}
        </div>
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU / Nama</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">{isIn ? 'Harga beli' : 'Avg cost (server)'}</th>
                <th className="px-3 py-2 text-right">{isIn ? 'Nilai (perkiraan)' : 'HPP (estimasi)'}</th>
                {!isIn && <th className="px-3 py-2 text-right">Stok tersedia</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.sku} className="border-t border-slate-100">
                  <td className="px-3 py-2"><span className="font-mono">{l.sku}</span><br /><span className="text-xs text-slate-500">{l.name}</span></td>
                  <td className="px-3 py-2 text-right">{num(l.quantity.replace(',', '.'))} {l.unit}</td>
                  <td className="px-3 py-2 text-right">{isIn ? rp(l.unitCost.replace(',', '.'), 6) : rp(l.averageCost ?? 0, 6)}</td>
                  <td className="px-3 py-2 text-right">{estimates[i] === null ? '-' : rp(estimates[i]!)}</td>
                  {!isIn && <td className="px-3 py-2 text-right">{num(l.available ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold">
                <td className="px-3 py-2" colSpan={3}>Total (perkiraan)</td>
                <td className="px-3 py-2 text-right">{total === null ? '-' : rp(total)}</td>
                {!isIn && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="rounded bg-sky-50 p-3 text-xs text-sky-900">
          Angka di atas hanya perkiraan. Server memvalidasi stok, menghitung {isIn ? 'Moving Average baru' : 'HPP berdasarkan average cost sebelum transaksi'}, lalu membukukan seluruh dokumen secara atomik: jika satu barang gagal, seluruh dokumen batal.
        </p>
        <div className="flex gap-2">
          <button className={`${btn} border border-slate-300 bg-white`} disabled={busy} onClick={() => setStep('edit')}>Kembali</button>
          <button className={`${btn} bg-[#0b1f4d] text-white`} disabled={busy} onClick={() => void post()}>
            {busy ? 'Memposting…' : `Posting ${TITLE[type]}`}
          </button>
        </div>
      </section>
    )
  }

  // ------------------------------------------------------------------- form
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{TITLE[type]}</h2>
      {(!online || source === 'cache') && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Mode offline: pencarian dan stok memakai data terakhir di perangkat
          {cachedAt ? ` (diperbarui ${new Date(cachedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })})` : ' (belum pernah diperbarui)'}. Transaksi akan
          masuk antrean dan diverifikasi server saat online.
        </p>
      )}

      <div className="grid gap-3 rounded-lg bg-white p-4 shadow-sm sm:grid-cols-2">
        <label className="text-sm">Tanggal
          <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-sm">No. dokumen
          <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={isIn ? 'mis. PO-001 / surat jalan' : 'mis. SJ-001'} />
        </label>
        <label className="text-sm">{isIn ? 'Supplier' : 'Penerima / tujuan'}
          <input className={input} value={party} onChange={(e) => setParty(e.target.value)} />
        </label>
        <label className="text-sm">Keterangan
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {dateInfo.relation === 'past' && (
          <div className="rounded bg-orange-50 p-3 text-xs text-orange-900 sm:col-span-2">
            Tanggal lebih awal dari mutasi terakhir suatu barang tidak dapat langsung diposting dan perlu persetujuan ADMIN.
            {role === 'ADMIN' && (
              <label className="mt-2 flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={allowBackdate} onChange={(e) => setAllowBackdate(e.target.checked)} />
                Saya (ADMIN) menyetujui transaksi bertanggal mundur ini
              </label>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg bg-white p-4 shadow-sm">
        <label className="text-sm font-medium" htmlFor="cari-barang">Tambah barang (SKU, barcode, atau nama)</label>
        <div className="mt-1 flex gap-2">
          <input
            id="cari-barang"
            className={input}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitManual() } }}
            placeholder="Ketik lalu Enter untuk SKU/barcode persis"
            autoComplete="off"
            inputMode="search"
          />
          <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} onClick={() => void submitManual()}>Tambah</button>
        </div>
        <button className={`${btn} mt-2 w-full bg-[#0b1f4d] text-white`} onClick={() => setScanOpen(true)}>
          Scan Barcode / QR dengan Kamera
        </button>
        {searching && <p className="mt-2 text-xs text-slate-500">Mencari…</p>}
        {hits.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded border border-slate-200" role="listbox" aria-label="Hasil pencarian">
            {hits.map((p) => (
              <li key={p.id}>
                <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => addProduct(p)}>
                  <span><span className="font-mono">{p.sku}</span> · {p.product_name}</span>
                  <span className="shrink-0 text-xs text-slate-500">Stok {num(p.quantity)} {p.unit}{!isIn && Number(p.quantity) > 0 ? ` · avg ${rp(p.average_cost, 2)}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!searching && term.trim() && hits.length === 0 && <p className="mt-2 text-xs text-slate-500">Tidak ada barang aktif yang cocok. Tekan Enter untuk memeriksa SKU/barcode persis.</p>}
      </div>

      <div className="space-y-2">
        {lines.length === 0 && <p className="rounded-lg bg-white p-4 text-sm text-slate-500 shadow-sm">Belum ada barang. Cari barang di atas untuk menambahkannya ke dokumen ini.</p>}
        {lines.map((l, i) => (
          <div key={l.sku} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold">{l.sku}</p>
                <p className="truncate text-sm">{l.name}</p>
                <p className="text-xs text-slate-500">
                  Stok tersedia: <span className="font-medium">{num(l.available ?? 0)} {l.unit}</span>
                  {!isIn && ` · Average cost: ${rp(l.averageCost ?? 0, 6)}`}
                </p>
              </div>
              <button className="shrink-0 text-sm text-red-700 underline" onClick={() => setLines((cur) => cur.filter((_, k) => k !== i))}>Hapus</button>
            </div>
            <div className={`mt-2 grid gap-2 ${isIn ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <label className="text-xs">Quantity ({l.unit})
                <input className={`${input} ${issueFor(i, 'quantity') ? 'border-red-500' : ''}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-invalid={Boolean(issueFor(i, 'quantity'))} />
                {issueFor(i, 'quantity') && <span role="alert" className="text-red-600">{issueFor(i, 'quantity')}</span>}
              </label>
              {isIn && (
                <label className="text-xs">Harga beli per unit (Rp)
                  <input className={`${input} ${issueFor(i, 'unitCost') ? 'border-red-500' : ''}`} inputMode="decimal" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} aria-invalid={Boolean(issueFor(i, 'unitCost'))} />
                  {issueFor(i, 'unitCost') && <span role="alert" className="text-red-600">{issueFor(i, 'unitCost')}</span>}
                </label>
              )}
            </div>
            {issueFor(i, 'line') && <p role="alert" className="mt-1 text-xs text-red-600">{issueFor(i, 'line')}</p>}
          </div>
        ))}
      </div>

      {docIssues.length > 0 && (
        <ul role="alert" className="list-disc rounded bg-red-100 p-3 pl-6 text-sm text-red-800">
          {docIssues.map((d) => <li key={d.message}>{d.message}</li>)}
        </ul>
      )}

      <button className={`${btn} bg-[#0b1f4d] text-white`} disabled={busy} onClick={() => void goPreview()}>
        {busy ? 'Memeriksa…' : 'Pratinjau'}
      </button>

      {scanOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 text-white">Memuat scanner…</div>}>
          <ScanModal type={type} onAdd={addScanned} onClose={() => setScanOpen(false)} />
        </Suspense>
      )}
    </section>
  )
}
