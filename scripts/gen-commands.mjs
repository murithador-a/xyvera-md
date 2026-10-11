#!/usr/bin/env node
/**
 * Generate docs/COMMANDS.md from the live command registry.
 * Run: node scripts/gen-commands.mjs
 * A command that does not exist cannot appear in the docs.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bootstrap } from '../src/index.js';
import { COMMAND_STATUS, CAPABILITIES } from '../src/config/defaults.js';

const app = await bootstrap({
  connect: false,
  rootDir: await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-docs-')),
  env: { LOG_LEVEL: 'silent' },
});

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

lines.push('## Anti-link actions');
lines.push('');
lines.push('Named values are final. Numeric aliases are **pending owner approval** and are');
lines.push('rejected until approved (see `docs/REQUIREMENTS.md` §2.1):');
lines.push('');
lines.push('| Name | Behavior |');
lines.push('|------|----------|');
lines.push('| `delete` | Delete the violating message |');
lines.push('| `delete-warn` | Delete + warn (counts toward the group warning threshold) |');
lines.push('| `delete-kick` | Delete + remove the sender |');
lines.push('| `escalate` | Delete + warn; remove only if the group configured `warnings.actionOnThreshold = kick` |');
lines.push('');
lines.push('## Sudo capabilities');
lines.push('');
for (const cap of Object.values(CAPABILITIES)) {
  lines.push(`- \`${cap}\``);
}

const out = path.join(process.cwd(), 'docs', 'COMMANDS.md');
await fs.writeFile(out, `${lines.join('\n')}\n`, 'utf8');
console.log(`wrote ${out} — ${app.registry.size} commands`);
