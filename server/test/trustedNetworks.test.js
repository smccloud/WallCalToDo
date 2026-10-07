import { describe, expect, it, vi } from 'vitest';
import { afterEach, beforeEach } from 'vitest';

// trustedNetworks.js builds its allowlist from config at import time, and
// config reads process.env.TRUSTED_CIDRS, so each test reloads the module
// with the subnet list it wants. Loopback stays trusted regardless.
async function loadWithCidrs(cidrs) {
  vi.resetModules();
  process.env.TRUSTED_CIDRS = cidrs;
  return await import('../src/services/trustedNetworks.js');
}

describe('trustedNetworks', () => {
  let mod;

  beforeEach(async () => {
    mod = await loadWithCidrs('');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('loopback', () => {
    it('trusts IPv4 loopback', () => {
      expect(mod.isTrustedAddress('127.0.0.1')).toBe(true);
      expect(mod.isTrustedAddress('127.255.255.255')).toBe(true);
    });

    it('trusts IPv6 loopback', () => {
      expect(mod.isTrustedAddress('::1')).toBe(true);
    });
  });

  describe('with no TRUSTED_CIDRS', () => {
    it('trusts nothing off-loopback', () => {
      expect(mod.isTrustedAddress('192.168.1.42')).toBe(false);
      expect(mod.isTrustedAddress('8.8.8.8')).toBe(false);
      expect(mod.isTrustedAddress('2001:db8::1')).toBe(false);
    });

    it('returns false for non-IP strings', () => {
      expect(mod.isTrustedAddress('not-an-ip')).toBe(false);
      expect(mod.isTrustedAddress('')).toBe(false);
      expect(mod.isTrustedAddress(null)).toBe(false);
    });
  });

  describe('with TRUSTED_CIDRS set', () => {
    it('matches hosts inside a CIDR block', async () => {
      const { isTrustedAddress } = await loadWithCidrs('192.168.1.0/24');
      expect(isTrustedAddress('192.168.1.99')).toBe(true);
      expect(isTrustedAddress('192.168.5.1')).toBe(false);
    });

    it('matches a bare single host entry', async () => {
      const { isTrustedAddress } = await loadWithCidrs('10.0.0.5');
      expect(isTrustedAddress('10.0.0.5')).toBe(true);
      expect(isTrustedAddress('10.0.0.6')).toBe(false);
    });

    it('accepts multiple comma-separated entries', async () => {
      const { isTrustedAddress } = await loadWithCidrs('192.168.1.0/24,10.0.0.5');
      expect(isTrustedAddress('192.168.1.7')).toBe(true);
      expect(isTrustedAddress('10.0.0.5')).toBe(true);
    });

    it('accepts IPv6 subnets', async () => {
      const { isTrustedAddress } = await loadWithCidrs('2001:db8::/32');
      expect(isTrustedAddress('2001:db8:1::1')).toBe(true);
      expect(isTrustedAddress('2001:db9::1')).toBe(false);
    });

    it('warns once about unusable entries instead of crashing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await loadWithCidrs('not-an-ip,10.0.0.5');
      expect(warn).toHaveBeenCalledOnce();
      const message = warn.mock.calls[0].join(' ');
      expect(message).toContain('not-an-ip');
      warn.mockRestore();
    });
  });

  describe('clientAddress', () => {
    it('unwraps IPv4-mapped IPv6 addresses', () => {
      expect(mod.clientAddress({ socket: { remoteAddress: '::ffff:192.168.1.42' } })).toBe('192.168.1.42');
    });

    it('leaves native addresses untouched', () => {
      expect(mod.clientAddress({ socket: { remoteAddress: '192.168.1.42' } })).toBe('192.168.1.42');
      expect(mod.clientAddress({ socket: { remoteAddress: '::1' } })).toBe('::1');
    });

    it('returns null when there is no socket address', () => {
      expect(mod.clientAddress({})).toBeNull();
      expect(mod.clientAddress({ socket: {} })).toBeNull();
    });
  });

  describe('isTrustedRequest', () => {
    it('trusts a loopback request', () => {
      expect(mod.isTrustedRequest({ socket: { remoteAddress: '127.0.0.1' } })).toBe(true);
    });

    it('rejects a foreign request by default', () => {
      expect(mod.isTrustedRequest({ socket: { remoteAddress: '192.168.1.42' } })).toBe(false);
    });

    it('rejects a request with no address', () => {
      expect(mod.isTrustedRequest({})).toBe(false);
    });

    it('trusts a mapped address that matches a configured host', async () => {
      const { isTrustedRequest } = await loadWithCidrs('192.168.1.42');
      expect(isTrustedRequest({ socket: { remoteAddress: '::ffff:192.168.1.42' } })).toBe(true);
    });
  });
});