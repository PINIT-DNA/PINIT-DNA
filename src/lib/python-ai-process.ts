/**
 * PINIT-DNA — Python AI Process Manager
 *
 * Starts the Python FastAPI service as a child process of Express.
 * No separate terminal needed.
 * Gracefully stops Python when Express shuts down.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs   from 'fs';
import { logger } from './logger';

let pythonProcess: ChildProcess | null = null;

const PYTHON_DIR  = path.resolve(__dirname, '../../python-ai');
const PYTHON_MAIN = path.join(PYTHON_DIR, 'main.py');
const AI_PORT     = parseInt(process.env['AI_SERVICE_PORT'] ?? '8001', 10);

export function startPythonAI(): void {
  // Skip if python-ai/main.py doesn't exist
  if (!fs.existsSync(PYTHON_MAIN)) {
    logger.warn('Python AI service not found — skipping', { path: PYTHON_MAIN });
    return;
  }

  // Skip if already running as child process
  if (pythonProcess && !pythonProcess.killed) return;

  // Check if port is already in use (Python running in another terminal)
  const net = require('net');
  const tester = net.createServer()
    .once('error', () => {
      // Port already in use — Python is already running externally
      logger.info(`Python AI already running on port ${AI_PORT} — skipping auto-start`);
    })
    .once('listening', () => {
      tester.close(() => {
        // Port is free — start Python as child process
        _doStartPython();
      });
    })
    .listen(AI_PORT, '127.0.0.1');
  return;
}

function _doStartPython(): void {

  // Try python3 first, fall back to python
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  logger.info('Starting Python AI service…', { port: AI_PORT });

  pythonProcess = spawn(
    pythonCmd,
    ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', String(AI_PORT)],
    {
      cwd:   PYTHON_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env:   { ...process.env, PYTHONUNBUFFERED: '1' },
    }
  );

  pythonProcess.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) logger.info(`[python-ai] ${msg}`);
  });

  let missingModule = false;

  pythonProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (!msg) return;
    if (msg.includes('ModuleNotFoundError')) {
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
    // Do NOT restart if dependencies are missing — would loop forever
    if (missingModule) {
      logger.warn('Python AI disabled — install dependencies first: cd python-ai && pip install -r requirements.txt');
      return;
    }
    // Auto-restart after 5s on unexpected crash
    if (code !== 0 && signal !== 'SIGTERM') {
      setTimeout(() => {
        logger.info('Restarting Python AI service…');
        startPythonAI();
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
  if (pythonProcess && !pythonProcess.killed) {
    logger.info('Stopping Python AI service…');
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
  }
}
