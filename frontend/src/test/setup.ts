// Vitest setup -- runs before every test file. Wires jest-dom matchers so we
// can speak fluent toBeInTheDocument(), and clears the DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
