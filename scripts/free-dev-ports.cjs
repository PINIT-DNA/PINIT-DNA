/**
 * Free dev ports 4000 (Node) and 8001 (Python AI) before npm run dev.
 * Fixes EADDRINUSE when a previous ts-node-dev instance did not exit cleanly.
 */
const { execSync } = require('child_process');

const PORTS = [
  parseInt(process.env.PORT || '4000', 10),
  parseInt(process.env.AI_SERVICE_PORT || '8001', 10),
];

function freePortWindows(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid > 0) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
        console.log(`[free-dev-ports] Freed port ${port} (PID ${pid})`);
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* port not in use */
  }
}

function freePortUnix(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8' }).trim();
    if (!out) return;
    for (const pid of out.split('\n')) {
      try {
        process.kill(parseInt(pid, 10), 'SIGTERM');
        console.log(`[free-dev-ports] Freed port ${port} (PID ${pid})`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* port not in use */
  }
}

const free = process.platform === 'win32' ? freePortWindows : freePortUnix;

for (const port of PORTS) {
  free(port);
}
