import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { isUuidSessionId } from './lib/uuid.js';
import SessionWorkspace from './pages/SessionWorkspace.jsx';

function LandingPage() {
  return (
    <main className="ds-stub">
      <h1 style={{ font: 'var(--font-heading)', marginBottom: 'var(--space-4)' }}>Landing / Submit</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Start a session (orchestrator wiring lands in later squads).</p>
      <nav style={{ marginTop: 'var(--space-5)', display: 'flex', gap: 'var(--space-3)' }}>
        <Link to="/history">History</Link>
      </nav>
    </main>
  );
}

function HistoryPage() {
  return (
    <main className="ds-stub">
      <h1 style={{ font: 'var(--font-heading)' }}>Session history</h1>
      <p style={{ color: 'var(--color-text-muted)' }}>Operator-scoped history only (server enforced).</p>
      <Link to="/">Back home</Link>
    </main>
  );
}

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
      <Route path="/" element={<LandingPage />} />
      <Route path="/session/:id" element={<SessionRoute />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/error" element={<ErrorPage />} />
      <Route path="*" element={<Navigate to="/error" replace />} />
    </Routes>
  );
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
      <AppRoutes />
    </div>
  );
}
