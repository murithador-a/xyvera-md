# Xyvera MD — Requirements

Status: Phase 0/1 baseline. This document records **confirmed decisions**, **proposed
behavior awaiting approval**, and **unresolved questions**. It is the source of truth for
what the bot is expected to do; nothing not described here (or explicitly marked
"pending") may be silently implemented.

Working name: **Xyvera MD** (display/branding name). The WhatsApp profile/menu styling
may use a distinctive presentation later; the product name is not settled and the code
must read the display name from configuration.

---

## 1. Confirmed decisions

These were agreed in the planning discussion and are treated as final unless revised.

### 1.1 Product scope

- Feature surface is **broad** (owner controls, sudo, groups, security, status automation,
  games, AI/media, utilities), but each command's behavior is deliberate and documented.
- Built as a **maintainable software project**: modular architecture, tests, storage
  abstraction, no pile of placeholder handlers.
- Development first on **Windows locally**, deployment later to a **persistent cloud server**.

### 1.2 Language, runtime, stack

- **JavaScript + Node.js (>= 20)**, **ES modules**.
- WhatsApp Web multi-device access via **Baileys** (see `docs/ARCHITECTURE.md` for the
  library evaluation). All Baileys APIs are isolated behind an adapter so the rest of the
  codebase never imports the library directly.
- **JSON persistence** for the initial version, behind a storage abstraction that can be
  swapped for SQLite later without touching command handlers.
- Secrets and configuration via **environment variables** (`.env`, gitignored). No
  hardcoded owner numbers, API keys, or session data in source.

### 1.3 Bot identity and configuration

Configurable (via env and/or `.settings`): display name, owner name + WhatsApp identifier,
bot version, command prefix (default `.`), menu text/branding, profile picture and
about/bio where the library supports it, optional GitHub/project links.

- Owner details ship as **placeholders**. The bot must never guess a phone number or embed
  a fake owner identity. With no owner configured, owner-only commands reply with a clear
  "configure `OWNER_NUMBERS`" message.
- Menu version/uptime/response time come from **runtime values**, never hardcoded.
- Confirmed commands: `.menu .help .owner .ping .alive .uptime .github .settings .setprefix
  .setbotbio .setbotpp .mode`.

### 1.4 Public / private modes

- `.mode public` / `.mode private`; persists across restarts.
- **Public**: ordinary users may run general commands; administrative commands still obey
  their own permission rules. Public access grants **no** owner/sudo rights.
- **Private**: only owner and authorized sudo users can run commands at all. Owner-only
  commands remain owner-only, and the owner can always restore public mode.
- Bot *command* access is conceptually separate from whether someone may message the bot
  as a normal contact.

### 1.5 Owner and sudo permissions

- Owner has ultimate control: `.addsudo .delsudo .sudolist .ban .unban .mode .settings`.
- Sudo users receive **granular capabilities**, not blanket access. Capability families:
  - `group.moderate` — mute/unmute, slowmode, lock/unmute-lock style group moderation
  - `group.kick` — member removal (`.kick`, group mute enforcement)
  - `group.promote` — promotion and demotion
  - `group.config` — group settings (`.setname .setdesc .revoke`)
  - `group.tag` — mass tagging (`.tagall .hidetag .tagadmins`)
  - `group.welcome` — welcome/goodbye configuration
  - `security.manage` — anti-link/anti-tag/anti-bad-word/anti-delete config + warnings
  - `bot.settings` — bot-level settings (subset of owner powers, grantable)
  - `status.automation` — status auto-view/auto-react configuration
  - `maintenance` — `.cleartmp` and similar maintenance tasks
- Owner grants/revokes capabilities per sudo user. Enforcement is **centralized** before
  handlers run. Identity is validated from the actual sender JID / group context — **never**
  from display names or user-supplied mentions alone.
- Sudo identities and permissions persist.
- `.ban`/`.unban` control **access to the bot's commands**. They do **not** kick anyone
  from a group and do **not** use WhatsApp's block list.

### 1.6 Per-group configuration (critical)

- Every group has an **independent** configuration keyed by the WhatsApp group JID.
  Enabling a feature in one group never enables it elsewhere.
- Group config model stores at least: welcome/goodbye toggles + texts (+ optional media),
  anti-link (toggle, action, domain allowlist, admin exemptions, user exemptions),
  anti-tag settings, anti-bad-word settings + per-group word lists, warning thresholds,
  moderation settings, slowmode, command cooldowns, moderation history, optional
  permission overrides.
- A missing group config **initializes safe defaults** — security features are **off** by
  default and nothing becomes "enabled everywhere".
- `.settings` / `.gcstatus` clearly distinguish group-local vs global settings.

### 1.7 Group management

- Member management: `.kick .promote .demote .add .ban .unban .mute .unmute`
  - Kick/promote/demote/mute require group-admin rights or a granted sudo capability, and
    the **bot itself** must hold the required WhatsApp group permission.
  - `.add` attempts direct add where supported; when WhatsApp requires an invitation
    instead, the bot explains accurately and offers the invite-link workflow.
  - Safe validation of targets: missing mentions, invalid numbers, self-targeting,
    unavailable participants, permission failures.
  - **No** destructive mass-kicking commands.
- Tagging/info: `.tagall .hidetag .tagadmins .staff .groupinfo .gcstatus .jid`
  - Mass tagging needs group-admin or granted `group.tag`; configurable cooldowns.
  - `.staff` lists admins; `.tagadmins` mentions them; `.groupinfo` shows name, description,
    member count where accessible; `.jid` shows only the relevant identifier.
  - Group info commands are public by default.
- Group settings: `.setname .setdesc .revoke .leavegc`
  - Admin (or granted `group.config`) required.
  - `.revoke` requires **short-lived pending confirmation** bound to requesting user +
    group. Mentioning the command never resets a link by itself.
  - `.leavegc` is owner-only by default and requires confirmation.
  - Accurate errors when the bot lacks permissions.

### 1.8 Welcome / goodbye

- `.welcome on|off`, `.goodbye on|off`, `.setwelcome <text>`, `.setgoodbye <text>`,
  `.testwelcome`, `.testgoodbye` — per group, independently switchable.
- **Goodbye defaults to disabled.** Welcome defaults to **disabled** as the safe documented
  default (see §2.2 for the open styling question).
- Group admins / granted `group.welcome` sudo capability may change these.
- Placeholders: `{user}`, `{group}` (extensible). Plain text plus optional configured image.
- Join/leave events processed only when the library exposes them. **Never** claim a
  departure was voluntary or that someone was kicked unless the event proves it.
- Template substitution handles missing values and special characters (tested).

### 1.9 Security / moderation

**Anti-link** (core feature, per group):

- Commands: `.antilink on|off`, `.antilink action <name>`, `.allowlink <domain>`,
  `.dellink <domain>`.
- Named actions (internal, final): `delete`, `delete-warn`, `delete-kick`, `escalate`
  (delete + warn + kick when the group's configured warning threshold is reached).
- **Numeric aliases 1–4 are pending owner approval** (see §2.1). Until approved, numeric
  input is rejected with a message referencing the proposal. Internally only named values
  are stored.
- Admin exemptions and explicit per-user exemptions; trusted-domain allowlist; exempt
  users are never penalized.
- Detects common link formats including scheme-less domains, while avoiding false
  positives on every dot-containing word.
- Checks the sender's **actual** group-admin status; deletes only when supported/permitted;
  kicks only when the action explicitly authorizes it and permissions allow.
- Duplicate enforcement prevention per message; sensible cooldowns; moderation logs;
  never claims success when WhatsApp rejected the action.

**Anti-tag** (`.antitag on|off`, `.antitag limit <n>`): configurable threshold for
excessive/abusive tagging, configurable response, admin exemptions by default; ordinary
mentions are not treated as mass mentions.

**Anti-bad-word** (`.antibadword on|off`, `.addbadword <word>`, `.delbadword <word>`):
per-group word lists, case-insensitive, avoid accidental partial-word matches where
possible, configurable response, clear moderation explanation.

**Anti-delete**: per-group on/off. Only messages the bot actually observed can be
recovered; store only what the configured feature needs; recovered content is restricted
to the intended group/authorized context. **No view-once bypass** of any kind. Honest
limitations documented (`docs/LIMITATIONS.md`).

**Warnings**: `.warn @user [reason]`, `.warnings @user`, `.delwarn @user`,
`.resetwarn @user`. Per-group thresholds and escalation. Resetting active warnings keeps
history. No automatic kick after a threshold unless the group explicitly configured and
confirmed the escalation rule.

**Slowmode / lock**: `.slowmode`, `.lock`, `.unlock` use real WhatsApp group settings
where available; where only application-level limits exist, the bot must say so and must
not present bot cooldowns as native WhatsApp restrictions.

**Anti-call**: explicitly **not** in the initial release.

### 1.10 Status automation

- `.autoview on|off`, `.autoreact on|off` — configurable, persisted, rate-limited,
  duplicate-processing prevention. Supported status types: image, video, text (where the
  library exposes them). Reaction behavior configurable. Can be disabled immediately.
- Never fabricate delivery/view/reaction confirmations. Library limits documented.
- `.autotyping` / `.autorecording`: **not** in the initial release.

### 1.11 Maintenance

`.setprefix .settings .setbotbio .setbotpp .cleartmp .clearsession .restart`:

- `.cleartmp` only removes files inside the designated temp directory.
- `.clearsession` owner-only + confirmation + explicit warning that the WhatsApp session
  will be disconnected. Session files are never exposed through any command.
- `.restart` owner-only, controlled restart mechanism.
- Profile changes report when unsupported. Prefix validation: no empty/conflicting values.

### 1.12 Games

`.ttt .tictactoe .rps .trivia .hangman .truth .dare .poll .8ball .dice .coin .riddle
.ship .compliment .roast`

- Tic-tac-toe: play vs bot and challenge another user; valid turns, board rendering,
  win/draw detection, challenge accept/cancel, timeouts, no overlapping games for the same
  players, state isolated per group + participants.
- **No gambling or wagers** anywhere in the game system.

### 1.13 AI, media, utilities

- AI: `.ai .imagine .translate`
- Media/design: `.sticker .toimg .blur .meme .lyrics`
- Utilities: `.qr .shorturl .password .screenshot .calc .hash .base64 .binary .count
  .reverse .case .palindrome .reminder .weather .currency .timestamp`
- Optional downloads: `.play .song .video .tiktok .instagram`
- External services must be legitimate/configured providers; document API keys, costs,
  rate limits, restrictions. No hardcoded scraping endpoints as the only implementation.
- Unconfigured provider ⇒ clear "setup required" message, never a fake success.
- `.password` generates a random password; it must **never** retrieve or disclose saved
  credentials.
- `.screenshot` validates URLs and blocks private IPs / internal services / local files.
- `.shorturl` requires a configured provider; never invents a shortened URL.

### 1.14 Excluded / deferred features

- `.vv` / `.vv2` (view-once reveal): **excluded**. We will not implement any bypass of
  WhatsApp's view-once privacy. Documented alternative: ask the sender to share normally.
- `.ghost`: **pending definition** — not implemented.
- "Dazzle" and similar unnamed features: **pending definition** — not implemented.

### 1.15 Menu

- Sections: Owner & sudo, Group management, Security, Automation, Games, AI & media,
  Utilities, Bot information.
- Each entry: command name, concise description, required arguments.
- Generated from the **command registry** (no phantom commands). Includes configured bot
  name, version, owner name, live uptime and measured latency. Mobile-readable layout.

### 1.16 Persistence and quality bar

- JSON storage behind a repository abstraction; schema versions + migrations; safe atomic
  writes (temp file + rename); validated loads; malformed files recovered without crash;
  concurrent updates serialized. Runtime session data kept separate from settings.
- Automated tests for: mode enforcement, owner-only, sudo capabilities, bans, per-group
  isolation, welcome/goodbye toggles, placeholder substitution, anti-link actions and
  exemptions, warning thresholds, duplicate-message handling, tic-tac-toe outcomes, JSON
  persistence/malformed recovery, destructive-action confirmations.
- Tests use mocks; **no live WhatsApp credentials required** to run them.
- Each phase ends with a truthful report: implemented / tested / passed / failed /
  functional commands / external services needed / limitations / next phase.

---

## 2. Decisions resolved after presentation

### 2.1 Anti-link numeric action aliases — **APPROVED (2026-10-11)**

The presented mapping was approved with the "make it perfect and complete" go-ahead and
is now in effect. Group configuration still stores only the **named** values; numbers are
input aliases:

| Numeric alias | Meaning                                        | Internal action name |
|---------------|------------------------------------------------|----------------------|
| 1             | Delete the message                             | `delete`             |
| 2             | Delete and warn                                | `delete-warn`        |
| 3             | Delete and kick                                | `delete-kick`        |
| 4             | Delete, warn, and kick per the group's configured escalation rules | `escalate` |

Any future change to this table is a documented config/alias change, not silent behavior.

### 2.2 Welcome default — resolved

Welcome defaults to **disabled** (opt-in per group); goodbye defaults to disabled. This is
the documented safe default (`docs/LIMITATIONS.md`, `src/config/defaults.js`).

### 2.3 Sudo capability → command mapping

The capability families in §1.5 are confirmed; the exact default mapping of each command
to a capability is generated into `docs/COMMANDS.md` and can be overridden per group later.

---

## 3. Unresolved questions

1. ~~Anti-link numeric aliases~~ — **resolved** (§2.1, approved 2026-10-11).
2. ~~Welcome default~~ — **resolved** (§2.2, disabled by default).
3. **`.ghost`** — what should it do? (Stays `pending-definition` until specified; the
   bot will not invent behavior.)
4. **"Dazzle"** — what should it do? (Same policy as `.ghost`.)
5. **Bot profile name styling** — keep "Xyvera MD" as display name, or a different menu
   presentation name? (Code reads it from config either way.)
6. **Warning escalation confirmation UX** — when a group configures "kick at N warnings",
   confirm once per group (proposal) vs every time the threshold changes.
7. **Anti-tag response** — warn-only, delete, or delete+warn as the configurable response?
   (Current default: warn, escalating through the warnings system.)
8. **Media downloads (.play/.song/.video/.tiktok/.instagram)** — provider policy now:
   keyless documented services are implemented for translate/weather/currency/lyrics/
   shorturl, and OpenAI-compatible endpoints for AI/imagine. Media *downloads* still need
   a licensed provider decision + funding before they leave `stub-config-required`.
9. **Cloud deployment target** — VPS with PM2/systemd, Docker, or a PaaS? Affects `.restart`
   design (current: exit code 75 + supervisor restart policy; documented in DEPLOYMENT.md).

---

## 4. Reference material

- The **Anita V5 / EMMYHENZ V4** feature concepts are used as *inspiration for menus and
  feature organization only*. No reference archive was present in this workspace
  (inspection recorded in `docs/ARCHITECTURE.md` §1); no branding, credentials, session
  files, or implementation code from those projects will be copied. If an archive is added
  later it will be inspected read-only for structure, with secrets excluded.

## 5. Non-goals (initial release)

- Anti-call, `.autotyping`, `.autorecording`, view-once bypass (`.vv`/`.vv2`), gambling.
- Blindly cloning another bot's commands or branding.
- Claiming untested commands work. The registry tracks each command's status:
  `implemented` / `partial` / `stub-config-required` / `pending-definition`.
