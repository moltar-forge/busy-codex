import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export const APP_ID = 'app.moltar.codex';
export const AGENT_LABEL = 'app.moltar.busy-codex-usage';
export const DEFAULT_BAR = 'http://10.0.4.20';

export function barUrl(address = DEFAULT_BAR) {
  const url = new URL(address.includes('://') ? address : `http://${address}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use a BUSY Bar host or HTTP(S) origin without credentials or a path');
  }
  return url.origin;
}

export async function findExecutable(name, searchPath = process.env.PATH ?? '') {
  const candidates = isAbsolute(name) ? [name] : searchPath.split(delimiter).filter(Boolean).map(dir => join(dir, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next PATH entry. */ }
  }
  throw new Error(`Cannot find executable: ${name}. Add it to PATH or pass its absolute path.`);
}

export async function loadConfig(directory, env = process.env) {
  let config = {};
  try { config = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read updater config.json'); }
  return {
    barUrl: barUrl(env.BUSY_BAR_ADDR || config.barUrl || DEFAULT_BAR),
    codexPath: await findExecutable(env.BUSY_CODEX_PATH || config.codexPath || 'codex'),
  };
}
