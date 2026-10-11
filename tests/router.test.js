import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHarness } from './helpers/harness.js';
import { safeCalc } from '../src/commands/utilities/index.js';

const OWNER = '15550000000@s.whatsapp.net';
const ALICE = '15550000001@s.whatsapp.net';
const BOB = '15550000002@s.whatsapp.net';
const G = '120363000000000000@g.us';

async function harnessWith({ owner = '15550000000', ...rest } = {}) {
  return createHarness({
    env: { OWNER_NUMBERS: owner },
    ...rest,
  });
}

test('unknown commands are ignored (not replied to)', async () => {
  const h = await harnessWith();
  const res = await h.dispatch('.definitelynotacommand', { senderJid: ALICE });
  assert.equal(res.handled, false);
  assert.equal(res.reason, 'unknown-command');
  assert.equal(h.lastSent(), null);
  await h.cleanup();
});

test('non-command messages are ignored', async () => {
  const h = await harnessWith();
  const res = await h.dispatch('hello everyone', { senderJid: ALICE });
  assert.equal(res.reason, 'not-a-command');
  await h.cleanup();
});

test('public mode: ordinary users can use general commands', async () => {
  const h = await harnessWith();
  const res = await h.dispatch('.ping', { senderJid: ALICE });
  assert.equal(res.handled, true);
  assert.match(h.lastSent().text, /Pong/);
  await h.cleanup();
});

test('private mode: ordinary users are silently ignored; owner still works', async () => {
  const h = await harnessWith();
  await h.dispatch('.mode private', { senderJid: OWNER });
  h.client.sent.length = 0;
  const denied = await h.dispatch('.ping', { senderJid: ALICE });
  assert.equal(denied.handled, false);
  assert.equal(denied.reason, 'denied-silent');
  assert.equal(h.lastSent(), null);

  const allowed = await h.dispatch('.ping', { senderJid: OWNER });
  assert.equal(allowed.handled, true);
  await h.cleanup();
});

test('private mode: owner can always restore public mode', async () => {
  const h = await harnessWith();
  await h.dispatch('.mode private', { senderJid: OWNER });
  const res = await h.dispatch('.mode public', { senderJid: OWNER });
  assert.equal(res.handled, true);
  assert.equal(h.app.permissions.getMode(), 'public');
  await h.cleanup();
});

test('owner-only commands reject ordinary users and sudo users', async () => {
  const h = await harnessWith();
  // give Alice every sudo capability — she still must not run owner commands
  await h.dispatch('.addsudo 15550000001 all', { senderJid: OWNER });
  const denied = await h.dispatch('.mode private', { senderJid: ALICE });
  assert.equal(denied.reason, 'denied'); // denial reply was sent
  assert.match(h.lastSent().text, /owner/i);

  // owner mode change still works
  const ok = await h.dispatch('.mode private', { senderJid: OWNER });
  assert.equal(ok.handled, true);
  await h.cleanup();
});

test('sudo capability grants are granular', async () => {
  const h = await harnessWith();
  await h.dispatch('.addsudo 15550000001 group.tag', { senderJid: OWNER });

  // group.tag allows .tagall (Alice is not a group admin)
  h.client.admins.delete(`${h.groupJid}|${ALICE}`);
  const tagged = await h.dispatch('.tagall hello', { senderJid: ALICE });
  assert.equal(tagged.handled, true);
  assert.match(h.lastSent().text, /hello/);

  // but not .warn (needs security.manage)
  const warn = await h.dispatch('.warn @15550000002 spam', { senderJid: ALICE, mentions: [BOB] });
  assert.match(h.lastSent().text, /sudo capability|group admin/i);
  await h.cleanup();
});

test('delsudo revokes capabilities', async () => {
  const h = await harnessWith();
  await h.dispatch('.addsudo 15550000001 all', { senderJid: OWNER });
  await h.dispatch('.delsudo 15550000001 all', { senderJid: OWNER });
  assert.equal(h.app.permissions.isSudo(ALICE), false);
  await h.cleanup();
});

test('ban blocks command usage silently; unban restores it (never kicks)', async () => {
  const h = await harnessWith();
  await h.dispatch('.ban 15550000002', { senderJid: OWNER });
  const denied = await h.dispatch('.ping', { senderJid: BOB });
  assert.equal(denied.handled, false);
  assert.equal(denied.reason, 'denied-silent');
  // no kick happened
  assert.equal(h.client.calls.find((c) => c.name === 'kickParticipant'), undefined);

  await h.dispatch('.unban 15550000002', { senderJid: OWNER });
  const ok = await h.dispatch('.ping', { senderJid: BOB });
  assert.equal(ok.handled, true);
  await h.cleanup();
});

test('group-only commands reject private chats', async () => {
  const h = await harnessWith();
  const res = await h.dispatch('.gcstatus', { senderJid: ALICE, chatJid: ALICE, isGroup: false });
  assert.equal(res.reason, 'denied');
  assert.match(h.lastSent(ALICE).text, /groups/i);
  await h.cleanup();
});

test('group admin validation uses real admin status, not claims', async () => {
  const h = await harnessWith();
  // Alice is admin in the fake metadata
  const ok = await h.dispatch('.setname New Name', { senderJid: ALICE });
  assert.equal(ok.handled, true);
  assert.ok(h.client.calls.find((c) => c.name === 'setGroupSubject'));

  // Bob is not an admin
  h.client.sent.length = 0;
  const denied = await h.dispatch('.setname Hack', { senderJid: BOB });
  assert.match(h.lastSent().text, /admin/i);
  assert.equal(h.client.calls.find((c) => c.name === 'setGroupSubject' && c.args[1] === 'Hack'), undefined);
  await h.cleanup();
});

test('.revoke requires a confirmation and only the same user can confirm', async () => {
  const h = await harnessWith();
  await h.dispatch('.revoke', { senderJid: ALICE });
  assert.match(h.lastSent().text, /confirm/i);
  assert.equal(h.client.calls.find((c) => c.name === 'revokeInvite'), undefined);

  // Bob cannot confirm Alice's action
  await h.dispatch('.confirm', { senderJid: BOB });
  assert.equal(h.client.calls.find((c) => c.name === 'revokeInvite'), undefined);

  // Alice confirms → link revoked
  await h.dispatch('.confirm', { senderJid: ALICE });
  assert.ok(h.client.calls.find((c) => c.name === 'revokeInvite'));
  await h.cleanup();
});

test('.revoke alone NEVER resets the link', async () => {
  const h = await harnessWith();
  await h.dispatch('.revoke', { senderJid: ALICE });
  await h.dispatch('.revoke', { senderJid: ALICE });
  await h.dispatch('yes please', { senderJid: ALICE }); // plain text is not a confirm
  assert.equal(h.client.calls.find((c) => c.name === 'revokeInvite'), undefined);
  await h.cleanup();
});

test('.cancel aborts a pending destructive action', async () => {
  const h = await harnessWith();
  await h.dispatch('.revoke', { senderJid: ALICE });
  await h.dispatch('.cancel', { senderJid: ALICE });
  await h.dispatch('.confirm', { senderJid: ALICE });
  assert.equal(h.client.calls.find((c) => c.name === 'revokeInvite'), undefined);
  await h.cleanup();
});

test('.leavegc is owner-only and confirm-gated', async () => {
  const h = await harnessWith();
  const denied = await h.dispatch('.leavegc', { senderJid: ALICE });
  assert.match(h.lastSent().text, /owner/i);
  assert.equal(h.client.calls.find((c) => c.name === 'leaveGroup'), undefined);

  await h.dispatch('.leavegc', { senderJid: OWNER });
  assert.match(h.lastSent().text, /confirm/i);
  assert.equal(h.client.calls.find((c) => c.name === 'leaveGroup'), undefined);

  await h.dispatch('.confirm', { senderJid: OWNER });
  assert.ok(h.client.calls.find((c) => c.name === 'leaveGroup'));
  await h.cleanup();
});

test('.clearsession warns and is confirm-gated', async () => {
  const h = await harnessWith();
  const denied = await h.dispatch('.clearsession', { senderJid: ALICE });
  assert.match(h.lastSent().text, /owner/i);

  await h.dispatch('.clearsession', { senderJid: OWNER });
  assert.match(h.lastSent().text, /DANGER|disconnect/i);
  await h.cleanup();
});

test('welcome/goodbye toggle per group only', async () => {
  const h = await harnessWith();
  await h.dispatch('.welcome on', { senderJid: ALICE });
  const gc = h.app.store.groups.get(h.groupJid);
  assert.equal(gc.welcome.enabled, true);
  assert.equal(gc.goodbye.enabled, false);

  // second group unaffected
  const g2 = '120363000000000099@g.us';
  h.client.addGroup(g2, { subject: 'Other', participants: [{ jid: ALICE, admin: 'admin' }] });
  await h.dispatch('.gcstatus', { senderJid: ALICE, chatJid: g2 });
  const gc2 = h.app.store.groups.get(g2);
  assert.equal(gc2.welcome.enabled, false);
  await h.cleanup();
});

test('.setwelcome saves template; .testwelcome previews with substitution', async () => {
  const h = await harnessWith();
  await h.dispatch('.setwelcome Hi {user}, welcome to {group}!', { senderJid: ALICE });
  await h.dispatch('.testwelcome', { senderJid: ALICE });
  const sent = h.lastSent().text;
  assert.match(sent, /Hi @15550000001, welcome to Test Group!/);
  await h.cleanup();
});

test('anti-link end-to-end: group config drives enforcement in chat', async () => {
  const h = await harnessWith();
  await h.dispatch('.antilink on', { senderJid: ALICE });
  await h.dispatch('.antilink action delete-warn', { senderJid: ALICE });

  const msg = { text: 'check https://spam.com', senderJid: BOB, messageId: 'e2e_msg_1' };
  await h.app.moderation.handleMessage(
    { ...msg, chatJid: h.groupJid, isGroup: true, senderIsAdmin: false },
    h.client,
  );
  assert.ok(h.client.calls.find((c) => c.name === 'deleteMessage'));
  assert.equal(h.app.warnings.state(h.groupJid, BOB).active, 1);
  await h.cleanup();
});

test('numeric anti-link aliases are rejected pending approval', async () => {
  const h = await harnessWith();
  await h.dispatch('.antilink on', { senderJid: ALICE });
  await h.dispatch('.antilink action 3', { senderJid: ALICE });
  assert.match(h.lastSent().text, /pending owner approval/i);
  // action unchanged
  assert.equal(h.app.store.groups.get(h.groupJid).antiLink.action, 'delete');
  await h.cleanup();
});

test('named anti-link actions apply; invalid ones rejected', async () => {
  const h = await harnessWith();
  await h.dispatch('.antilink on', { senderJid: ALICE });
  await h.dispatch('.antilink action escalate', { senderJid: ALICE });
  assert.equal(h.app.store.groups.get(h.groupJid).antiLink.action, 'escalate');
  await h.dispatch('.antilink action delete-kick', { senderJid: ALICE });
  assert.equal(h.app.store.groups.get(h.groupJid).antiLink.action, 'delete-kick');
  h.client.sent.length = 0;
  await h.dispatch('.antilink action nonsense', { senderJid: ALICE });
  assert.match(h.lastSent().text, /Unknown action/i);
  await h.cleanup();
});

test('warn/warnings/delwarn/resetwarn flow with thresholds', async () => {
  const h = await harnessWith();
  await h.dispatch('.warn 15550000002 first', { senderJid: ALICE });
  assert.equal(h.app.warnings.state(h.groupJid, BOB).active, 1);

  await h.dispatch('.warnings 15550000002', { senderJid: BOB });
  assert.match(h.lastSent().text, /Active: 1/);

  await h.dispatch('.delwarn 15550000002', { senderJid: ALICE });
  assert.equal(h.app.warnings.state(h.groupJid, BOB).active, 0);

  await h.dispatch('.warn 15550000002 a', { senderJid: ALICE });
  await h.dispatch('.warn 15550000002 b', { senderJid: ALICE });
  await h.dispatch('.resetwarn 15550000002', { senderJid: ALICE });
  const state = h.app.warnings.state(h.groupJid, BOB);
  assert.equal(state.active, 0);
  assert.ok(state.history.length >= 3); // history retained
  await h.cleanup();
});

test('menu is generated from the registry and includes runtime values', async () => {
  const h = await harnessWith();
  await h.dispatch('.menu', { senderJid: ALICE });
  const menu = h.lastSent().text;
  assert.match(menu, /Xyvera MD/);
  assert.match(menu, /Owner/);
  assert.match(menu, /Group Management/);
  assert.match(menu, /Uptime/);
  assert.match(menu, /\.ping/);
  assert.match(menu, /\.kick/);
  // every command listed exists in the registry
  const listed = [...menu.matchAll(/┃ \.([a-z0-9]+)/g)].map((m) => m[1]);
  assert.ok(listed.length > 20);
  for (const name of listed) {
    assert.ok(h.app.registry.get(name), `menu listed unregistered command: ${name}`);
  }
  await h.cleanup();
});

test('.commands reports truthful statuses including stubs and pending', async () => {
  const h = await harnessWith();
  await h.dispatch('.commands', { senderJid: ALICE });
  const text = h.lastSent().text;
  assert.match(text, /Implemented/);
  assert.match(text, /Needs external setup/);
  assert.match(text, /Pending definition/);
  assert.match(text, /ghost/); // .ghost is registered as pending
  await h.cleanup();
});

test('pending-definition commands get an honest reply', async () => {
  const h = await harnessWith();
  await h.dispatch('.ghost', { senderJid: ALICE });
  assert.match(h.lastSent().text, /pending definition/i);
  await h.cleanup();
});

test('unconfigured provider commands return setup instructions', async () => {
  const h = await harnessWith();
  await h.dispatch('.ai hello', { senderJid: ALICE });
  assert.match(h.lastSent().text, /not configured/i);
  assert.match(h.lastSent().text, /AI_API_KEY/);
  await h.cleanup();
});

test('.password generates a random password and never leaks env secrets', async () => {
  const h = await harnessWith();
  await h.dispatch('.password 20', { senderJid: ALICE });
  const text = h.lastSent().text;
  assert.match(text, /Random password/);
  assert.ok(!text.includes('OWNER_NUMBERS'));
  await h.cleanup();
});

test('cooldowns apply per command/user after first use', async () => {
  const h = await harnessWith();
  // .tagall has a 60s cooldown; Alice is group admin
  const first = await h.dispatch('.tagall hi', { senderJid: ALICE });
  assert.equal(first.handled, true);
  const second = await h.dispatch('.tagall hi again', { senderJid: ALICE });
  assert.equal(second.reason, 'cooldown');
  assert.match(h.lastSent().text, /Cooldown/);
  await h.cleanup();
});

test('safeCalc evaluates correctly and rejects dangerous input', () => {
  assert.equal(safeCalc('2+2'), '4');
  assert.equal(safeCalc('2+2*3'), '8');
  assert.equal(safeCalc('(2+2)*3'), '12');
  assert.equal(safeCalc('2^10'), '1024');
  assert.equal(safeCalc('-5+3'), '-2');
  assert.equal(safeCalc('10/4'), '2.5');
  assert.throws(() => safeCalc('process.exit(1)'), /allowed/);
  assert.throws(() => safeCalc('1/0'), /zero/);
  assert.throws(() => safeCalc('((1+2)'), /parentheses/);
});
