# Xyvera MD — Command Reference

_Generated from the command registry by `node scripts/gen-commands.mjs`.
Do not edit by hand — regenerate after changing commands._

Legend: **status** — `implemented` (works with the current code), `partial`
(works with documented gaps), `stub-config-required` (needs an external
provider configured in `.env`; returns setup instructions otherwise),
`pending-definition` (behavior not yet defined — replies honestly).

Access levels: `everyone`, `group-admin` (real WhatsApp group admin **or** the
matching sudo capability), `sudo:<capability>`, `owner`.

## Owner & Sudo

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.addsudo` | `<number|@user> [capability|all]` | owner | implemented | Grant sudo capabilities to a user |
| `.ban` | `<number|@user>` | sudo:bot.settings | implemented | Ban a user from using bot commands (does NOT kick them) |
| `.clearsession` | — | owner | implemented | ⚠️ Delete the WhatsApp session (disconnects the bot!) |
| `.cleartmp` | — | sudo:maintenance | implemented | Delete files from the bot temp directory only |
| `.delsudo` | `<number|@user> [capability|all]` | owner | implemented | Revoke sudo capabilities (or all) from a user |
| `.mode` | `<public|private>` | owner | implemented | Switch bot between public and private |
| `.restart` | — | owner | implemented | Restart the bot process (owner only) |
| `.setbotbio` | `<text>` | owner | implemented | Set the WhatsApp profile about text |
| `.setbotpp` | — | owner | implemented | Set the bot profile picture (reply to an image, or no args for the bundled logo) |
| `.setprefix` | `<symbol>` | sudo:bot.settings | implemented | Change the command prefix |
| `.settings` | — | everyone | implemented | Show global vs group settings |
| `.sudolist` | — | owner | implemented | List sudo users and their capabilities |
| `.unban` | `<number|@user>` | sudo:bot.settings | implemented | Allow a banned user to use bot commands again |

## Group Management

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.add` | `<number>` | group-admin:group.kick | implemented | Try to add a number to the group (invitation fallback) |
| `.demote` | `@user` | group-admin:group.promote | implemented | Demote a group admin to member |
| `.gcstatus` | — | everyone | implemented | Report this group's configuration and enabled features |
| `.groupinfo` _(aka `.gcinfo`)_ | — | everyone | implemented | Show group name, description and member count |
| `.hidetag` | `<message>` | group-admin:group.tag | implemented | Send a message that silently mentions everyone |
| `.jid` | — | everyone | implemented | Show the relevant chat / participant identifier |
| `.kick` _(aka `.remove`)_ | `@user` | group-admin:group.kick | implemented | Remove a member from the group |
| `.leavegc` _(aka `.leave`)_ | — | owner | implemented | Bot leaves this group (owner only, requires .confirm) |
| `.lock` | — | group-admin:group.moderate | implemented | Alias of .mute — lock group to admins only |
| `.mute` | — | group-admin:group.moderate | implemented | Lock the group (admins only can send) |
| `.promote` | `@user` | group-admin:group.promote | implemented | Promote a member to group admin |
| `.revoke` _(aka `.revokeinvite`)_ | — | group-admin:group.config | implemented | Reset the group invite link (requires .confirm) |
| `.setdesc` | `<text>` | group-admin:group.config | implemented | Change the group description |
| `.setname` | `<text>` | group-admin:group.config | implemented | Change the group name |
| `.slowmode` | `<seconds|off>` | group-admin:group.moderate | implemented | Set group slow mode (WhatsApp native where available) |
| `.staff` | — | everyone | implemented | List the group administrators |
| `.tagadmins` | — | everyone | implemented | Mention the group admins |
| `.tagall` | — | group-admin:group.tag | implemented | Mention every group member |
| `.unlock` | — | group-admin:group.moderate | implemented | Alias of .unmute — open group to everyone |
| `.unmute` | — | group-admin:group.moderate | implemented | Unlock the group (everyone can send) |

## Security

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.addbadword` | `<word>` | group-admin:security.manage | implemented | Add a word to this group’s bad-word list |
| `.allowlink` | `<domain>` | group-admin:security.manage | implemented | Allow a domain in this group’s anti-link filter |
| `.antibadword` | `<on|off>` | group-admin:security.manage | implemented | Anti-bad-word: on\|off — per-group word list |
| `.antidelete` | `<on|off>` | group-admin:security.manage | partial | Toggle anti-delete for this group (observed messages only) |
| `.antilink` | `<on|off|action <name>>` | group-admin:security.manage | implemented | Anti-link: on\|off\|action <name> — per-group |
| `.antilink-actions` | — | everyone | implemented | Explain the anti-link action values (incl. pending numeric aliases) |
| `.antitag` | `<on|off|limit <n>>` | group-admin:security.manage | implemented | Anti-tag: on\|off\|limit <n> — per-group |
| `.delbadword` | `<word>` | group-admin:security.manage | implemented | Remove a word from this group’s bad-word list |
| `.dellink` _(aka `.disallowlink`)_ | `<domain>` | group-admin:security.manage | implemented | Remove a domain from this group’s allowlist |
| `.delwarn` | `@user` | group-admin:security.manage | implemented | Remove one active warning (history is kept) |
| `.exempt` _(aka `.exemptuser`)_ | `@user` | group-admin:security.manage | implemented | Exempt a user from anti-link enforcement |
| `.modlog` | — | group-admin:security.manage | implemented | Show this group's recent moderation log |
| `.resetwarn` | `@user` | group-admin:security.manage | implemented | Reset active warnings to 0 (history is kept) |
| `.unexempt` | `@user` | group-admin:security.manage | implemented | Remove a user’s anti-link exemption |
| `.warn` | `@user [reason]` | group-admin:security.manage | implemented | Warn a member (counted toward the group threshold) |
| `.warnings` | `@user` | everyone | implemented | Show a member's warnings |

## Automation

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.autoreact` | `<on|off> [emoji]` | sudo:status.automation | implemented | Auto-react to WhatsApp statuses (global) |
| `.autoview` | `<on|off>` | sudo:status.automation | implemented | Auto-view WhatsApp statuses (global) |
| `.goodbye` | `<on|off>` | group-admin:group.welcome | implemented | Toggle goodbye messages for this group |
| `.greetingvars` | — | everyone | implemented | List placeholders available in welcome/goodbye texts |
| `.setgoodbye` | `<text>` | group-admin:group.welcome | implemented | Set this group’s goodbye text (placeholders: {user} {group}) |
| `.setgoodbyepp` | — | group-admin:group.welcome | implemented | Attach an image to goodbye messages (reply to an image) |
| `.setwelcome` | `<text>` | group-admin:group.welcome | implemented | Set this group’s welcome text (placeholders: {user} {group}) |
| `.setwelcomepp` | — | group-admin:group.welcome | implemented | Attach an image to welcome messages (reply to an image) |
| `.testgoodbye` | — | group-admin:group.welcome | implemented | Preview this group’s goodbye message |
| `.testwelcome` | — | group-admin:group.welcome | implemented | Preview this group’s welcome message |
| `.welcome` | `<on|off>` | group-admin:group.welcome | implemented | Toggle welcome messages for this group |

## Games

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.8ball` _(aka `.eightball`)_ | `<question>` | everyone | implemented | Ask the magic 8-ball a question |
| `.coin` | — | everyone | implemented | Flip a coin |
| `.compliment` | — | everyone | implemented | Give (or receive) a compliment |
| `.dare` | — | everyone | implemented | Get a dare |
| `.dice` | `[sides] [count]` | everyone | implemented | Roll dice (no wagers) |
| `.hangman` | `[start|guess <letter|word>]` | everyone | implemented | Play hangman (.hangman start \| guess <letter\|word>) |
| `.poll` | `<question> | <opt1> | <opt2> …` | everyone | implemented | Create a simple poll: question \| option1 \| option2 … |
| `.riddle` | `[answer <text>]` | everyone | implemented | Get a riddle (answer with .riddle answer <text>) |
| `.roast` | — | everyone | implemented | Playful roast (keep it friendly!) |
| `.rps` | `<rock|paper|scissors>` | everyone | implemented | Rock-paper-scissors vs the bot |
| `.ship` | `@user1 [@user2]` | everyone | implemented | Ship two people (fun percentage) |
| `.trivia` | `[answer <text>]` | everyone | implemented | Answer a trivia question (.trivia answer <text>) |
| `.truth` | — | everyone | implemented | Get a truth question |
| `.ttt` _(aka `.tictactoe`)_ | `[@user | move <1-9> | cancel]` | everyone | implemented | Tic-tac-toe: vs bot, or challenge with .ttt @user |

## AI

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.ai` _(aka `.chat`, `.ask`)_ | `<prompt>` | everyone | implemented | Talk to an AI assistant (requires AI_API_KEY + AI_API_URL) |
| `.imagine` | `<prompt>` | everyone | implemented | Generate an image (requires IMAGINE_API_KEY + IMAGINE_API_URL) |
| `.translate` | `[lang] <text>` | everyone | implemented | Translate text (MyMemory engine) |

## Media & Design

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.blur` | `[radius]` | everyone | implemented | Blur a replied image (optional radius 1-100) |
| `.instagram` | `<query|url>` | everyone | stub-config-required | Download media via a licensed provider (instagram) |
| `.lyrics` | `<artist> - <title>` | everyone | implemented | Look up song lyrics (lyrics.ovh) |
| `.meme` | `<top> | <bottom>` | everyone | implemented | Caption a replied image: <top> \| <bottom> |
| `.play` | `<query|url>` | everyone | stub-config-required | Download media via a licensed provider (play) |
| `.song` | `<query|url>` | everyone | stub-config-required | Download media via a licensed provider (song) |
| `.sticker` _(aka `.s`)_ | — | everyone | implemented | Turn a replied image into a sticker |
| `.tiktok` | `<query|url>` | everyone | stub-config-required | Download media via a licensed provider (tiktok) |
| `.toimg` | — | everyone | implemented | Convert a replied sticker back to an image |
| `.video` | `<query|url>` | everyone | stub-config-required | Download media via a licensed provider (video) |
| `.vv` _(aka `.vv2`)_ | — | everyone | implemented | Why view-once media cannot be revealed (privacy policy) |

## Utilities

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.base64` | `<encode|decode> <text>` | everyone | implemented | Encode/decode base64 |
| `.binary` | `<encode|decode> <text>` | everyone | implemented | Convert text↔binary |
| `.calc` _(aka `.calculate`)_ | `<expression>` | everyone | implemented | Evaluate an arithmetic expression (safe parser) |
| `.cancel` | — | everyone | implemented | Cancel your pending destructive action |
| `.case` | `<upper|lower|title|toggle> <text>` | everyone | implemented | Change text case |
| `.confirm` | — | everyone | implemented | Confirm your pending destructive action |
| `.count` | `<text>` | everyone | implemented | Count characters and words in text |
| `.currency` | `<amount> <from> <to>` | everyone | implemented | Convert currency (Frankfurter/ECB daily rates) |
| `.delreminder` | `<number>` | everyone | implemented | Cancel one of your pending reminders by number |
| `.echo` | `<text>` | everyone | implemented | Repeat your text back |
| `.ghost` | — | everyone | pending-definition | Reserved — behavior not defined yet |
| `.hash` | `[algo] <text>` | everyone | implemented | Hash text with md5/sha1/sha256/sha512 |
| `.palindrome` | `<text>` | everyone | implemented | Check whether text is a palindrome |
| `.password` | `[length]` | everyone | implemented | Generate a random password (never reveals saved ones) |
| `.qr` | `<text>` | everyone | implemented | Generate a QR code image from text |
| `.reminder` | `<time> <text>` | everyone | implemented | Set a reminder (persisted across restarts) |
| `.reminders` | — | everyone | implemented | List your pending reminders |
| `.reverse` | `<text>` | everyone | implemented | Reverse text |
| `.screenshot` | `<url>` | everyone | implemented | Screenshot a public web page (requires SCREENSHOT_API_URL) |
| `.shorturl` | `<url>` | everyone | implemented | Shorten a public URL via the configured provider (is.gd by default) |
| `.timestamp` | — | everyone | implemented | Show current Unix/ISO timestamps |
| `.weather` | `<city>` | everyone | implemented | Current weather for a city (Open-Meteo) |

## Bot Information

| Command | Arguments | Access | Status | Description |
|---------|-----------|--------|--------|-------------|
| `.alive` | — | everyone | implemented | Check that the bot is running |
| `.commands` | — | everyone | implemented | List every command with its real implementation status |
| `.configcheck` | — | owner | implemented | List external providers and whether they are configured |
| `.github` | — | everyone | implemented | Show the project GitHub link |
| `.logo` _(aka `.botimage`, `.brand`)_ | — | everyone | implemented | Send the bot branding image |
| `.menu` _(aka `.help`, `.list`)_ | — | everyone | implemented | Show the full command menu |
| `.owner` | — | everyone | implemented | Show bot owner contact information |
| `.ownerconfig` | — | everyone | implemented | Check whether owner identity is configured |
| `.ping` _(aka `.p`)_ | — | everyone | implemented | Measure bot response latency |
| `.setbotname` | `<text>` | sudo:bot.settings | implemented | Set the bot display name |
| `.uptime` | — | everyone | implemented | Show how long the bot has been running |

## Anti-link actions

Named values are final. Numeric aliases are **pending owner approval** and are
rejected until approved (see `docs/REQUIREMENTS.md` §2.1):

| Name | Behavior |
|------|----------|
| `delete` | Delete the violating message |
| `delete-warn` | Delete + warn (counts toward the group warning threshold) |
| `delete-kick` | Delete + remove the sender |
| `escalate` | Delete + warn; remove only if the group configured `warnings.actionOnThreshold = kick` |

## Sudo capabilities

- `group.moderate`
- `group.kick`
- `group.promote`
- `group.config`
- `group.tag`
- `group.welcome`
- `security.manage`
- `bot.settings`
- `status.automation`
- `maintenance`
