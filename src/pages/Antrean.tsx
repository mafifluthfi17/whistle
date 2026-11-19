import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useLive } from '../hooks/useLive'
import { useSync } from '../hooks/useSync'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useToast } from '../components/Toast'
import { outbox } from '../services/catalog'
import type { OutboxTxn, SyncStatus } from '../types'
import { STATUS_STYLE, dateTime, qty, rupiah } from '../utils/formatReport'
import { parseDecimal } from '../utils/decimal'
import { buildItems, validateLines, type TxLine } from '../utils/transactionForm'

const BADGE: Record<SyncStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  SYNCING: 'bg-sky-100 text-sky-800',
  SYNCED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  CONFLICT: 'bg-orange-100 text-orange-800',
}
const HINT: Record<SyncStatus, string> = {
  PENDING: 'Menunggu dikirim. Belum menjadi transaksi resmi dan belum mengubah saldo.',
  SYNCING: 'Sedang dikirim ke server.',
  SYNCED: 'Sudah diposting di server.',
  FAILED: 'Ditolak server. Perbaiki datanya atau batalkan.',
  CONFLICT: 'Bentrok dengan data server (mis. stok sudah berubah). Perbaiki atau batalkan.',
}

export default function Antrean() {
  const { userId } = useAuth()
  const toast = useToast()
  const online = useOnlineStatus()
  const { syncNow, syncing, lastSyncAt, cachedAt, cacheCount, refreshCatalog, othersOpen } = useSync()
  const all = useLive(() => outbox.listAll(), [], [] as OutboxTxn[])
  const [editing, setEditing] = useState<OutboxTxn | null>(null)
  const mine = all.filter((t) => t.userId === userId)
  const open = mine.filter((t) => t.status !== 'SYNCED')
  const done = mine.filter((t) => t.status === 'SYNCED').slice(-20).reverse()

  async function cancel(t: OutboxTxn) {
    const warn = t.status === 'PENDING' && t.attempts > 0 ? '\n\nPERHATIAN: transaksi ini sudah pernah dicoba dikirim dan mungkin sudah diposting di server. Periksa Transaction History sebelum membatalkan.' : ''
    if (!window.confirm(`Batalkan transaksi ini dari antrean? Data lokalnya akan dihapus.${warn}`)) return
    try {
      await outbox.cancel(t.id)
      toast('info', 'Transaksi dibatalkan dari antrean')
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Antrean Offline</h2>

      <div className="rounded-lg bg-white p-4 text-sm shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{online ? 'Online' : 'Offline'}</span>
          <button className="rounded-md bg-[#0b1f4d] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!online || syncing || open.length === 0} onClick={() => void syncNow()}>
            {syncing ? 'Menyinkronkan…' : 'Sinkronkan sekarang'}
          </button>
          <button className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50" disabled={!online} onClick={() => void refreshCatalog()}>Perbarui data barang</button>
        </div>
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
          <li>Data barang di perangkat: {cacheCount.toLocaleString('id-ID')} barang{cachedAt ? ` (diperbarui ${dateTime(cachedAt)})` : ' (belum pernah diperbarui; hubungkan ke internet sekali sebelum bekerja offline)'}.</li>
          <li>Sinkronisasi terakhir: {lastSyncAt ? dateTime(lastSyncAt) : 'belum ada sesi ini'}.</li>
          {othersOpen > 0 && <li className="text-amber-700">{othersOpen} transaksi milik pengguna lain di perangkat ini; dikirim saat pemiliknya masuk.</li>}
        </ul>
        <p className="mt-2 rounded bg-sky-50 p-2 text-xs text-sky-900">
          Transaksi di antrean bersifat <b>sementara</b>: belum resmi dan belum memengaruhi saldo. Server memvalidasi stok dan urutan saat sinkronisasi,
          sehingga transaksi offline <b>tidak dijamin berhasil</b> jika stok berubah di perangkat lain.
        </p>
      </div>

      {open.length === 0 && <p className="rounded-lg bg-white p-6 text-center text-sm text-slate-500 shadow-sm">Tidak ada transaksi menunggu. Semua sudah tersinkron.</p>}

      {open.map((t) => (
        <article key={t.id} className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">
                {t.type === 'IN' ? 'Barang Masuk' : 'Barang Keluar'} · {t.payload.reference || 'tanpa dokumen'}
                <span className={`ml-2 rounded px-2 py-0.5 text-xs ${BADGE[t.status]}`}>{t.status}</span>
              </p>
              <p className="text-xs text-slate-500">Dicatat {dateTime(t.createdAt)} · tanggal transaksi {t.payload.dateInput} · percobaan {t.attempts}x</p>
            </div>
            <div className="flex gap-2 text-sm">
              {(t.status === 'FAILED' || t.status === 'CONFLICT') && (
                <button className="rounded-md border border-sky-700 px-3 py-1 text-sky-800" onClick={() => setEditing(t)}>Perbaiki</button>
              )}
              {t.status !== 'SYNCING' && <button className="rounded-md border border-red-700 px-3 py-1 text-red-800" onClick={() => void cancel(t)}>Batalkan</button>}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-600">{HINT[t.status]}</p>
          {t.blockedBy && <p className="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-900">Ditahan karena transaksi sebelumnya untuk barang yang sama belum berhasil. Urutan pencatatan dijaga.</p>}
          {t.error && <p role="alert" className={`mt-1 rounded p-2 text-xs ${t.status === 'PENDING' ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`}>{t.status === 'PENDING' ? 'Percobaan terakhir: ' : 'Penyebab: '}{t.error}</p>}
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-slate-500"><tr><th className="py-1">SKU</th><th className="py-1 text-right">Qty</th>{t.type === 'IN' && <th className="py-1 text-right">Harga beli</th>}</tr></thead>
            <tbody>
              {t.payload.items.map((i) => (
                <tr key={i.sku} className="border-t border-slate-100">
                  <td className="py-1"><span className="font-mono">{i.sku}</span> <span className="text-slate-500">{t.payload.names[i.sku]?.name}</span></td>
                  <td className="py-1 text-right">{qty(i.quantity)} {t.payload.names[i.sku]?.unit}</td>
                  {t.type === 'IN' && <td className="py-1 text-right">{rupiah(i.unit_cost, 6)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}

      {done.length > 0 && (
        <div className="rounded-lg bg-white shadow-sm">
          <h3 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Sudah tersinkron (20 terakhir, disimpan 7 hari)</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {done.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>{t.type === 'IN' ? 'Masuk' : 'Keluar'} · {t.payload.items.map((i) => `${i.sku} × ${qty(i.quantity)}`).join(', ')}</span>
                <span className="text-xs text-slate-500">
                  <span className={`mr-2 rounded px-2 py-0.5 ${STATUS_STYLE.POSTED}`}>{t.result?.transaction_number ?? 'POSTED'}</span>
                  {t.syncedAt ? dateTime(t.syncedAt) : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && <EditModal txn={editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function EditModal({ txn, onClose }: { txn: OutboxTxn; onClose: () => void }) {
  const toast = useToast()
  const { role } = useAuth()
  const [reference, setReference] = useState(txn.payload.reference)
  const [party, setParty] = useState(txn.payload.party)
  const [notes, setNotes] = useState(txn.payload.notes)
  const [allowBackdate, setAllowBackdate] = useState(txn.payload.allowBackdate)
  const [lines, setLines] = useState(txn.payload.items.map((i) => ({ sku: i.sku, quantity: i.quantity, unitCost: i.unit_cost ?? '' })))
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const txLines: TxLine[] = lines.map((l) => ({ sku: l.sku, name: txn.payload.names[l.sku]?.name ?? l.sku, unit: txn.payload.names[l.sku]?.unit ?? '', quantity: l.quantity, unitCost: l.unitCost }))
    const issues = validateLines(txn.type, txLines).filter((i) => !i.message.startsWith('Melebihi stok'))
    if (issues.length) return setErr(issues[0].message)
    for (const l of lines) if (!parseDecimal(l.quantity, { maxScale: 4, maxIntDigits: 16 }).ok) return setErr(`Quantity ${l.sku} tidak valid`)
    try {
      await outbox.edit(txn.id, { items: buildItems(txn.type, txLines), reference, party, notes, allowBackdate })
      toast('success', 'Perbaikan disimpan. Transaksi akan dikirim ulang.')
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base'
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label="Perbaiki transaksi">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="text-lg font-semibold">Perbaiki transaksi</h3>
        {txn.error && <p className="mt-1 rounded bg-red-50 p-2 text-xs text-red-800">Penyebab: {txn.error}</p>}
        <p className="mt-1 text-xs text-slate-500">Perubahan hanya dilakukan oleh Anda. Setelah disimpan, transaksi dikirim ulang sebagai dokumen baru pada posisi urutan yang sama.</p>
        <div className="mt-3 space-y-2">
          {lines.map((l, i) => (
            <div key={l.sku} className="grid grid-cols-2 gap-2 rounded border border-slate-200 p-2">
              <p className="col-span-2 font-mono text-sm">{l.sku} <span className="font-sans text-xs text-slate-500">{txn.payload.names[l.sku]?.name}</span></p>
              <label className="text-xs">Quantity<input className={input} inputMode="decimal" value={l.quantity} onChange={(e) => setLines((c) => c.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)))} /></label>
              {txn.type === 'IN' && <label className="text-xs">Harga beli<input className={input} inputMode="decimal" value={l.unitCost} onChange={(e) => setLines((c) => c.map((x, k) => (k === i ? { ...x, unitCost: e.target.value } : x)))} /></label>}
            </div>
          ))}
          <label className="block text-sm">No. dokumen<input className={input} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          <label className="block text-sm">{txn.type === 'IN' ? 'Supplier' : 'Penerima/tujuan'}<input className={input} value={party} onChange={(e) => setParty(e.target.value)} /></label>
          <label className="block text-sm">Keterangan<input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          {role === 'ADMIN' && txn.errorKind === 'backdated' && (
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={allowBackdate} onChange={(e) => setAllowBackdate(e.target.checked)} /> Saya (ADMIN) menyetujui transaksi bertanggal mundur ini</label>
          )}
        </div>
        {err && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-md border border-slate-300 px-4 py-2 text-sm" onClick={onClose}>Tutup</button>
          <button className="rounded-md bg-[#0b1f4d] px-4 py-2 text-sm font-semibold text-white" onClick={() => void save()}>Simpan perbaikan</button>
        </div>
      </div>
    </div>
  )
}
