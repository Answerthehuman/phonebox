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
