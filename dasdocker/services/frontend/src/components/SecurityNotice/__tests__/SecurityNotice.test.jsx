import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import SecurityNotice from '../SecurityNotice.jsx';

beforeEach(() => {
  const store = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
  });
});

describe('SecurityNotice', () => {
  it('renders first-use security limitation banner text', () => {
    window.localStorage.removeItem('dasdocker_security_notice_seen_v1');
    render(<SecurityNotice />);
    expect(screen.getByLabelText(/Security limitations notice/i)).toBeInTheDocument();
    expect(screen.getByText(/no sandbox is unconditionally secure/i)).toBeInTheDocument();
  });

  it('has no high-impact axe violations', async () => {
    window.localStorage.removeItem('dasdocker_security_notice_seen_v1');
    const { container } = render(<SecurityNotice />);
    const result = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    const seriousOrCritical = result.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    expect(seriousOrCritical).toEqual([]);
  });
});
