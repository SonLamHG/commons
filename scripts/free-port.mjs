// Free a TCP port by killing whatever process is LISTENING on it.
// Cross-platform (win32 / macOS / Linux). Safe no-op when the port is free.
// Usage: node scripts/free-port.mjs [port]   (default 8787, or $PORT)
import { execSync } from 'node:child_process';

const port = process.argv[2] || process.env.PORT || '8787';
const isWin = process.platform === 'win32';

function pidsOnPort(p) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split('\n')) {
        // ...  TCP  0.0.0.0:8787  0.0.0.0:0  LISTENING  15356
        const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (m && m[1] === String(p)) pids.add(m[2]);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return []; // no match / tool returned non-zero
  }
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.error(`[free-port] :${port} is free`);
  process.exit(0);
}
for (const pid of pids) {
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    else process.kill(Number(pid), 'SIGKILL');
    console.error(`[free-port] killed PID ${pid} holding :${port}`);
  } catch (e) {
    console.error(`[free-port] could not kill PID ${pid}: ${e instanceof Error ? e.message : e}`);
  }
}
