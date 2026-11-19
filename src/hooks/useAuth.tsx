import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import type { Role } from '../types'

interface Identity {
  userId: string
  fullName: string
  role: Role | null
  isActive: boolean
}

interface AuthState {
  loading: boolean
  configured: boolean
  /** Sesi Supabase. Bisa null saat offline walau identitas lokal dikenal. */
  session: Session | null
  /** Ada pengguna yang dikenal (sesi online atau identitas terakhir di perangkat saat offline) */
  signedIn: boolean
  /** id pengguna (auth.users) yang sedang login */
  userId: string | null
  fullName: string
  role: Role | null
  isActive: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const IDENTITY_KEY = 'whistle.identity'

function readIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    return raw ? (JSON.parse(raw) as Identity) : null
  } catch {
    return null
  }
}
function saveIdentity(i: Identity | null) {
  try {
    if (i) localStorage.setItem(IDENTITY_KEY, JSON.stringify(i))
    else localStorage.removeItem(IDENTITY_KEY)
  } catch {
    /* penyimpanan tidak tersedia */
  }
}

/**
 * Identitas terakhir disimpan di perangkat HANYA agar antarmuka dan antrean offline dapat dibuka tanpa
 * internet. Ini bukan autentikasi: hak akses sebenarnya selalu divalidasi server (RLS) saat sinkronisasi.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [identity, setIdentity] = useState<Identity | null>(readIdentity)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!supabase || !s) return
    try {
      const [r, p] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', s.user.id).maybeSingle(),
        supabase.from('profiles').select('full_name,is_active').eq('id', s.user.id).maybeSingle(),
      ])
      if (r.error || p.error) throw r.error ?? p.error
      const next: Identity = {
        userId: s.user.id,
        role: (r.data?.role as Role | undefined) ?? null,
        fullName: p.data?.full_name || s.user.email || '',
        isActive: p.data?.is_active ?? true,
      }
      setIdentity(next)
      saveIdentity(next)
    } catch {
      // Tidak ada koneksi: pakai identitas terakhir bila milik pengguna yang sama
      const cached = readIdentity()
      if (cached && cached.userId === s.user.id) setIdentity(cached)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!alive) return
        setSession(data.session)
        await loadProfile(data.session)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') {
        // keluar yang disengaja; kegagalan refresh token saat offline tidak menghapus identitas lokal
        if (navigator.onLine) {
          saveIdentity(null)
          setIdentity(null)
        }
        return
      }
      // jangan memanggil supabase di dalam callback ini secara sinkron
      setTimeout(() => void loadProfile(s), 0)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const offlineOnly = !session && !navigator.onLine && identity !== null
  const signedIn = Boolean(session) || offlineOnly

  const value = useMemo<AuthState>(
    () => ({
      loading,
      configured: Boolean(supabase),
      session,
      signedIn,
      userId: session?.user.id ?? (offlineOnly ? identity!.userId : null),
      fullName: identity?.fullName ?? '',
      role: identity?.role ?? null,
      isActive: identity?.isActive ?? true,
      async signIn(email, password) {
        if (!supabase) return 'Supabase belum dikonfigurasi'
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (!error) return null
        if (/failed to fetch|network/i.test(error.message)) return 'Tidak ada koneksi internet. Masuk memerlukan koneksi.'
        return /invalid login/i.test(error.message) ? 'Email atau password salah' : error.message
      },
      async signOut() {
        saveIdentity(null)
        setIdentity(null)
        try {
          await supabase?.auth.signOut()
        } catch {
          /* sesi lokal tetap dihapus */
        }
      },
    }),
    [loading, session, signedIn, offlineOnly, identity],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider')
  return ctx
}
