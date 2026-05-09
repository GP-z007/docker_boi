import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\.git)?$/;
const MAX_ZIP_BYTES = 256 * 1024 * 1024;

function errorMsg(status) {
  if (status === 400) return 'Invalid request. Check source URL or ZIP file.';
  if (status === 429) return 'Rate limit reached. Please wait and retry.';
  if (status === 503) return 'Service unavailable. Try again shortly.';
  return 'Failed to create session.';
}

export default function SubmitPage() {
  const [githubUrl, setGithubUrl] = useState('');
  const [zipFile, setZipFile] = useState(null);
  const [ttlSeconds, setTtlSeconds] = useState('300');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const urlValid = useMemo(() => GITHUB_URL_REGEX.test(githubUrl.trim()), [githubUrl]);
  const canSubmit = (urlValid || !!zipFile) && !loading;

  const onFile = (file) => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      setErr('Only .zip files are allowed.');
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setErr('ZIP exceeds 256MB size limit.');
      return;
    }
    setErr('');
    setZipFile(file);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.set('ttl_seconds', ttlSeconds);
      if (urlValid) fd.set('github_url', githubUrl.trim());
      if (zipFile) fd.set('archive', zipFile);
      const r = await fetch('/api/v1/sessions', { method: 'POST', body: fd });
      if (r.status !== 201) {
        setErr(errorMsg(r.status));
        setLoading(false);
        return;
      }
      const j = await r.json();
      if (j.token) window.__DASDOCKER_SESSION_JWT = j.token;
      const id = j.session_id || j.id;
      nav(`/session/${id}`);
    } catch {
      setErr('Network error while creating session.');
      setLoading(false);
    }
  };

  return (
    <main>
      <h1 style={{ font: 'var(--font-heading)' }}>Landing / Submit</h1>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 760 }}>
        <label>
          GitHub URL
          <input
            aria-label="GitHub URL"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
          />
        </label>
        {githubUrl && !urlValid ? <p style={{ color: '#F5A524' }}>URL must match github.com/org/repo(.git)</p> : null}

        <label>
          ZIP Upload (.zip, max 256MB)
          <input aria-label="ZIP Upload" type="file" accept=".zip,application/zip" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <div
          role="button"
          tabIndex={0}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
          onDragOver={(e) => e.preventDefault()}
          style={{ border: '1px dashed var(--color-border-subtle)', padding: 12 }}
        >
          Drag and drop ZIP here
        </div>
        {zipFile ? <p>Selected: {zipFile.name}</p> : null}

        <label>
          TTL
          <select aria-label="TTL Selector" value={ttlSeconds} onChange={(e) => setTtlSeconds(e.target.value)}>
            <option value="60">60s</option>
            <option value="300">300s</option>
            <option value="600">600s</option>
            <option value="1800">1800s</option>
            <option value="3600">3600s</option>
          </select>
        </label>

        {err ? <p style={{ color: '#F14B4B' }}>{err}</p> : null}
        <button type="submit" disabled={!canSubmit}>
          {loading ? 'Starting…' : 'Start session'}
        </button>
      </form>
    </main>
  );
}
