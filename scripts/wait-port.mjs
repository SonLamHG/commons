// Block until something is accepting TCP connections on a port, then exit 0.
// Used to gate the web dev server on the API being ready, so Vite never
// proxies to a not-yet-listening :8787 (the startup-race ECONNREFUSED).
// Usage: node scripts/wait-port.mjs [port] [timeoutMs]   (default 8787, 30000)
import { connect } from 'node:net';

const port = Number(process.argv[2] || process.env.PORT || 8787);
const timeoutMs = Number(process.argv[3] || 30000);
const host = '127.0.0.1';
const started = Date.now();

function probe() {
  const sock = connect({ host, port });
  sock.once('connect', () => {
    sock.destroy();
    console.error(`[wait-port] :${port} is up`);
    process.exit(0);
  });
  sock.once('error', () => {
    sock.destroy();
    if (Date.now() - started > timeoutMs) {
      console.error(`[wait-port] timed out after ${timeoutMs}ms waiting for :${port}`);
      process.exit(1);
    }
    setTimeout(probe, 200);
  });
}

probe();
