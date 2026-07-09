/**
 * Free dev ports before npm run dev — but NEVER kill a healthy API on 4000.
 * Fixes EADDRINUSE when stale processes linger, without killing a running backend.
 */
const http = require('http');
const { execSync } = require('child_process');

const NODE_PORT = parseInt(process.env.PORT || '4000', 10);
const AI_PORT = parseInt(process.env.AI_SERVICE_PORT || '8001', 10);

function probeHealth(port, path = '/health') {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path, timeout: 1200 },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

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

async function main() {
  const nodeHealthy = await probeHealth(NODE_PORT, '/health');
  if (nodeHealthy) {
    console.log(`[free-dev-ports] API already healthy on port ${NODE_PORT} — keeping it running`);
  } else {
    free(NODE_PORT);
  }

  const aiHealthy = await probeHealth(AI_PORT, '/health');
  if (aiHealthy) {
    console.log(`[free-dev-ports] Python AI already healthy on port ${AI_PORT} — keeping it running`);
  } else {
    free(AI_PORT);
  }
}

main().catch((err) => {
  console.warn('[free-dev-ports] Warning:', err.message);
  free(NODE_PORT);
  free(AI_PORT);
});
