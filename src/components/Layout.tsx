import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? 'bg-sky-900 text-white' : 'text-sky-100 hover:bg-sky-800'
  }`

export default function Layout() {
  const { session, profile, loading, signOut } = useAuth()

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading…</div>
  }
  if (!session) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-sky-950 text-white">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-4 px-4 py-2">
          <span className="text-lg font-semibold tracking-tight">ASI Connect Budget</span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={linkClass}>
              My Cost Centres
            </NavLink>
            <NavLink to="/company" className={linkClass}>
              Company View
            </NavLink>
            {profile?.is_admin && (
              <NavLink to="/admin" className={linkClass}>
                Admin
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-sky-200">
            <span>{profile?.full_name || session.user.email}</span>
            <button
              onClick={() => void signOut()}
              className="rounded-md border border-sky-700 px-2 py-1 hover:bg-sky-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-4">
        <Outlet />
      </main>
    </div>
  )
}
