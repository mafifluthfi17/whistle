import type { ReactNode } from 'react'
import { APP_NAME, APP_TAGLINE } from '../utils/brand'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useAuth } from '../hooks/useAuth'
import { useSync } from '../hooks/useSync'
import type { Role } from '../types'

export interface NavItem {
  id: string
  label: string
  roles: Role[]
}

const ALL: Role[] = ['ADMIN', 'WAREHOUSE', 'VIEWER']

/** Menu sesuai Bagian 19, ditampilkan menurut role. */
export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', roles: ALL },
  { id: 'master', label: 'Master Barang', roles: ALL },
  { id: 'masuk', label: 'Barang Masuk', roles: ['ADMIN', 'WAREHOUSE'] },
  { id: 'keluar', label: 'Barang Keluar', roles: ['ADMIN', 'WAREHOUSE'] },
  { id: 'antrean', label: 'Antrean Offline', roles: ['ADMIN', 'WAREHOUSE'] },
  { id: 'kartu', label: 'Kartu Stok', roles: ALL },
  { id: 'laporan', label: 'Laporan', roles: ALL },
  { id: 'import', label: 'Import/Export', roles: ['ADMIN'] },
  { id: 'audit', label: 'Audit Trail', roles: ['ADMIN'] },
  { id: 'pengaturan', label: 'Pengaturan', roles: ['ADMIN'] },
]

export function navFor(role: Role | null): NavItem[] {
  return role ? NAV.filter((n) => n.roles.includes(role)) : []
}

export default function Layout({ route, onNavigate, children }: { route: string; onNavigate: (r: string) => void; children: ReactNode }) {
  const online = useOnlineStatus()
  const { role, fullName, signOut } = useAuth()
  const { counts, syncing } = useSync()
  const items = navFor(role)
  const needAction = counts.FAILED + counts.CONFLICT
  const waiting = counts.PENDING + counts.SYNCING
  const open = needAction + waiting

  async function logout() {
    if (open > 0 && !window.confirm(`Ada ${open} transaksi offline yang belum tersinkron. Datanya tetap tersimpan di perangkat ini dan terkirim saat Anda masuk lagi dan online. Tetap keluar?`)) return
    await signOut()
  }
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-[#0b1f4d] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-wide">{APP_NAME}</h1>
            <p className="truncate text-xs text-sky-200">{APP_TAGLINE}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <span className={`rounded px-2 py-1 ${online ? 'bg-emerald-600' : 'bg-amber-600'}`}>{online ? 'Online' : 'Offline'}</span>
            <button
              onClick={() => onNavigate('antrean')}
              title="Status sinkronisasi"
              className={`rounded px-2 py-1 ${needAction ? 'bg-red-600' : waiting ? 'bg-amber-600' : syncing ? 'bg-sky-700' : 'bg-white/15'}`}
            >
              {syncing ? 'Menyinkronkan…' : needAction ? `${needAction} perlu tindakan` : waiting ? `${waiting} pending` : 'Tersinkron'}
            </button>
            <span className="hidden sm:inline">{fullName}{role ? ` · ${role}` : ''}</span>
            <button onClick={() => void logout()} className="rounded border border-white/40 px-2 py-1 hover:bg-white/10">
              Keluar
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2" aria-label="Menu utama">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${route === n.id ? 'bg-white text-[#0b1f4d] font-semibold' : 'text-sky-100 hover:bg-white/10'}`}
            >
              {n.label}
              {n.id === 'antrean' && open > 0 && (
                <span className={`ml-1 rounded-full px-1.5 text-xs ${needAction ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>{open}</span>
              )}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  )
}
