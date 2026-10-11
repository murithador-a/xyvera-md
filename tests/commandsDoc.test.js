import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkCommandsDoc } from '../scripts/verify-commands-doc.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('docs/COMMANDS.md matches the live command registry', async () => {
  const res = await checkCommandsDoc({ rootDir: repoRoot });
  assert.equal(
    res.ok,
    true,
    `docs/COMMANDS.md is stale${res.firstDiffLine ? ` (first difference at line ${res.firstDiffLine})` : ''} — ` +
      'regenerate it with: node scripts/gen-commands.mjs',
  );
  assert.ok(res.commands > 100, 'the registry should still expose every documented command');
});
