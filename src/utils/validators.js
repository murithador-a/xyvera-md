/**
 * Validation and normalization helpers. Pure — no WhatsApp library imports.
 */

import { ValidationError } from './errors.js';

const PHONE_RE = /^\d{5,20}$/;
const JID_RE = /^[\w.-]+(@(?:s\.whatsapp\.net|g\.us|lid|newsletter|broadcast))?$/i;

/** Strip a phone number down to digits; rejects junk. */
export function normalizePhone(input) {
  if (input === null || input === undefined) throw new ValidationError('A phone number is required.');
  const digits = String(input).replace(/[^\d]/g, '');
  if (!PHONE_RE.test(digits)) {
    throw new ValidationError('Invalid phone number. Use international format, digits only (e.g. 15551234567).');
  }
  return digits;
}

export function phoneToJid(input) {
  return `${normalizePhone(input)}@s.whatsapp.net`;
}

export function jidToPhone(jid) {
  const s = String(jid ?? '');
  return s.split('@')[0].replace(/[^\d]/g, '');
}

/** Canonicalize a JID for identity comparisons (lowercase, strip device suffix). */
export function normalizeJid(jid) {
  if (!jid || typeof jid !== 'string') return null;
  let s = jid.trim().toLowerCase();
  // Strip device suffix: 123:4@s.whatsapp.net -> 123@s.whatsapp.net
  s = s.replace(/:\d+@/, '@');
  if (!s.includes('@')) {
    // Bare number -> assume WhatsApp user
    const digits = s.replace(/[^\d]/g, '');
    return digits ? `${digits}@s.whatsapp.net` : null;
  }
  if (!JID_RE.test(s)) return null;
  return s;
}

export function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

export function isUserJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid'));
}

export function isStatusJid(jid) {
  return jid === 'status@broadcast';
}

/** Validate a command prefix: 1–3 characters, no whitespace, no letters/digits. */
export function validatePrefix(prefix) {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new ValidationError('Prefix must not be empty.');
  }
  if (prefix.length > 3) {
    throw new ValidationError('Prefix must be 1–3 characters.');
  }
  if (/\s/.test(prefix)) {
    throw new ValidationError('Prefix must not contain whitespace.');
  }
  if (/[a-z0-9]/i.test(prefix)) {
    throw new ValidationError('Prefix must not contain letters or digits (it would collide with normal words).');
  }
  return prefix;
}

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Domains that end with these "TLDs" are never treated as links (file names etc.). */
const FILE_EXT_TLDS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html', 'php', 'rb', 'go', 'rs',
  'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'log', 'md', 'txt', 'csv', 'sql',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'mp3', 'mp4', 'm4a', 'wav', 'ogg',
  'flac', 'avi', 'mkv', 'mov', 'webm', 'zip', 'rar', '7z', 'tar', 'gz', 'pdf', 'doc', 'docx',
  'xls', 'xlsx', 'ppt', 'pptx', 'exe', 'dll', 'bat', 'sh', 'apk', 'ipa', 'iso', 'img', 'ttf',
  'otf', 'woff', 'woff2', 'env', 'example', 'sample', 'test', 'spec', 'map', 'lock',
]);

// Common real TLDs — scheme-less detection only treats a domain as a link when the
// pseudo-TLD is in this set (plus explicit scheme / www. forms). Documented limitation.
const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'io', 'ai', 'app', 'dev', 'co', 'me', 'tv',
  'gg', 'xyz', 'info', 'biz', 'online', 'site', 'store', 'shop', 'link', 'live', 'chat', 'club',
  'fun', 'icu', 'top', 'pro', 'us', 'uk', 'ca', 'de', 'fr', 'nl', 'it', 'es', 'pt', 'br', 'mx',
  'ar', 'in', 'id', 'ng', 'za', 'ke', 'au', 'nz', 'jp', 'kr', 'cn', 'ru', 'tr', 'pl', 'se',
  'no', 'fi', 'dk', 'be', 'ch', 'at', 'ie', 'sg', 'my', 'ph', 'pk', 'bd', 'vn', 'th', 'ae',
  'sa', 'eg', 'ma', 'gh', 'tz', 'ug', 'zm', 'zw', 'cm', 'ci', 'sn', 'mz', 'ao', 'ml', 'wiki',
  'blog', 'cloud', 'tech', 'digital', 'space', 'page', 'ly', 'gl', 'be', 'to', 'cc', 'ws', 'fm',
  'am', 'sh', 'so', 'tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'one', 'team', 'group', 'life', 'news',
]);

/**
 * Extract link-like matches from text.
 * Detects http(s)/ftp URLs, www. hosts, and scheme-less domains with known TLDs.
 * Avoids treating every dotted word as a URL (file extensions, version numbers, emails).
 * @returns {{ raw: string, domain: string, scheme: string|null }[]}
 */
export function extractLinks(text) {
  if (typeof text !== 'string' || !text) return [];
  const results = [];
  const seen = new Set();

  const add = (raw, scheme) => {
    const cleaned = raw.replace(/[.,;:!?)\]}'"…]+$/, '');
    if (!cleaned || seen.has(cleaned)) return;
    const domain = extractDomain(cleaned);
    if (!domain) return;
    seen.add(cleaned);
    results.push({ raw: cleaned, domain, scheme: scheme ?? null });
  };

  // 1. Explicit schemes
  const schemeRe = /\b((?:https?|ftp):\/\/[^\s<>"']+)/gi;
  for (const m of text.matchAll(schemeRe)) add(m[1], m[1].split('://')[0].toLowerCase());

  // 2. www. hosts
  const wwwRe = /\b(www\.[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/[^\s<>"']*)?)/gi;
  for (const m of text.matchAll(wwwRe)) add(m[1], null);

  // 3. Scheme-less domains with known TLDs (optional path)
  const bareRe = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24})(?::\d{1,5})?(?:\/[^\s<>"']*)?/gi;
  for (const m of text.matchAll(bareRe)) {
    const tld = m[1].toLowerCase();
    if (FILE_EXT_TLDS.has(tld) && !KNOWN_TLDS.has(tld)) continue;
    if (!KNOWN_TLDS.has(tld)) continue;
    // Skip if this exact span was already captured via scheme/www (overlap)
    const raw = m[0];
    const already = results.some((r) => r.raw.includes(raw) || raw.includes(r.raw));
    if (!already) add(raw, null);
  }

  // Filter out email local-parts: drop matches immediately preceded by '@'
  return results.filter((r) => {
    const idx = text.indexOf(r.raw);
    return idx <= 0 || text[idx - 1] !== '@';
  });
}

/** Extract a comparable domain from a URL-ish string (strips scheme, www, path, port). */
export function extractDomain(link) {
  let s = String(link).trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.split(':')[0];
  if (s.startsWith('www.')) s = s.slice(4);
  if (!s || !s.includes('.')) return null;
  return s;
}

/**
 * Whether a domain matches an allowlist entry: exact or subdomain-of.
 * Entries like `example.com` match `a.example.com`; entries may start with '.' for
 * explicit subdomain-only matching.
 */
export function domainAllowed(domain, allowList = []) {
  const d = extractDomain(domain);
  if (!d) return false;
  return allowList.some((entry) => {
    let e = String(entry ?? '').trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith('.')) return d.endsWith(e) || d === e.slice(1);
    return d === e || d.endsWith(`.${e}`);
  });
}

const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|.*\.local|.*\.internal|.*\.localhost)$/i;

/**
 * SSRF guard for URL-consuming commands (.screenshot etc.).
 * Blocks non-http(s) schemes, local/loopback/private IPs, and internal hostnames.
 */
export function isSafePublicUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) URLs are allowed.' };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST_RE.test(host)) {
    return { ok: false, reason: 'Local or private network addresses are not allowed.' };
  }
  // Literal IPv6 private ranges
  if (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) {
    return { ok: false, reason: 'Local or private network addresses are not allowed.' };
  }
  return { ok: true, url };
}

/** Basic sanity for user-supplied text fields (welcome templates etc.). */
export function validateText(input, { min = 1, max = 2000, label = 'Text' } = {}) {
  const s = String(input ?? '');
  if (s.length < min) throw new ValidationError(`${label} must be at least ${min} character(s).`);
  if (s.length > max) throw new ValidationError(`${label} must be at most ${max} characters.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) {
    throw new ValidationError(`${label} contains invalid control characters.`);
  }
  return s;
}

export function validateEmoji(input) {
  const s = String(input ?? '').trim();
  if (!s || s.length > 8) throw new ValidationError('Please provide a single emoji.');
  return s;
}
