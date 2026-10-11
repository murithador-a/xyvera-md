/**
 * Test harness: boots the real application stack (registry, router, services,
 * JSON storage in a temp dir) WITHOUT any WhatsApp connection, then dispatches
 * synthetic messages through a FakeWhatsAppClient.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bootstrap } from '../../src/index.js';
import { FakeWhatsAppClient, makeMsg } from './fakeClient.js';

export async function createHarness({
  env = {},
  admins = [],
  groupJid = '120363000000000000@g.us',
  groupParticipants = [],
} = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xyvera-test-'));
  const app = await bootstrap({
    rootDir,
    connect: false,
    env: {
      LOG_LEVEL: 'silent',
      OWNER_NUMBERS: '',
      ...env,
    },
  });

  const client = new FakeWhatsAppClient({ admins });
  client.addGroup(groupJid, {
    subject: 'Test Group',
    participants: groupParticipants.length
      ? groupParticipants
      : [{ jid: '15550000001@s.whatsapp.net', admin: 'admin' }, { jid: '15550000002@s.whatsapp.net', admin: null }],
  });

  // Wire the fake client so PermissionService can resolve real group-admin status.
  app.attachClient(client, '15550000000@s.whatsapp.net');

  /** Dispatch a command/message as a given sender. */
  async function dispatch(text, opts = {}) {
    const msg = makeMsg({ text, chatJid: opts.chatJid ?? groupJid, ...opts });
    return app.router.dispatch(msg, client, app.services);
  }

  /** Last message sent to a jid. */
  function lastSent(jid = groupJid) {
    const list = client.sent.filter((s) => !jid || s.jid === jid);
    return list[list.length - 1] ?? null;
  }

  return {
    app,
    client,
    dispatch,
    lastSent,
    rootDir,
    groupJid,
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export { makeMsg, FakeWhatsAppClient };
