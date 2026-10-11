/**
 * Document schemas and validators for persisted JSON collections.
 * Validation is strict on structure but forward-compatible: unknown fields are
 * preserved, missing fields fall back to safe defaults.
 */

import {
  SCHEMA_VERSION,
  ANTI_LINK_ACTION_LIST,
  MODERATION_RESPONSES,
  ALL_CAPABILITIES,
  defaultGroupConfig,
  defaultSettings,
} from '../config/defaults.js';
import { normalizeJid } from '../utils/validators.js';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function check(cond, errors, msg) {
  if (!cond) errors.push(msg);
  return cond;
}

/**
 * Deep-merge `value` over `defaults` (arrays and scalars replaced, objects merged).
 * Used to make loaded documents forward/backward compatible.
 */
export function mergeDefaults(defaults, value) {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults.slice();
  if (isPlainObject(defaults)) {
    const out = {};
    const src = isPlainObject(value) ? value : {};
    for (const k of new Set([...Object.keys(defaults), ...Object.keys(src)])) {
      if (k in defaults) out[k] = mergeDefaults(defaults[k], src[k]);
      else out[k] = src[k]; // preserve unknown fields
    }
    return out;
  }
  return value === undefined ? defaults : value;
}

export function validateSettings(doc) {
  const errors = [];
  if (!isPlainObject(doc)) return { ok: false, errors: ['settings must be an object'] };
  check(typeof doc.prefix === 'string' && doc.prefix.length >= 1 && doc.prefix.length <= 3, errors, 'prefix must be a 1-3 char string');
  check(doc.mode === 'public' || doc.mode === 'private', errors, 'mode must be public|private');
  check(typeof doc.botName === 'string' && doc.botName.length > 0, errors, 'botName required');
  check(Array.isArray(doc.ownerNumbers), errors, 'ownerNumbers must be an array');
  check(isPlainObject(doc.sudo), errors, 'sudo must be an object');
  check(Array.isArray(doc.bans), errors, 'bans must be an array');
  return { ok: errors.length === 0, errors };
}

export function normalizeSettings(doc) {
  const merged = mergeDefaults(defaultSettings(), doc);
  // Normalize JID keys in sudo / bans
  const sudo = {};
  for (const [jid, entry] of Object.entries(merged.sudo ?? {})) {
    const nj = normalizeJid(jid);
    if (!nj || !isPlainObject(entry)) continue;
    const caps = (Array.isArray(entry.capabilities) ? entry.capabilities : []).filter((c) =>
      ALL_CAPABILITIES.includes(c),
    );
    sudo[nj] = {
      capabilities: caps,
      grantedAt: entry.grantedAt ?? null,
      grantedBy: entry.grantedBy ?? null,
    };
  }
  merged.sudo = sudo;
  merged.bans = [...new Set((merged.bans ?? []).map(normalizeJid).filter(Boolean))];
  merged.schemaVersion = SCHEMA_VERSION;
  return merged;
}

export function validateGroupConfig(doc) {
  const errors = [];
  if (!isPlainObject(doc)) return { ok: false, errors: ['group config must be an object'] };
  check(typeof doc.welcome === 'object' && typeof doc.welcome.enabled === 'boolean', errors, 'welcome.enabled must be boolean');
  check(typeof doc.goodbye === 'object' && typeof doc.goodbye.enabled === 'boolean', errors, 'goodbye.enabled must be boolean');
  check(typeof doc.antiLink === 'object' && typeof doc.antiLink.enabled === 'boolean', errors, 'antiLink.enabled must be boolean');
  if (doc.antiLink && doc.antiLink.action !== undefined) {
    check(ANTI_LINK_ACTION_LIST.includes(doc.antiLink.action), errors, `antiLink.action must be one of ${ANTI_LINK_ACTION_LIST.join(', ')}`);
  }
  if (doc.antiTag && doc.antiTag.response !== undefined) {
    check(Object.values(MODERATION_RESPONSES).includes(doc.antiTag.response), errors, 'antiTag.response invalid');
  }
  if (doc.antiBadWord && doc.antiBadWord.response !== undefined) {
    check(Object.values(MODERATION_RESPONSES).includes(doc.antiBadWord.response), errors, 'antiBadWord.response invalid');
  }
  if (doc.warnings && doc.warnings.actionOnThreshold !== undefined) {
    check(['none', 'kick'].includes(doc.warnings.actionOnThreshold), errors, 'warnings.actionOnThreshold must be none|kick');
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeGroupConfig(doc) {
  const merged = mergeDefaults(defaultGroupConfig(), doc ?? {});
  merged.schemaVersion = SCHEMA_VERSION;
  // Sanitize collections
  merged.antiLink.allowDomains = [...new Set((merged.antiLink.allowDomains ?? []).map((x) => String(x).toLowerCase().trim()).filter(Boolean))];
  merged.antiLink.exemptUsers = [...new Set((merged.antiLink.exemptUsers ?? []).map(normalizeJid).filter(Boolean))];
  merged.antiBadWord.words = [...new Set((merged.antiBadWord.words ?? []).map((w) => String(w).toLowerCase().trim()).filter(Boolean))];
  if (!ANTI_LINK_ACTION_LIST.includes(merged.antiLink.action)) merged.antiLink.action = 'delete';
  if (!Array.isArray(merged.moderationLog)) merged.moderationLog = [];
  return merged;
}

export function validateWarnings(doc) {
  const errors = [];
  if (!isPlainObject(doc)) return { ok: false, errors: ['warnings doc must be an object'] };
  check(isPlainObject(doc.groups), errors, 'warnings.groups must be an object');
  return { ok: errors.length === 0, errors };
}

export function validateStatus(doc) {
  const errors = [];
  if (!isPlainObject(doc)) return { ok: false, errors: ['status doc must be an object'] };
  check(typeof doc.autoview === 'boolean', errors, 'autoview must be boolean');
  check(typeof doc.autoreact === 'boolean', errors, 'autoreact must be boolean');
  return { ok: errors.length === 0, errors };
}
