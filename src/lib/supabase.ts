import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anonKey) {
  // Surfaced on the login screen; the app cannot work without these.
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not configured')
}

export const supabase = createClient(url ?? '', anonKey ?? '')
