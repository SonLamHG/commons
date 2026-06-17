import { lookup } from 'node:dns/promises';
import net from 'node:net';

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function inV4(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const V4_BLOCKS = [
  '0.0.0.0/8',       // unspecified / this-network
  '10.0.0.0/8',      // private
  '100.64.0.0/10',   // CGNAT
  '127.0.0.0/8',     // loopback
  '169.254.0.0/16',  // link-local incl. cloud metadata 169.254.169.254
  '172.16.0.0/12',   // private
  '192.0.0.0/24',    // IETF protocol
  '192.168.0.0/16',  // private
  '198.18.0.0/15',   // benchmarking
  '224.0.0.0/4',     // multicast
  '240.0.0.0/4',     // reserved
];

/** True if the (already-numeric) IP is in a range we must never let a webhook reach. */
export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return V4_BLOCKS.some((c) => inV4(ip, c));
  if (v === 6) {
    const lo = ip.toLowerCase();
    if (lo === '::1' || lo === '::') return true;            // loopback / unspecified
    const fe10 = parseInt(lo.slice(0, 4), 16);
    if (fe10 >= 0xfe80 && fe10 <= 0xfebf) return true;  // link-local fe80::/10
    if (lo.startsWith('fc') || lo.startsWith('fd')) return true; // unique-local fc00::/7
    if (lo.startsWith('ff')) return true;                    // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lo);
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  return true; // not a valid IP literal — treat as blocked
}

/** Validate a webhook URL: must be https and must resolve only to public addresses.
 * Resolves DNS at call time (so call it right before fetch to limit DNS-rebind windows). */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('invalid URL'); }
  if (url.protocol !== 'https:') throw new Error('webhook must use https');
  const host = url.hostname;
  const ips = net.isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  if (ips.length === 0) throw new Error('webhook host did not resolve');
  for (const ip of ips) if (isBlockedIp(ip)) throw new Error('webhook host is not allowed (non-public address)');
  return url;
}
