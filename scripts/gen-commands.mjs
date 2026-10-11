#!/usr/bin/env node
/**
 * Generate docs/COMMANDS.md from the live command registry.
 * Run: node scripts/gen-commands.mjs
 * A command that does not exist cannot appear in the docs.
 *
 * `buildCommandsDoc(app)` is exported so tests and `scripts/verify-commands-doc.mjs`
 * can regenerate the document in memory and prove the committed copy is current.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { bootstrap } from '../src/index.js';
import { COMMAND_STATUS, CAPABILITIES, NUMERIC_ACTION_ALIASES } from '../src/config/defaults.js';

const CATEGORY_TITLES = {
  owner: 'Owner & Sudo',
  group: 'Group Management',
  security: 'Security',
  automation: 'Automation',
  games: 'Games',
  ai: 'AI',
  media: 'Media & Design',
  utilities: 'Utilities',
  info: 'Bot Information',
};

const STATUS_LABEL = {
  [COMMAND_STATUS.IMPLEMENTED]: 'implemented',
  [COMMAND_STATUS.PARTIAL]: 'partial',
  [COMMAND_STATUS.STUB]: 'stub-config-required',
  [COMMAND_STATUS.PENDING]: 'pending-definition',
};

/** Render the full docs/COMMANDS.md text for a booted app. */
export function buildCommandsDoc(app) {
  const lines = [];
  lines.push('# Xyvera MD — Command Reference');
  lines.push('');
  lines.push('_Generated from the command registry by `node scripts/gen-commands.mjs`.');
  lines.push('Do not edit by hand — regenerate after changing commands._');
  lines.push('');
  lines.push('Legend: **status** — `implemented` (works with the current code), `partial`');
  lines.push('(works with documented gaps), `stub-config-required` (needs an external');
  lines.push('provider configured in `.env`; returns setup instructions otherwise),');
  lines.push('`pending-definition` (behavior not yet defined — replies honestly).');
  lines.push('');
  lines.push('Access levels: `everyone`, `group-admin` (real WhatsApp group admin **or** the');
  lines.push('matching sudo capability), `sudo:<capability>`, `owner`.');
  lines.push('');

  const byCat = app.registry.byCategory();
  for (const [category, title] of Object.entries(CATEGORY_TITLES)) {
    const cmds = byCat.get(category) ?? [];
    if (cmds.length === 0) continue;
    lines.push(`## ${title}`);
    lines.push('');
    lines.push('| Command | Arguments | Access | Status | Description |');
    lines.push('|---------|-----------|--------|--------|-------------|');
    for (const cmd of cmds) {
      const args = cmd.args ? `\`${cmd.args}\`` : '—';
      const access =
        cmd.access === 'sudo' || cmd.access === 'group-admin'
          ? `${cmd.access}${cmd.capability ? `:${cmd.capability}` : ''}`
          : cmd.access;
      const aliases = cmd.aliases?.length ? ` _(aka ${cmd.aliases.map((a) => `\`.${a}\``).join(', ')})_` : '';
      lines.push(
        `| \`.${cmd.name}\`${aliases} | ${args} | ${access} | ${STATUS_LABEL[cmd.status]} | ${cmd.description.replace(/\|/g, '\\|')} |`,
      );
    }
    lines.push('');
  }

  const aliasFor = Object.fromEntries(Object.entries(NUMERIC_ACTION_ALIASES).map(([n, name]) => [name, n]));
  lines.push('## Anti-link actions');
  lines.push('');
  lines.push('Numeric aliases 1–4 are **approved and in effect** (`docs/REQUIREMENTS.md` §2.1).');
  lines.push('Group configuration always stores the **named** value.');
  lines.push('');
  lines.push('| Name | Alias | Behavior |');
  lines.push('|------|-------|----------|');
  lines.push(`| \`delete\` | ${aliasFor.delete} | Delete the violating message |`);
  lines.push(`| \`delete-warn\` | ${aliasFor['delete-warn']} | Delete + warn (counts toward the group warning threshold) |`);
  lines.push(`| \`delete-kick\` | ${aliasFor['delete-kick']} | Delete + remove the sender |`);
  lines.push(`| \`escalate\` | ${aliasFor.escalate} | Delete + warn; remove only if the group configured \`warnings.actionOnThreshold = kick\` |`);
  lines.push('');
  lines.push('## Sudo capabilities');
  lines.push('');
  for (const cap of Object.values(CAPABILITIES)) {
    lines.push(`- \`${cap}\``);
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const app = await bootstrap({
    connect: false,
    rootDir: await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-docs-')),
    env: { LOG_LEVEL: 'silent' },
  });
  const out = path.join(process.cwd(), 'docs', 'COMMANDS.md');
  await fs.writeFile(out, buildCommandsDoc(app), 'utf8');
  console.log(`wrote ${out} — ${app.registry.size} commands`);
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryHref === import.meta.url) {
  main().catch((err) => {
    console.error('FATAL:', err?.stack ?? err);
    process.exit(1);
  });
}
