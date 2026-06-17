import { describe, it, expect } from 'vitest';
import { isBlockedIp, assertPublicHttpsUrl } from '../src/util/ssrf.js';

describe('isBlockedIp', () => {
  it('blocks loopback, private, link-local, metadata, unspecified', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1',
                       '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fc00::1'])
      expect(isBlockedIp(ip), ip).toBe(true);
  });
  it('allows public addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])
      expect(isBlockedIp(ip), ip).toBe(false);
  });
});

describe('assertPublicHttpsUrl', () => {
  it('rejects non-https', async () => {
    await expect(assertPublicHttpsUrl('http://1.1.1.1/')).rejects.toThrow(/https/);
  });
  it('rejects a literal private-IP host without any DNS', async () => {
    await expect(assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/not allowed/);
  });
  it('rejects garbage URLs', async () => {
    await expect(assertPublicHttpsUrl('not a url')).rejects.toThrow();
  });
  it('accepts a literal public-IP https host', async () => {
    await expect(assertPublicHttpsUrl('https://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
  });
});
