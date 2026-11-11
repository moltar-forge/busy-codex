import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { APP_ID, loadConfig } from './config.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const STATE = fileURLToPath(new URL('./last-sync.json', import.meta.url));
function readLimits(codexPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexPath, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '';
    const timeout = setTimeout(() => finish(new Error('Codex usage request timed out')), 25000);
    let done = false;
    function finish(error, result) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      child.kill();
      if (error) reject(error); else resolve(result);
    }
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.on('exit', () => finish(new Error('Codex app-server exited before returning usage')));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) { finish(new Error('Codex initialization failed')); return; }
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read' });
        }
        if (message.id === 2) {
          if (message.error) finish(new Error('Cannot read Codex usage; check Codex sign-in'));
          else finish(null, message.result);
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'busy_codex_usage', version: '1.0.0' } } });
  });
}
export function normalize(result, now = Date.now()) {
  const bucket = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
  const windows = [bucket?.primary, bucket?.secondary].filter(window =>
    window && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 &&
    Number.isFinite(window.windowDurationMins) && window.windowDurationMins > 0 && Number.isFinite(window.resetsAt));
  if (!windows.length) throw new Error('No percentage-based Codex usage limit is available');
  const limiting = windows.reduce((a, b) => a.usedPercent >= b.usedPercent ? a : b);
  return { remaining: 100 - limiting.usedPercent, windowMins: limiting.windowDurationMins, resetsAt: limiting.resetsAt, updatedAt: now };
}
function curl(base, path, body) {
  const args = ['--fail-with-body', '--silent', '--show-error', '--max-time', '8', '--noproxy', '*'];
  if (body !== undefined) args.push('-X', 'PUT', '-H', 'Content-Type: application/json', '--data-binary', body);
  args.push(base + path);
  return new Promise((resolve, reject) => execFile('/usr/bin/curl', args, { timeout: 10000 }, (error, stdout) => {
    if (error) reject(new Error('BUSY Bar USB connection failed: ' + (error.stderr?.trim() || error.message))); else resolve(stdout);
  }));
}
async function main() {
  const config = await loadConfig(DIRECTORY);
  await curl(config.barUrl, '/api/version');
  const usage = normalize(await readLimits(config.codexPath));
  let previous;
  try { previous = JSON.parse(await readFile(STATE, 'utf8')); } catch {}
  if (previous && previous.remaining === usage.remaining && previous.windowMins === usage.windowMins &&
      previous.resetsAt === usage.resetsAt && usage.updatedAt - previous.updatedAt < 300000) return;
  await curl(config.barUrl, '/api/apps/settings?app_id=' + APP_ID, JSON.stringify({ version: 1, values: { snapshot: JSON.stringify(usage) } }));
  await writeFile(STATE + '.next', JSON.stringify(usage), { mode: 0o600 });
  await rename(STATE + '.next', STATE);
  console.log(new Date().toISOString() + ': synced ' + usage.remaining + '% remaining');
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(new Date().toISOString() + ': ' + error.message + (error.cause ? ': ' + error.cause.message + ' (' + error.cause.code + ')' : '')); process.exitCode = 1; });
}
