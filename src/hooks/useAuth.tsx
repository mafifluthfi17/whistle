import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import type { Role } from '../types'

interface AuthState {
  loading: boolean
  configured: boolean
  session: Session | null
  fullName: string
  role: Role | null
  isActive: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [isActive, setIsActive] = useState(true)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!supabase || !s) {
      setRole(null)
      setFullName('')
      return
    }
    const [r, p] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', s.user.id).maybeSingle(),
      supabase.from('profiles').select('full_name,is_active').eq('id', s.user.id).maybeSingle(),
    ])
    setRole((r.data?.role as Role | undefined) ?? null)
    setFullName(p.data?.full_name || s.user.email || '')
    setIsActive(p.data?.is_active ?? true)
  }, [])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // jangan memanggil supabase di dalam callback ini secara sinkron
      setTimeout(() => void loadProfile(s), 0)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const value = useMemo<AuthState>(
    () => ({
      loading,
      configured: Boolean(supabase),
      session,
      fullName,
      role,
      isActive,
      async signIn(email, password) {
        if (!supabase) return 'Supabase belum dikonfigurasi'
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (!error) return null
        return /invalid login/i.test(error.message) ? 'Email atau password salah' : error.message
      },
      async signOut() {
        await supabase?.auth.signOut()
      },
    }),
    [loading, session, fullName, role, isActive],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider')
  return ctx
}
