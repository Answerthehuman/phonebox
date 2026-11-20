#!/usr/bin/env python3
"""
Adds the keys the Minecraft and Meeting pages use to the PhoneBox agent on THIS computer, and (optionally) cuts the
agent loose from the original project's update feed.

    python tools/install-shortcuts.py              # add / refresh the pb-mc-* and pb-mt-* shortcuts
    python tools/install-shortcuts.py --no-updates # also stop the agent checking ersinkoc/phonebox for releases
    python tools/install-shortcuts.py --remove     # take the shortcuts out again
    python tools/install-shortcuts.py --dry-run    # show what would change, write nothing

How: the agent's own settings API (http://127.0.0.1:8765/api/settings, this computer only) is read, changed and written
back with the version it gave, so the running agent keeps working and nothing else in your settings is touched. A copy of
the settings as they were goes to %APPDATA%/PhoneBox/config.before-patch4.json first. The shortcuts are keyboard keys
sent to the window in front on this computer (the Windows key presser the agent already has), plus "open the app" links
and, for Minecraft, start.bat of your server and the reader (tools/mc-bridge.py). Their ids start with "pb-", which the phone's general Shortcuts page hides. Standard library only.
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

BASE = 'http://127.0.0.1:8765'
OWN_REPO = 'Answerthehuman/phonebox'   # a repository with no releases: nothing to offer, nothing to install


def key(id_, label, keys, icon='⌨️', color='#62c554'):
    return {'id': id_, 'label': label, 'icon': icon, 'color': color, 'cmd': 'builtin:keys', 'args': keys, 'toggle': False}


def macro(id_, label, steps, icon='⌨️', color='#0a84ff'):
    return {'id': id_, 'label': label, 'icon': icon, 'color': color, 'cmd': 'builtin:macro', 'steps': steps, 'toggle': False}


def link(id_, label, cmd, icon='↗', color='#8e8e93'):
    return {'id': id_, 'label': label, 'icon': icon, 'color': color, 'cmd': cmd, 'toggle': False}


def say(text):
    # a chat command: open chat, type it, send it
    return ['keys:t', 'wait:350', f'text:{text}', 'wait:120', 'keys:enter']


def build(server_dir):
    here = os.path.dirname(os.path.abspath(__file__))
    py = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')       # no console window for the reader
    if not os.path.exists(py):
        py = sys.executable
    bridge = {'id': 'pb-mc-bridge', 'label': 'MC reader', 'icon': '👁', 'color': '#62c554', 'cmd': py,
              'args': f'"{os.path.join(here, "mc-bridge.py")}" --dir "{server_dir}"', 'toggle': False}
    bat = {'id': 'pb-mc-server-bat', 'label': 'MC server', 'icon': '🖥', 'color': '#62c554', 'cmd': os.path.join(server_dir, 'start.bat'), 'cwd': server_dir, 'toggle': False}
    return [
        # ---- Minecraft (Java keys; F3 combinations as in the game's own debug screen)
        key('pb-mc-shot', 'MC screenshot', 'f2'), key('pb-mc-hud', 'MC hide HUD', 'f1'), key('pb-mc-debug', 'MC debug screen', 'f3'),
        key('pb-mc-view', 'MC camera view', 'f5'), key('pb-mc-full', 'MC full screen', 'f11'),
        key('pb-mc-chat', 'MC chat', 't'), key('pb-mc-inv', 'MC inventory', 'e'), key('pb-mc-esc', 'MC menu', 'esc'),
        key('pb-mc-copy', 'MC copy position', 'f3+c'), key('pb-mc-map', 'MC chunk borders', 'f3+g'),
        macro('pb-mc-day', 'MC day', say('/time set day')), macro('pb-mc-night', 'MC night', say('/time set night')),
        macro('pb-mc-clear', 'MC clear weather', say('/weather clear')),
        macro('pb-mc-gm-survival', 'MC survival', say('/gamemode survival')), macro('pb-mc-gm-creative', 'MC creative', say('/gamemode creative')),
        macro('pb-mc-gm-adventure', 'MC adventure', say('/gamemode adventure')), macro('pb-mc-gm-spectator', 'MC spectator', say('/gamemode spectator')),
        macro('pb-mc-home', 'MC go home', say('/trigger home'), icon='🏠'),
        bat, bridge, macro('pb-mc-server', 'MC start server', ['shortcut:pb-mc-server-bat', 'wait:2500', 'shortcut:pb-mc-bridge'], icon='▶️', color='#62c554'),
        # ---- Google Meet (browser tab in front)
        key('pb-mt-meet-mic', 'Meet mute', 'ctrl+d'), key('pb-mt-meet-cam', 'Meet camera', 'ctrl+e'),
        key('pb-mt-meet-hand', 'Meet raise hand', 'ctrl+alt+h'), key('pb-mt-meet-chat', 'Meet chat', 'ctrl+alt+c'), key('pb-mt-meet-cc', 'Meet captions', 'c'),
        # ---- Microsoft Teams
        key('pb-mt-teams-mic', 'Teams mute', 'ctrl+shift+m'), key('pb-mt-teams-cam', 'Teams camera', 'ctrl+shift+o'),
        key('pb-mt-teams-share', 'Teams share screen', 'ctrl+shift+e'), key('pb-mt-teams-hand', 'Teams raise hand', 'ctrl+shift+k'),
        key('pb-mt-teams-leave', 'Teams leave', 'ctrl+shift+h'), link('pb-mt-teams-front', 'Teams open', 'msteams:'),
        # ---- Discord
        key('pb-mt-discord-mic', 'Discord mute', 'ctrl+shift+m'), key('pb-mt-discord-deaf', 'Discord deafen', 'ctrl+shift+d'),
        link('pb-mt-discord-front', 'Discord open', 'discord://'),
    ]


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=8) as r:
        return r.read(), r.headers


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--remove', action='store_true', help='remove the pb-* shortcuts instead of adding them')
    ap.add_argument('--no-updates', action='store_true', help="stop the agent checking the original project's releases")
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--server-dir', default=r'C:\Users\anshu\MinecraftServer\snowblack', help='your Minecraft server folder (where start.bat is)')
    a = ap.parse_args()

    try:
        raw, hdr = call('GET', '/api/settings')
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f'Could not reach the PhoneBox agent on this computer ({e}). Is it running?')
    cfg = json.loads(raw.decode('utf-8'))
    version = hdr.get('X-Config-Version')

    have = {s['id']: s for s in cfg.get('shortcuts', [])}
    if a.remove:
        cfg['shortcuts'] = [s for s in cfg.get('shortcuts', []) if not s['id'].startswith('pb-')]
        print(f'removing {len(have) - len(cfg["shortcuts"])} shortcuts')
    else:
        added = updated = 0
        keep = [s for s in cfg.get('shortcuts', []) if not s['id'].startswith('pb-')]
        SHORTCUTS = build(a.server_dir)
        for s in SHORTCUTS:
            if s['id'] in have:
                updated += 1
            else:
                added += 1
        cfg['shortcuts'] = keep + SHORTCUTS
        print(f'shortcuts: {added} added, {updated} refreshed, {len(keep)} of yours left alone')
    if a.no_updates:
        u = cfg.setdefault('updates', {})
        print(f'updates: auto {u.get("auto")} -> False, repo {u.get("repo")} -> {OWN_REPO}')
        u['auto'] = False
        u['repo'] = OWN_REPO

    if a.dry_run:
        print('dry run: nothing written')
        return
    backup = os.path.join(os.environ.get('APPDATA', '.'), 'PhoneBox', 'config.before-patch4.json')
    if not os.path.exists(backup):
        with open(backup, 'wb') as f:
            f.write(raw)
        print('settings as they were saved to', backup)
    body = json.dumps(cfg, ensure_ascii=False).encode('utf-8')
    headers = {'Content-Type': 'application/json'}
    if version:
        headers['X-Config-Version'] = version
    try:
        call('PUT', '/api/settings', body, headers)
    except urllib.error.HTTPError as e:
        sys.exit(f'The agent refused the settings ({e.code}): {e.read().decode("utf-8", "replace")[:300]}')
    print('saved. The phone picks the new keys up within a few seconds.')


if __name__ == '__main__':
    main()
