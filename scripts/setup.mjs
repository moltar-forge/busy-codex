import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { APP_ID, barUrl, findExecutable } from '../companion/config.mjs';
import { installationPaths, installHelper, uninstallHelper, run } from './lifecycle.mjs';

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const HELP = `Usage: npm run setup [-- options] | npm run teardown [-- options]

  --addr HOST      BUSY Bar address (default: USB 10.0.4.20)
  --codex PATH     Codex executable (default: detected on PATH; setup only)
  --helper-only    Install/remove the Mac updater without touching the device app
  --dry-run        Show the plan without changing files, services, or the device
  --help          Show this help

Setup requires macOS, Node 24, npm ci, and Codex signed in with ChatGPT.
Teardown keeps device settings and diagnostic logs. It never signs Codex out.
`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    addr: { type: 'string' }, codex: { type: 'string' },
    'helper-only': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } });
  if (values.help) { console.log(HELP); return; }
  const action = positionals[0] || 'install';
  if (positionals.length > 1 || !['install', 'uninstall'].includes(action)) throw new Error(HELP);
  if (process.platform !== 'darwin') throw new Error('The background updater installer requires macOS.');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node 24: nvm install && nvm use');
  const paths = installationPaths();
  let previous = {};
  try { previous = JSON.parse(await readFile(join(paths.data, 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const address = barUrl(values.addr || previous.barUrl);
  const deviceArgs = ['--addr', address];
  const busy = (...args) => run(process.execPath, [join(source, 'node_modules/@busy-app/cli/dist/index.js'), ...args], { cwd: source });
  const options = { source, paths, uid: process.getuid(), nodePath: process.execPath };
  if (action === 'install') {
    const codexPath = await findExecutable(values.codex || process.env.BUSY_CODEX_PATH || previous.codexPath || 'codex');
    console.log(`Install: ${values['helper-only'] ? 'Mac updater only' : 'device app and Mac updater'}\nBUSY Bar: ${address}\nCodex: ${codexPath}\nNode: ${process.execPath}\nUpdater: ${paths.data}\nLaunchAgent: ${paths.plist}`);
    if (values['dry-run']) return;
    if (!values['helper-only']) {
      await run(process.execPath, [join(source, 'node_modules/typescript/bin/tsc')], { cwd: source });
      await busy('build');
      await busy('app', 'install', ...deviceArgs);
    }
    await installHelper({ ...options, config: { barUrl: address, codexPath } });
    if (!values['helper-only']) await busy('app', 'run', ...deviceArgs);
    console.log('Installed. The updater runs at login and every minute. Re-run setup after updating the code.');
  } else {
    console.log(`Remove: ${values['helper-only'] ? 'Mac updater only' : 'device app and Mac updater'}\nBUSY Bar: ${address}\nUpdater: ${paths.data}\nLaunchAgent: ${paths.plist}\nDiagnostic logs retained: ${paths.logs}`);
    if (values['dry-run']) return;
    await uninstallHelper(options);
    if (!values['helper-only']) {
      try {
        const { stdout } = await run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--max-time', '8', '--noproxy', '*', address + '/api/apps/list'], { quiet: true });
        const listing = JSON.parse(stdout);
        if (!Array.isArray(listing.apps)) throw new Error('BUSY Bar returned an invalid app list');
        if (listing.apps.some(app => app.id === APP_ID)) await busy('app', 'uninstall', APP_ID, ...deviceArgs);
      }
      catch (error) {
        throw new Error('The Mac updater was removed, but device removal failed. Connect the BUSY Bar and re-run npm run teardown. ' + (error.stderr || error.message));
      }
    }
    console.log('Removed. Device settings and diagnostic logs are retained.');
  }
}
main().catch(error => { console.error(error.stderr?.trim() || error.message); process.exitCode = 1; });
