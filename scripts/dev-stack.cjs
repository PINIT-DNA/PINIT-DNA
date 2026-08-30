/**
 * Start Node backend (4000) + Vite client (3002) in one command.
 * Waits until /api/v1/ping responds before opening the frontend.
 * Usage: npm run dev:all
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const BACKEND_PORT = parseInt(process.env.PORT || '4000', 10);
const PING_PATH = '/api/v1/ping';

function waitForBackend(maxMs = 90_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { hostname: '127.0.0.1', port: BACKEND_PORT, path: PING_PATH, timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
            return;
          }
          retry();
        },
      );
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });

      function retry() {
        if (Date.now() - started > maxMs) {
          reject(new Error(`Backend did not respond on port ${BACKEND_PORT} within ${maxMs / 1000}s`));
          return;
        }
        setTimeout(tick, 1500);
      }
    };
    tick();
  });
}

function run(name, cwd, command, args) {
  const child = spawn(command, args, {
    cwd,
    shell: isWin,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[dev:all] ${name} exited with code ${code}`);
    }
  });
  return child;
}

console.log('\n  PINIT-DNA — starting full dev stack');
console.log('  Backend  → http://localhost:4000');
console.log('  Frontend → http://localhost:3002');
console.log('  Waiting for API ping before starting Vite…\n');

const backend = run('backend', root, 'npm', ['run', 'dev']);

waitForBackend()
  .then(() => {
    console.log('\n  ✓ Backend ready — starting Vite client\n');
    run('client', path.join(root, 'client'), 'npm', ['run', 'dev']);
  })
  .catch((err) => {
    console.error(`\n  ✗ ${err.message}`);
    console.error('  Check the backend terminal for errors.\n');
  });

process.on('SIGINT', () => {
  if (isWin) {
    try {
      spawn('taskkill', ['/pid', String(process.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
    } catch { /* ignore */ }
  }
  process.exit(0);
});
