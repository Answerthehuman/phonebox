// Time-of-day colours and the ambient screen (Patch 4).
//  - phaseAt(date): which part of the day it is (early light, morning, afternoon, evening, night) and its colours.
//    Mornings are bright and warm, the afternoon is clear, the evening is calm and dim, the night is deep and quiet.
//  - The ambient screen: after the panel has been left alone for a while (Ambient, in the overview) a slowly moving
//    gradient in the colours of the hour covers the page with a big clock, like a lock screen. A tap brings the page
//    back, exactly as it was: no page is ever switched. It stays away while a call is on air, a prompt is open, the
//    night screen is on, or music plays on the Music page.
//  - Time colours (also in the overview, off by default): the same colours as a faint wash behind every page.
import { $, D, curPage, fmtHM, h, haptic, lastTouch, lastUserTouch, nightOn, pages, store } from './main.js';

const PHASES = [
  // from (hour), key, greeting, line, three colours (r, g, b), how much black to lay over it (0..1)
  { from: 5, key: 'dawn', hello: 'Good morning', line: 'Early light', c: ['255, 176, 136', '255, 112, 150', '255, 214, 150'], dim: 0.05 },
  { from: 8, key: 'morning', hello: 'Good morning', line: 'Make it a good one', c: ['255, 205, 70', '255, 130, 60', '70, 190, 255'], dim: 0 },
  { from: 12, key: 'afternoon', hello: 'Good afternoon', line: 'Keep the momentum', c: ['64, 156, 255', '40, 205, 190', '170, 232, 255'], dim: 0.08 },
  { from: 17, key: 'evening', hello: 'Good evening', line: 'Wind down', c: ['255, 150, 100', '160, 90, 215', '70, 60, 160'], dim: 0.3 },
  { from: 21, key: 'night', hello: 'Good night', line: 'Rest well', c: ['44, 62, 150', '90, 44, 140', '16, 28, 70'], dim: 0.5 },
];
export function phaseAt(d = new Date()) {
  const hr = d.getHours() + d.getMinutes() / 60;
  let p = PHASES[PHASES.length - 1];            // before 05:00 it is still night
  for (const q of PHASES) if (hr >= q.from) p = q;
  return p;
}

export const AMBIENT_CHOICES = [0, 2, 5, 10, 30];            // minutes of no touch; 0 = never
export const ambientMin = () => { const v = +store.get('ambMin', 10); return AMBIENT_CHOICES.includes(v) ? v : 10; };
export const ambientLabel = () => `Ambient screen ${ambientMin() === 0 ? 'off' : 'after ' + ambientMin() + ' min'}`;
export const todTheme = () => store.get('todTheme', false) === true;
export const todLabel = () => `Time colours ${todTheme() ? 'on' : 'off'}`;
export function cycleAmbient() {
  const next = AMBIENT_CHOICES[(AMBIENT_CHOICES.indexOf(ambientMin()) + 1) % AMBIENT_CHOICES.length];
  store.set('ambMin', next);
  return next;
}
export function toggleTod() { store.set('todTheme', !todTheme()); applyTod(true); return todTheme(); }

// ---------------------------------------------------------------- the faint wash behind the pages
let wash = null, lastKey = '';
export function applyTod(force = false) {
  const p = phaseAt();
  if (!wash) { wash = h('div'); wash.id = 'todwash'; document.body.prepend(wash); }
  const on = todTheme();
  document.body.classList.toggle('tod-on', on);
  document.body.dataset.tod = p.key;
  if (!force && p.key === lastKey) return;
  lastKey = p.key;
  wash.style.setProperty('--t1', p.c[0]); wash.style.setProperty('--t2', p.c[1]); wash.style.setProperty('--t3', p.c[2]);
  wash.style.setProperty('--t-str', String(p.key === 'morning' ? 1 : p.key === 'dawn' || p.key === 'afternoon' ? 0.85 : p.key === 'evening' ? 0.6 : 0.45));
}

// ---------------------------------------------------------------- the ambient screen
let forced = false, el = null, layers = [], dismissedAt = 0, shown = false, paintedKey = '', paintedMin = '', paintedMusic = '';
function build() {
  el = h('div');
  el.id = 'ambient';
  layers = [h('i', 'am-g on'), h('i', 'am-g')];
  const hello = h('div', 'am-hello'), time = h('div', 'am-time'), date = h('div', 'am-date'), line = h('div', 'am-line'), music = h('div', 'am-music');
  el.append(...layers, h('div', 'am-shade'), h('div', 'am-wrap', hello, time, date, line, music));
  el.hello = hello; el.time = time; el.date = date; el.line = line; el.music = music;
  document.body.append(el);
  // a tap anywhere brings the page back; the tap itself does nothing to the page underneath
  el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); haptic(); forced = false; dismissedAt = Date.now(); hide(); });
}
function paint(now) {
  const p = phaseAt(now);
  if (p.key !== paintedKey) {
    const next = layers.find((l) => !l.classList.contains('on')) || layers[0];
    next.style.setProperty('--a1', p.c[0]); next.style.setProperty('--a2', p.c[1]); next.style.setProperty('--a3', p.c[2]);
    layers.forEach((l) => l.classList.toggle('on', l === next));
    el.style.setProperty('--am-dim', String(p.dim));
    el.hello.textContent = p.hello; el.line.textContent = p.line;
    el.dataset.phase = p.key; paintedKey = p.key;
  }
  const hm = fmtHM(now);
  if (hm !== paintedMin) {
    paintedMin = hm; el.time.textContent = hm;
    el.date.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    // the clock moves a few pixels every minute so the same pixels are not lit all night
    const m = now.getHours() * 60 + now.getMinutes();
    el.style.setProperty('--am-x', (((m * 37) % 41) - 20) + 'px');
    el.style.setProperty('--am-y', (((m * 53) % 31) - 15) + 'px');
  }
  const m = D.state?.media;
  const song = m?.playing && m.title ? `♪  ${m.title}${m.artist ? ' · ' + m.artist : ''}` : '';
  if (song !== paintedMusic) { paintedMusic = song; el.music.textContent = song; }
}
export function show() {
  if (!el) build();
  paint(new Date());
  if (shown) return;
  shown = true; el.classList.add('on');
}
export function hide() {
  if (!el || !shown) return;
  shown = false; el.classList.remove('on');
}

function check() {
  const now = new Date();
  if (todTheme() || document.body.classList.contains('tod-on')) applyTod();
  const min = ambientMin();
  const idle = Date.now() - Math.max(lastTouch, lastUserTouch, dismissedAt);
  const priv = D.state?.privacy;
  const onAir = !!(priv && (priv.mic || priv.camera));
  const prompt = $('approval') && !$('approval').hidden;
  const musicStage = pages[curPage]?.id === 'apple-music' && !!D.state?.media?.playing;
  const want = forced || min > 0 && idle > min * 60_000 && !nightOn && !onAir && !prompt && !musicStage && !document.hidden;
  if (want) show(); else hide();
  if (shown) paint(now);
}

export function initAmbient() {
  applyTod(true);
  setInterval(check, 1000);
  window.pbAmbient = (on) => { forced = !!on; if (on) show(); else { dismissedAt = Date.now(); hide(); } };   // for testing in a browser
}
