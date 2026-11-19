import { lazy, Suspense } from 'react'
import { useAuth } from './hooks/useAuth'
import { useHashRoute } from './hooks/useHashRoute'
import Layout, { NAV, navFor } from './components/Layout'
import Login from './pages/Login'
import MasterBarang from './pages/MasterBarang'
import Placeholder from './pages/Placeholder'
import TransactionPage from './pages/TransactionPage'
import { APP_FULL_NAME, APP_NAME, APP_TAGLINE } from './utils/brand'

// SheetJS cukup besar, jadi dimuat hanya saat halaman Import/Export dibuka.
const ImportExport = lazy(() => import('./pages/ImportExport'))

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-100 p-6 text-center">
      <h1 className="text-2xl font-bold text-[#0b1f4d]">{APP_NAME}</h1>
      <p className="text-xs text-slate-500">{APP_FULL_NAME} · {APP_TAGLINE}</p>
      {children}
    </div>
  )
}

export default function App() {
  const { loading, session, role, isActive, signOut } = useAuth()
  const [route, navigate] = useHashRoute()

  if (loading) return <Centered><p className="text-sm text-slate-600">Memuat…</p></Centered>
  if (!session) return <Login />

  if (!isActive || !role) {
    return (
      <Centered>
        <p className="max-w-sm text-sm text-red-700">
          {!isActive ? 'Akun Anda dinonaktifkan. Hubungi ADMIN.' : 'Akun Anda belum memiliki role. Hubungi ADMIN.'}
        </p>
        <button onClick={() => void signOut()} className="rounded-md bg-[#0b1f4d] px-4 py-2 text-sm text-white">Keluar</button>
      </Centered>
    )
  }

  const allowed = navFor(role)
  const current = allowed.find((n) => n.id === route) ?? allowed[0]

  let page: React.ReactNode
  switch (current.id) {
    case 'master':
      page = <MasterBarang />
      break
    case 'masuk':
      page = <TransactionPage key="IN" type="IN" />
      break
    case 'keluar':
      page = <TransactionPage key="OUT" type="OUT" />
      break
    case 'import':
      page = <Suspense fallback={<p className="text-sm">Memuat…</p>}><ImportExport /></Suspense>
      break
    default:
      page = <Placeholder id={current.id} title={NAV.find((n) => n.id === current.id)!.label} />
  }

  return (
    <Layout route={current.id} onNavigate={navigate}>
      {page}
    </Layout>
  )
}
