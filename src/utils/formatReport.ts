// Format tampilan laporan (hanya tampilan; angka resmi dari server).

const dtf = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export const qty = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: 4 })

export const rupiah = (v: string | number | null | undefined, maxDigits = 2) =>
  v === null || v === undefined ? '-' : `Rp ${Number(v).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: maxDigits })}`

export const dateTime = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : '-')

export function firstOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`
}

export const STATUS_STYLE: Record<string, string> = {
  AMAN: 'bg-emerald-100 text-emerald-800',
  RENDAH: 'bg-amber-100 text-amber-800',
  HABIS: 'bg-red-100 text-red-800',
  POSTED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  REVERSED: 'bg-slate-200 text-slate-700',
  REJECTED: 'bg-red-100 text-red-800',
  DRAFT: 'bg-slate-100 text-slate-700',
}
