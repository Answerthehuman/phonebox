#!/usr/bin/env python3
"""
Builds the item pictures the Minecraft page shows, from YOUR installed game, the way the inventory draws them: flat items use
their own texture, blocks are rendered as the little isometric cubes (stairs, slabs, fences, trapdoors... from the game's own
models). Also copies the HUD sprites (hearts, hunger, armour, XP bar).

    python tools/extract-mc-icons.py                       # newest version found in %APPDATA%/.minecraft/versions
    python tools/extract-mc-icons.py path/to/26.2.jar      # a specific game jar

Output: android/app/src/main/assets/www/mcicons/ (in .gitignore: the pictures are Mojang's, they only go into the APK you
build for your own phone, never into git). Needs Pillow and numpy (pip install pillow numpy).
"""
import io, json, math, os, re, sys, zipfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'android', 'app', 'src', 'main', 'assets', 'www', 'mcicons'))
SIZE = 64


def find_jar():
    root = os.path.join(os.environ.get('APPDATA', ''), '.minecraft', 'versions')
    best = None
    for name in os.listdir(root) if os.path.isdir(root) else []:
        jar = os.path.join(root, name, name + '.jar')
        if re.fullmatch(r'\d+(\.\d+)*', name) and os.path.exists(jar):
            key = tuple(int(p) for p in name.split('.'))
            if best is None or key > best[0]:
                best = (key, jar)
    return best[1] if best else None


class Pack:
    def __init__(self, jar):
        self.z = zipfile.ZipFile(jar)
        self.names = set(self.z.namelist())
        self._json, self._tex = {}, {}

    def json(self, path):
        if path not in self._json:
            self._json[path] = json.loads(self.z.read(path)) if path in self.names else None
        return self._json[path]

    def model(self, ref):
        ref = ref.replace('minecraft:', '')
        return self.json(f'assets/minecraft/models/{ref}.json')

    def texture(self, ref):
        """RGBA numpy array of the first frame (animated strips are tall), or None."""
        ref = ref.replace('minecraft:', '')
        if ref not in self._tex:
            p = f'assets/minecraft/textures/{ref}.png'
            if p in self.names:
                im = Image.open(io.BytesIO(self.z.read(p))).convert('RGBA')
                if im.height > im.width:
                    im = im.crop((0, 0, im.width, im.width))
                self._tex[ref] = np.array(im)
            else:
                self._tex[ref] = None
        return self._tex[ref]


# ---------------------------------------------------------------- models
def item_model(node):
    """The model id an items/<id>.json definition points at (first sensible branch), or None."""
    if not isinstance(node, dict):
        return None
    t = node.get('type', '').replace('minecraft:', '')
    if t == 'model':
        return node.get('model')
    if t == 'condition':
        return item_model(node.get('on_false')) or item_model(node.get('on_true'))
    if t in ('select', 'range_dispatch'):
        if node.get('fallback'):
            return item_model(node['fallback'])
        for c in node.get('cases', []) + node.get('entries', []):
            m = item_model(c.get('model'))
            if m:
                return m
    if t == 'composite':
        for c in node.get('models', []):
            m = item_model(c)
            if m:
                return m
    if t == 'special':
        return node.get('base')
    return None


def resolve(pack, ref):
    """Merges a model with its parents: textures, elements, display.gui, and whether it is a flat 'generated' item."""
    textures, elements, gui, flat, entity = {}, None, None, False, False
    chain = []
    while ref:
        r = ref.replace('minecraft:', '')
        if r in ('builtin/generated',):
            flat = True
            break
        if r.startswith('builtin/'):
            entity = True
            break
        m = pack.model(ref)
        if not m:
            break
        chain.append(m)
        ref = m.get('parent')
    for m in reversed(chain):                      # root first, so children override
        textures.update(m.get('textures', {}))
        if 'elements' in m:
            elements = m['elements']
        if 'gui' in m.get('display', {}):
            gui = m['display']['gui']
    return {'textures': textures, 'elements': elements, 'gui': gui, 'flat': flat and elements is None, 'entity': entity}


def tex_ref(textures, v):
    seen = 0
    while isinstance(v, str) and v.startswith('#') and seen < 12:
        v = textures.get(v[1:]); seen += 1
    return v if isinstance(v, str) and not v.startswith('#') else None


TINTS = [(r'leaves|vine|grass_block|fern|grass|sugar_cane|lily', (124, 189, 107)), (r'water|cauldron', (63, 118, 228)),
         (r'birch_leaves', (128, 167, 85)), (r'spruce_leaves', (97, 153, 97))]


def tint_for(name):
    for pat, c in TINTS:
        if re.search(pat, name):
            return c
    return None


# ---------------------------------------------------------------- the isometric renderer
FACES = {   # corner order as seen from outside: top-left, top-right, bottom-right, bottom-left; (axis positions: x1/x2, y1/y2, z1/z2)
    'north': lambda x1, y1, z1, x2, y2, z2: [(x2, y2, z1), (x1, y2, z1), (x1, y1, z1), (x2, y1, z1)],
    'south': lambda x1, y1, z1, x2, y2, z2: [(x1, y2, z2), (x2, y2, z2), (x2, y1, z2), (x1, y1, z2)],
    'west': lambda x1, y1, z1, x2, y2, z2: [(x1, y2, z1), (x1, y2, z2), (x1, y1, z2), (x1, y1, z1)],
    'east': lambda x1, y1, z1, x2, y2, z2: [(x2, y2, z2), (x2, y2, z1), (x2, y1, z1), (x2, y1, z2)],
    'up': lambda x1, y1, z1, x2, y2, z2: [(x1, y2, z1), (x2, y2, z1), (x2, y2, z2), (x1, y2, z2)],
    'down': lambda x1, y1, z1, x2, y2, z2: [(x1, y1, z2), (x2, y1, z2), (x2, y1, z1), (x1, y1, z1)],
}
DEFAULT_UV = {
    'up': lambda x1, y1, z1, x2, y2, z2: (x1, z1, x2, z2),
    'down': lambda x1, y1, z1, x2, y2, z2: (x1, 16 - z2, x2, 16 - z1),
    'north': lambda x1, y1, z1, x2, y2, z2: (16 - x2, 16 - y2, 16 - x1, 16 - y1),
    'south': lambda x1, y1, z1, x2, y2, z2: (x1, 16 - y2, x2, 16 - y1),
    'west': lambda x1, y1, z1, x2, y2, z2: (z1, 16 - y2, z2, 16 - y1),
    'east': lambda x1, y1, z1, x2, y2, z2: (16 - z2, 16 - y2, 16 - z1, 16 - y1),
}
NORMAL = {'north': (0, 0, -1), 'south': (0, 0, 1), 'west': (-1, 0, 0), 'east': (1, 0, 0), 'up': (0, 1, 0), 'down': (0, -1, 0)}


def rot(axis, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return np.array({'x': [[1, 0, 0], [0, c, -s], [0, s, c]], 'y': [[c, 0, s], [0, 1, 0], [-s, 0, c]], 'z': [[c, -s, 0], [s, c, 0], [0, 0, 1]]}[axis], float)


def render_model(pack, res, name):
    textures, elements = res['textures'], res['elements']
    gui = res['gui'] or {'rotation': [30, 225, 0]}
    rx, ry, rz = gui.get('rotation', [30, 225, 0])
    R = rot('x', rx) @ rot('y', -ry) @ rot('z', rz)           # the game turns the model the other way round: 225 shows north and west
    quads = []
    for el in elements:
        x1, y1, z1 = el['from']; x2, y2, z2 = el['to']
        er = el.get('rotation')
        for face, f in el.get('faces', {}).items():
            if face not in FACES:
                continue
            ref = tex_ref(textures, f.get('texture'))
            tex = pack.texture(ref) if ref else None
            if tex is None:
                continue
            corners = np.array(FACES[face](x1, y1, z1, x2, y2, z2), float)
            normal = np.array(NORMAL[face], float)
            if er:
                M = rot(er['axis'], er['angle']); o = np.array(er['origin'], float)
                corners = (corners - o) @ M.T + o; normal = M @ normal
            c3 = (corners - 8) @ R.T
            n3 = R @ normal
            if n3[2] <= 1e-6:
                continue                                         # facing away from the viewer
            u1, v1, u2, v2 = f.get('uv') or DEFAULT_UV[face](x1, y1, z1, x2, y2, z2)
            uv = [(u1, v1), (u2, v1), (u2, v2), (u1, v2)]
            for _ in range((f.get('rotation', 0) // 90) % 4):
                uv = uv[3:] + uv[:3]
            shade = 1.0 if n3[1] > 0.5 else (0.84 if n3[0] < 0 else 0.66)
            tint = tint_for(ref) if 'tintindex' in f else None
            quads.append((c3, uv, tex, shade, tint))
    if not quads:
        return None
    allc = np.concatenate([q[0] for q in quads])
    xs, ys = allc[:, 0], -allc[:, 1]
    span = max(xs.max() - xs.min(), ys.max() - ys.min(), 1e-6)
    k = SIZE * 0.94 / span
    cx, cy = (xs.max() + xs.min()) / 2, (ys.max() + ys.min()) / 2
    img = np.zeros((SIZE, SIZE, 4), np.float32)
    zbuf = np.full((SIZE, SIZE), -1e9, np.float32)
    for c3, uv, tex, shade, tint in quads:
        P = np.stack([(c3[:, 0] - cx) * k + SIZE / 2, (-c3[:, 1] - cy) * k + SIZE / 2], 1)
        Z = c3[:, 2]
        th, tw = tex.shape[:2]
        UV = np.array(uv, float) * np.array([tw / 16, th / 16])
        for tri in ((0, 1, 2), (0, 2, 3)):
            a, b, c = (P[i] for i in tri)
            minx, maxx = int(max(0, math.floor(min(a[0], b[0], c[0])))), int(min(SIZE - 1, math.ceil(max(a[0], b[0], c[0]))))
            miny, maxy = int(max(0, math.floor(min(a[1], b[1], c[1])))), int(min(SIZE - 1, math.ceil(max(a[1], b[1], c[1]))))
            if minx > maxx or miny > maxy:
                continue
            gx, gy = np.meshgrid(np.arange(minx, maxx + 1) + 0.5, np.arange(miny, maxy + 1) + 0.5)
            det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(det) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / det
            l2 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / det
            l3 = 1 - l1 - l2
            inside = (l1 >= -1e-3) & (l2 >= -1e-3) & (l3 >= -1e-3)
            if not inside.any():
                continue
            ia, ib, ic = tri
            u = l1 * UV[ia][0] + l2 * UV[ib][0] + l3 * UV[ic][0]
            v = l1 * UV[ia][1] + l2 * UV[ib][1] + l3 * UV[ic][1]
            z = l1 * Z[ia] + l2 * Z[ib] + l3 * Z[ic]
            tx = np.clip(np.floor(u).astype(int), 0, tw - 1); ty = np.clip(np.floor(v).astype(int), 0, th - 1)
            px = tex[ty, tx].astype(np.float32)
            ok = inside & (px[..., 3] > 20)
            sub_z = zbuf[miny:maxy + 1, minx:maxx + 1]
            ok &= z > sub_z - 1e-4
            rgb = px[..., :3] * shade
            if tint:
                rgb = rgb * (np.array(tint, np.float32) / 255)
            sub = img[miny:maxy + 1, minx:maxx + 1]
            sub[ok, :3] = rgb[ok]; sub[ok, 3] = 255
            sub_z[ok] = z[ok]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGBA')


def render_flat(pack, res, name):
    layers = []
    for i in range(5):
        ref = tex_ref(res['textures'], res['textures'].get(f'layer{i}'))
        tex = pack.texture(ref) if ref else None
        if tex is not None:
            layers.append((i, ref, tex))
    if not layers:
        return None
    base = Image.fromarray(layers[0][2], 'RGBA')
    for i, ref, tex in layers[1:]:
        ov = Image.fromarray(tex, 'RGBA')
        tint = (56, 93, 198) if 'potion' in name or 'overlay' in ref else None    # potions: the water-blue liquid; dyed leather keeps its own look
        if tint:
            a = np.array(ov).astype(np.float32); a[..., :3] *= np.array(tint, np.float32) / 255; ov = Image.fromarray(a.astype(np.uint8), 'RGBA')
        base = Image.alpha_composite(base, ov.resize(base.size, Image.NEAREST))
    if re.search(r'^leather_(helmet|chestplate|leggings|boots)$', name) or name == 'leather_horse_armor':
        pass
    return base.resize((SIZE, SIZE), Image.NEAREST)



def box(frm, to, tex, u, v, w, h, d, tw=64):
    """A model element for a Minecraft 'box' entity model: UVs unfold as top / bottom / west / north / east / south from (u, v)."""
    k = 16 / tw
    def uv(x, y, a, b):
        return [x * k, y * k, (x + a) * k, (y + b) * k]
    faces = {
        'up': {'uv': uv(u + d, v, w, d), 'texture': '#t'}, 'down': {'uv': uv(u + d + w, v, w, d), 'texture': '#t'},
        'west': {'uv': uv(u, v + d, d, h), 'texture': '#t'}, 'north': {'uv': uv(u + d, v + d, w, h), 'texture': '#t'},
        'east': {'uv': uv(u + d + w, v + d, d, h), 'texture': '#t'}, 'south': {'uv': uv(u + d + w + d, v + d, w, h), 'texture': '#t'},
    }
    return {'from': frm, 'to': to, 'faces': faces}


def special(pack, it):
    """Chests and shulker boxes are drawn by the game from entity textures, not item models: rebuilt here from their box layout."""
    gui = {'rotation': [30, 45, 0]}
    chests = {'chest': 'entity/chest/normal', 'trapped_chest': 'entity/chest/trapped', 'ender_chest': 'entity/chest/ender'}
    if it in chests:
        t = chests[it]
        # the front of a chest faces south in the item picture: the unfolded layout puts the latch side on 'south' of the model
        els = [box([1, 0, 1], [15, 10, 15], t, 0, 19, 14, 10, 14), box([1, 10, 1], [15, 15, 15], t, 0, 0, 14, 5, 14)]
        return {'textures': {'t': t}, 'elements': els, 'gui': gui, 'flat': False, 'entity': False}
    m = re.fullmatch(r'(?:(\w+)_)?shulker_box', it)
    if m:
        t = f'entity/shulker/shulker_{m.group(1)}' if m.group(1) else 'entity/shulker/shulker'
        els = [box([0, 0, 0], [16, 8, 16], t, 0, 28, 16, 8, 16), box([0, 8, 0], [16, 20, 16], t, 0, 0, 16, 12, 16)]
        for e in els:
            e['to'][1] = min(e['to'][1], 16)
        els[1]['from'][1], els[1]['to'][1] = 8, 16
        return {'textures': {'t': t}, 'elements': els, 'gui': gui, 'flat': False, 'entity': False}
    return None


def main():
    jar = sys.argv[1] if len(sys.argv) > 1 else find_jar()
    if not jar or not os.path.exists(jar):
        sys.exit('No Minecraft game jar found. Give the path to one, e.g. %APPDATA%\\.minecraft\\versions\\26.2\\26.2.jar')
    pack = Pack(jar)
    items = sorted(n.split('/')[-1][:-5] for n in pack.names if n.startswith('assets/minecraft/items/') and n.endswith('.json'))
    os.makedirs(os.path.join(OUT, 'hud'), exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.png'):
            os.remove(os.path.join(OUT, f))
    made, solid, flat, missing = 0, 0, 0, []
    for it in items:
        d = pack.json(f'assets/minecraft/items/{it}.json')
        ref = item_model((d or {}).get('model'))
        img = None
        sp = special(pack, it)
        if ref or sp:
            res = sp or resolve(pack, ref)
            try:
                if res['elements']:
                    img = render_model(pack, res, it); solid += 1 if img else 0
                elif res['flat']:
                    img = render_flat(pack, res, it); flat += 1 if img else 0
            except Exception as e:                       # a strange model must not stop the rest
                print('skip', it, repr(e))
        if img is None:
            missing.append(it); continue
        img.save(os.path.join(OUT, it + '.png'), optimize=True)
        made += 1
    hud = 0
    for n in pack.names:
        m = re.fullmatch(r'assets/minecraft/textures/gui/sprites/hud/((?:heart/)?(?:full|half|container)|food_(?:full|half|empty)|armor_(?:full|half|empty)|experience_bar_(?:background|progress))\.png', n)
        if m:
            with open(os.path.join(OUT, 'hud', m.group(1).replace('heart/', 'heart_') + '.png'), 'wb') as f:
                f.write(pack.z.read(n))
            hud += 1
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump({'jar': os.path.basename(jar), 'items': made, 'hud': hud, 'missing': missing}, f)
    print(f'{os.path.basename(jar)}: {made} item pictures ({solid} rendered blocks, {flat} flat), {hud} HUD sprites -> {OUT}')
    print(f'{len(missing)} without a picture (drawn by special renderers in the game): {", ".join(missing[:40])}{" ..." if len(missing) > 40 else ""}')


if __name__ == '__main__':
    main()
