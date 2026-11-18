import { useState, type FormEvent } from 'react'
import { APP_FULL_NAME, APP_NAME, APP_TAGLINE } from '../utils/brand'
import { useAuth } from '../hooks/useAuth'

export default function Login() {
  const { signIn, configured } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const err = await signIn(email.trim(), password)
    if (err) setError(err)
    setBusy(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1f4d] p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h1 className="text-center text-3xl font-bold tracking-wide text-[#0b1f4d]">{APP_NAME}</h1>
        <p className="mt-1 text-center text-xs text-slate-500">{APP_FULL_NAME}</p>
        <p className="mb-6 text-center text-sm font-medium text-sky-700">{APP_TAGLINE}</p>

        {!configured && (
          <p className="mb-4 rounded bg-amber-100 p-3 text-sm text-amber-900">
            Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.
          </p>
        )}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-base" />
        </label>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block font-medium">Password</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-base" />
        </label>

        {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy || !configured}
          className="w-full rounded-md bg-[#0b1f4d] py-2.5 font-semibold text-white disabled:opacity-50">
          {busy ? 'Masuk…' : 'Masuk'}
        </button>
      </form>
    </div>
  )
}
