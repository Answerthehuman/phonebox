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
      // the game's own picture over a coloured tile; the tile shows when the game has no flat picture for the item
      const img = h('img', 'mc-img'); img.alt = ''; img.hidden = true; img.draggable = false;
      const sq = h('div', 'mc-sq', sw, img, cnt);
      img.addEventListener('error', () => { img.hidden = true; img.dataset.bad = img.dataset.id; sq.classList.remove('pic'); });
      img.addEventListener('load', () => { sq.classList.add('pic'); });
      const s = h('div', 'mc-slot', sq, nm);
      slots.push({ el: s, sq, sw, img, cnt, nm }); hot.append(s);
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
      h('div', null, '1. RCON must be on in server.properties: python tools/mc-bridge.py --enable-rcon (keeps a backup).'),
      h('div', null, '2. Restart your Minecraft server, then start it with the Start server button here (it also starts the reader).'),
      h('div', null, 'The reader only looks: it never changes your world.'));
    setup.hidden = true;
    controls.append(
      h('div', 'mc-col', vitals, hot, why, setup, modeRow, home),
      h('div', 'mc-col', keys, cmds, playing),
    );
    function paintMode() {
      const d = live(), cur = d?.status === 'ok' && d.mode ? d.mode : chosen;
      modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === cur));
    }
    // ten hearts / ten drumsticks drawn from the game's own sprites (full, half, empty), like the in-game bars
    const meter = (kind, value) => {
      const wrap = h('span', 'mc-meter ' + kind);
      for (let i = 0; i < 10; i++) {
        const left = (value ?? 0) - i * 2, c = h('i', 'mc-cell');
        c.dataset.s = left >= 2 ? 'full' : left >= 1 ? 'half' : 'empty';
        wrap.append(c);
      }
      return wrap;
    };
    let vitalsSig = '';
    // laid out like the game's own HUD: hearts left and hunger right, the XP bar with the level above the hot bar
    function paintVitals(d) {
      const sig = JSON.stringify([d.health, d.absorb, d.food, d.level, d.xp, d.armor]);
      if (sig === vitalsSig) return;
      vitalsSig = sig;
      const worn = ['head', 'chest', 'legs', 'feet', 'offhand'].map((k) => d.armor?.[k]).filter(Boolean).map((id) => {
        const im = h('img', 'mc-gear-img'); im.alt = ''; im.src = `mcicons/${id}.png`; im.title = title(id); im.onerror = () => im.remove(); return im;
      });
      vitals.replaceChildren(
        h('div', 'mc-vrow top', h('span', 'mc-hearts', meter('heart', d.health), d.absorb > 0 ? h('span', 'mc-abs', '+' + Math.round(d.absorb)) : null), h('span', 'mc-gear', worn), meter('food', d.food)),
        h('div', 'mc-xprow', h('b', 'mc-lvl', String(d.level ?? 0)), h('span', 'mc-xpbar', h('i', null))),
      );
      vitals.querySelector('.mc-xpbar i').style.clipPath = `inset(0 ${100 - Math.max(0, Math.min(100, (d.xp || 0) * 100))}% 0 0)`;
    }
    const hhmm = (ticks) => { const hh = Math.floor(ticks / 1000 + 6) % 24, mm = Math.floor(((ticks % 1000) / 1000) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
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
        if (!it) { s.img.hidden = true; s.img.dataset.id = ''; s.sq.classList.remove('pic'); }
        else if (s.img.dataset.id !== it.id) { s.img.dataset.id = it.id; s.img.hidden = false; s.sq.classList.remove('pic'); s.img.src = `mcicons/${it.id}.png`; }
      });
      if (ok) {
        paintVitals(d);
        why.textContent = ''; why.hidden = true;
      } else {
        vitalsSig = '';
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
    // Start / Stop. The server counts as running only when the reader can talk to it (RCON answers), never from "some Java is running":
    // the game itself is Java too. After a tap the button says Starting / Stopping until the reader's answer changes.
    let pendingStart = 0, pendingStop = 0, armedStop = 0;
    const serverState = () => {
      const d = live(), up = ['ok', 'no-player'].includes(d?.status), now = Date.now();
      if (up) pendingStart = 0; else pendingStop = 0;
      if (up) return pendingStop && now - pendingStop < 60_000 ? 'stopping' : 'up';
      if (pendingStart && now - pendingStart < 120_000) return 'starting';
      if (!d && mc.server) return 'checking';           // Java is running but the reader has not answered yet
      return 'down';
    };
    serverBtn.addEventListener('click', async () => {
      const st = serverState();
      if (st === 'starting' || st === 'stopping' || st === 'checking') return;
      if (st === 'down') {
        if (await run(serverBtn, 'pb-mc-server')) { pendingStart = Date.now(); toast('Starting the server: a console window opens on the computer', 'ok'); paintStatus(); }
        return;
      }
      if (Date.now() - armedStop > 3000) { armedStop = Date.now(); paintStatus(); setTimeout(paintStatus, 3100); return; }   // the first tap only arms it
      armedStop = 0;
      if (await run(serverBtn, 'pb-mc-stop')) { pendingStop = Date.now(); toast('Saving the world and stopping the server', 'ok'); paintStatus(); }
    });
    function paintStatus() {
      const d = live();
      const st = serverState();
      dot.classList.toggle('on', mc.game || d?.status === 'ok');
      const bits = [mc.game || d?.status === 'ok' ? 'game running' : 'game not running',
        { up: 'server running', stopping: 'server stopping', starting: 'server starting', checking: 'server running?', down: 'server stopped' }[st]];
      if (d?.status === 'ok' && d.player) {
        bits.push(d.player);
        if (d.pos) bits.push(d.pos.map(Math.round).join(' ') + (d.dim && d.dim !== 'overworld' ? ' ' + d.dim.replace('the_', '') : ''));
        if (d.daytime != null) bits.push((d.day != null ? 'day ' + (d.day + 1) + ' ' : '') + hhmm(d.daytime));
      }
      sub.textContent = bits.join('  ·  ');
      const armed = st === 'up' && Date.now() - armedStop < 3000;
      serverBtn.classList.toggle('up', st === 'up');
      serverBtn.classList.toggle('wait', st === 'starting' || st === 'stopping' || st === 'checking');
      serverBtn.textContent = { up: armed ? 'Tap again to stop' : 'Stop server', stopping: 'Stopping…', starting: 'Starting…', checking: 'Checking…', down: 'Start server' }[st];
      serverBtn.disabled = !have(st === 'up' ? 'pb-mc-stop' : 'pb-mc-server') || st === 'starting' || st === 'stopping' || st === 'checking';
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
