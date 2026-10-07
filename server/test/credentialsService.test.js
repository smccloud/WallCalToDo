import { describe, expect, it, vi } from 'vitest';
import { dataPath } from './setup.js';
import { readJson, writeJson } from '../src/store/fileStore.js';

const CREDENTIALS_FILE = 'apiCredentials.json';

// Reloads credentialsService (and the config it reads) so process.env values
// set for a test are captured fresh.
async function loadService() {
  vi.resetModules();
  return await import('../src/services/credentialsService.js');
}

describe('credentialsService', () => {
  it('starts with no Google sets and nothing configured', async () => {
    const svc = await loadService();
    expect(svc.getGoogleSetStatuses()).toEqual([]);
    expect(svc.getCredentialsStatus().google.configured).toBe(false);
    expect(svc.getCredentialsStatus().ms.configured).toBe(false);
    expect(() => svc.getCredentials('google')).toThrow(/not configured/i);
  });

  it('adds a Google set and makes it the default', async () => {
    const svc = await loadService();
    const added = svc.addGoogleSet({ name: 'Org A', clientId: 'id-a', clientSecret: 'secret-a' });
    expect(added.id).toBeTruthy();
    expect(added.name).toBe('Org A');

    expect(svc.getGoogleSetStatuses()).toEqual([
      { id: added.id, name: 'Org A', clientId: 'id-a', configured: true },
    ]);
    expect(svc.getGoogleDefaultSetId()).toBe(added.id);
    expect(svc.resolveGoogleCredentials()).toEqual({ clientId: 'id-a', clientSecret: 'secret-a' });
    expect(svc.resolveGoogleCredentials(added.id)).toEqual({ clientId: 'id-a', clientSecret: 'secret-a' });
  });

  it('names an anonymous set "Default"', async () => {
    const svc = await loadService();
    const added = svc.addGoogleSet({ clientId: 'id', clientSecret: 'secret' });
    expect(added.name).toBe('Default');
  });

  it('trims Google set fields on add', async () => {
    const svc = await loadService();
    const added = svc.addGoogleSet({ name: '  Spaced  ', clientId: '  id  ', clientSecret: '  secret  ' });
    expect(added).toMatchObject({ name: 'Spaced', clientId: 'id', clientSecret: 'secret' });
  });

  it('keeps a blank secret on update', async () => {
    const svc = await loadService();
    const added = svc.addGoogleSet({ name: 'Org', clientId: 'id', clientSecret: 'secret' });
    svc.updateGoogleSet(added.id, { name: 'Renamed', clientId: 'new-id' });
    const updated = svc.getGoogleSetStatuses().find((set) => set.id === added.id);
    expect(updated).toMatchObject({ name: 'Renamed', clientId: 'new-id', configured: true });
  });

  it('refuses to update the read-only env set', async () => {
    const svc = await loadService();
    expect(() => svc.updateGoogleSet('env', { name: 'x' })).toThrow(/read-only/i);
    expect(() => svc.deleteGoogleSet('env')).toThrow(/can[’\u2019]t be deleted|server\/\.env/i);
  });

  it('throws on unknown set ids', async () => {
    const svc = await loadService();
    expect(() => svc.updateGoogleSet('nope', { name: 'x' })).toThrow(/unknown/i);
    expect(() => svc.resolveGoogleCredentials('nope')).toThrow(/no longer exists/i);
  });

  it('deletes a Google set', async () => {
    const svc = await loadService();
    const added = svc.addGoogleSet({ name: 'Org', clientId: 'id', clientSecret: 'secret' });
    svc.deleteGoogleSet(added.id);
    expect(svc.getGoogleSetStatuses()).toEqual([]);
  });

  it('stores Microsoft credentials and resolves the tenant', async () => {
    const svc = await loadService();
    svc.setCredentials('ms', {
      clientId: 'ms-id',
      clientSecret: 'ms-secret',
      tenantId: 'https://login.microsoftonline.com/some-tenant-id/subdir',
    });
    const status = svc.getCredentialsStatus().ms;
    expect(status.clientId).toBe('ms-id');
    expect(status.configured).toBe(true);
    expect(status.tenantId).toBe('some-tenant-id');
  });

  it('clearing a stored tenant falls back to .env, then "common"', async () => {
    const svc = await loadService();
    svc.setCredentials('ms', { clientId: 'ms-id', clientSecret: 'ms-secret', tenantId: '' });
    const status = svc.getCredentialsStatus().ms;
    expect(status.tenantId).toBe('common');
  });

  it('prefers stored credentials over .env fallbacks', async () => {
    process.env.MS_CLIENT_ID = 'env-ms-id';
    process.env.MS_CLIENT_SECRET = 'env-ms-secret';
    const svc = await loadService();
    svc.setCredentials('ms', { clientId: 'stored-ms-id', clientSecret: 'stored-ms-secret', tenantId: '' });
    const status = svc.getCredentialsStatus().ms;
    expect(status.clientId).toBe('stored-ms-id');
    expect(status.configured).toBe(true);
    delete process.env.MS_CLIENT_ID;
    delete process.env.MS_CLIENT_SECRET;
  });

  it('surfaces the .env Google pair as the implicit set when complete', async () => {
    process.env.GOOGLE_CLIENT_ID = 'env-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-google-secret';
    const svc = await loadService();
    const statuses = svc.getGoogleSetStatuses();
    expect(statuses[0]).toMatchObject({ id: 'env', name: 'server/.env', clientId: 'env-google-id', configured: true });
    expect(svc.resolveGoogleCredentials('env')).toEqual({ clientId: 'env-google-id', clientSecret: 'env-google-secret' });
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('enables Google when only the .env pair exists', async () => {
    process.env.GOOGLE_CLIENT_ID = 'env-google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-google-secret';
    const svc = await loadService();
    expect(svc.getCredentialsStatus().google.configured).toBe(true);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('migrates a legacy single google object into a "default" set', async () => {
    writeJson(CREDENTIALS_FILE, { google: { clientId: 'legacy-id', clientSecret: 'legacy-secret' } });
    const svc = await loadService();
    expect(svc.getGoogleSetStatuses()).toContainEqual({
      id: 'default',
      name: 'Default',
      clientId: 'legacy-id',
      configured: true,
    });
  });

  it('persists credentials to the data dir the suite points at', async () => {
    const svc = await loadService();
    svc.setCredentials('ms', { clientId: 'p-id', clientSecret: 'p-secret', tenantId: '' });
    const raw = readJson(CREDENTIALS_FILE, null);
    expect(raw.ms.clientId).toBe('p-id');
    expect(dataPath(CREDENTIALS_FILE)).toBeTruthy();
  });
});