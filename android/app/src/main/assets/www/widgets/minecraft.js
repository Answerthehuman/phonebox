// Minecraft side panel (Patch 4). A page of its own, built as five small tabs:
//   Controls   - keys sent to the game on the PC (screenshot, HUD, debug screen, camera, chat ...), and three commands
//   Coordinates- Overworld <-> Nether converter and a notebook of places, kept on this phone
//   Stronghold - two eye-of-ender throws -> where the stronghold is
//   Timers     - furnace / brewing countdowns that buzz when done, and a day-night clock
//   Guide      - ore depths, Nether and End facts, F3 debug keys
// Everything except the Controls tab works on the phone alone. The keys use the PC agent's shortcuts (ids "pb-mc-*"),
// which tools/install-shortcuts.py adds to the agent's settings; they go to whatever window is in front on the PC.
import { D, api, buzz, cfg, h, haptic, store, toast } from '../main.js';
import { W } from '../registry.js';

const KEYS = [
  ['pb-mc-shot', 'Screenshot', 'F2'], ['pb-mc-hud', 'Hide HUD', 'F1'], ['pb-mc-debug', 'Debug screen', 'F3'],
  ['pb-mc-view', 'Camera view', 'F5'], ['pb-mc-full', 'Full screen', 'F11'],
  ['pb-mc-chat', 'Chat', 'T'], ['pb-mc-inv', 'Inventory', 'E'], ['pb-mc-esc', 'Menu', 'Esc'],
  ['pb-mc-copy', 'Copy position', 'F3 + C'], ['pb-mc-map', 'Chunk borders', 'F3 + G'],
];
const COMMANDS = [['pb-mc-day', 'Day', '/time set day'], ['pb-mc-night', 'Night', '/time set night'], ['pb-mc-clear', 'Clear sky', '/weather clear']];

const PRESETS = [['Furnace x64', 640], ['Furnace x8', 80], ['Furnace x1', 10], ['Brew', 20], ['Beacon pulse', 180], ['Crops (check)', 300]];
const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const num = (v) => { const n = parseFloat(String(v ?? '').trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const input = (cls, ph, mode = 'text') => { const i = h('input', cls); i.type = 'text'; i.inputMode = mode; i.placeholder = ph; i.autocomplete = 'off'; i.spellcheck = false; return i; };

// "x y z" in any shape, or the whole line that F3 + C copies ("/execute in minecraft:overworld run tp @s -120.5 64 300.2 ...")
function parsePos(text) {
  let s = String(text || '');
  const at = s.indexOf('@s');
  if (at >= 0) s = s.slice(at + 2);
  const n = (s.match(/-?\d+(?:[.,]\d+)?/g) || []).map((v) => parseFloat(v.replace(',', '.')));
  if (n.length >= 3) return { x: n[0], y: n[1], z: n[2] };
  if (n.length === 2) return { x: n[0], y: null, z: n[1] };
  return null;
}

W.minecraft = {
  bare: true,
  needs: ['state', 'tick', 'fast'],
  always: true,    // timers must ring whichever page is showing
  create(box, { page }) {
    box.classList.add('mc');
    const status = h('div', 'mc-status');
    const dot = h('i', 'mc-dot'), who = h('b', null, 'Minecraft'), sub = h('small', null, 'looking for the game...');
    const stats = h('div', 'mc-stats');
    status.append(dot, h('div', 'mc-who', who, sub), stats);
    const tabs = h('div', 'mc-tabs');
    const body = h('div', 'mc-body');
    box.append(status, tabs, body);

    // ---------- the game on the PC
    let procAt = 0, procBusy = false, running = null;
    const findGame = (groups) => (groups || []).filter((g) => /minecraft|javaw/i.test(g.name || '')).sort((a, b) => b.memMb - a.memMb)[0] || null;
    async function look() {
      if (procBusy || performance.now() - procAt < 6000) return;
      procBusy = true; procAt = performance.now();
      try { running = findGame((await api('/procs?top=150', 'GET', 4000)).groups); } catch (_) { running = null; }
      procBusy = false; paintStatus();
    }
    function paintStatus() {
      dot.classList.toggle('on', !!running);
      sub.textContent = running ? `running  ·  ${(running.memMb / 1024).toFixed(1)} GB  ·  CPU ${Math.round(running.cpu)}%` : 'not running on the PC';
      const pc = D.state?.pc, g = pc?.gpu || pc?.gpus?.[0];
      const bits = [];
      if (pc?.cpu != null) bits.push(['CPU', Math.round(pc.cpu) + '%']);
      if (g?.util != null) bits.push(['GPU', Math.round(g.util) + '%' + (g.temp != null ? ' ' + Math.round(g.temp) + '°' : '')]);
      if (pc?.ramTotalGb) bits.push(['RAM', Math.round((pc.ramUsedGb / pc.ramTotalGb) * 100) + '%']);
      stats.replaceChildren(...bits.map(([k, v]) => h('span', null, k + ' ', h('b', null, v))));
    }

    // ---------- Controls
    const press = async (btn, id) => {
      haptic(); btn.classList.add('busy');
      let ok = false;
      try { await api('/run/' + encodeURIComponent(id), 'POST', 5000); ok = true; } catch (_) {}
      btn.classList.remove('busy'); btn.classList.add(ok ? 'ok' : 'err');
      setTimeout(() => btn.classList.remove('ok', 'err'), 800);
      if (!ok) toast('The PC did not take that key', 'err');
    };
    const have = (id) => (cfg.shortcuts || []).some((s) => s.id === id);
    const keyBtn = ([id, label, hint, cls]) => {
      const b = h('button', 'mc-key ' + (cls || ''), h('span', 'mc-k-label', label), h('small', null, hint));
      b.type = 'button'; b.dataset.id = id;
      b.addEventListener('click', () => press(b, id));
      return b;
    };
    const controls = h('div', 'mc-pane mc-controls');
    {
      const note = h('div', 'mc-note');
      const grid = h('div', 'mc-keys', ...KEYS.map(keyBtn));
      const cmds = h('div', 'mc-keys mc-cmds', ...COMMANDS.map(([id, label, hint]) => keyBtn([id, label, hint, 'cmd'])));
      controls.append(grid, h('div', 'mc-sub', 'Commands (cheats must be on in the world)'), cmds, note);
      controls.refresh = () => {
        const ok = KEYS.every(([id]) => have(id));
        controls.querySelectorAll('.mc-key').forEach((b) => { b.disabled = !have(b.dataset.id); });
        note.textContent = ok ? 'Keys go to the window in front on the PC: click into the game first.' : 'These keys are not installed on the PC yet: run tools/install-shortcuts.py on the laptop, then wait a few seconds.';
        note.classList.toggle('warn', !ok);
      };
    }

    // ---------- Coordinates
    const coords = h('div', 'mc-pane mc-coords');
    {
      let dim = store.get('mc-dim', 'o');
      const pos = input('mc-in wide', 'x y z   (or paste what F3 + C copies)');
      const dimBtns = [['o', 'Overworld'], ['n', 'Nether']].map(([k, label]) => { const b = h('button', 'mc-chip', label); b.type = 'button'; b.addEventListener('click', () => { dim = k; store.set('mc-dim', k); paint(); }); b.dataset.k = k; return b; });
      const out = h('div', 'mc-out');
      const name = input('mc-in', 'name');
      const save = h('button', 'mc-btn go', 'Save place'); save.type = 'button';
      const death = h('button', 'mc-chip', 'Death'); death.type = 'button';
      const list = h('div', 'mc-list');
      let spots = store.get('mc-spots', []);
      const convert = (p, from) => from === 'o' ? { x: Math.floor(p.x / 8), z: Math.floor(p.z / 8) } : { x: Math.round(p.x * 8), z: Math.round(p.z * 8) };
      function paint() {
        dimBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === dim));
        const p = parsePos(pos.value);
        if (!p) { out.replaceChildren(h('div', 'mc-hint', 'Type or paste a position. The Nether is 8 times smaller than the Overworld, so a portal built at the matching spot links up.')); return; }
        const c = convert(p, dim), other = dim === 'o' ? 'Nether' : 'Overworld';
        out.replaceChildren(h('div', 'mc-big', `${other}: ${c.x}  ${p.y != null ? '' : ''}${c.z}`), h('div', 'mc-hint', `X ${c.x}   Z ${c.z}   (from ${p.x}, ${p.z})`));
      }
      function drawList() {
        list.replaceChildren(...(spots.length ? spots.map((s, i) => {
          const there = convert(s, s.d), other = s.d === 'o' ? 'Nether' : 'Overworld';
          const del = h('button', 'mc-x', '×'); del.type = 'button'; del.setAttribute('aria-label', 'Delete');
          del.addEventListener('click', (e) => { e.stopPropagation(); spots.splice(i, 1); store.set('mc-spots', spots); drawList(); });
          const row = h('div', 'mc-spot', h('div', 'mc-spot-t', h('b', null, s.n), h('small', null, `${s.d === 'o' ? 'Overworld' : 'Nether'}  ${s.x}${s.y != null ? ' ' + s.y : ''} ${s.z}   →   ${other} ${there.x} ${there.z}`)), del);
          row.addEventListener('click', () => { haptic(); pos.value = `${s.x} ${s.y ?? ''} ${s.z}`.replace(/\s+/g, ' '); dim = s.d; paint(); });
          return row;
        }) : [h('div', 'mc-hint pad', 'No saved places yet. Paste a position, name it, save it.')]));
      }
      pos.addEventListener('input', paint);
      death.addEventListener('click', () => { name.value = 'Death'; });
      save.addEventListener('click', () => {
        const p = parsePos(pos.value);
        if (!p) { toast('Enter a position first', 'err'); return; }
        spots.unshift({ n: (name.value || 'Place ' + (spots.length + 1)).slice(0, 24), x: Math.round(p.x), y: p.y != null ? Math.round(p.y) : null, z: Math.round(p.z), d: dim });
        spots = spots.slice(0, 40); store.set('mc-spots', spots); name.value = ''; drawList(); haptic(); toast('Saved', 'ok');
      });
      coords.append(
        h('div', 'mc-col', h('div', 'mc-row', ...dimBtns), pos, out, h('div', 'mc-row', name, death, save)),
        h('div', 'mc-col', list),
      );
      paint(); drawList();
    }

    // ---------- Stronghold
    const strong = h('div', 'mc-pane mc-strong');
    {
      const mk = (n) => ({ x: input('mc-in s', 'X'), z: input('mc-in s', 'Z'), yaw: input('mc-in s', 'angle') });
      const a = mk(1), b = mk(2);
      const out = h('div', 'mc-out');
      const saveBtn = h('button', 'mc-btn', 'Save as place'); saveBtn.type = 'button'; saveBtn.hidden = true;
      let found = null;
      const calc = () => {
        saveBtn.hidden = true; found = null;
        const v = [a.x, a.z, a.yaw, b.x, b.z, b.yaw].map((i) => num(i.value));
        if (v.some(Number.isNaN)) { out.replaceChildren(h('div', 'mc-hint', 'Throw an eye of ender and note where you stand (X, Z) and the angle you face while it flies. Walk about 100 blocks sideways and throw again. Both lines meet at the stronghold.')); return; }
        const [x1, z1, y1, x2, z2, y2] = v, r = (d) => (d * Math.PI) / 180;
        const d1 = [-Math.sin(r(y1)), Math.cos(r(y1))], d2 = [-Math.sin(r(y2)), Math.cos(r(y2))];
        const det = -d1[0] * d2[1] + d2[0] * d1[1];
        if (Math.abs(det) < 0.06) { out.replaceChildren(h('div', 'mc-hint warn', 'The two throws point almost the same way. Move further sideways and throw again.')); return; }
        const tt = (-(x2 - x1) * d2[1] + d2[0] * (z2 - z1)) / det, ss = (-(x2 - x1) * d1[1] + d1[0] * (z2 - z1)) / det;
        if (tt < 0 || ss < 0) { out.replaceChildren(h('div', 'mc-hint warn', 'The lines meet behind you: check the angles (use the first number in brackets after "Facing").')); return; }
        found = { x: Math.round(x1 + tt * d1[0]), z: Math.round(z1 + tt * d1[1]) };
        out.replaceChildren(h('div', 'mc-big', `Stronghold near  ${found.x}   ${found.z}`), h('div', 'mc-hint', `about ${Math.round(tt)} blocks from your first throw; dig down when you are there`));
        saveBtn.hidden = false;
      };
      [a, b].forEach((o) => Object.values(o).forEach((i) => i.addEventListener('input', calc)));
      saveBtn.addEventListener('click', () => {
        if (!found) return;
        const spots = store.get('mc-spots', []);
        spots.unshift({ n: 'Stronghold', x: found.x, y: null, z: found.z, d: 'o' });
        store.set('mc-spots', spots.slice(0, 40)); toast('Saved in Coordinates', 'ok');
      });
      strong.append(
        h('div', 'mc-col', h('div', 'mc-throw', h('b', null, 'Throw 1'), a.x, a.z, a.yaw), h('div', 'mc-throw', h('b', null, 'Throw 2'), b.x, b.z, b.yaw),
          h('div', 'mc-hint', 'Angle: the first number in brackets after "Facing" on the F3 screen (-180 to 180).')),
        h('div', 'mc-col', out, saveBtn),
      );
      calc();
    }

    // ---------- Timers
    const timers = h('div', 'mc-pane mc-timers');
    let running_t = store.get('mc-timers', []);
    let dayStart = store.get('mc-day', 0);
    const tList = h('div', 'mc-list'), dayEl = h('div', 'mc-day');
    {
      const start = (label, secs) => { running_t.push({ id: Date.now() + Math.random(), label, end: Date.now() + secs * 1000 }); store.set('mc-timers', running_t); haptic(); drawTimers(); };
      const chips = h('div', 'mc-chips', ...PRESETS.map(([label, secs]) => { const c = h('button', 'mc-chip', `${label}  ${fmt(secs)}`); c.type = 'button'; c.addEventListener('click', () => start(label, secs)); return c; }));
      const mins = input('mc-in s', 'min', 'decimal'), go = h('button', 'mc-btn go', 'Start'); go.type = 'button';
      go.addEventListener('click', () => { const m = num(mins.value); if (!(m > 0)) { toast('Enter minutes', 'err'); return; } start(`${mins.value} min`, Math.min(m, 600) * 60); mins.value = ''; });
      const sync = h('button', 'mc-btn', 'Sunrise just now'); sync.type = 'button';
      sync.addEventListener('click', () => { dayStart = Date.now(); store.set('mc-day', dayStart); haptic(); toast('Day clock synced', 'ok'); });
      timers.append(h('div', 'mc-col', chips, h('div', 'mc-row', mins, go), tList), h('div', 'mc-col', h('div', 'mc-sub', 'Day and night'), dayEl, sync, h('div', 'mc-hint', 'One Minecraft day is 20 minutes. Tap the button as the sun comes up and this keeps count.')));
    }
    function drawTimers() {
      const now = Date.now();
      tList.replaceChildren(...(running_t.length ? running_t.map((tm) => {
        const x = h('button', 'mc-x', '×'); x.type = 'button'; x.addEventListener('click', () => { running_t = running_t.filter((q) => q.id !== tm.id); store.set('mc-timers', running_t); drawTimers(); });
        const left = h('b', 'mc-left', fmt((tm.end - now) / 1000));
        return h('div', 'mc-spot', h('div', 'mc-spot-t', h('b', null, tm.label)), left, x);
      }) : [h('div', 'mc-hint pad', 'No timers running. Pick one on the left.')]));
    }
    function tickTimers() {
      const now = Date.now();
      let changed = false;
      for (const tm of running_t) if (tm.end <= now) { buzz([0, 220, 90, 220, 90, 320]); toast(`${tm.label} is done`, 'ok'); changed = true; }
      if (changed) { running_t = running_t.filter((q) => q.end > now); store.set('mc-timers', running_t); drawTimers(); }
      else tList.querySelectorAll('.mc-left').forEach((el, i) => { if (running_t[i]) el.textContent = fmt((running_t[i].end - now) / 1000); });
      // day clock: 24000 ticks, 50 ms each. Dawn 0, dusk about 12000, night from 13000 to 23000.
      if (!dayStart) { dayEl.textContent = 'not synced'; return; }
      const tick = ((now - dayStart) / 50) % 24000;
      const secs = (ticks) => (ticks * 50) / 1000;
      let line, next;
      if (tick < 12000) { line = 'Day'; next = `night falls in ${fmt(secs(13000 - tick))}`; }
      else if (tick < 13000) { line = 'Dusk'; next = `night in ${fmt(secs(13000 - tick))}`; }
      else if (tick < 23000) { line = 'Night'; next = `sunrise in ${fmt(secs(24000 - tick))}; beds work from now`; }
      else { line = 'Dawn'; next = `day in ${fmt(secs(24000 - tick))}`; }
      dayEl.replaceChildren(h('div', 'mc-big', line), h('div', 'mc-hint', next));
    }
    drawTimers();

    // ---------- Guide
    const guide = h('div', 'mc-pane mc-guide');
    {
      const card = (title, rows) => h('div', 'mc-card', h('b', null, title), ...rows.map(([k, v]) => h('div', 'mc-line', h('span', null, k), h('em', null, v))));
      guide.append(
        card('Best ore levels (Java 1.18+)', [['Diamond', 'Y -59'], ['Redstone', 'Y -59'], ['Gold', 'Y -16'], ['Lapis', 'Y 0'], ['Iron', 'Y 16'], ['Copper', 'Y 48'], ['Coal', 'Y 96'], ['Ancient debris', 'Nether Y 15']]),
        card('Nether and End', [['Nether distance', '1 block = 8 blocks'], ['Portal', '4 x 5 frame, 10 obsidian'], ['Bed in Nether / End', 'explodes'], ['End portal', '12 eyes of ender'], ['First strongholds', '1280 - 2816 blocks out'], ['Blaze rod to eye', 'rod -> powder + pearl']]),
        card('F3 debug keys', [['F3 + C', 'copy position'], ['F3 + G', 'chunk borders'], ['F3 + B', 'hitboxes'], ['F3 + H', 'item details'], ['F3 + N', 'creative / spectator'], ['F3 + Q', 'list all']]),
      );
    }

    // ---------- tabs
    const TABS = [['controls', 'Controls', controls], ['coords', 'Coordinates', coords], ['strong', 'Stronghold', strong], ['timers', 'Timers', timers], ['guide', 'Guide', guide]];
    let tab = store.get('mc-tab', 'controls');
    if (!TABS.some(([k]) => k === tab)) tab = 'controls';
    const tabBtns = TABS.map(([k, label, pane]) => {
      const b = h('button', 'mc-tab', label); b.type = 'button'; b.dataset.k = k;
      b.addEventListener('click', () => { haptic(); tab = k; store.set('mc-tab', k); showTab(); });
      pane.hidden = true; body.append(pane);
      return b;
    });
    tabs.append(...tabBtns);
    function showTab() {
      tabBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === tab));
      TABS.forEach(([k, , pane]) => { pane.hidden = k !== tab; });
    }
    showTab(); paintStatus(); controls.refresh();

    return {
      update(kind) {
        if (kind === 'fast') return;
        tickTimers();
        if (kind === 'tick') {
          const r = box.getBoundingClientRect();
          if (!document.hidden && r.width > 0 && r.right > 0 && r.left < innerWidth) { look(); paintStatus(); }
          controls.refresh();
        }
      },
      destroy() {},
    };
  },
};
