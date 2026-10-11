import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JsonDocument } from '../src/storage/jsonStore.js';
import { PermissionService } from '../src/whatsapp/permissions.js';
import { defaultSettings, CAPABILITIES, ALL_CAPABILITIES } from '../src/config/defaults.js';

async function makePerms({ admins = new Set() } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-perm-'));
  const settings = new JsonDocument(path.join(dir, 'settings.json'), {
    defaults: () => ({
      ...defaultSettings(),
      ownerNumbers: ['15550000000@s.whatsapp.net'],
    }),
  });
  await settings.load();
  const perms = new PermissionService({
    settings,
    isGroupAdminFn: (g, u) => admins.has(`${g}|${u}`),
  });
  return { perms, settings, dir };
}

const OWNER = '15550000000@s.whatsapp.net';
const ALICE = '15550000001@s.whatsapp.net';
const BOB = '15550000002@s.whatsapp.net';
const GROUP = '120363000000000000@g.us';

test('owner detection uses configured numbers only', async () => {
  const { perms } = await makePerms();
  assert.equal(perms.isOwner(OWNER), true);
  assert.equal(perms.isOwner(ALICE), false);
  assert.equal(perms.ownerJids().length, 1);
});

test('ownerJids dedupes raw digits and JID forms of the same number', async () => {
  const { perms, settings } = await makePerms();
  // Settings may accumulate both '234…' and '234…@s.whatsapp.net' forms
  // (env merge + persisted values) — one human must never show twice.
  settings.update((s) => ({
    ...s,
    ownerNumbers: ['15550000000', '15550000000@s.whatsapp.net', '15550000001@s.whatsapp.net'],
  }));
  assert.equal(perms.ownerJids().length, 2);
  assert.equal(perms.isOwner('15550000000@s.whatsapp.net'), true);
  assert.equal(perms.isOwner('15550000000'), true);
});

test('sudo grant/revoke manages granular capabilities', async () => {
  const { perms } = await makePerms();
  perms.grantSudo(ALICE, [CAPABILITIES.GROUP_KICK, CAPABILITIES.GROUP_TAG], { grantedBy: OWNER });
  assert.equal(perms.isSudo(ALICE), true);
  assert.equal(perms.hasCapability(ALICE, CAPABILITIES.GROUP_KICK), true);
  assert.equal(perms.hasCapability(ALICE, CAPABILITIES.GROUP_TAG), true);
  assert.equal(perms.hasCapability(ALICE, CAPABILITIES.BOT_SETTINGS), false);

  perms.revokeSudo(ALICE, [CAPABILITIES.GROUP_KICK]);
  assert.equal(perms.hasCapability(ALICE, CAPABILITIES.GROUP_KICK), false);
  assert.equal(perms.hasCapability(ALICE, CAPABILITIES.GROUP_TAG), true);

  perms.removeSudo(ALICE);
  assert.equal(perms.isSudo(ALICE), false);
});

test('granting "all" gives exactly the known capability set', async () => {
  const { perms } = await makePerms();
  perms.grantSudo(ALICE, [...ALL_CAPABILITIES]);
  assert.equal(perms.getCapabilities(ALICE).length, ALL_CAPABILITIES.length);
});

test('unknown capabilities are rejected', async () => {
  const { perms } = await makePerms();
  assert.throws(() => perms.grantSudo(ALICE, ['not.a.capability']), /Unknown capability/);
});

test('bans control command access and persist', async () => {
  const { perms, settings } = await makePerms();
  perms.ban(BOB);
  assert.equal(perms.isBanned(BOB), true);
  assert.ok(settings.get().bans.includes(BOB));
  perms.unban(BOB);
  assert.equal(perms.isBanned(BOB), false);
});

test('mode persists and validates', async () => {
  const { perms, settings } = await makePerms();
  perms.setMode('private');
  assert.equal(perms.getMode(), 'private');
  assert.equal(settings.get().mode, 'private');
  assert.throws(() => perms.setMode('turbo'), /Mode must be/);
});

test('checkAccess: everyone passes in public mode', async () => {
  const { perms } = await makePerms();
  const res = await perms.checkAccess({ senderJid: ALICE, chatJid: GROUP, access: 'everyone' });
  assert.equal(res.allowed, true);
});

test('checkAccess: private mode blocks ordinary users silently', async () => {
  const { perms } = await makePerms();
  perms.setMode('private');
  const res = await perms.checkAccess({ senderJid: ALICE, chatJid: GROUP, access: 'everyone' });
  assert.equal(res.allowed, false);
  assert.equal(res.silent, true);
});

test('checkAccess: private mode allows sudo and owner', async () => {
  const { perms } = await makePerms();
  perms.setMode('private');
  perms.grantSudo(ALICE, [CAPABILITIES.GROUP_TAG]);
  assert.equal((await perms.checkAccess({ senderJid: ALICE, chatJid: GROUP, access: 'everyone' })).allowed, true);
  assert.equal((await perms.checkAccess({ senderJid: OWNER, chatJid: GROUP, access: 'everyone' })).allowed, true);
  assert.equal((await perms.checkAccess({ senderJid: BOB, chatJid: GROUP, access: 'everyone' })).allowed, false);
});

test('checkAccess: owner-only commands reject sudo users', async () => {
  const { perms } = await makePerms();
  perms.grantSudo(ALICE, [...ALL_CAPABILITIES]);
  const res = await perms.checkAccess({ senderJid: ALICE, chatJid: GROUP, access: 'owner' });
  assert.equal(res.allowed, false);
  assert.match(res.reason, /owner/i);
  assert.equal((await perms.checkAccess({ senderJid: OWNER, chatJid: GROUP, access: 'owner' })).allowed, true);
});

test('checkAccess: sudo capability commands require the matching capability', async () => {
  const { perms } = await makePerms();
  perms.grantSudo(ALICE, [CAPABILITIES.GROUP_TAG]);
  const withCap = await perms.checkAccess({
    senderJid: ALICE, chatJid: GROUP, access: 'sudo', capability: CAPABILITIES.GROUP_TAG,
  });
  const withoutCap = await perms.checkAccess({
    senderJid: ALICE, chatJid: GROUP, access: 'sudo', capability: CAPABILITIES.BOT_SETTINGS,
  });
  assert.equal(withCap.allowed, true);
  assert.equal(withoutCap.allowed, false);
  assert.match(withoutCap.reason, /bot\.settings/);
});

test('checkAccess: group-admin commands allow real group admins', async () => {
  const { perms } = await makePerms({ admins: new Set([`${GROUP}|${ALICE}`]) });
  const res = await perms.checkAccess({
    senderJid: ALICE, chatJid: GROUP, access: 'group-admin', capability: CAPABILITIES.GROUP_KICK, groupOnly: true,
  });
  assert.equal(res.allowed, true);
});

test('checkAccess: group-admin commands allow sudo with the matching capability', async () => {
  const { perms } = await makePerms();
  perms.grantSudo(BOB, [CAPABILITIES.GROUP_KICK]);
  const res = await perms.checkAccess({
    senderJid: BOB, chatJid: GROUP, access: 'group-admin', capability: CAPABILITIES.GROUP_KICK, groupOnly: true,
  });
  assert.equal(res.allowed, true);
});

test('checkAccess: banned users are denied silently even as owner?? no — ban list wins', async () => {
  const { perms } = await makePerms();
  // sanity: owner cannot be blocked by ban of someone else
  perms.ban(BOB);
  const res = await perms.checkAccess({ senderJid: BOB, chatJid: GROUP, access: 'everyone' });
  assert.equal(res.allowed, false);
  assert.equal(res.silent, true);
  assert.equal((await perms.checkAccess({ senderJid: OWNER, chatJid: GROUP, access: 'everyone' })).allowed, true);
});

test('checkAccess: groupOnly rejects usage in private chats', async () => {
  const { perms } = await makePerms();
  const res = await perms.checkAccess({
    senderJid: ALICE, chatJid: ALICE, access: 'everyone', groupOnly: true,
  });
  assert.equal(res.allowed, false);
  assert.match(res.reason, /groups/i);
});

test('bot self (authenticated device) is owner-equivalent', async () => {
  const { perms } = await makePerms();
  const BOT = '15550000000@s.whatsapp.net';
  assert.equal(perms.isOwnerOrSelf(BOT, BOT), true);
  assert.equal(perms.isOwnerOrSelf(ALICE, BOT), false);
});

test('identity never comes from display names — only JIDs', async () => {
  const { perms } = await makePerms();
  // A JID that merely *looks* like the owner string in another namespace is not owner
  assert.equal(perms.isOwner('15550000000@lid'), false);
  assert.equal(perms.isOwner(OWNER), true);
});
