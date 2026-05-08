import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App.jsx';

describe('routing', () => {
  it('loads landing on /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /landing/i })).toBeInTheDocument();
  });

  it('redirects non-UUID session paths to /error', () => {
    render(
      <MemoryRouter initialEntries={['/session/123']}>
        <Routes>
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
  });

  it('allows canonical UUID routes', () => {
    const id = 'c5d0efd3-1736-4910-9e6b-4b0f2c9d4a11';
    render(
      <MemoryRouter initialEntries={[`/session/${id}`]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByText(new RegExp(id.slice(0, 8), 'i'))).toBeInTheDocument();
  });
});
