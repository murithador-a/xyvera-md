/**
 * In-memory fake of the WhatsAppClient interface for unit/integration tests.
 * Records every call so tests can assert real outcomes; can be told to fail
 * specific actions to verify honest failure reporting.
 */

export class FakeWhatsAppClient {
  constructor({ admins = [], fail = {} } = {}) {
    this.admins = new Set(admins); // `${group}|${user}` entries
    this.fail = fail; // { kickParticipant: true, ... }
    this.calls = [];
    this.sent = []; // { jid, text, opts }
    this.groups = new Map(); // jid -> { subject, desc, participants: [{jid, admin}] }
  }

  _rec(name, ...args) {
    this.calls.push({ name, args });
    if (this.fail[name]) {
      throw new Error(`simulated ${name} failure`);
    }
    return this.fail[name];
  }

  addGroup(jid, { subject = 'Test Group', desc = 'A test group', participants = [] } = {}) {
    this.groups.set(jid, {
      subject,
      desc,
      size: participants.length,
      participants: participants.map((p) => (typeof p === 'string' ? { jid: p, admin: null } : p)),
    });
    for (const p of participants) {
      const pj = typeof p === 'string' ? p : p.jid;
      const isAdmin = typeof p === 'object' && !!p.admin;
      if (isAdmin) this.admins.add(`${jid}|${pj}`);
    }
  }

  async sendText(jid, text, opts = {}) {
    this._rec('sendText', jid, text, opts);
    this.sent.push({ jid, text, opts });
  }

  async sendImage(jid, buffer, opts = {}) {
    this._rec('sendImage', jid, opts);
    if (this.fail.sendImage) return { ok: false, reason: 'simulated failure' };
    this.sent.push({ jid, text: '[image]', opts, buffer });
    return { ok: true };
  }

  async deleteMessage(jid, key) {
    this._rec('deleteMessage', jid, key);
    this.sent.push({ jid, text: '[deleted]', opts: { key } });
  }

  async kickParticipant(groupJid, userJid) {
    this._rec('kickParticipant', groupJid, userJid);
    return !this.fail.kickParticipant;
  }

  async promoteParticipant(groupJid, userJid) {
    this._rec('promoteParticipant', groupJid, userJid);
    return !this.fail.promoteParticipant;
  }

  async demoteParticipant(groupJid, userJid) {
    this._rec('demoteParticipant', groupJid, userJid);
    return !this.fail.demoteParticipant;
  }

  async addParticipant(groupJid, userJid) {
    this._rec('addParticipant', groupJid, userJid);
    return this.fail.addParticipant ? { ok: false, reason: 'simulated refusal' } : { ok: true };
  }

  async groupMetadata(groupJid) {
    this._rec('groupMetadata', groupJid);
    return this.groups.get(groupJid) ?? null;
  }

  async isGroupAdmin(groupJid, userJid) {
    return this.admins.has(`${groupJid}|${userJid}`);
  }

  async setGroupSubject(groupJid, text) {
    this._rec('setGroupSubject', groupJid, text);
    return this.fail.setGroupSubject ? { ok: false, reason: 'simulated' } : { ok: true };
  }

  async setGroupDescription(groupJid, text) {
    this._rec('setGroupDescription', groupJid, text);
    return this.fail.setGroupDescription ? { ok: false, reason: 'simulated' } : { ok: true };
  }

  async setGroupAnnounce(groupJid, on) {
    this._rec('setGroupAnnounce', groupJid, on);
    return this.fail.setGroupAnnounce ? { ok: false, reason: 'simulated' } : { ok: true };
  }

  async setGroupSlowMode(groupJid, seconds) {
    this._rec('setGroupSlowMode', groupJid, seconds);
    return this.fail.setGroupSlowMode
      ? { ok: false, reason: 'simulated unsupported' }
      : { ok: true };
  }

  async getInviteLink(groupJid) {
    this._rec('getInviteLink', groupJid);
    return 'https://chat.whatsapp.com/FakeLink123';
  }

  async revokeInvite(groupJid) {
    this._rec('revokeInvite', groupJid);
    return 'https://chat.whatsapp.com/NewFakeLink456';
  }

  async leaveGroup(groupJid) {
    this._rec('leaveGroup', groupJid);
    return { ok: true };
  }

  async updateProfileStatus(text) {
    this._rec('updateProfileStatus', text);
    return { ok: true };
  }

  async updateProfilePicture(jid, media) {
    this._rec('updateProfilePicture', jid, media);
    return { ok: false, reason: 'simulated unsupported' };
  }

  async markStatusRead(ev) {
    this._rec('markStatusRead', ev);
  }

  async sendReaction(ev, emoji) {
    this._rec('sendReaction', ev, emoji);
    if (this.fail.sendReaction) throw new Error('simulated reaction failure');
  }

  async saveMediaFile(msg, name) {
    this._rec('saveMediaFile', name);
    return this.fail.saveMediaFile ? { ok: false, reason: 'simulated' } : { ok: true, path: `/tmp/${name}.bin` };
  }

  async downloadMedia(msg) {
    this._rec('downloadMedia', msg);
    if (this.fail.downloadMedia) return null;
    return this.mediaBuffer ?? Buffer.from('fake-image-bytes');
  }

  async sendSticker(jid, webpBuffer) {
    this._rec('sendSticker', jid);
    this.sent.push({ jid, text: '[sticker]', opts: { size: webpBuffer?.length ?? 0 } });
  }

  async sendImageBuffer(jid, buffer, opts = {}) {
    this._rec('sendImageBuffer', jid);
    if (this.fail.sendImageBuffer) return { ok: false, reason: 'simulated failure' };
    this.sent.push({ jid, text: '[image]', opts });
    return { ok: true };
  }

  async setProfilePictureFromBuffer(jid, buffer) {
    this._rec('setProfilePictureFromBuffer', jid);
    return this.fail.setProfilePictureFromBuffer
      ? { ok: false, reason: 'simulated refusal' }
      : { ok: true, size: buffer?.length ?? 0 };
  }
}

/** Build a normalized message context as the transport layer would. */
export function makeMsg({
  text = '',
  chatJid = '120363000000000000@g.us',
  senderJid = '15550000001@s.whatsapp.net',
  mentions = [],
  quoted = null,
  messageId = `msg_${Math.random().toString(36).slice(2, 10)}`,
  isGroup = true,
  fromMe = false,
  hasMedia = false,
  senderIsAdmin = false,
  timestamp = Date.now(),
  botJid = '15550000000@s.whatsapp.net',
} = {}) {
  return {
    messageId,
    chatJid,
    senderJid,
    botJid,
    fromMe,
    isGroup,
    isStatus: false,
    text,
    mentions,
    hasMedia,
    quoted,
    timestamp,
    senderIsAdmin,
  };
}
