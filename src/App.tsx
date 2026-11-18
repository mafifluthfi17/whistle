import { APP_NAME, APP_FULL_NAME, APP_TAGLINE } from './utils/brand'
import { useOnlineStatus } from './hooks/useOnlineStatus'

export default function App() {
  const online = useOnlineStatus()
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-wide">{APP_NAME}</h1>
            <p className="text-xs text-sky-300">{APP_TAGLINE}</p>
          </div>
          <span
            className={`rounded px-2 py-1 text-xs ${online ? 'bg-emerald-600' : 'bg-amber-600'}`}
          >
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
      </header>
      <main className="p-4">
        <h2 className="text-lg font-semibold">Selamat datang di {APP_NAME}</h2>
        <p className="text-sm text-slate-600">{APP_FULL_NAME}</p>
        <p className="mt-4 text-sm text-slate-500">Fase 1: scaffold dan arsitektur.</p>
      </main>
    </div>
  )
}
