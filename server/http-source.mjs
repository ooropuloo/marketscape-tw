import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const allowedHosts = new Set(['mis.twse.com.tw', 'www.twse.com.tw', 'openapi.twse.com.tw', 'www.tpex.org.tw', 'opendata.tdcc.com.tw', 'www.yuantaetfs.com']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MarketScapeTW/2.0 local-observer';

// System curl uses the host's trusted TLS/proxy configuration. Never invokes a shell.
export async function getPublicText(url, { maxBytes = 80_000_000, timeout = 60 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) throw new Error('Unsupported host ' + parsed.hostname);
  const { stdout } = await exec(process.platform === 'win32' ? 'curl.exe' : 'curl',
    ['--fail', '--silent', '--show-error', '--location', '--max-time', String(timeout), '--max-filesize', String(maxBytes), '--user-agent', UA, '--header', 'Accept: application/json, text/plain, */*', url],
    { windowsHide: true, maxBuffer: maxBytes + 1024, timeout: (timeout + 5) * 1000, encoding: 'utf8' });
  return stdout;
}
export async function getPublicJSON(url, options) { return JSON.parse(await getPublicText(url, options)); }

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Serialises upstream calls so the official sites never see bursts from this observer.
export function createThrottle(gapMs) {
  let chain = Promise.resolve(), lastAt = 0;
  return fn => { const run = chain.then(async () => { const wait = lastAt + gapMs - Date.now(); if (wait > 0) await sleep(wait); try { return await fn(); } finally { lastAt = Date.now(); } }); chain = run.catch(() => {}); return run; };
}

export const taipei = {
  date(now = Date.now()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); },
  time(now = Date.now()) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now); },
  weekday(now = Date.now()) { return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(now); },
  isWeekday(now = Date.now()) { return !['Sat', 'Sun'].includes(this.weekday(now)); },
  // Regular session with a small margin for the opening and closing auctions.
  inSession(now = Date.now()) { const t = this.time(now); return this.isWeekday(now) && t >= '08:50:00' && t <= '13:40:00'; },
};
