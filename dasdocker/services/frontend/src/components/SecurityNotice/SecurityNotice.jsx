import { useEffect, useState } from 'react';

const KEY = 'dasdocker_security_notice_seen_v1';

export default function SecurityNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(KEY);
      if (!seen) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  return (
    <aside
      aria-label="Security limitations notice"
      style={{
        border: '1px solid var(--color-border-subtle)',
        background: '#111827',
        color: '#E6EAF2',
        padding: '12px',
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      <p style={{ margin: 0 }}>
        dasDocker runs untrusted code in a hardened container. While we enforce strong isolation controls, no sandbox is
        unconditionally secure. Do not submit code containing production secrets or sensitive personal data.
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(KEY, '1');
          } catch {
            // Ignore storage issues and still allow dismissing in-memory.
          }
          setVisible(false);
        }}
        style={{ marginTop: 8 }}
      >
        I understand
      </button>
    </aside>
  );
}
