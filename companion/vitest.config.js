import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.js on purpose: vite.config.js sets base '/companion/'
// for the production build, which is not what tests want to resolve against.
// TZ is pinned so the locale-dependent times these components format are
// deterministic on any machine.
export default defineConfig({
  plugins: [react()],
  env: {
    TZ: 'America/Chicago',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
  },
});
