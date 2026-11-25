import { spawn } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['dev:api', 'dev:web'].map(script => spawn(npm, ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' }));
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const p of children) p.kill(); process.exitCode = code; }
for (const p of children) { p.on('exit', code => stop(code ?? 0)); p.on('error', () => stop(1)); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
