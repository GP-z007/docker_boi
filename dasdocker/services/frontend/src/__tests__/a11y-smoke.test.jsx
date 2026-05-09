import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App.jsx';

describe('a11y smoke', () => {
  it('landing route has no obvious axe violations', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const results = await axe.run(document.body);
    expect(results.violations.length).toBe(0);
  });
});
