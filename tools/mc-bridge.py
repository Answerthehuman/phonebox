#!/usr/bin/env python3
"""
Minecraft bridge for the phone panel: reads your local server over RCON and hands the result to the PhoneBox agent, so
the Minecraft page can show the hot bar, position, game mode, health and food of the player who is online.

    python tools/mc-bridge.py --enable-rcon     # once: turns RCON on in server.properties (a backup is kept), then restart the server
    python tools/mc-bridge.py                   # runs until the server has been gone for 15 minutes (the panel's "Start server" runs it)
    python tools/mc-bridge.py --once            # one reading printed as JSON, nothing sent (for checking)

It only READS (`list`, `data get entity ...`); it never changes the world. Everything stays on this computer: RCON on
127.0.0.1, the agent on 127.0.0.1:8765. Standard library only.

About RCON: the server listens for it on the server's network address, protected by the password in server.properties.
--enable-rcon makes a long random one. If other computers on your network must not be able to try it, leave Windows Firewall's
"private networks" box for Java unticked, or keep the world's network closed; the page works the same either way.
"""
import argparse, json, os, re, secrets, socket, struct, sys, time, urllib.request

DEFAULT_DIR = r'C:\Users\anshu\MinecraftServer\snowblack'
LOCK_PORT = 25599                      # a local port held while running, so a second copy exits at once
MODES = {0: 'survival', 1: 'creative', 2: 'adventure', 3: 'spectator'}


# ---------------------------------------------------------------- RCON
class Rcon:
    def __init__(self, host, port, password, timeout=3.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.n = 10
        self._send(1, 3, password)
        pid, _, _ = self._recv()
        if pid == -1:
            raise PermissionError('RCON password refused')

    def _send(self, rid, kind, body):
        data = struct.pack('<ii', rid, kind) + body.encode('utf-8') + b'\x00\x00'
        self.sock.sendall(struct.pack('<i', len(data)) + data)

    def _recv(self):
        raw = self._read(4)
        (size,) = struct.unpack('<i', raw)
        data = self._read(size)
        rid, kind = struct.unpack('<ii', data[:8])
        return rid, kind, data[8:-2].decode('utf-8', 'replace')

    def _read(self, n):
        buf = b''
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError('RCON closed')
            buf += chunk
        return buf

    def command(self, text):
        """Runs a command. A long answer comes in several packets, so a second, unknown request is sent right behind it:
        its answer marks the end."""
        self.n += 2
        rid, end = self.n, self.n + 1
        self._send(rid, 2, text)
        self._send(end, 100, '')
        out = []
        while True:
            got, _, body = self._recv()
            if got == end:
                break
            if got == rid:
                out.append(body)
        return ''.join(out)

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


# ---------------------------------------------------------------- reading Minecraft's text format (SNBT)
def after_data(text):
    """'Name has the following entity data: <value>' -> '<value>'; None when the answer is an error."""
    m = re.search(r'entity data: (.*)$', text.strip(), re.S)
    return m.group(1).strip() if m else None


def split_top(text, open_ch='{', close_ch='}'):
    """Top-level {...} pieces of a [{...}, {...}] list, aware of strings and nesting."""
    parts, depth, start, quote, esc = [], 0, 0, None, False
    for i, c in enumerate(text):
        if quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == quote:
                quote = None
            continue
        if c in '"\'':
            quote = c
        elif c in '{[':
            if c == open_ch and depth == 1:
                start = i
            depth += 1
        elif c in '}]':
            depth -= 1
            if c == close_ch and depth == 1:
                parts.append(text[start:i + 1])
    return parts


def top_value(obj, key):
    """The raw value of `key` directly inside one {...} (not in a nested compound), or None."""
    depth, quote, esc, i, n = 0, None, False, 0, len(obj)
    while i < n:
        c = obj[i]
        if quote:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == quote:
                quote = None
            i += 1
            continue
        if c in '"\'':
            quote = c
        elif c in '{[':
            depth += 1
        elif c in '}]':
            depth -= 1
        elif depth == 1 and obj.startswith(key, i) and (i == 0 or obj[i - 1] in '{, ') and obj[i + len(key):i + len(key) + 1] == ':':
            j = i + len(key) + 1
            while j < n and obj[j] == ' ':
                j += 1
            k, d2, q2 = j, 0, None
            while k < n:
                ch = obj[k]
                if q2:
                    if ch == q2:
                        q2 = None
                elif ch in '"\'':
                    q2 = ch
                elif ch in '{[':
                    d2 += 1
                elif ch in '}]':
                    if d2 == 0:
                        break
                    d2 -= 1
                elif ch == ',' and d2 == 0:
                    break
                k += 1
            return obj[j:k].strip()
        i += 1
    return None


def number(raw, default=None):
    if raw is None:
        return default
    m = re.match(r'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?', raw.strip())
    return float(m.group(0)) if m else default


def parse_inventory(text):
    """Hot bar only: slots 0-8, as [{slot, id, count}]."""
    raw = after_data(text) or ''
    items = []
    for obj in split_top(raw):
        slot = number(top_value(obj, 'Slot'))
        if slot is None or not 0 <= slot <= 8:
            continue
        ident = (top_value(obj, 'id') or '').strip('"\'')
        count = number(top_value(obj, 'count'), number(top_value(obj, 'Count'), 1))
        items.append({'slot': int(slot), 'id': ident.replace('minecraft:', ''), 'count': int(count or 1)})
    return sorted(items, key=lambda i: i['slot'])


def parse_equipment(text):
    """Armour and off hand from `data get entity NAME equipment`: {head, chest, legs, feet, offhand} -> item id or None."""
    raw = (after_data(text) or '').strip()
    out = {}
    for slot in ('head', 'chest', 'legs', 'feet', 'offhand'):
        obj = top_value(raw, slot) if raw.startswith('{') else None
        ident = top_value(obj, 'id') if obj and obj.startswith('{') else None
        out[slot] = ident.strip('"\'').replace('minecraft:', '') if ident else None
    return out


def read_player(r, name):
    """One `data get entity NAME` for everything (each RCON command waits for a server tick, and a busy server answers slowly,
    so the fewer commands the better), then the fields are cut out of that one answer."""
    raw = (after_data(r.command(f'data get entity {name}')) or '').strip()
    if not raw.startswith('{'):
        raise ValueError('no player data')

    def field(key):
        return top_value(raw, key)

    def clock(what):
        """Older games answer 'The time is N'; 26.x answers 'Timeline minecraft:day is at N tick(s)'."""
        m = re.search(r'(?:time is|is at) (-?\d+)', r.command('time query ' + what))
        return int(m.group(1)) if m else None

    pos = [round(float(v), 1) for v in re.findall(r'-?\d+(?:\.\d+)?(?=d)', field('Pos') or '')][:3]
    mode = number(field('playerGameType'))
    death = re.search(r'pos: \[I; (-?\d+), (-?\d+), (-?\d+)\]', field('LastDeathLocation') or '')
    eq = field('equipment') or ''
    equip = {}
    for slot in ('head', 'chest', 'legs', 'feet', 'offhand'):
        obj = top_value(eq, slot) if eq.startswith('{') else None
        ident = top_value(obj, 'id') if obj and obj.startswith('{') else None
        equip[slot] = ident.strip('"\'').replace('minecraft:', '') if ident else None
    return {
        'death': [int(v) for v in death.groups()] if death else None,
        'player': name,
        'pos': pos if len(pos) == 3 else None,
        'dim': (field('Dimension') or '').strip('"').replace('minecraft:', '') or None,
        'mode': MODES.get(int(mode)) if mode is not None else None,
        'slot': int(number(field('SelectedItemSlot'), 0)),
        'health': number(field('Health')),
        'absorb': number(field('AbsorptionAmount')),
        'food': number(field('foodLevel')),
        'sat': number(field('foodSaturationLevel')),
        'level': int(number(field('XpLevel'), 0)),
        'xp': number(field('XpP'), 0.0),
        'daytime': clock('day'),
        'day': None,
        'armor': equip,
        'hotbar': parse_inventory('x has the following entity data: ' + (field('Inventory') or '[]')),
    }


def online_players(r):
    m = re.search(r'online: ?(.*)$', r.command('list').strip())
    return [p.strip() for p in (m.group(1).split(',') if m else []) if p.strip()]


# ---------------------------------------------------------------- the server's properties
def props(path):
    out = {}
    try:
        for line in open(path, encoding='utf-8'):
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.rstrip('\r\n').split('=', 1)
                out[k.strip()] = v
    except OSError:
        pass
    return out


def enable_rcon(server_dir):
    path = os.path.join(server_dir, 'server.properties')
    if not os.path.exists(path):
        sys.exit(f'No server.properties in {server_dir}')
    p = props(path)
    password = p.get('rcon.password') or secrets.token_urlsafe(24)
    want = {'enable-rcon': 'true', 'rcon.password': password, 'rcon.port': p.get('rcon.port') or '25575', 'broadcast-rcon-to-ops': 'false'}
    backup = path + '.before-phonebox'
    if not os.path.exists(backup):
        open(backup, 'wb').write(open(path, 'rb').read())
        print('backup of the old file:', backup)
    lines, seen = [], set()
    for line in open(path, encoding='utf-8').read().splitlines():
        k = line.split('=', 1)[0].strip()
        if '=' in line and k in want and not line.lstrip().startswith('#'):
            lines.append(f'{k}={want[k]}'); seen.add(k)
        else:
            lines.append(line)
    lines += [f'{k}={v}' for k, v in want.items() if k not in seen]
    open(path, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
    print('RCON is on in server.properties. Restart the Minecraft server for it to take effect (port', want['rcon.port'] + ').')


# ---------------------------------------------------------------- talking to the agent
def push(agent, data, ttl=12):
    req = urllib.request.Request(f'{agent}/api/push/mc?ttl={ttl}', data=json.dumps(data).encode('utf-8'), method='POST',
                                 headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req, timeout=3).read()


_conn = {'r': None}      # one RCON connection kept open between readings (a new one every second filled the server log and cost it threads)


def drop():
    if _conn['r']:
        _conn['r'].close()
    _conn['r'] = None


def poll(server_dir, player=None, host='127.0.0.1', port=None, password=None):
    """One reading: a dict that the panel shows."""
    p = props(os.path.join(server_dir, 'server.properties'))
    port = port or int(p.get('rcon.port') or 25575)
    password = password if password is not None else p.get('rcon.password', '')
    if password == '' and p.get('enable-rcon') != 'true':
        return {'status': 'rcon-off'}
    if _conn['r'] is None:
        try:
            _conn['r'] = Rcon(host, port, password, timeout=20.0)      # a busy server answers slowly: wait for it
        except PermissionError:
            return {'status': 'rcon-password'}
        except OSError:
            return {'status': 'down'}
    r = _conn['r']
    try:
        names = online_players(r)
        if not names:
            return {'status': 'no-player'}
        name = player if player in names else names[0]
        return {'status': 'ok', **read_player(r, name), 'players': names}
    except ValueError:
        return {'status': 'down'}              # the connection is fine, the answer was not (a player just left): ask again
    except (OSError, ConnectionError):
        drop()
        return {'status': 'down'}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dir', default=DEFAULT_DIR, help='the server folder (where server.properties is)')
    ap.add_argument('--agent', default='http://127.0.0.1:8765')
    ap.add_argument('--player', help='which player to follow when several are online')
    ap.add_argument('--enable-rcon', action='store_true')
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--rcon-port', type=int)
    ap.add_argument('--password')
    a = ap.parse_args()

    if a.enable_rcon:
        return enable_rcon(a.dir)
    if a.once:
        print(json.dumps(poll(a.dir, a.player, port=a.rcon_port, password=a.password), indent=1))
        return
    lock = socket.socket()
    try:
        lock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        return                                            # already running
    last, last_sent, gone_since, good = None, 0, None, None
    while True:
        data = poll(a.dir, a.player, port=a.rcon_port, password=a.password)
        # one failed reading (a lagging server, a dropped connection) must not blank the panel: keep the last good one for 20 s
        if data['status'] == 'ok':
            good = (data, time.time())
        elif data['status'] == 'down' and good and time.time() - good[1] < 20:
            data = dict(good[0])
        data['at'] = int(time.time() * 1000)
        gone_since = (gone_since or time.time()) if data['status'] in ('down', 'rcon-off') else None
        if gone_since and time.time() - gone_since > 900:
            return
        core = {k: v for k, v in data.items() if k != 'at'}
        if core != last or time.time() - last_sent > 5:   # a change goes out at once, otherwise every 5 s so the panel knows we are alive
            try:
                push(a.agent, data, ttl=30)
                last, last_sent = core, time.time()
            except OSError:
                pass
        time.sleep(3.0 if data['status'] == 'ok' else 5.0)


if __name__ == '__main__':
    main()
