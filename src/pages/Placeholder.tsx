const PHASE: Record<string, string> = {
  dashboard: 'FASE 7',
  masuk: 'FASE 5',
  keluar: 'FASE 5',
  kartu: 'FASE 7',
  laporan: 'FASE 7',
  pengaturan: 'FASE 9',
}

export default function Placeholder({ id, title }: { id: string; title: string }) {
  return (
    <section className="rounded-lg bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">Fitur ini akan tersedia pada {PHASE[id] ?? 'fase berikutnya'}.</p>
    </section>
  )
}
