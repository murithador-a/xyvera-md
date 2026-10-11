import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePhone,
  phoneToJid,
  normalizeJid,
  validatePrefix,
  extractLinks,
  extractDomain,
  domainAllowed,
  isSafePublicUrl,
  escapeRegex,
} from '../src/utils/validators.js';

test('normalizePhone strips formatting and validates', () => {
  assert.equal(normalizePhone('+1 (555) 123-4567'), '15551234567');
  assert.equal(normalizePhone('15551234567'), '15551234567');
  assert.throws(() => normalizePhone('abc'), /Invalid phone/);
  assert.throws(() => normalizePhone('12'), /Invalid phone/);
  assert.throws(() => normalizePhone(null));
});

test('phoneToJid builds a WhatsApp user JID', () => {
  assert.equal(phoneToJid('15551234567'), '15551234567@s.whatsapp.net');
});

test('normalizeJid strips device suffixes and normalizes bare numbers', () => {
  assert.equal(normalizeJid('15551234567:12@s.whatsapp.net'), '15551234567@s.whatsapp.net');
  assert.equal(normalizeJid('15551234567'), '15551234567@s.whatsapp.net');
  assert.equal(normalizeJid('120363000000000000@g.us'), '120363000000000000@g.us');
  assert.equal(normalizeJid(''), null);
  assert.equal(normalizeJid(null), null);
});

test('validatePrefix rejects empty, long, word-like, and whitespace prefixes', () => {
  assert.equal(validatePrefix('.'), '.');
  assert.equal(validatePrefix('!'), '!');
  assert.equal(validatePrefix('>>'), '>>');
  assert.throws(() => validatePrefix(''), /empty/);
  assert.throws(() => validatePrefix('....'), /1–3|1-3/);
  assert.throws(() => validatePrefix('a'), /letters or digits/);
  assert.throws(() => validatePrefix('. '), /whitespace/);
});

test('extractLinks detects real links in common formats', () => {
  const links = extractLinks('check https://example.com/path and www.foo.org/x and bar.io/hi');
  const domains = links.map((l) => l.domain);
  assert.ok(domains.includes('example.com'));
  assert.ok(domains.includes('foo.org'));
  assert.ok(domains.includes('bar.io'));
});

test('extractLinks avoids false positives: file names, versions, emails', () => {
  assert.equal(extractLinks('see my notes.txt and photo.png').length, 0);
  assert.equal(extractLinks('released v1.2.3 today').length, 0);
  assert.equal(extractLinks('mail me at bob@example.com').length, 0);
  assert.equal(extractLinks('the e.g. problem').length, 0);
  assert.equal(extractLinks('Mr. Smith went to Washington.').length, 0);
});

test('extractLinks strips trailing punctuation', () => {
  const links = extractLinks('go to https://example.com/page.');
  assert.equal(links[0].raw, 'https://example.com/page');
});

test('extractDomain and domainAllowed handle subdomains and schemes', () => {
  assert.equal(extractDomain('https://www.Example.com/path?q=1'), 'example.com');
  assert.equal(extractDomain('sub.example.com'), 'sub.example.com');
  assert.ok(domainAllowed('chat.whatsapp.com', ['whatsapp.com']));
  assert.ok(domainAllowed('example.com', ['example.com']));
  assert.ok(!domainAllowed('badexample.com', ['example.com']));
  assert.ok(domainAllowed('x.example.com', ['.example.com']));
});

test('isSafePublicUrl blocks private/internal targets (SSRF guard)', () => {
  assert.equal(isSafePublicUrl('https://example.com/page').ok, true);
  assert.equal(isSafePublicUrl('http://localhost:8080').ok, false);
  assert.equal(isSafePublicUrl('http://127.0.0.1/admin').ok, false);
  assert.equal(isSafePublicUrl('http://192.168.1.10').ok, false);
  assert.equal(isSafePublicUrl('http://10.0.0.5').ok, false);
  assert.equal(isSafePublicUrl('http://172.16.0.1').ok, false);
  assert.equal(isSafePublicUrl('file:///etc/passwd').ok, false);
  assert.equal(isSafePublicUrl('not a url').ok, false);
  assert.equal(isSafePublicUrl('http://foo.internal').ok, false);
});

test('escapeRegex escapes metacharacters', () => {
  const re = new RegExp(escapeRegex('a.b*c'));
  assert.ok(re.test('a.b*c'));
  assert.ok(!re.test('aXbYc'));
});
