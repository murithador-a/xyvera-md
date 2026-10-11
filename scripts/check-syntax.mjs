#!/usr/bin/env node
/**
 * Syntax / static sanity check: runs `node --check` on every .js/.mjs file in
 * src/, tests/, and scripts/. Equivalent of a lightweight lint pass.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = process.cwd();
const targets = ['src', 'tests', 'scripts'];

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'data', 'tmp'].includes(e.name)) continue;
      out.push(...(await walk(p)));
    } else if (/\.(m?js)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = [];
for (const t of targets) files.push(...(await walk(path.join(root, t))));

let failed = 0;
for (const file of files) {
  try {
    await run(process.execPath, ['--check', file]);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${path.relative(root, file)}\n${err.stderr ?? err.message}`);
  }
}

console.log(`checked ${files.length} file(s), ${failed} failure(s)`);
process.exit(failed > 0 ? 1 : 0);
