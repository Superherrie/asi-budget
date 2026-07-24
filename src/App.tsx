import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import BudgetEditor from './pages/editor/BudgetEditor'
import CompanyView from './pages/CompanyView'
import AdminHome from './pages/admin/AdminHome'
import ChangePassword from './pages/ChangePassword'

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cc/:code/*" element={<BudgetEditor />} />
            <Route path="/company" element={<CompanyView />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="/admin/*" element={<AdminHome />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
