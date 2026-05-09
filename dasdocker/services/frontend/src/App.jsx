import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { isUuidSessionId } from './lib/uuid.js';
import SessionWorkspace from './pages/SessionWorkspace.jsx';
import SubmitPage from './pages/SubmitPage.jsx';
import SessionHistoryPage from './pages/SessionHistoryPage.jsx';
import SessionProvisioningView from './pages/SessionProvisioningView.jsx';
import SecurityNotice from './components/SecurityNotice/SecurityNotice.jsx';

function ErrorPage() {
  return (
    <main className="ds-stub">
      <h1 style={{ font: 'var(--font-heading)', color: 'var(--color-danger)' }}>Something went wrong</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Use the reference id from the orchestrator when filing issues.</p>
      <Link to="/">Return home</Link>
    </main>
  );
}

function SessionRoute() {
  const { id } = useParams();
  if (!isUuidSessionId(id)) {
    return <Navigate to="/error" replace />;
  }
  return <SessionWorkspace sessionId={id} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SubmitPage />} />
      <Route path="/session/:id" element={<SessionRoute />} />
      <Route path="/session/:id/provisioning" element={<ProvisioningRoute />} />
      <Route path="/history" element={<SessionHistoryPage />} />
      <Route path="/error" element={<ErrorPage />} />
      <Route path="*" element={<Navigate to="/error" replace />} />
    </Routes>
  );
}

function ProvisioningRoute() {
  const { id } = useParams();
  if (!isUuidSessionId(id)) {
    return <Navigate to="/error" replace />;
  }
  return <SessionProvisioningView sessionId={id} authToken={window.__DASDOCKER_SESSION_JWT || ''} />;
}

export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-surface)', padding: 'var(--space-6)' }}>
      <header
        style={{
          display: 'flex',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-5)',
          font: 'var(--font-label)',
          color: 'var(--color-text-muted)',
        }}
      >
        <Link to="/" style={{ color: 'var(--color-accent)' }}>
          dasDocker
        </Link>
        <Link to="/history">History</Link>
      </header>
      <SecurityNotice />
      <AppRoutes />
    </div>
  );
}
