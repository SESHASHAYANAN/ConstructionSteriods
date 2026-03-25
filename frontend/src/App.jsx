import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, FileText, Settings, LogOut, Shield,
  FlaskConical, ShoppingCart, ShieldAlert, Building2, Sparkles, PencilRuler
} from 'lucide-react';
import { useAuthStore } from './stores';
import { getMe } from './lib/api';

import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectPage from './pages/ProjectPage';
import DrawingViewerPage from './pages/DrawingViewerPage';
import SpecGeneratorPage from './pages/SpecGeneratorPage';
import SettingsPage from './pages/SettingsPage';
import MaterialAnalysisPage from './pages/MaterialAnalysisPage';
import ProcurementPage from './pages/ProcurementPage';
import CompliancePage from './pages/CompliancePage';
import BuildScratchPage from './pages/BuildScratchPage';
import AIDesignPage from './pages/AIDesignPage';
import EnhancedSpecPage from './pages/EnhancedSpecPage';

/* ── Auth Guard ──────────────────────────────────────────────────────────── */
function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

/* ── Sidebar Nav ─────────────────────────────────────────────────────────── */
const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/material-analysis', icon: FlaskConical, label: 'Material QA' },
  { to: '/procurement', icon: ShoppingCart, label: 'Procurement' },
  { to: '/compliance', icon: ShieldAlert, label: 'Code Compliance' },
  { to: '/spec-generator', icon: FileText, label: 'Spec Generator' },
  { to: '/enhanced-spec', icon: PencilRuler, label: 'Enhanced Spec' },
  { to: '/build-scratch', icon: Building2, label: 'Build Scratch' },
  { to: '/ai-design', icon: Sparkles, label: 'AI Design' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

function Sidebar() {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-surface-900/80 backdrop-blur-xl border-r border-surface-800 flex flex-col z-30">
      {/* Logo */}
      <div className="p-6 border-b border-surface-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lg shadow-brand-500/20">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">ConstructAI</h1>
            <p className="text-xs text-surface-500">AI QA/QC Platform</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-brand-600/15 text-brand-400 border border-brand-500/20'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
              }`
            }
            id={`nav-${item.label.toLowerCase().replace(/\s/g, '-')}`}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User / Logout */}
      <div className="p-4 border-t border-surface-800">
        {user && (
          <div className="flex items-center gap-3 mb-3 px-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
              {user.name?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.name}</p>
              <p className="text-xs text-surface-500 truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button onClick={handleLogout} className="btn-ghost w-full justify-start text-surface-400 hover:text-red-400" id="logout-btn">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </aside>
  );
}

/* ── App Layout ──────────────────────────────────────────────────────────── */
function AppLayout({ children }) {
  const setUser = useAuthStore((s) => s.setUser);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (token) {
      getMe().then(setUser).catch(() => {});
    }
  }, [token, setUser]);

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="ml-64 p-8">{children}</main>
    </div>
  );
}

/* ── App Root ─────────────────────────────────────────────────────────────── */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/project/:id" element={<ProjectPage />} />
                  <Route path="/project/:id/drawing/:fileId" element={<DrawingViewerPage />} />
                  <Route path="/material-analysis" element={<MaterialAnalysisPage />} />
                  <Route path="/procurement" element={<ProcurementPage />} />
                  <Route path="/compliance" element={<CompliancePage />} />
                  <Route path="/spec-generator" element={<SpecGeneratorPage />} />
                  <Route path="/enhanced-spec" element={<EnhancedSpecPage />} />
                  <Route path="/build-scratch" element={<BuildScratchPage />} />
                  <Route path="/ai-design" element={<AIDesignPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
