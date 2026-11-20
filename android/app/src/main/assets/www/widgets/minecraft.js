// Minecraft side panel (Patch 5): two tabs.
//   Controls    - the hot bar, health and food, game mode, "Go Home", the server button, keys for the game, and what the
//                 computer is playing.
//   Coordinates - your live position, an Overworld <-> Nether converter and a notebook of places.
// The live parts (hot bar, position, mode, health, food, last death) come from tools/mc-bridge.py, which reads your local
// server over RCON and passes it to the agent (D.push.mc). Without it the page still works: the keys, the converter and
// the notebook need nothing from the server. Game mode and Go Home type chat commands into the game window (/gamemode ..,
// /trigger home), like the other keys: the game has to be in front on the computer.
import { D, api, cfg, goPage, h, haptic, pages, store, toast } from '../main.js';
import { W } from '../registry.js';
import { mc } from '../visibility.js';

const KEYS = [
  ['pb-mc-shot', 'Screenshot', 'F2'], ['pb-mc-hud', 'Hide HUD', 'F1'], ['pb-mc-debug', 'Debug', 'F3'], ['pb-mc-view', 'Camera', 'F5'], ['pb-mc-full', 'Full screen', 'F11'],
  ['pb-mc-chat', 'Chat', 'T'], ['pb-mc-inv', 'Inventory', 'E'], ['pb-mc-esc', 'Menu', 'Esc'], ['pb-mc-copy', 'Copy position', 'F3+C'], ['pb-mc-map', 'Chunk borders', 'F3+G'],
];
const COMMANDS = [['pb-mc-day', 'Day'], ['pb-mc-night', 'Night'], ['pb-mc-clear', 'Clear sky']];
const MODES = [['survival', 'Survival'], ['creative', 'Creative'], ['adventure', 'Adventure'], ['spectator', 'Spectator']];
const WHY = {
  'rcon-off': 'Live hot bar is off. One-time setup: tap here.',
  'rcon-password': 'The server rejected the RCON password. Run the setup again.',
  down: 'Server is not running. Press Start server.',
  'no-player': 'Server is up. Join the world and your hot bar shows here.',
};

const num = (v) => { const n = parseFloat(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const input = (cls, ph) => { const i = h('input', cls); i.type = 'text'; i.placeholder = ph; i.autocomplete = 'off'; i.spellcheck = false; return i; };

// "x y z" in any shape, or the line F3 + C copies ("/execute in minecraft:overworld run tp @s -120.5 64 300.2 ...")
function parsePos(text) {
  let s = String(text || '');
  const at = s.indexOf('@s');
  if (at >= 0) s = s.slice(at + 2);
  const n = (s.match(/-?\d+(?:[.,]\d+)?/g) || []).map((v) => parseFloat(v.replace(',', '.')));
  if (n.length >= 3) return { x: n[0], y: n[1], z: n[2] };
  if (n.length === 2) return { x: n[0], y: null, z: n[1] };
  return null;
}

// ---- hot bar tiles: a colour for the material and the item's initials (the game's own pictures are not available here)
const MATERIALS = [
  [/netherite/, '#5b4b5f'], [/diamond/, '#3fd8d8'], [/emerald/, '#2fcb6b'], [/golden|gold/, '#f3c13a'], [/iron|chain/, '#c5c8ce'], [/copper/, '#d7855a'], [/lapis/, '#3a5fd0'],
  [/redstone/, '#d1262e'], [/obsidian/, '#3a2858'], [/coal|charcoal/, '#3b3b3b'], [/stone|cobble|deepslate|andesite|diorite|granite|brick/, '#8d8d8d'],
  [/oak|spruce|birch|jungle|acacia|cherry|mangrove|bamboo|plank|log|stick|wood|crafting|chest|barrel/, '#a67c52'], [/dirt|mud|soil|podzol/, '#8a5a3b'],
  [/grass|leaves|sapling|vine|fern|moss/, '#5fae4a'], [/sand|sandstone/, '#e3d79c'], [/water|bucket|ice|snow/, '#5ea0f5'], [/lava|magma|fire|blaze|torch/, '#f08a24'],
  [/apple|beef|pork|chicken|mutton|steak|carrot|potato|bread|cookie|melon|berry|stew|cake|pie/, '#d94f4f'], [/wool|white|paper|book|bone/, '#e6e6e6'],
  [/arrow|bow|crossbow|shield|trident/, '#b99a6b'], [/pearl|ender|eye/, '#2a9d8f'], [/glass|pane/, '#b7e4ee'], [/bed|banner/, '#c24a4a'], [/glowstone|lantern|light/, '#f5d76e'],
];
function tileStyle(id) {
  for (const [re, c] of MATERIALS) if (re.test(id)) return c;
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 55%)`;
}
const initials = (id) => id.split('_').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const title = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

W.minecraft = {
  bare: true,
  needs: ['state', 'tick', 'push'],
  create(box) {
    box.classList.add('mc');
    const status = h('div', 'mc-status');
    const dot = h('i', 'mc-dot'), who = h('b', null, 'Minecraft'), sub = h('small', null, '');
    const serverBtn = h('button', 'mc-chip srv', 'Start server');
    serverBtn.type = 'button';
    status.append(dot, h('div', 'mc-who', who, sub), serverBtn);
    const tabs = h('div', 'mc-tabs'), body = h('div', 'mc-body');
    box.append(status, tabs, body);

    const have = (id) => (cfg.shortcuts || []).some((s) => s.id === id);
    const run = async (btn, id) => {
      haptic(); btn?.classList.add('busy');
      let ok = false;
      try { await api('/run/' + encodeURIComponent(id), 'POST', 6000); ok = true; } catch (_) {}
      btn?.classList.remove('busy'); btn?.classList.add(ok ? 'ok' : 'err');
      setTimeout(() => btn?.classList.remove('ok', 'err'), 800);
      if (!ok) toast('The PC did not take that', 'err');
      return ok;
    };
    // live data from the bridge (null when it is missing or has gone quiet)
    const live = () => {
      const it = D.push?.mc;
      if (!it?.data) return null;
      if (it.expiresAt && Date.now() > it.expiresAt + 4000) return null;
      return it.data;
    };

    // ================= Controls
    const controls = h('div', 'mc-pane mc-play');
    const hot = h('div', 'mc-hot'), slots = [];
    for (let i = 0; i < 9; i++) {
      const sw = h('span', 'mc-sw'), cnt = h('em', 'mc-cnt'), nm = h('small', 'mc-nm');
      const s = h('div', 'mc-slot', h('div', 'mc-sq', sw, cnt), nm);
      slots.push({ el: s, sw, cnt, nm }); hot.append(s);
    }
    const vitals = h('div', 'mc-vitals'), why = h('div', 'mc-why');
    const modeRow = h('div', 'mc-modes');
    let chosen = store.get('mc-mode', 'survival');
    const modeBtns = MODES.map(([k, label]) => {
      const b = h('button', 'mc-mode', label); b.type = 'button'; b.dataset.k = k;
      b.addEventListener('click', async () => { chosen = k; store.set('mc-mode', k); paintMode(); await run(b, 'pb-mc-gm-' + k); });
      modeRow.append(b); return b;
    });
    const home = h('button', 'mc-btn go home', 'Go Home'); home.type = 'button';
    home.addEventListener('click', () => run(home, 'pb-mc-home'));
    const keys = h('div', 'mc-keys');
    for (const [id, label, hint] of KEYS) {
      const b = h('button', 'mc-key', h('span', 'mc-k-label', label), h('small', null, hint)); b.type = 'button'; b.dataset.id = id;
      b.addEventListener('click', () => run(b, id)); keys.append(b);
    }
    const cmds = h('div', 'mc-keys mc-cmds');
    for (const [id, label] of COMMANDS) {
      const b = h('button', 'mc-key cmd', h('span', 'mc-k-label', label)); b.type = 'button'; b.dataset.id = id;
      b.addEventListener('click', () => run(b, id)); cmds.append(b);
    }
    const playing = h('button', 'mc-playing'); playing.type = 'button';
    playing.addEventListener('click', () => { haptic(); const at = pages.findIndex((p) => p.id === 'apple-music'); if (at >= 0) goPage(at); });
    why.addEventListener('click', () => { haptic(); setup.hidden = !setup.hidden; });
    const setup = h('div', 'mc-setup', h('b', null, 'One-time setup for the live hot bar'),
      h('div', null, '1. On the computer run:  python tools/mc-bridge.py --enable-rcon  (it turns RCON on in server.properties and keeps a backup).'),
      h('div', null, '2. Restart your Minecraft server, then always start it with the Start server button here (it also starts the reader).'),
      h('div', null, 'The reader only looks: it never changes your world.'));
    setup.hidden = true;
    controls.append(
      h('div', 'mc-col', hot, vitals, why, setup, modeRow, home),
      h('div', 'mc-col', keys, cmds, playing),
    );
    function paintMode() {
      const d = live(), cur = d?.status === 'ok' && d.mode ? d.mode : chosen;
      modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === cur));
    }
    const heartRow = (v, max, ch) => { const n = Math.max(0, Math.min(max, Math.round(v))); return ch.repeat(Math.ceil(n / 2)); };
    function paintLive() {
      const d = live();
      const ok = d?.status === 'ok';
      const hb = new Map((ok ? d.hotbar : []).map((i) => [i.slot, i]));
      slots.forEach((s, i) => {
        const it = hb.get(i);
        s.el.classList.toggle('sel', ok && d.slot === i);
        s.el.classList.toggle('empty', !it);
        s.sw.style.background = it ? tileStyle(it.id) : '';
        s.sw.textContent = it ? initials(it.id) : '';
        s.cnt.textContent = it && it.count > 1 ? it.count : '';
        s.nm.textContent = it ? title(it.id) : '';
      });
      if (ok) {
        const pos = d.pos ? `${Math.round(d.pos[0])}  ${Math.round(d.pos[1])}  ${Math.round(d.pos[2])}` : '';
        vitals.replaceChildren(
          h('span', 'mc-hp', d.health != null ? heartRow(d.health, 20, '♥') : ''),
          h('span', 'mc-food', d.food != null ? heartRow(d.food, 20, '●') : ''),
          h('span', 'mc-pos', pos + (d.dim && d.dim !== 'overworld' ? '   ' + d.dim.replace('the_', '') : '')),
        );
        why.textContent = ''; why.hidden = true;
      } else {
        vitals.replaceChildren();
        const text = WHY[d?.status] || (d ? '' : 'Live hot bar is off. One-time setup: tap here.');
        why.textContent = text; why.hidden = !text;
        if (d?.status !== 'rcon-off' && d) setup.hidden = true;
      }
      paintMode();
    }
    function paintPlaying() {
      const m = D.state?.media;
      playing.replaceChildren(h('i', null, '♪'), h('span', null, m?.title ? `${m.title}${m.artist ? '  ·  ' + m.artist : ''}` : 'Nothing playing on the computer'));
      playing.classList.toggle('idle', !m?.title);
    }

    // ================= Coordinates
    const coords = h('div', 'mc-pane mc-coords');
    let dim = store.get('mc-dim', 'o');
    const pos = input('mc-in wide', 'x y z   (or paste what F3 + C copies)');
    const dimBtns = [['o', 'Overworld'], ['n', 'Nether']].map(([k, label]) => {
      const b = h('button', 'mc-chip', label); b.type = 'button'; b.dataset.k = k;
      b.addEventListener('click', () => { dim = k; store.set('mc-dim', k); paintConv(); }); return b;
    });
    const out = h('div', 'mc-out'), name = input('mc-in', 'name');
    const save = h('button', 'mc-btn go', 'Save place'); save.type = 'button';
    const hereRow = h('div', 'mc-here'), list = h('div', 'mc-list');
    let spots = store.get('mc-spots', []);
    const convert = (p, from) => (from === 'o' ? { x: Math.floor(p.x / 8), z: Math.floor(p.z / 8) } : { x: Math.round(p.x * 8), z: Math.round(p.z * 8) });
    function paintConv() {
      dimBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === dim));
      const p = parsePos(pos.value);
      if (!p) { out.replaceChildren(h('div', 'mc-hint', 'Type or paste a position. The Nether is 8 times smaller than the Overworld, so a portal built at the matching spot links up.')); return; }
      const c = convert(p, dim);
      out.replaceChildren(h('div', 'mc-big', `${dim === 'o' ? 'Nether' : 'Overworld'}: ${c.x}  ${c.z}`), h('div', 'mc-hint', `from ${Math.round(p.x)}, ${Math.round(p.z)}`));
    }
    function drawList() {
      list.replaceChildren(...(spots.length ? spots.map((s, i) => {
        const there = convert(s, s.d);
        const del = h('button', 'mc-x', '×'); del.type = 'button'; del.setAttribute('aria-label', 'Delete');
        del.addEventListener('click', (e) => { e.stopPropagation(); spots.splice(i, 1); store.set('mc-spots', spots); drawList(); });
        const row = h('div', 'mc-spot', h('div', 'mc-spot-t', h('b', null, s.n), h('small', null, `${s.d === 'o' ? 'Overworld' : 'Nether'}  ${s.x}${s.y != null ? ' ' + s.y : ''} ${s.z}   →   ${s.d === 'o' ? 'Nether' : 'Overworld'} ${there.x} ${there.z}`)), del);
        row.addEventListener('click', () => { haptic(); pos.value = `${s.x} ${s.y ?? ''} ${s.z}`.replace(/\s+/g, ' '); dim = s.d; paintConv(); });
        return row;
      }) : [h('div', 'mc-hint pad', 'No saved places yet.')]));
    }
    const addSpot = (n, p, d) => {
      spots.unshift({ n: String(n).slice(0, 24), x: Math.round(p.x), y: p.y != null ? Math.round(p.y) : null, z: Math.round(p.z), d });
      spots = spots.slice(0, 40); store.set('mc-spots', spots); drawList(); haptic(); toast('Saved', 'ok');
    };
    pos.addEventListener('input', paintConv);
    save.addEventListener('click', () => {
      const p = parsePos(pos.value);
      if (!p) { toast('Enter a position first', 'err'); return; }
      addSpot(name.value || 'Place ' + (spots.length + 1), p, dim); name.value = '';
    });
    let hereSig = '';
    function paintHere() {
      const d = live();
      const here = d?.status === 'ok' && d.pos ? d.pos : null, death = d?.status === 'ok' ? d.death : null;
      const dimName = d?.dim === 'the_nether' ? 'n' : 'o';
      const sig = JSON.stringify([here && here.map(Math.round), death, dimName]);
      if (sig === hereSig) return;
      hereSig = sig;
      const mk = (label, p, d2, nm) => {
        const use = h('button', 'mc-chip', 'Convert'); use.type = 'button';
        use.addEventListener('click', () => { haptic(); pos.value = `${Math.round(p[0])} ${Math.round(p[1])} ${Math.round(p[2])}`; dim = d2; paintConv(); });
        const sv = h('button', 'mc-chip', 'Save'); sv.type = 'button';
        sv.addEventListener('click', () => addSpot(nm, { x: p[0], y: p[1], z: p[2] }, d2));
        return h('div', 'mc-here-row', h('span', null, h('b', null, label), `  ${Math.round(p[0])}  ${Math.round(p[1])}  ${Math.round(p[2])}`), h('span', 'mc-here-btns', use, sv));
      };
      hereRow.replaceChildren(...(here || death ? [here ? mk('You are here', here, dimName, 'Here') : null, death ? mk('Last death', death, dimName, 'Death') : null].filter(Boolean)
        : [h('div', 'mc-hint', 'Your live position shows here once the reader is running (see the Controls tab).')]));
    }
    coords.append(
      h('div', 'mc-col', hereRow, h('div', 'mc-row', ...dimBtns), pos, out),
      h('div', 'mc-col', h('div', 'mc-sub', 'Save the position on the left'), h('div', 'mc-row', name, save), list),
    );
    paintConv(); drawList();

    // ================= tabs and status
    const TABS = [['controls', 'Controls', controls], ['coords', 'Coordinates', coords]];
    let tab = store.get('mc-tab', 'controls');
    if (!TABS.some(([k]) => k === tab)) tab = 'controls';
    const tabBtns = TABS.map(([k, label, pane]) => {
      const b = h('button', 'mc-tab', label); b.type = 'button'; b.dataset.k = k;
      b.addEventListener('click', () => { haptic(); tab = k; store.set('mc-tab', k); showTab(); });
      pane.hidden = true; body.append(pane); return b;
    });
    tabs.append(...tabBtns);
    function showTab() {
      tabBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
      TABS.forEach(([k, , pane]) => { pane.hidden = k !== tab; });
    }
    serverBtn.addEventListener('click', async () => {
      if (mc.server) { toast('The server is already running'); return; }
      if (await run(serverBtn, 'pb-mc-server')) toast('Starting the server: a console window opens on the computer', 'ok');
    });
    function paintStatus() {
      const d = live();
      dot.classList.toggle('on', mc.game);
      const bits = [mc.game ? 'game running' : 'game not running', mc.server ? 'server running' : 'server stopped'];
      if (d?.status === 'ok' && d.player) bits.push(d.player);
      sub.textContent = bits.join('  ·  ');
      serverBtn.classList.toggle('on', mc.server);
      serverBtn.textContent = mc.server ? 'Server running' : 'Start server';
      serverBtn.disabled = !have('pb-mc-server');
      controls.querySelectorAll('.mc-key, .mc-mode, .mc-btn.home').forEach((b) => { const id = b.dataset.id || (b.dataset.k && 'pb-mc-gm-' + b.dataset.k) || (b.classList.contains('home') && 'pb-mc-home'); if (id) b.disabled = !have(id); });
    }
    showTab(); paintLive(); paintPlaying(); paintStatus(); paintHere();

    return {
      update() {
        paintStatus(); paintLive(); paintHere();
        if (tab === 'controls') paintPlaying();
      },
      destroy() {},
    };
  },
};
