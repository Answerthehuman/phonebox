#!/usr/bin/env python3
"""
Copies Minecraft's own item pictures and HUD sprites (hearts, hunger, armour, XP bar) out of YOUR installed game into the
panel's web folder, so the Minecraft page can show real icons in the hot bar.

    python tools/extract-mc-icons.py                       # newest version found in %APPDATA%/.minecraft/versions
    python tools/extract-mc-icons.py path/to/26.2.jar      # a specific game jar

They go to android/app/src/main/assets/www/mcicons/ and from there into the APK you build for your own phone.
That folder is in .gitignore on purpose: the pictures belong to Mojang, so they are not committed, pushed or published.
Standard library only (the pictures are copied byte for byte; the page crops animated strips with CSS).
"""
import json, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'android', 'app', 'src', 'main', 'assets', 'www', 'mcicons'))
TEX = 'assets/minecraft/textures/'


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


# blocks have several faces; the item picture of a block is closest to one of these
SUFFIXES = ['', '_front', '_side', '_top', '_still', '_stage0', '_0']
SPECIAL = {'grass_block': 'grass_block_side', 'oak_log': 'oak_log', 'furnace': 'furnace_front', 'crafting_table': 'crafting_table_front',
           'tnt': 'tnt_side', 'bookshelf': 'bookshelf', 'pumpkin': 'pumpkin_side', 'melon': 'melon_side', 'water_bucket': None}


def main():
    jar = sys.argv[1] if len(sys.argv) > 1 else find_jar()
    if not jar or not os.path.exists(jar):
        sys.exit('No Minecraft game jar found. Give the path to one, e.g. %APPDATA%\\.minecraft\\versions\\26.2\\26.2.jar')
    z = zipfile.ZipFile(jar)
    names = set(z.namelist())
    items = sorted(n.split('/')[-1][:-5] for n in names if n.startswith('assets/minecraft/items/') and n.endswith('.json'))
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, 'hud'), exist_ok=True)
    got, missing = 0, []
    for it in items:
        src = None
        cands = [TEX + 'item/' + it + '.png']
        for s in SUFFIXES:
            cands.append(TEX + 'block/' + it + s + '.png')
        if SPECIAL.get(it):
            cands.insert(1, TEX + 'block/' + SPECIAL[it] + '.png')
        for c in cands:
            if c in names:
                src = c
                break
        if not src:
            missing.append(it)
            continue
        with open(os.path.join(OUT, it + '.png'), 'wb') as f:
            f.write(z.read(src))
        got += 1
    hud = 0
    for n in names:
        m = re.fullmatch(r'assets/minecraft/textures/gui/sprites/hud/((?:heart/)?(?:full|half|container)|food_(?:full|half|empty)|armor_(?:full|half|empty)|experience_bar_(?:background|progress))\.png', n)
        if m:
            with open(os.path.join(OUT, 'hud', m.group(1).replace('heart/', 'heart_') + '.png'), 'wb') as f:
                f.write(z.read(n))
            hud += 1
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump({'jar': os.path.basename(jar), 'items': got, 'hud': hud}, f)
    print(f'{os.path.basename(jar)}: {got} item pictures, {hud} HUD sprites -> {OUT}')
    print(f'{len(missing)} items have no flat picture (chests, beds, banners ...); the page shows a coloured tile for those.')


if __name__ == '__main__':
    main()
