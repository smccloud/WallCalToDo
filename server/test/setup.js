import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll } from 'vitest';

// A fresh scratch dir for the whole run, removed again at the end. Set
// before anything imports fileStore.js so DATA_DIR resolves inside it.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wallcaltodo-test-'));

process.env.WALLCAL_DATA_DIR = scratch;

export function dataDir() {
  return scratch;
}

export function dataPath(filename) {
  return path.join(scratch, filename);
}

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});