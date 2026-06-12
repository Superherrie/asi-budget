import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Assignment, CostCentre, Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  assignments: Assignment[]
  costCentres: CostCentre[]
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  assignments: [],
  costCentres: [],
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [costCentres, setCostCentres] = useState<CostCentre[]>([])
  const [loading, setLoading] = useState(true)

  async function loadUserData(s: Session | null) {
    if (!s) {
      setProfile(null)
      setAssignments([])
      setCostCentres([])
      return
    }
    const [p, a, c] = await Promise.all([
      supabase.from('budget_profiles').select('*').eq('user_id', s.user.id).maybeSingle(),
      supabase.from('budget_assignments').select('*').eq('user_id', s.user.id),
      supabase.from('budget_cost_centres').select('*').eq('active', true).order('code'),
    ])
    setProfile((p.data as Profile) ?? null)
    setAssignments((a.data as Assignment[]) ?? [])
    setCostCentres((c.data as CostCentre[]) ?? [])
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadUserData(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      void loadUserData(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        assignments,
        costCentres,
        loading,
        refresh: () => loadUserData(session),
        signOut: async () => {
          await supabase.auth.signOut()
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}
