import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library's auto-cleanup only wires itself up when the test
// runner exposes its hooks as globals, which this suite deliberately doesn't
// (every test file imports what it uses from vitest).
afterEach(() => {
  cleanup();
});
