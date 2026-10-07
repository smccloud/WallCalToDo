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
    writeJson('corrupt.json', '{ not valid json');
    expect(readJson('corrupt.json', 'fallback')).toBe('fallback');
  });

  it('writes files in the configured data dir', () => {
    writeJson('located.json', { yes: true });
    expect(dataFilePath('located.json')).toBe(dataPath('located.json'));
  });
});