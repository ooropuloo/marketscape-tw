import { readFileSync, unlinkSync, existsSync } from 'node:fs';
const pidFile = new URL('../.runtime/server.pid', import.meta.url);
if (!existsSync(pidFile)) { console.log('No PID file.'); process.exit(0); }
const pid = Number(readFileSync(pidFile, 'utf8'));
try { process.kill(pid); console.log(`Stopped PID ${pid}`); } catch (e) { console.log(`PID ${pid} not running (${e.code})`); }
unlinkSync(pidFile);
