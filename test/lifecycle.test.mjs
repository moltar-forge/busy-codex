import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { barUrl, findExecutable, loadConfig } from '../companion/config.mjs';
import { installationPaths, launchAgent, installHelper, uninstallHelper } from '../scripts/lifecycle.mjs';

const source = dirname(dirname(fileURLToPath(import.meta.url)));
test('configuration detects executables, honors overrides, and rejects credential-bearing URLs', async () => {
  assert.equal(barUrl('10.0.4.20'), 'http://10.0.4.20');
  assert.equal(barUrl('http://127.0.0.1:9000'), 'http://127.0.0.1:9000');
  for (const address of ['ftp://host', 'http://u:secret@host', 'http://host/api', 'http://host?token=secret']) assert.throws(() => barUrl(address));
  assert.equal(await findExecutable(process.execPath, ''), process.execPath);
  await assert.rejects(findExecutable('not-installed', ''), /Cannot find executable/);
  const directory = await mkdtemp(join(tmpdir(), 'busy-config-'));
  try {
    await writeFile(join(directory, 'config.json'), JSON.stringify({ codexPath: process.execPath, barUrl: 'http://old-host' }));
    assert.deepEqual(await loadConfig(directory, { BUSY_BAR_ADDR: 'new-host' }), { codexPath: process.execPath, barUrl: 'http://new-host' });
  } finally { await rm(directory, { recursive: true }); }
});

test('install, reinstall and repeated uninstall use isolated paths and retain logs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'busy-lifecycle-'));
  const paths = installationPaths(join(directory, 'A & B'));
  const calls = [];
  let loaded = false;
  const runner = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'print' && !loaded) throw Object.assign(new Error('Not loaded'), { code: 113 });
    if (args[0] === 'bootout') loaded = false;
    if (args[0] === 'bootstrap') loaded = true;
    return {};
  };
  const options = { source, paths, uid: 501, nodePath: process.execPath,
    config: { barUrl: 'http://10.0.4.20', codexPath: process.execPath } };
  try {
    await installHelper(options, runner);
    assert.equal(loaded, true);
    assert.deepEqual(JSON.parse(await readFile(join(paths.data, 'config.json'))), options.config);
    assert.equal((await stat(join(paths.data, 'config.json'))).mode & 0o777, 0o600);
    assert.match(await readFile(paths.plist, 'utf8'), /A &amp; B/);
    assert.equal(await readFile(join(paths.data, 'sync.mjs'), 'utf8'), await readFile(join(source, 'companion/sync.mjs'), 'utf8'));
    assert.match(await readFile(join(paths.data, 'config.mjs'), 'utf8'), /loadConfig/);
    await writeFile(join(paths.data, 'last-sync.json'), '{}');
    await writeFile(join(paths.logs, 'sync.log'), 'keep diagnostic log');
    await installHelper(options, runner);
    await assert.rejects(stat(join(paths.data, 'last-sync.json')), { code: 'ENOENT' });
    assert.ok(calls.some(call => call[1] === 'bootout'));
    await uninstallHelper(options, runner);
    await uninstallHelper(options, runner);
    assert.equal(loaded, false);
    for (const file of [paths.plist, join(paths.data, 'sync.mjs'), join(paths.data, 'config.mjs'), join(paths.data, 'config.json')]) await assert.rejects(stat(file), { code: 'ENOENT' });
    assert.equal(await readFile(join(paths.logs, 'sync.log'), 'utf8'), 'keep diagnostic log');
  } finally { await rm(directory, { recursive: true }); }
});

test('launchAgent safely escapes executable paths', () => {
  const content = launchAgent({ paths: installationPaths('/example/A & B'), nodePath: '/example/"node"' });
  assert.match(content, /&quot;node&quot;/);
  assert.match(content, /<integer>60<\/integer>/);
});
