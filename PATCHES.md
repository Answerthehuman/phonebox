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
