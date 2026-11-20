# Patch tracker

What changed in each patch of this fork (a restyle of the PhoneBox phone panel). Newest at the bottom. Every patch
is one commit on `apple-ui-patches`. Details of how the APK is patched: [docs/PATCHING-THE-APK.md](docs/PATCHING-THE-APK.md).

Base: PhoneBox 0.9.19 (`ersinkoc/phonebox`).

## Patch 1: Apple look, seven fixed pages, Music page

**Look**
- `apple.css`: flat Apple-style skin (warm near-black, grouped surfaces, hairlines, one accent), Inter font
  (SIL OFL, `fonts/`) as the Helvetica stand-in.
- Real app icons on colour-coded shortcut cards (`icons/`, `shortcut-skin.js`); shortcuts Snip and Calculator became
  Claude Code and Netflix in the desktop settings.

**Pages** (`pages.js`, replaces the saved layout; `USE_FIXED_PAGES = false` brings it back)
1. Home  2. Music  3. System  4. Sessions (Claude only, one per row)  5. AI quotas  6. Shortcuts  7. Clock
   (clock, weather, 3-day forecast, calendar).

**Music page** (`widgets/music.js`, `music.css`)
- Spinning record with the cover as its label, tonearm, synced lyrics from LRCLIB, queue and like (Spotify, needs the
  Spotify connection in the desktop settings), tap the lyrics' empty space to hide the controls and the page dots.

**Navigation**
- Windowed page dots with the page name, tap a dot to jump, readable overview tiles with a Music shortcut.
- "Unpin screen" button, "Stays awake" setting (never sleeps while charging, 30 min on battery by default).
- Weather location found from the phone's internet address when the desktop setting is still the default city.

**Tools**: `tools/live-panel.py` (live panel in a desktop browser), `tools/patch-apk.py` (APK patching).

**Known limit**: the Claude quotas page needs a fresh Claude Code sign-in on the computer (`claude auth login`).

## Patch 2: no overlap, full screen, pages stay put, Claude chats and permission prompts

1. **Dots bar no longer collides with content.** A 30 px strip (`--nav-h`) at the bottom of every page is reserved for the
   slim page-dots bar; the Music controls and lyrics sit above it. The dots bar is always visible (the idle fade-out
   from Patch 1 is gone).
2. **Tonearm moved to the top-left corner** of the record and swings in from the left.
3. **Every page is full screen.** The gutter kept for the camera cut-out is gone: pages use the whole width (6 px
   gutter); the Music page is edge to edge. If the camera hole covers a left-aligned label on some page, tell me which.
4. **Claude permission prompts.** The agent already ships this (a `PermissionRequest` hook posts each prompt to the
   agent, which pushes it to the phone). The panel now jumps to the **Sessions** page the moment a prompt arrives and
   shows the tool, the command or file and **Allow / Deny** (a countdown shows when the terminal takes over). Questions
   (`AskUserQuestion`) are shown with their options as text, but are answered at the computer: Claude Code does not let
   a hook answer them. **The hook has to be installed once** (desktop settings, Claude section, or `POST /api/claude/hook`);
   it was not installed at the time of this patch.
5. **Sessions page shows Claude Code chats.** Each row is the chat's own title, with the project folder, model and
   status under it (before, it showed the project folder name). Message text is never sent by the agent.
6. **Pin / Unpin.** The overview now has one button that reads "Pin screen" or "Unpin screen" depending on the state
   and toggles it (Android asks once to confirm pinning).
7. **No pause or play, no automatic page changes.** The pause button on the dots bar, the long-press pause and the
   "Pause rules 1 h" button are removed. The page you are on stays until you leave it: no return to Home when idle,
   and rules, webhooks and notifications no longer switch pages (`KEEP_PAGE` in `pages.js`). The pause/play buttons
   only paused the idle return and the rule-based page switching.

Also: the repository is pushed with `git config http.postBuffer 524288000` (the default buffer made the first push
of this large history fail without a message).

## Patch 3: smoother Music page

The jump between the record view and the lyrics / queue view stuttered. Causes and fixes (`music.css`, `widgets/music.js`):
- The record, title and controls animated `left`, `top`, `width` and `height`, which re-runs layout on every frame. They
  now switch layout at once and each block is played from its old position with a transform (FLIP, Web Animations API).
- Lyric lines used a blur filter and colour transitions on every line. They now fade with opacity and a small scale only.
- Moving to the next lyric rewrote every line; it now touches only the lines near the old and new position.
- The progress bar moves with `transform: scaleX` instead of changing its width, and its text updates once a second.
- Removed a blend mode over the turning record and the always-on layer hints; the hidden lyrics and queue panels are
  `visibility: hidden` when not shown.

Measured on the phone with `dumpsys gfxinfo` while switching views and the record spins: janky frames 20.7 % -> 5.7 %,
95th percentile frame time 105 ms -> 40 ms (one earlier before-run did not land on the Music page, so only the valid one
is quoted).

## Patch 4: Minecraft page, meeting controls, ambient screen, repeat, song colours, no upstream updates

1. **Bold home clock** (`apple.css`): the big time on Home and the Clock page is now weight 700.
2. **Updates from the original project are switched off.** The "0.9.24 available" notice came from the *computer agent*,
   which checks `ersinkoc/phonebox` for releases and, with "install new releases automatically" on, had been trying to
   install the stock app onto the phone over USB (the swap fails because the signing key differs, which is why it
   "timed out"; it would have undone these changes had the key matched). Now:
   - the phone panel no longer shows the notice (`UPSTREAM_UPDATES = false` in `pages.js`);
   - the agent's setting `updates.auto` is `false` and `updates.repo` points at this repository (`tools/install-shortcuts.py --no-updates`),
     so it checks nothing upstream. The agent on the laptop is already 0.9.24; the phone app stays 0.9.19 plus these patches.
   - Not changed: the first-time pairing QR still opens a page hosted by the original project (`ersinkoc.github.io/phonebox/pair`).
3. **Music: repeat button** beside mic / queue / like. Off -> repeat all -> repeat one, through the computer's media session
   (works for Spotify's desktop app). Lit when on; the "1" shows for repeat-one.
4. **Music: song-coloured backdrop.** `coverPalette()` reads the cover and picks its strongest hue, a second hue and the overall
   tone; two layers cross-fade between songs and drift slowly while it plays (opacity and transform only). Grey covers get a
   neutral blue-grey.
5. **Minecraft page (page 8)**, `widgets/minecraft.js`: status of the game on the PC (running, memory, CPU/GPU/RAM) and five tabs:
   *Controls* (screenshot, HUD, debug screen, camera, full screen, chat, inventory, menu, copy position, chunk borders, and three
   chat commands: day / night / clear weather), *Coordinates* (Overworld <-> Nether converter that also reads the line F3 + C copies,
   saved places), *Stronghold* (two eye-of-ender throws -> position), *Timers* (furnace / brewing countdowns that buzz, and a day-night
   clock), *Guide* (ore depths, Nether / End facts, F3 keys). Everything except Controls works on the phone alone.
6. **Meeting page (page 9) and "On air" pill**, `widgets/meeting.js`: the agent reports which app uses the microphone or camera;
   while that is true a red "On air" pill shows on every page (tap it to open the Meeting page; nothing switches by itself). The page
   sends each service's own keyboard shortcuts: Google Meet (mute, camera, hand, chat, captions), Microsoft Teams (mute, camera, share,
   hand, leave, open), Discord (mute, deafen, open). Keys go to the window in front on the computer.
7. **Ambient screen** (`ambient.js`, overview button "Ambient screen after N min", default 10): after the panel is left alone, a slowly
   moving gradient in the colours of the hour with a big clock covers the page; a tap brings the page back unchanged. Hours: early light,
   morning (bright), afternoon (clear), evening (calm, dimmer), night (deep, dimmest). It stays away during a call, a prompt, the night
   screen, and music playing on the Music page.
8. **Time colours** (overview button, **off by default**): the same palette as a faint wash behind every page.
9. **Shortcuts for the new pages** live in the agent's settings with ids starting `pb-` (the general Shortcuts page hides them). Add or
   refresh them with `python tools/install-shortcuts.py` (`--remove` takes them out; a copy of the old settings goes to
   `%APPDATA%/PhoneBox/config.before-patch4.json`).

Not possible from this app: using the phone's camera in meetings (a virtual camera needs a driver on the computer, see the answer in the
patch notes of the chat: Windows 11's "Use as a connected camera", Iriun or DroidCam do it).

## Patch 5: optional pages, Minecraft rework, meeting icons, tidy overview

1. **Minecraft and Meeting pages stay hidden until needed** (`visibility.js`). In the overview, *Optional pages* has a choice for each:
   **Auto** (the page appears when the game or your server starts, or when a call is on air, and leaves about 90 s after it ends; you are
   never pulled off the page you are standing on), **Always**, or **Hidden**. The choice is kept on the phone. The "On air" pill
   hides too when Meeting is Hidden.
2. **Minecraft page = Controls + Coordinates only.** Timers, Stronghold and Guide are gone.
   - *Controls*: hot bar (9 slots, the selected one outlined, item colour and initials plus count), health and food, position,
     **game mode** buttons (Survival / Creative / Adventure / Spectator), **Go Home** (types `/trigger home`), the keys and
     Day / Night / Clear sky, what the computer is playing (tap for the Music page), and a **Start server** button that runs
     `start.bat` in `C:\Users\anshu\MinecraftServer\snowblack` and the reader below.
   - *Coordinates*: your live position and last death with Convert / Save, the Overworld <-> Nether converter, saved places.
3. **The live part needs the reader**, `tools/mc-bridge.py`: it asks your local server over RCON for the online player's
   position, hot bar, selected slot, game mode, health, food and last death (read-only `data get entity ...`) and hands it to the
   agent (`/api/push/mc`). One-time setup: `python tools/mc-bridge.py --enable-rcon`, then restart the server (a backup,
   `server.properties.before-phonebox`, is kept). Without it the page still works: keys, game mode, Go Home, converter and notebook
   do not need the server. Tested against a stand-in RCON server (with a 6 KB split reply and tricky item data), not yet against
   your real server.
4. **Game mode and Go Home type chat commands into the game window** (open chat with T, type, Enter), like Day / Night. Game mode needs
   operator rights (you are op on the server); `/trigger home` does not. The game has to be in front on the computer.
5. **Not possible: the track Minecraft itself is playing.** The game's music is played inside the game and is not exposed to the server,
   a log or Windows' media controls. The page shows what the computer's media player is playing instead.
6. **Meeting buttons are icons**, drawn in each app's style: Google Meet (round grey buttons), Microsoft Teams (rounded purple buttons,
   red Leave), Discord (round dark buttons, blurple Open). The camera button is struck through while no app has the camera open (real
   state); the microphone has no state because Windows reports a muted call as "in use" too. The icons are drawn here as simple line
   glyphs; the apps' own icon files are not used.
7. **Overview redesigned** (`extras.css`, `openOverview()` in `main.js`): page tiles with a coloured icon, name and number on the left,
   and settings as grouped rows like the iOS Settings app on the right (Screen: stays awake, ambient screen, time colours, pin;
   Optional pages; Computers). The old mini-maps and row of pills are gone.
8. `tools/install-shortcuts.py` now also installs the game-mode, Go Home and server shortcuts (`--server-dir` if your server folder
   moves). Already run on this computer.

## Patch 6: commands work again, real Minecraft icons, level / hunger / armour, calmer gradient, meeting layout

1. **Why taps did nothing (the important one).** The laptop agent had updated itself to 0.9.24 (before updates were switched off in
   Patch 4) while the phone app was still 0.9.19. 0.9.24 changed the USB link: the adb tunnel now points at a private port that
   only the 0.9.24 app understands. The 0.9.19 app still tried that tunnel first, and for a command (a POST) it never falls back to
   Wi-Fi, so every button that sends something to the computer (play/pause, keys, Start server) failed with "The PC did not take
   that", while reading data still worked over Wi-Fi. **Fix: the panel is now built on the matching 0.9.24 app** (the APK the agent
   had already downloaded and checked, SHA-256 a84f354a...). My changes were merged into 0.9.24's web files (three-way merge:
   stock 0.9.19 / mine / stock 0.9.24; conflicts in `main.js`, `widgets/basic.js`, `widgets/sky.js` resolved by hand, the rest took
   0.9.24's changes). Verified on the phone: a tap on the Music page's play/pause pauses and resumes the laptop's player, and the agent
   log shows the phone on USB. Build with `python tools/patch-apk.py PhoneBox-0.9.24.apk android/app/src/main/assets/www ...`.
2. **Start server** works (it was the same failure). It runs `start.bat` and the reader.
3. **RCON is on** in your `server.properties` (backup: `server.properties.before-phonebox`). The server listens for it on all network
   interfaces, protected by a long random password; keep Windows Firewall's "private networks" box for Java unticked if other devices
   on your network should not be able to try it. Tested with your real server: it started, RCON answered, the reader reported "no
   player"; it has not yet seen a player, so the hot bar itself has only been tested against a stand-in server.
4. **Real item pictures in the hot bar**, plus the game's own hearts, hunger drumsticks and XP bar. `tools/extract-mc-icons.py` copies
   them from your installed 26.2 game (1,153 items, 11 HUD sprites) into `www/mcicons/`, which is in `.gitignore`: they are Mojang's
   and are never committed or pushed; they exist only inside the APK built on your computer. Items with no flat picture (chests,
   beds, banners...) show the coloured tile.
5. **Level, hunger and more**: XP level with progress bar, health (hearts, with absorption), hunger, armour and off-hand pieces, plus
   position, dimension, in-game day and time in the status line (`tools/mc-bridge.py` reads them from the server).
6. **Meeting page**: the explanation and the "use this phone as the laptop camera" tip moved to the top right; the buttons fill the
   rest of the page and scale with it.
7. **Music gradient** is calmer: one hue from the cover plus a close neighbour and a deep tone, always soft and dark (no more
   contrasting second colour).
8. The ambient screen, hidden pages and overview from Patch 4 / 5 carry over unchanged.
