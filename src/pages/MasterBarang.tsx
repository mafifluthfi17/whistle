import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import {
  createProduct,
  deleteProduct,
  listCategories,
  listProducts,
  setProductActive,
  updateProduct,
  type StatusFilter,
} from '../services/products'
import type { Product, ProductInput } from '../types'

const PAGE_SIZE = 20

const EMPTY: ProductInput = {
  sku: '', barcode: null, product_name: '', category: null, brand: null,
  unit: 'PCS', location: null, minimum_stock: 0, is_active: true,
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function MasterBarang() {
  const { role } = useAuth()
  const toast = useToast()
  const canEdit = role === 'ADMIN'

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 300)
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; data: ProductInput } | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listProducts({ search: debouncedSearch, category, status, page, pageSize: PAGE_SIZE })
      setRows(res.rows)
      setTotal(res.total)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, category, status, page])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => { listCategories().then(setCategories).catch(() => {}) }, [rows.length, editing])
  useEffect(() => { setPage(1) }, [debouncedSearch, category, status])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  async function toggleActive(p: Product) {
    try {
      await setProductActive(p.id, !p.is_active)
      toast('success', p.is_active ? `${p.sku} dinonaktifkan` : `${p.sku} diaktifkan`)
      void reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  async function remove(p: Product) {
    if (!window.confirm(`Hapus ${p.sku} (${p.product_name})? Barang yang punya histori tidak dapat dihapus.`)) return
    try {
      await deleteProduct(p.id)
      toast('success', `${p.sku} dihapus`)
      void reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Master Barang</h2>
        {canEdit && (
          <button onClick={() => setEditing({ id: null, data: { ...EMPTY } })}
            className="rounded-md bg-[#0b1f4d] px-4 py-2 text-sm font-semibold text-white">
            + Tambah Barang
          </button>
        )}
      </div>

      <div className="grid gap-2 rounded-lg bg-white p-3 shadow-sm sm:grid-cols-3">
        <input type="search" placeholder="Cari SKU, barcode, atau nama…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-base" aria-label="Cari barang" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-base" aria-label="Filter kategori">
          <option value="">Semua kategori</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded-md border border-slate-300 px-3 py-2 text-base" aria-label="Filter status">
          <option value="all">Semua status</option>
          <option value="active">Aktif</option>
          <option value="inactive">Nonaktif</option>
        </select>
      </div>

      {error && <p role="alert" className="rounded bg-red-100 p-3 text-sm text-red-800">{error}</p>}

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">SKU</th><th className="px-3 py-2">Barcode</th><th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Kategori</th><th className="px-3 py-2">Merek</th><th className="px-3 py-2">Satuan</th>
              <th className="px-3 py-2">Lokasi</th><th className="px-3 py-2 text-right">Min. Stok</th><th className="px-3 py-2">Status</th>
              {canEdit && <th className="px-3 py-2">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono">{p.sku}</td>
                <td className="px-3 py-2 font-mono">{p.barcode ?? '-'}</td>
                <td className="px-3 py-2">{p.product_name}</td>
                <td className="px-3 py-2">{p.category ?? '-'}</td>
                <td className="px-3 py-2">{p.brand ?? '-'}</td>
                <td className="px-3 py-2">{p.unit}</td>
                <td className="px-3 py-2">{p.location ?? '-'}</td>
                <td className="px-3 py-2 text-right">{Number(p.minimum_stock).toLocaleString('id-ID')}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                    {p.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                {canEdit && (
                  <td className="whitespace-nowrap px-3 py-2">
                    <button className="mr-2 text-sky-700 underline" onClick={() => setEditing({ id: p.id, data: { sku: p.sku, barcode: p.barcode, product_name: p.product_name, category: p.category, brand: p.brand, unit: p.unit, location: p.location, minimum_stock: Number(p.minimum_stock), is_active: p.is_active } })}>Edit</button>
                    <button className="mr-2 text-amber-700 underline" onClick={() => void toggleActive(p)}>{p.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                    <button className="text-red-700 underline" onClick={() => void remove(p)}>Hapus</button>
                  </td>
                )}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={canEdit ? 10 : 9} className="px-3 py-8 text-center text-slate-500">Tidak ada barang yang cocok.</td></tr>
            )}
          </tbody>
        </table>
        {loading && <p className="p-3 text-center text-sm text-slate-500">Memuat…</p>}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span>{total.toLocaleString('id-ID')} barang · halaman {page} dari {pages}</span>
        <div className="flex gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Sebelumnya</button>
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-40">Berikutnya</button>
        </div>
      </div>

      {editing && (
        <ProductForm
          initial={editing.data}
          isNew={editing.id === null}
          categories={categories}
          onCancel={() => setEditing(null)}
          onSave={async (data) => {
            try {
              if (editing.id) await updateProduct(editing.id, data)
              else await createProduct(data)
              toast('success', editing.id ? 'Barang diperbarui' : 'Barang ditambahkan')
              setEditing(null)
              void reload()
            } catch (e) {
              toast('error', (e as Error).message)
            }
          }}
        />
      )}
    </section>
  )
}

function ProductForm({ initial, isNew, categories, onCancel, onSave }: {
  initial: ProductInput
  isNew: boolean
  categories: string[]
  onCancel: () => void
  onSave: (data: ProductInput) => Promise<void>
}) {
  const [f, setF] = useState({ ...initial, minimum_stock: String(initial.minimum_stock) })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))
  const blank = (s: string | null) => (s && s.trim() ? s.trim() : null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const min = Number(f.minimum_stock)
    if (!f.sku.trim()) return setErr('SKU wajib diisi')
    if (!f.product_name.trim()) return setErr('Nama barang wajib diisi')
    if (!f.unit.trim()) return setErr('Satuan wajib diisi')
    if (!Number.isFinite(min) || min < 0) return setErr('Minimum stok harus angka ≥ 0')
    setErr(null)
    setBusy(true)
    await onSave({
      sku: f.sku.trim(), barcode: blank(f.barcode), product_name: f.product_name.trim(),
      category: blank(f.category), brand: blank(f.brand), unit: f.unit.trim(), location: blank(f.location),
      minimum_stock: min, is_active: f.is_active,
    })
    setBusy(false)
  }

  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base'
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-label={isNew ? 'Tambah barang' : 'Edit barang'}>
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="mb-3 text-lg font-semibold">{isNew ? 'Tambah Barang' : 'Edit Barang'}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">SKU *<input className={input} value={f.sku} onChange={(e) => set('sku', e.target.value)} /></label>
          <label className="text-sm">Barcode<input className={input} value={f.barcode ?? ''} onChange={(e) => set('barcode', e.target.value)} /></label>
          <label className="text-sm sm:col-span-2">Nama barang *<input className={input} value={f.product_name} onChange={(e) => set('product_name', e.target.value)} /></label>
          <label className="text-sm">Kategori<input list="kategori-list" className={input} value={f.category ?? ''} onChange={(e) => set('category', e.target.value)} /></label>
          <datalist id="kategori-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          <label className="text-sm">Merek<input className={input} value={f.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></label>
          <label className="text-sm">Satuan *<input className={input} value={f.unit} onChange={(e) => set('unit', e.target.value)} /></label>
          <label className="text-sm">Lokasi gudang<input className={input} value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} /></label>
          <label className="text-sm">Minimum stok<input type="number" min="0" step="any" className={input} value={f.minimum_stock} onChange={(e) => set('minimum_stock', e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm sm:self-end sm:pb-2">
            <input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Aktif
          </label>
        </div>
        {!isNew && <p className="mt-3 text-xs text-slate-500">Mengubah nama atau kategori tidak mengubah histori transaksi. SKU dan barcode harus tetap unik.</p>}
        {err && <p role="alert" className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm">Batal</button>
          <button type="submit" disabled={busy} className="rounded-md bg-[#0b1f4d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div>
      </form>
    </div>
  )
}
