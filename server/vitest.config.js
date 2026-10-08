import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The sun/sunset math (and everything layered on it) assumes the saved
    // location shares the Pi's own timezone, so the suite pins one timezone
    // rather than inheriting whatever machine it runs on -- otherwise a
    // western sunset that belongs to "today" locally lands on a different
    // UTC date depending on where the tests are run.
    env: { TZ: 'America/Chicago' },
    // Tests never touch the real server/data: fileStore.js honors
    // WALLCAL_DATA_DIR (see src/store/fileStore.js), and the setup below
    // points it at a per-run scratch dir that the runner cleans up.
    setupFiles: ['./test/setup.js'],
  },
});