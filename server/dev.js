import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const resolvePythonBinary = () => {
  const candidates = [
    path.join(root, '.venv', 'bin', 'python3'),
    path.join(root, '.venv', 'bin', 'python'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return 'python3';
};

const spawnPrefixed = (label, command, args) => {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const forward = (stream, logger) => {
    stream.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.trim()) logger(`[${label}] ${line}`);
      }
    });
  };

  forward(child.stdout, console.log);
  forward(child.stderr, console.error);
  return child;
};

const apiProcess = spawnPrefixed('api', resolvePythonBinary(), [
  '-m',
  'uvicorn',
  'backend.main:app',
  '--host',
  '0.0.0.0',
  '--port',
  '8000',
]);

const webProcess = spawnPrefixed('web', process.execPath, [path.join(__dirname, 'index.js')]);

let shuttingDown = false;

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of [apiProcess, webProcess]) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(code), 200);
};

apiProcess.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[api] exited with code ${code ?? 0}`);
    shutdown(code ?? 1);
  }
});

webProcess.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[web] exited with code ${code ?? 0}`);
    shutdown(code ?? 1);
  }
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
