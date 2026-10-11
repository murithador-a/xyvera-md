import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderTemplate, templatePlaceholders } from '../src/utils/templates.js';

test('renders known placeholders', () => {
  const { text, missing } = renderTemplate('Welcome {user} to {group}!', {
    user: '@alice',
    group: 'Cool Group',
  });
  assert.equal(text, 'Welcome @alice to Cool Group!');
  assert.deepEqual(missing, []);
});

test('missing placeholders are left visible and reported', () => {
  const { text, missing } = renderTemplate('Hi {user}, welcome to {group}', { user: '@bob' });
  assert.equal(text, 'Hi @bob, welcome to {group}');
  assert.deepEqual(missing, ['group']);
});

test('double braces escape to literal braces', () => {
  const { text, missing } = renderTemplate('use {{user}} for the name, {user}', { user: '@x' });
  assert.equal(text, 'use {user} for the name, @x');
  assert.deepEqual(missing, []);
});

test('special characters in values are preserved', () => {
  const { text } = renderTemplate('Hello {user}', { user: '@a "quoted" <tag> \\ 🎉' });
  assert.equal(text, 'Hello @a "quoted" <tag> \\ 🎉');
});

test('null/undefined vars render as missing, empty string renders empty', () => {
  const r1 = renderTemplate('{a}|{b}', { a: null, b: '' });
  assert.equal(r1.text, '{a}|');
  assert.deepEqual(r1.missing, ['a']);
});

test('templatePlaceholders lists placeholder names', () => {
  assert.deepEqual(templatePlaceholders('{user} and {group} and {user}').sort(), ['group', 'user']);
});

test('non-string template input does not crash', () => {
  const { text } = renderTemplate(undefined, {});
  assert.equal(text, '');
});
