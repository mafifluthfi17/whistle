const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 })

/** Format tampilan saja. Perhitungan resmi dilakukan di database. */
export function formatIDR(value: number | string): string {
  return idr.format(Number(value))
}

export function formatTanggal(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
