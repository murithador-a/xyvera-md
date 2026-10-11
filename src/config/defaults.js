/**
 * Central default values and constants for Xyvera MD.
 * No owner identity, phone numbers, or secrets are hardcoded here.
 */

export const BOT_DEFAULTS = Object.freeze({
  name: 'Xyvera MD',
  displayName: 'Xyvera MD',
  version: '0.1.0',
  prefix: '.',
  mode: 'public', // 'public' | 'private'
  ownerName: 'Murking',
});

export const MODES = Object.freeze({ PUBLIC: 'public', PRIVATE: 'private' });

/** Permission capability identifiers (granular sudo grants). */
export const CAPABILITIES = Object.freeze({
  GROUP_MODERATE: 'group.moderate', // mute/unmute, slowmode, lock/unlock
  GROUP_KICK: 'group.kick', // member removal
  GROUP_PROMOTE: 'group.promote', // promote/demote
  GROUP_CONFIG: 'group.config', // setname/setdesc/revoke
  GROUP_TAG: 'group.tag', // tagall/hidetag/tagadmins
  GROUP_WELCOME: 'group.welcome', // welcome/goodbye configuration
  SECURITY_MANAGE: 'security.manage', // anti-* config + warnings
  BOT_SETTINGS: 'bot.settings', // bot-level settings (subset, grantable)
  STATUS_AUTOMATION: 'status.automation', // autoview/autoreact
  MAINTENANCE: 'maintenance', // cleartmp etc.
});

export const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));

/**
 * Anti-link internal action names. Numeric aliases are PENDING OWNER APPROVAL
 * (docs/REQUIREMENTS.md §2.1) and are intentionally NOT wired to any behavior.
 */
export const ANTI_LINK_ACTIONS = Object.freeze({
  DELETE: 'delete',
  DELETE_WARN: 'delete-warn',
  DELETE_KICK: 'delete-kick',
  ESCALATE: 'escalate',
});

export const ANTI_LINK_ACTION_LIST = Object.freeze(Object.values(ANTI_LINK_ACTIONS));

/**
 * Numeric action aliases — APPROVED mapping (docs/REQUIREMENTS.md §2.1).
 * These are convenience aliases for the named values below; only named values
 * are ever stored in group configuration.
 */
export const PROPOSED_NUMERIC_ACTION_ALIASES = Object.freeze({
  1: ANTI_LINK_ACTIONS.DELETE,
  2: ANTI_LINK_ACTIONS.DELETE_WARN,
  3: ANTI_LINK_ACTIONS.DELETE_KICK,
  4: ANTI_LINK_ACTIONS.ESCALATE,
});

export const NUMERIC_ACTION_ALIASES_APPROVED = true;

/** Responses to anti-tag / anti-bad-word / warning escalation. */
export const MODERATION_RESPONSES = Object.freeze({
  DELETE: 'delete',
  WARN: 'warn',
  DELETE_WARN: 'delete-warn',
  KICK: 'kick',
  DELETE_KICK: 'delete-kick',
  NONE: 'none',
});

/** Registry status for truthful menus and reports. */
export const COMMAND_STATUS = Object.freeze({
  IMPLEMENTED: 'implemented',
  PARTIAL: 'partial',
  STUB: 'stub-config-required',
  PENDING: 'pending-definition',
});

export const SCHEMA_VERSION = 1;

export const DEFAULTS = Object.freeze({
  confirmationTtlMs: 60_000,
  tagallCooldownMs: 60_000,
  moderationLogMax: 200,
  warningHistoryMax: 100,
  statusDedupeTtlMs: 30 * 60_000,
  statusRateLimitMs: 2_000,
  processedMessageTtlMs: 10 * 60_000,
});

/** Safe defaults: ALL security features OFF until a group opts in. */
export function defaultGroupConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: null,
    // Welcome defaults to disabled as the safe documented default (REQUIREMENTS §2.2);
    // goodbye is disabled by default (confirmed decision).
    welcome: {
      enabled: false,
      text: 'Welcome {user} to {group}!',
      mediaPath: null,
    },
    goodbye: {
      enabled: false,
      text: 'Goodbye {user}.',
      mediaPath: null,
    },
    antiLink: {
      enabled: false,
      action: ANTI_LINK_ACTIONS.DELETE,
      allowDomains: [],
      exemptAdmins: true,
      exemptUsers: [],
    },
    antiTag: {
      enabled: false,
      limit: 5, // max mentions in a single message before action
      response: MODERATION_RESPONSES.WARN,
      exemptAdmins: true,
    },
    antiBadWord: {
      enabled: false,
      words: [],
      response: MODERATION_RESPONSES.DELETE_WARN,
      exemptAdmins: true,
    },
    antiDelete: {
      enabled: false,
      retentionCount: 200,
    },
    warnings: {
      threshold: 3,
      // No automatic kick unless the group explicitly configures it ('kick').
      actionOnThreshold: 'none', // 'none' | 'kick'
    },
    slowmode: {
      enabled: false,
      seconds: 0,
    },
    cooldowns: {
      tagallMs: DEFAULTS.tagallCooldownMs,
    },
    permissionOverrides: {
      // Optional per-group restriction of sudo capabilities: { [capability]: false }
    },
    moderationLog: [],
  };
}

export function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    botName: BOT_DEFAULTS.name,
    displayName: BOT_DEFAULTS.displayName,
    version: BOT_DEFAULTS.version,
    prefix: BOT_DEFAULTS.prefix,
    mode: BOT_DEFAULTS.mode,
    ownerName: BOT_DEFAULTS.ownerName,
    ownerNumbers: [], // populated from env on first boot; never guessed
    githubUrl: null,
    projectUrl: null,
    profilePictureApplied: false, // one-time auto-apply of BOT_IMAGE_PATH on connect
    sudo: {}, // { [jid]: { capabilities: string[], grantedAt, grantedBy } }
    bans: [], // [jid]
  };
}

export function defaultWarningsDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    groups: {}, // { [groupJid]: { [userJid]: { active: n, history: [{ ts, reason, by, active }] } } }
  };
}

export function defaultStatusDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    // Global defaults; per-chat overrides possible later.
    autoview: false,
    autoreact: false,
    autoreactEmoji: '❤️',
  };
}
