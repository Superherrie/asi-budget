import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

function Placeholder({ title }: { title: string }) {
  return <div className="text-slate-500">{title} — coming soon</div>
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cc/:code/*" element={<Placeholder title="Budget editor" />} />
            <Route path="/company" element={<Placeholder title="Company view" />} />
            <Route path="/admin/*" element={<Placeholder title="Admin" />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
