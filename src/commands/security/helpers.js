/** Helpers for security commands. */

import { extractDomain as _extractDomain, normalizeJid } from '../../utils/validators.js';

export function extractDomain(input) {
  return _extractDomain(input);
}

export function displayJidSafe(jid) {
  return String(jid ?? '').split('@')[0];
}

export { normalizeJid };
