import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SessionProvisioningView from '../SessionProvisioningView.jsx';

describe('SessionProvisioningView', () => {
  it('renders state-aware provisioning text and console', () => {
    render(
      <MemoryRouter>
        <SessionProvisioningView
          sessionId="c5d0efd3-1736-4910-9e6b-4b0f2c9d4a11"
          authToken="jwt"
          initialState="INSTALLING_DEPS"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/INSTALLING_DEPS/i)).toBeInTheDocument();
    expect(screen.getByText(/Installing dependencies/i)).toBeInTheDocument();
    expect(screen.getByText(/^Live Console$/i)).toBeInTheDocument();
  });
});
