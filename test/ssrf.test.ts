import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted above imports by Vitest so ssrf.ts picks up the mock too.
// Tests using literal IPs never call lookup (net.isIP returns truthy first), so this
// mock is only exercised by the DNS-resolution test at the bottom.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';

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
  it('rejects a hostname that resolves to a private IP (DNS path)', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    await expect(assertPublicHttpsUrl('https://evil.internal/hook')).rejects.toThrow(/not allowed/);
    vi.mocked(lookup).mockReset();
  });
});
