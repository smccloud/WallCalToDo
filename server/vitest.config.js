import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests never touch the real server/data: fileStore.js honors
    // WALLCAL_DATA_DIR (see src/store/fileStore.js), and the setup below
    // points it at a per-run scratch dir that the runner cleans up.
    setupFiles: ['./test/setup.js'],
  },
});