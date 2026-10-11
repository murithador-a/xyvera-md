/**
 * Declarative command registry. The menu is generated from this registry so
 * non-existent commands cannot be advertised. Every command carries a truthful
 * status: implemented | partial | stub-config-required | pending-definition.
 */

import { COMMAND_STATUS } from '../config/defaults.js';
import { ValidationError } from '../utils/errors.js';

export const CATEGORIES = Object.freeze([
  'owner',
  'group',
  'security',
  'automation',
  'games',
  'ai',
  'media',
  'utilities',
  'info',
]);

export class CommandRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this.commands = new Map();
    /** @type {Map<string, string>} alias -> name */
    this.aliases = new Map();
  }

  /**
   * @param {object} cmd
   *   name          'ping'
   *   aliases       ['p']
   *   category      one of CATEGORIES
   *   description   short menu text
   *   args          argument hint, e.g. '<user>'
   *   access        'everyone' | 'group-admin' | 'sudo' | 'owner'
   *   capability    sudo capability for 'sudo'/'group-admin' access (optional)
   *   groupOnly     boolean
   *   cooldownMs    number
   *   status        COMMAND_STATUS
   *   handler       async (ctx) => void
   */
  register(cmd) {
    if (!cmd?.name || typeof cmd.handler !== 'function') {
      throw new ValidationError('Command requires a name and handler.');
    }
    if (!CATEGORIES.includes(cmd.category)) {
      throw new ValidationError(`Command "${cmd.name}" has invalid category "${cmd.category}".`);
    }
    const status = cmd.status ?? COMMAND_STATUS.IMPLEMENTED;
    if (!Object.values(COMMAND_STATUS).includes(status)) {
      throw new ValidationError(`Command "${cmd.name}" has invalid status.`);
    }
    const entry = {
      aliases: [],
      description: '',
      args: '',
      access: 'everyone',
      capability: null,
      groupOnly: false,
      cooldownMs: 0,
      hidden: false,
      ...cmd,
      status,
    };
    if (this.commands.has(entry.name)) {
      throw new ValidationError(`Duplicate command "${entry.name}".`);
    }
    this.commands.set(entry.name, entry);
    for (const alias of entry.aliases ?? []) {
      const a = String(alias).toLowerCase();
      if (this.aliases.has(a) || this.commands.has(a)) {
        throw new ValidationError(`Duplicate alias "${a}".`);
      }
      this.aliases.set(a, entry.name);
    }
    return entry;
  }

  registerAll(cmds) {
    return cmds.map((c) => this.register(c));
  }

  /** Resolve a typed name/alias to a command entry. */
  get(name) {
    const n = String(name ?? '').toLowerCase();
    if (this.commands.has(n)) return this.commands.get(n);
    const viaAlias = this.aliases.get(n);
    return viaAlias ? this.commands.get(viaAlias) : undefined;
  }

  has(name) {
    return this.get(name) !== undefined;
  }

  list({ includeHidden = false } = {}) {
    return [...this.commands.values()].filter((c) => includeHidden || !c.hidden);
  }

  byCategory() {
    const out = new Map(CATEGORIES.map((c) => [c, []]));
    for (const cmd of this.list()) {
      out.get(cmd.category)?.push(cmd);
    }
    for (const arr of out.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  get size() {
    return this.commands.size;
  }
}
