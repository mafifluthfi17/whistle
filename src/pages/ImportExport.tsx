import { useMemo, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import { fetchAllProducts, fetchExistingKeys, importProducts } from '../services/products'
import {
  buildProductsWorkbook,
  buildTemplateWorkbook,
  downloadWorkbook,
  exportFileName,
} from '../utils/productExcel'
import { parseWorkbook, summarize, validateRows, type ImportMode, type RowResult } from '../utils/productImport'

const PREVIEW_LIMIT = 200

export default function ImportExport() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ImportMode>('NEW')
  const [fileName, setFileName] = useState('')
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [results, setResults] = useState<RowResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const rawRef = useRef<ReturnType<typeof parseWorkbook> | null>(null)

  const summary = useMemo(() => (results ? summarize(results) : null), [results])
  const shown = useMemo(() => {
    const list = results ?? []
    return (onlyErrors ? list.filter((r) => r.errors.length) : list).slice(0, PREVIEW_LIMIT)
  }, [results, onlyErrors])

  async function revalidate(parsed: NonNullable<typeof rawRef.current>, m: ImportMode) {
    setBusy(true)
    try {
      const existing = await fetchExistingKeys()
      setResults(validateRows(parsed.rows, m, existing))
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileName(file.name)
    setResults(null)
    const parsed = parseWorkbook(await file.arrayBuffer())
    rawRef.current = parsed
    setParseErrors(parsed.errors)
    setWarnings(parsed.warnings)
    if (parsed.errors.length === 0) await revalidate(parsed, mode)
  }

  async function changeMode(m: ImportMode) {
    setMode(m)
    if (rawRef.current && rawRef.current.errors.length === 0) await revalidate(rawRef.current, m)
  }

  async function confirmImport() {
    if (!results) return
    const valid = results.filter((r) => r.errors.length === 0 && r.payload)
    if (valid.length === 0) return
    const ok = window.confirm(
      `Simpan ${valid.length} baris valid?` +
        (summary && summary.invalid ? `\n${summary.invalid} baris bermasalah akan dilewati.` : '') +
        `\nProses ini atomik: jika ada satu baris gagal di server, tidak ada data yang tersimpan.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = await importProducts(valid.map((r) => r.payload!), mode)
      toast(
        'success',
        mode === 'NEW'
          ? `${res.inserted} barang ditambahkan${res.openings_staged ? `, ${res.openings_staged} stok awal disimpan (diposting di FASE 4)` : ''}`
          : `${res.updated} barang diperbarui`,
      )
      setResults(null)
      setFileName('')
      rawRef.current = null
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function exportMaster() {
    setBusy(true)
    try {
      const all = await fetchAllProducts()
      downloadWorkbook(buildProductsWorkbook(all), exportFileName())
      toast('success', `${all.length} barang diekspor`)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const btn = 'rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50'
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Import / Export Master Barang</h2>

      <div className="flex flex-wrap gap-2 rounded-lg bg-white p-4 shadow-sm">
        <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} onClick={() => downloadWorkbook(buildTemplateWorkbook(), 'WHISTLE_Template_Master_Barang.xlsx')}>
          Download Template Excel
        </button>
        <button className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={busy} onClick={() => void exportMaster()}>
          Export Master Barang
        </button>
      </div>

      <div className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <h3 className="font-semibold">Import dari Excel</h3>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Mode import</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === 'NEW'} onChange={() => void changeMode('NEW')} /> Import barang baru
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === 'UPDATE'} onChange={() => void changeMode('UPDATE')} /> Update master barang (tidak mengubah saldo)
          </label>
        </fieldset>
        <input ref={fileRef} type="file" accept=".xlsx" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-sm" aria-label="Pilih file Excel" />
        {fileName && <p className="text-xs text-slate-500">File: {fileName}</p>}

        {parseErrors.length > 0 && (
          <ul role="alert" className="list-disc rounded bg-red-100 p-3 pl-6 text-sm text-red-800">
            {parseErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        {warnings.length > 0 && (
          <ul className="list-disc rounded bg-amber-100 p-3 pl-6 text-sm text-amber-900">
            {warnings.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        {summary && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded bg-slate-100 px-3 py-1">Total: {summary.total}</span>
              <span className="rounded bg-emerald-100 px-3 py-1 text-emerald-800">Valid: {summary.valid}</span>
              <span className={`rounded px-3 py-1 ${summary.invalid ? 'bg-red-100 text-red-800' : 'bg-slate-100'}`}>Tidak valid: {summary.invalid}</span>
              <label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Hanya yang error</label>
            </div>

            <div className="max-h-96 overflow-auto rounded border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 uppercase text-slate-500">
                  <tr><th className="px-2 py-1">Baris</th><th className="px-2 py-1">SKU</th><th className="px-2 py-1">Nama</th><th className="px-2 py-1">Stok awal</th><th className="px-2 py-1">Rata-rata</th><th className="px-2 py-1">Status</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.rowNumber} className={`border-t border-slate-100 ${r.errors.length ? 'bg-red-50' : ''}`}>
                      <td className="px-2 py-1">{r.rowNumber}</td>
                      <td className="px-2 py-1 font-mono">{r.sku || '-'}</td>
                      <td className="px-2 py-1">{r.payload?.product_name ?? '-'}</td>
                      <td className="px-2 py-1">{r.payload?.opening_quantity ?? '-'}</td>
                      <td className="px-2 py-1">{r.derivedAverage ?? '-'}</td>
                      <td className="px-2 py-1">
                        {r.errors.length === 0 ? <span className="text-emerald-700">OK</span> : (
                          <ul className="list-disc pl-4 text-red-700">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                        )}
                        {r.warnings.length > 0 && <ul className="list-disc pl-4 text-amber-700">{r.warnings.map((e) => <li key={e}>{e}</li>)}</ul>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {results && results.length > PREVIEW_LIMIT && <p className="text-xs text-slate-500">Menampilkan {PREVIEW_LIMIT} baris pertama dari {results.length}.</p>}

            <button className={`${btn} bg-[#0b1f4d] text-white`} disabled={busy || summary.valid === 0} onClick={() => void confirmImport()}>
              {busy ? 'Memproses…' : `Konfirmasi Import ${summary.valid} Baris`}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
