/**
 * PINIT-DNA — Python AI Process Manager
 *
 * Starts the Python FastAPI service as a child process of Express.
 * No separate terminal needed.
 * Gracefully stops Python when Express shuts down.
 */

import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { logger } from './logger';

let pythonProcess: ChildProcess | null = null;
let shuttingDown = false;

const PYTHON_DIR = path.resolve(__dirname, '../../python-ai');
const PYTHON_MAIN = path.join(PYTHON_DIR, 'main.py');
const AI_PORT = parseInt(process.env['AI_SERVICE_PORT'] ?? '8001', 10);

export function markPythonShuttingDown(): void {
  shuttingDown = true;
}

export function startPythonAI(): void {
  if (shuttingDown) return;

  const aiUrl = process.env['AI_SERVICE_URL'] ?? '';
  if (aiUrl && !aiUrl.includes('localhost') && !aiUrl.includes('127.0.0.1')) {
    logger.info(`Python AI: using external service at ${aiUrl} — skipping local spawn`);
    return;
  }

  if (!fs.existsSync(PYTHON_MAIN)) {
    logger.warn('Python AI service not found — skipping', { path: PYTHON_MAIN });
    return;
  }

  if (pythonProcess && !pythonProcess.killed) return;

  const tester = net.createServer()
    .once('error', () => {
      logger.info(`Python AI already running on port ${AI_PORT} — skipping auto-start`);
    })
    .once('listening', () => {
      tester.close(() => {
        _doStartPython();
      });
    })
    .listen(AI_PORT, '127.0.0.1');
  void tester;
}

function _doStartPython(): void {
  if (shuttingDown) return;

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  logger.info('Starting Python AI service…', { port: AI_PORT });

  pythonProcess = spawn(
    pythonCmd,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(AI_PORT)],
    {
      cwd: PYTHON_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    },
  );

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) logger.info(`[python-ai] ${msg}`);
  });

  let missingModule = false;

  const isMissingPythonDep = (msg: string) =>
    msg.includes('ModuleNotFoundError') || /No module named/i.test(msg);

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (isMissingPythonDep(msg)) {
      missingModule = true;
      logger.warn('Python AI: missing module — run: cd python-ai && pip install -r requirements.txt');
    } else if (msg.includes('Uvicorn running')) {
      logger.info(`Python AI service ready on port ${AI_PORT}`);
    } else if (!msg.includes('INFO') && !msg.includes('WARNING')) {
      logger.warn(`[python-ai] ${msg.slice(0, 200)}`);
    }
  });

  pythonProcess.on('exit', (code, signal) => {
    logger.warn('Python AI process exited', { code, signal });
    pythonProcess = null;

    if (shuttingDown || missingModule) {
      if (missingModule) {
        logger.warn('Python AI disabled — install dependencies first: cd python-ai && pip install -r requirements.txt');
      }
      return;
    }

    if (code !== 0 && signal !== 'SIGTERM') {
      setTimeout(() => {
        if (!shuttingDown) {
          logger.info('Restarting Python AI service…');
          startPythonAI();
        }
      }, 5000);
    }
  });

  pythonProcess.on('error', (err) => {
    logger.error('Failed to start Python AI', { error: err.message });
    logger.warn('Python AI unavailable — AI features degraded gracefully');
    pythonProcess = null;
  });
}

export function stopPythonAI(): void {
  if (!pythonProcess || pythonProcess.killed) return;

  logger.info('Stopping Python AI service…');
  const proc = pythonProcess;
  pythonProcess = null;

  if (process.platform === 'win32' && proc.pid) {
    spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
    return;
  }

  proc.kill('SIGTERM');
}
