#!/usr/bin/env node
/**
 * Docs-sync gate: regenerates docs/COMMANDS.md from the live registry in
 * memory and compares it with the committed file. Fails (exit 1) when the
 * registry changed but the documentation was not regenerated.
 *
 * Run: node scripts/verify-commands-doc.mjs
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { bootstrap } from '../src/index.js';
import { buildCommandsDoc } from './gen-commands.mjs';

/**
 * @returns {Promise<{ok: boolean, expected: string, actual: string|null,
 *   target: string, firstDiffLine: number|null, commands: number}>}
 */
export async function checkCommandsDoc({ rootDir = process.cwd() } = {}) {
  const app = await bootstrap({
    connect: false,
    rootDir: await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-doccheck-')),
    env: { LOG_LEVEL: 'silent' },
  });
  const expected = buildCommandsDoc(app);
  const target = path.join(rootDir, 'docs', 'COMMANDS.md');
  const actual = await fs.readFile(target, 'utf8').catch(() => null);

  let firstDiffLine = null;
  if (actual !== expected) {
    const exp = expected.split('\n');
    const act = (actual ?? '').split('\n');
    const max = Math.max(exp.length, act.length);
    for (let i = 0; i < max; i += 1) {
      if (exp[i] !== act[i]) {
        firstDiffLine = i + 1;
        break;
      }
    }
  }

  return { ok: actual === expected, expected, actual, target, firstDiffLine, commands: app.registry.size };
}

async function main() {
  const res = await checkCommandsDoc();
  if (res.ok) {
    console.log(`docs/COMMANDS.md is in sync with the registry (${res.commands} commands).`);
    return;
  }
  console.error(
    `docs/COMMANDS.md is STALE (${res.target}` +
      (res.firstDiffLine ? `, first difference at line ${res.firstDiffLine}` : '') +
      ').\nRegenerate it: node scripts/gen-commands.mjs',
  );
  process.exit(1);
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  main().catch((err) => {
    console.error('FATAL:', err?.stack ?? err);
    process.exit(1);
  });
}
