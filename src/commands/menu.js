/**
 * Menu generation — ALWAYS from the command registry, with truthful statuses.
 * Runtime values (version, uptime, latency) come from the caller.
 */

import { COMMAND_STATUS } from '../config/defaults.js';

const CATEGORY_TITLES = {
  owner: '👑 Owner & Sudo',
  group: '🛡️ Group Management',
  security: '🔒 Security',
  automation: '⚙️ Automation',
  games: '🎮 Games',
  ai: '🤖 AI',
  media: '🎨 Media & Design',
  utilities: '🧰 Utilities',
  info: 'ℹ️ Bot Information',
};

const STATUS_BADGE = {
  [COMMAND_STATUS.PARTIAL]: ' ⟡partial',
  [COMMAND_STATUS.STUB]: ' ⟡needs setup',
  [COMMAND_STATUS.PENDING]: ' ⟡pending',
};

export function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

/**
 * @param {{ registry, botName, version, ownerName, mode, prefix,
 *          uptimeMs: number, latencyMs: number|null }} info
 */
export function buildMenu(info) {
  const {
    registry,
    botName = 'Xyvera MD',
    version = '0.0.0',
    ownerName = 'Owner',
    mode = 'public',
    prefix = '.',
    uptimeMs = 0,
    latencyMs = null,
  } = info;

  const lines = [];
  lines.push(`╭━━━〔 *${botName}* 〕━━━⬣`);
  lines.push(`┃ 👤 Owner  : ${ownerName}`);
  lines.push(`┃ 📌 Prefix : ${prefix}`);
  lines.push(`┃ 🕹️ Mode   : ${mode}`);
  lines.push(`┃ 📦 Version: v${version}`);
  lines.push(`┃ ⏱ Uptime  : ${formatUptime(uptimeMs)}`);
  if (latencyMs !== null && latencyMs !== undefined) lines.push(`┃ ⚡ Ping   : ${latencyMs}ms`);
  lines.push(`╰━━━━━━━━━━━━━━━━⬣\n`);

  const byCat = registry.byCategory();
  for (const [category, title] of Object.entries(CATEGORY_TITLES)) {
    const cmds = byCat.get(category) ?? [];
    if (cmds.length === 0) continue;
    lines.push(`╭━━━〔 ${title} 〕━━━⬣`);
    for (const cmd of cmds) {
      const badge = STATUS_BADGE[cmd.status] ?? '';
      const args = cmd.args ? ` ${cmd.args}` : '';
      const desc = cmd.description ? ` — ${cmd.description}` : '';
      lines.push(`┃ ${prefix}${cmd.name}${args}${badge}${desc}`);
    }
    lines.push(`╰━━━━━━━━━━━━━━━━⬣\n`);
  }

  lines.push(`_Generated from the live command registry._`);
  lines.push(`_⟡ = not fully functional yet — see ${prefix}commands for statuses._`);
  return lines.join('\n');
}

/** Status report of every registered command (for truthful reporting). */
export function buildCommandStatusList(registry, prefix = '.') {
  const groups = {
    [COMMAND_STATUS.IMPLEMENTED]: [],
    [COMMAND_STATUS.PARTIAL]: [],
    [COMMAND_STATUS.STUB]: [],
    [COMMAND_STATUS.PENDING]: [],
  };
  for (const cmd of registry.list()) {
    groups[cmd.status]?.push(cmd.name);
  }
  return [
    `*Command status* (from the registry)`,
    `✅ Implemented (${groups[COMMAND_STATUS.IMPLEMENTED].length}): ${groups[COMMAND_STATUS.IMPLEMENTED].join(', ') || '—'}`,
    `⟡ Partial (${groups[COMMAND_STATUS.PARTIAL].length}): ${groups[COMMAND_STATUS.PARTIAL].join(', ') || '—'}`,
    `🔧 Needs external setup (${groups[COMMAND_STATUS.STUB].length}): ${groups[COMMAND_STATUS.STUB].join(', ') || '—'}`,
    `🚧 Pending definition (${groups[COMMAND_STATUS.PENDING].length}): ${groups[COMMAND_STATUS.PENDING].join(', ') || '—'}`,
  ].join('\n');
}
