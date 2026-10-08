import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Same pinning as the server suite: the display's date/time formatting
    // (and the sun times it renders) are local-calendar-day by design, so a
    // run in another timezone would disagree with itself.
    env: { TZ: 'America/Chicago' },
    setupFiles: ['./test/setup.js'],
  },
});
