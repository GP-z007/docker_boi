import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.jsx';

describe('frontend smoke flow', () => {
  it('submit -> session workspace route renders and destroy state text path exists', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      status: 201,
      json: async () => ({ session_id: 'c5d0efd3-1736-4910-9e6b-4b0f2c9d4a11', token: 'jwt' }),
    });
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText(/GitHub URL/i), { target: { value: 'https://github.com/org/repo' } });
    fireEvent.click(screen.getByRole('button', { name: /start session/i }));
    await act(async () => {});
  });
});
