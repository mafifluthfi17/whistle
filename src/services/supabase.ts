import { createClient } from '@supabase/supabase-js'

// Hanya URL dan anon key. Service Role Key tidak boleh ada di frontend.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase = url && anonKey ? createClient(url, anonKey) : null
