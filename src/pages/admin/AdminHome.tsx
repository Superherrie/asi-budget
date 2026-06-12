import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import UsersAdmin from './UsersAdmin'
import CostCentresAdmin from './CostCentresAdmin'
import ImportAdmin from './ImportAdmin'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm font-medium ${
    isActive ? 'border-sky-700 text-sky-900' : 'border-transparent text-slate-500 hover:text-slate-700'
  }`

export default function AdminHome() {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (!profile?.is_admin) return <Navigate to="/" replace />

  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold text-sky-950">Administration</h1>
      <nav className="mb-4 flex gap-1 border-b border-slate-200">
        <NavLink to="" end className={tabClass}>Users &amp; Access</NavLink>
        <NavLink to="cost-centres" className={tabClass}>Cost Centres</NavLink>
        <NavLink to="import" className={tabClass}>Import Data</NavLink>
      </nav>
      <Routes>
        <Route index element={<UsersAdmin />} />
        <Route path="cost-centres" element={<CostCentresAdmin />} />
        <Route path="import" element={<ImportAdmin />} />
      </Routes>
    </div>
  )
}
