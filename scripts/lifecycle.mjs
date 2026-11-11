import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AGENT_LABEL } from '../companion/config.mjs';

const execute = promisify(execFile);
export async function run(command, args, options = {}) {
  const { quiet, ...execOptions } = options;
  const result = await execute(command, args, { timeout: 120000, maxBuffer: 1024 * 1024, ...execOptions });
  if (!quiet && result.stdout?.trim()) console.log(result.stdout.trim());
  return result;
}

export function installationPaths(userHome = homedir()) {
  const library = join(userHome, 'Library');
  return {
    data: join(library, 'Application Support', 'BUSYCodex'),
    logs: join(library, 'Logs', 'BUSYCodex'),
    plist: join(library, 'LaunchAgents', AGENT_LABEL + '.plist'),
  };
}

const xml = value => String(value).replace(/[<>&"']/g, char => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
})[char]);

export function launchAgent({ paths, nodePath }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${AGENT_LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(join(paths.data, 'sync.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(paths.data)}</string>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>60</integer>
<key>StandardOutPath</key><string>${xml(join(paths.logs, 'sync.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(paths.logs, 'sync.log'))}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(dirname(nodePath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
`;
}

async function stopAgent(uid, runner) {
  const service = `gui/${uid}/${AGENT_LABEL}`;
  let loaded = false;
  try { await runner('/bin/launchctl', ['print', service], { quiet: true }); loaded = true; }
  catch (error) { if (![3, 113].includes(error.code)) throw error; }
  if (loaded) await runner('/bin/launchctl', ['bootout', service]);
}

export async function installHelper(options, runner = run) {
  const { paths, source, config, uid } = options;
  await stopAgent(uid, runner);
  await mkdir(paths.data, { recursive: true, mode: 0o700 });
  await mkdir(paths.logs, { recursive: true, mode: 0o700 });
  await mkdir(dirname(paths.plist), { recursive: true });
  for (const file of ['sync.mjs', 'config.mjs']) await copyFile(join(source, 'companion', file), join(paths.data, file));
  await writeFile(join(paths.data, 'config.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await writeFile(paths.plist, launchAgent(options), { mode: 0o600 });
  // A setup or reinstall always sends a fresh snapshot, even if usage hasn't changed.
  await unlink(join(paths.data, 'last-sync.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await runner('/bin/launchctl', ['bootstrap', `gui/${uid}`, paths.plist]);
}

export async function uninstallHelper({ paths, uid }, runner = run) {
  await stopAgent(uid, runner);
  for (const file of [paths.plist, ...['sync.mjs', 'config.mjs', 'config.json', 'last-sync.json', 'last-sync.json.next'].map(name => join(paths.data, name))]) {
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
