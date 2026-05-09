import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SessionControlPanel from '../SessionControlPanel.jsx';

describe('SessionControlPanel', () => {
  it('timer turns red at T-30s', () => {
    render(
      <SessionControlPanel
        sessionId="s1"
        authToken="jwt"
        status="RUNNING"
        expiresAt={new Date(Date.now() + 30_000).toISOString()}
      />,
    );
    const ttl = screen.getByText(/TTL:/i);
    expect(ttl).toHaveStyle({ color: 'rgb(241, 75, 75)' });
  });

  it('kill button asks confirmation then sends DELETE with JWT', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
    render(
      <SessionControlPanel
        sessionId="s1"
        authToken="jwt-token"
        status="RUNNING"
        expiresAt={new Date(Date.now() + 300_000).toISOString()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /kill session/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v1/sessions/s1');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers.Authorization).toBe('Bearer jwt-token');
    confirmSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});
