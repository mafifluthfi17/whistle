import { useCallback, useEffect, useRef, useState } from 'react'
import BarcodeScanner from './BarcodeScanner'
import { useToast } from './Toast'
import { findProductByScan, type StockedProduct } from '../services/transactions'
import { validateLines, type TxLine, type TxType } from '../utils/transactionForm'
import type { CameraError } from '../utils/scanLogic'

interface Props {
  type: TxType
  onAdd: (product: StockedProduct, quantity: string, unitCost: string) => void
  onClose: () => void
}

const num = (s: string | number, max = 4) => Number(s).toLocaleString('id-ID', { maximumFractionDigits: max })
const rp = (s: string | number, max = 2) => `Rp ${Number(s).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: max })}`

/**
 * Alur: scan atau ketik kode -> cari barang -> tampil nama, SKU, stok terakhir
 * -> isi quantity (dan harga beli untuk barang masuk) -> tambahkan ke dokumen.
 */
export default function ScanModal({ type, onAdd, onClose }: Props) {
  const toast = useToast()
  const isIn = type === 'IN'
  const [found, setFound] = useState<{ product: StockedProduct; scanned: string; matchedBy: string } | null>(null)
  const [manual, setManual] = useState('')
  const [looking, setLooking] = useState(false)
  const [cameraDown, setCameraDown] = useState<CameraError | null>(null)
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scanKey, setScanKey] = useState(0)
  const busyRef = useRef(false)

  // Tutup dengan tombol Escape
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  const lookup = useCallback(
    async (raw: string) => {
      if (busyRef.current) return
      busyRef.current = true
      setLooking(true)
      try {
        const r = await findProductByScan(raw)
        if (r.kind === 'found') {
          setFound({ product: r.product, scanned: raw, matchedBy: r.matchedBy })
          setQuantity('')
          setUnitCost('')
          setError(null)
        } else if (r.kind === 'inactive') {
          toast('notfound', `${r.product.sku} berstatus nonaktif dan tidak dapat ditransaksikan`)
        } else if (r.kind === 'ambiguous') {
          toast('error', `Kode "${r.candidate}" cocok dengan lebih dari satu barang. Periksa master barang.`)
        } else {
          toast('notfound', `SKU atau barcode "${r.scanned}" tidak ditemukan`)
        }
      } catch (e) {
        toast('error', (e as Error).message)
      } finally {
        busyRef.current = false
        setLooking(false)
      }
    },
    [toast],
  )

  function confirm() {
    if (!found) return
    const p = found.product
    const line: TxLine = { sku: p.sku, name: p.product_name, unit: p.unit, quantity, unitCost, available: p.quantity, averageCost: p.average_cost, inventoryValue: p.inventory_value }
    const issues = validateLines(type, [line])
    if (issues.length) return setError(issues[0].message)
    onAdd(p, quantity, unitCost)
    setFound(null)
    setScanKey((k) => k + 1) // kembali memindai barang berikutnya
  }

  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base'
  const btn = 'rounded-md px-4 py-2.5 text-sm font-semibold disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-modal="true" aria-label="Scan barcode atau QR">
      <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Scan untuk {isIn ? 'Barang Masuk' : 'Barang Keluar'}</h3>
          <button type="button" className="text-sm text-slate-600 underline" onClick={onClose}>Selesai</button>
        </div>

        {found ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Hasil scan: <span className="font-mono">{found.scanned}</span> (cocok {found.matchedBy === 'barcode' ? 'barcode' : 'SKU'})</p>
              <p className="mt-1 text-lg font-semibold">{found.product.product_name}</p>
              <p className="font-mono text-sm">SKU: {found.product.sku}</p>
              <p className="mt-1 text-sm">
                Stok terakhir: <span className="font-semibold">{num(found.product.quantity)} {found.product.unit}</span>
                {!isIn && Number(found.product.quantity) > 0 && <> · Average cost: {rp(found.product.average_cost, 6)}</>}
              </p>
            </div>
            <div className={`grid gap-2 ${isIn ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <label className="text-sm">Quantity ({found.product.unit})
                <input className={input} inputMode="decimal" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm() } }} />
              </label>
              {isIn && (
                <label className="text-sm">Harga beli per unit (Rp)
                  <input className={input} inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm() } }} />
                </label>
              )}
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className={`${btn} border border-slate-300`} onClick={() => { setFound(null); setError(null); setScanKey((k) => k + 1) }}>Scan lagi</button>
              <button type="button" className={`${btn} bg-[#0b1f4d] text-white`} onClick={confirm}>Tambahkan ke dokumen</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <BarcodeScanner key={scanKey} autoStart={scanKey > 0} onDetected={(text) => void lookup(text)} onCameraError={setCameraDown} />
            <form
              className="space-y-1"
              onSubmit={(e) => {
                e.preventDefault()
                if (manual.trim()) void lookup(manual).then(() => setManual(''))
              }}
            >
              <label className="text-sm font-medium" htmlFor="scan-manual">
                {cameraDown ? 'Kamera tidak tersedia: ketik SKU atau barcode' : 'Atau ketik SKU / barcode'}
              </label>
              <div className="flex gap-2">
                <input id="scan-manual" className={input} value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" />
                <button type="submit" className={`${btn} border border-[#0b1f4d] text-[#0b1f4d]`} disabled={looking}>{looking ? 'Mencari…' : 'Cari'}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
