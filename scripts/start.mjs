import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(new URL('../.runtime/', import.meta.url), { recursive: true });
const pidFile = new URL('../.runtime/server.pid', import.meta.url);
if (existsSync(pidFile)) { const old = Number(readFileSync(pidFile, 'utf8')); try { process.kill(old, 0); console.log(`Already running: PID ${old}. Run "npm run stop" first.`); process.exit(1); } catch {} }
const log = openSync(new URL('../.runtime/server.log', import.meta.url), 'a');
const child = spawn(process.execPath, ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', 'server/index.mjs'], { cwd, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env } });
child.unref(); writeFileSync(pidFile, String(child.pid));
console.log(`MarketScape TW v2 server starting: PID ${child.pid}, http://127.0.0.1:5303 (log: .runtime/server.log)`);
