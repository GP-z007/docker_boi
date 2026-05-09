import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SubmitPage from '../SubmitPage.jsx';

describe('SubmitPage', () => {
  it('enables submit only with valid github url or zip', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 201,
      json: async () => ({ session_id: 'c5d0efd3-1736-4910-9e6b-4b0f2c9d4a11', token: 'jwt' }),
    });
    render(
      <MemoryRouter>
        <SubmitPage />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: /start session/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/GitHub URL/i), { target: { value: 'https://github.com/org/repo' } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    fetchSpy.mockRestore();
  });

  it('shows mapped error for 429', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ status: 429, json: async () => ({}) });
    render(
      <MemoryRouter>
        <SubmitPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/GitHub URL/i), { target: { value: 'https://github.com/org/repo' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    expect(await screen.findByText(/Rate limit reached/i)).toBeInTheDocument();
    fetchSpy.mockRestore();
  });
});
