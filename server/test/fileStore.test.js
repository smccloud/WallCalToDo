import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { dataPath } from './setup.js';
import { readJson, writeJson, dataFilePath } from '../src/store/fileStore.js';

describe('fileStore', () => {
  it('returns the fallback when the file is missing', () => {
    expect(readJson('does-not-exist.json', { fallback: true })).toEqual({ fallback: true });
    expect(readJson('does-not-exist.json', [])).toEqual([]);
  });

  it('round-trips written data', () => {
    const payload = { a: 1, b: ['x', 'y'], nested: { ok: true } };
    writeJson('roundtrip.json', payload);
    expect(readJson('roundtrip.json', null)).toEqual(payload);
  });

  it('returns the fallback for corrupt JSON rather than throwing', () => {
    // Written by hand rather than through writeJson, which would
    // JSON-stringify the text into valid JSON.
    fs.writeFileSync(dataPath('corrupt.json'), '{ not valid json');
    expect(readJson('corrupt.json', 'fallback')).toBe('fallback');
  });

  it('writes files in the configured data dir', () => {
    writeJson('located.json', { yes: true });
    expect(dataFilePath('located.json')).toBe(dataPath('located.json'));
  });
});