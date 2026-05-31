import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock react-router hooks: useRouteError only yields a value inside a real
// errorElement, which is more scaffolding than this unit needs. We feed the
// error directly and spy on navigation.
const navigateSpy = vi.fn();
let mockError: unknown = new Error('boom');

vi.mock('react-router-dom', () => ({
  useRouteError: () => mockError,
  useNavigate: () => navigateSpy,
  isRouteErrorResponse: (e: unknown) =>
    typeof e === 'object' && e !== null && 'status' in e && 'statusText' in e,
}));

import { RouteErrorBoundary } from './RouteErrorBoundary';

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    navigateSpy.mockReset();
    mockError = new Error('boom');
  });

  it('renders an alert with the error message for a plain Error', () => {
    render(<RouteErrorBoundary />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went sideways')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('renders status and statusText for a route error response', () => {
    mockError = { status: 404, statusText: 'Not Found', data: 'No such page' };
    render(<RouteErrorBoundary />);
    expect(screen.getByText('404 Not Found')).toBeInTheDocument();
    expect(screen.getByText('No such page')).toBeInTheDocument();
  });

  it('falls back to a generic message for non-Error throws', () => {
    mockError = 'just a string';
    render(<RouteErrorBoundary />);
    expect(
      screen.getByText('An unexpected error knocked this view off its feet.')
    ).toBeInTheDocument();
  });

  it('navigates back when "Go back" is clicked', async () => {
    render(<RouteErrorBoundary />);
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });

  it('reloads the window when "Reload" is clicked', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });
    render(<RouteErrorBoundary />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
  });
});
