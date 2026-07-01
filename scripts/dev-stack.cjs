/**
 * Start Node backend (4000) + Vite client (3000) in one command.
 * Usage: npm run dev:all
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

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
console.log('  Frontend → http://localhost:3000\n');

const backend = run('backend', root, 'npm', ['run', 'dev']);

// Give backend time to bind before Vite proxies API calls
setTimeout(() => {
  run('client', path.join(root, 'client'), 'npm', ['run', 'dev']);
}, 4000);

process.on('SIGINT', () => {
  if (isWin) {
    try {
      spawn('taskkill', ['/pid', String(process.pid), '/f', '/t'], { shell: true, stdio: 'ignore' });
    } catch { /* ignore */ }
  }
  process.exit(0);
});
