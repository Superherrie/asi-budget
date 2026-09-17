import { NavLink, Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import ChangePassword from '../pages/ChangePassword'

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
      <header className="relative overflow-hidden bg-brand-navy text-white">
        {/* brand motifs from the sign-in page: teal spiral top-right, pink wave lower right, both bleeding off-canvas */}
        <img src="brand/spiral.png" alt="" aria-hidden className="brand-spiral" />
        <img src="brand/wave.png" alt="" aria-hidden className="brand-wave" />
        <div className="pointer-events-none absolute right-24 top-3 hidden h-12 w-12 rounded-full border border-brand-lilac/60 lg:block" />
        <div className="relative mx-auto max-w-screen-2xl px-4">
          <div className="flex items-center justify-between gap-3 pt-3">
            <div className="flex items-center gap-2">
              <img src="brand/logo_white.png" alt="ASI Connect" className="h-7 sm:h-8" />
              <span className="font-display text-sm font-semibold tracking-tight text-white/70">Budget</span>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85 sm:text-[11px]">Connecting business to purpose</p>
          </div>
          <div className="flex items-center gap-2 py-2 sm:gap-4">
            <nav className="flex gap-1 overflow-x-auto">
              <NavLink to="/" end className={linkClass}>My Cost Centres</NavLink>
              <NavLink to="/company" className={linkClass}>Company View</NavLink>
              {profile?.is_admin && <NavLink to="/admin" className={linkClass}>Admin</NavLink>}
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-sm text-sky-200 sm:gap-3">
              <span className="hidden sm:inline">{profile?.full_name || session.user.email}</span>
              {!profile?.must_change_password && (
                <NavLink to="/change-password" className="rounded-md border border-sky-700 px-2 py-1 hover:bg-sky-800">
                  Change password
                </NavLink>
              )}
              <button
                onClick={() => void signOut()}
                className="rounded-md border border-sky-700 px-2 py-1 hover:bg-sky-800"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
        <div className="brand-rule" />
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-4">
        {/* password was set for them — nothing else is reachable until it's changed */}
        {profile?.must_change_password ? <ChangePassword forced /> : <Outlet />}
      </main>
      <footer className="relative overflow-hidden bg-brand-navy text-white">
        <div className="brand-rule" />
        <img src="brand/wave.png" alt="" aria-hidden className="brand-wave-footer" />
        <img src="brand/spiral.png" alt="" aria-hidden className="brand-spiral-footer" />
        <div className="relative mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/85">Connecting business to purpose</p>
          <span className="text-[10px] tracking-[0.2em] text-white/50">asiconnect.co.za</span>
        </div>
      </footer>
    </div>
  )
}
