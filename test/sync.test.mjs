import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const source = dirname(dirname(fileURLToPath(import.meta.url)));
test('installed helper syncs through configured paths and retries failed writes without caching them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'busy-sync-'));
  const writes = [];
  let rejectWrites = false;
  const server = createServer(async (request, response) => {
    if (request.url === '/api/version') { response.end('{"api_semver":"27.14.0"}'); return; }
    assert.equal(request.url, '/api/apps/settings?app_id=app.moltar.codex');
    assert.equal(request.method, 'PUT');
    let body = '';
    for await (const chunk of request) body += chunk;
    if (rejectWrites) { response.writeHead(503); response.end('Unavailable'); return; }
    writes.push(JSON.parse(body));
    response.end('{"result":"OK"}');
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const file of ['sync.mjs', 'config.mjs']) await copyFile(join(source, 'companion', file), join(directory, file));
    const fake = join(directory, 'fake-codex');
    const used = join(directory, 'used.json');
    await writeFile(used, '62');
    await writeFile(fake, `#!${process.execPath}\nimport readline from 'node:readline';\nimport { readFileSync } from 'node:fs';\nconst lines = readline.createInterface({input:process.stdin});\nlines.on('line', line => {\n const request=JSON.parse(line);\n if(request.method==='initialize') console.log(JSON.stringify({id:request.id,result:{}}));\n if(request.method==='account/rateLimits/read') console.log(JSON.stringify({id:request.id,result:{rateLimits:{primary:{usedPercent:JSON.parse(readFileSync(${JSON.stringify(used)},'utf8')),windowDurationMins:10080,resetsAt:1794527558}}}}));\n});\n`, { mode: 0o700 });
    // The fixture is an ESM executable without relying on a filename extension.
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'config.json'), JSON.stringify({ codexPath: fake, barUrl: `http://127.0.0.1:${server.address().port}` }));
    const command = () => execute(process.execPath, [join(directory, 'sync.mjs')], { timeout: 10000,
      env: { ...process.env, BUSY_BAR_ADDR: '', BUSY_CODEX_PATH: '' } });
    await command();
    assert.equal(writes.length, 1);
    assert.equal(JSON.parse(writes[0].values.snapshot).remaining, 38);
    await command();
    assert.equal(writes.length, 1, 'unchanged usage does not rewrite flash each minute');
    await writeFile(used, '70');
    rejectWrites = true;
    await assert.rejects(command());
    assert.equal(JSON.parse(await readFile(join(directory, 'last-sync.json'))).remaining, 38);
    rejectWrites = false;
    await command();
    assert.equal(writes.length, 2);
    assert.equal(JSON.parse(writes[1].values.snapshot).remaining, 30);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true });
  }
});
