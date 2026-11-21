// Optional pages (Patch 5): the Minecraft and Meeting pages stay out of the page list until they are needed.
//   Auto   - the page appears when Minecraft (or your Minecraft server) starts, or when a call is on air, and goes
//            about a minute and a half after it ends. A page you are standing on is never taken away under you.
//   Always - the page is always in the list.   Hidden - it is never in the list (you can still open it by tapping the On air pill).
// The choice is kept on this phone (overview > Pages).
import { D, api, buildLayout, curPage, pages, store, toast } from './main.js';

const KEYS = { minecraft: 'vis-minecraft', meeting: 'vis-meeting' };
export const OPTIONAL = Object.keys(KEYS);
export const VIS_LABEL = { auto: 'Auto', show: 'Always', hide: 'Hidden' };
const MODES = ['auto', 'show', 'hide'];
const GRACE_MS = 90_000;

export const visMode = (id) => { const v = store.get(KEYS[id], 'auto'); return MODES.includes(v) ? v : 'auto'; };
export function cycleVis(id) {
  store.set(KEYS[id], MODES[(MODES.indexOf(visMode(id)) + 1) % MODES.length]);
  buildLayout();
}

// what is running on the computer (from the agent's process list)
export const mc = { game: false, server: false, at: 0 };
const lastActive = {};
let procBusy = false, readerTry = 0;
async function readProcs() {
  if (procBusy || Date.now() - mc.at < 8000) return;
  procBusy = true; mc.at = Date.now();
  try {
    const groups = (await api('/procs?top=120', 'GET', 4000)).groups || [];
    // the game runs as javaw (TLauncher's launcher too, which is fine: you opened it to play); the server is java.exe from start.bat.
    // Memory figures are no use here: Windows trims a busy game's working set. The reader's answer is proof of a live server.
    mc.game = groups.some((g) => /minecraft/i.test(g.name || '') || /^javaw$/i.test(g.name || ''));
    mc.server = groups.some((g) => /^java$/i.test(g.name || ''));
  } catch (_) { /* keep what we knew */ }
  procBusy = false;
}

function activeNow(id) {
  if (id === 'meeting') { const p = D.state?.privacy; return !!(p && (p.mic || p.camera)); }
  if (id === 'minecraft') return mc.game || mc.server || ['ok', 'no-player'].includes(D.push?.mc?.data?.status);
  return false;
}

export function pageVisible(id) {
  if (!KEYS[id]) return true;
  const mode = visMode(id);
  if (mode === 'show') return true;
  if (pages[curPage]?.id === id) return true;               // never pulled out from under you; it goes once you leave it
  if (mode === 'hide') return false;
  return activeNow(id) || Date.now() - (lastActive[id] || 0) < GRACE_MS;
}

/** Puts an optional page in the list for the grace period (the On air pill uses it before the next check runs). */
export function ensurePage(id) {
  if (!KEYS[id] || visMode(id) === 'hide') return false;
  lastActive[id] = Date.now();
  buildLayout();
  return true;
}

export function initVisibility() {
  let sig = OPTIONAL.map(pageVisible).join();
  const check = async () => {
    await readProcs();
    for (const id of OPTIONAL) if (activeNow(id)) lastActive[id] = Date.now();
    // the live Minecraft data comes from the reader (tools/mc-bridge.py): when the server is up and nothing is arriving, start it
    // (it is safe to start twice, a second copy exits at once)
    const fresh = (D.push?.mc?.expiresAt || 0) > Date.now();
    if (mc.server && !fresh && Date.now() - readerTry > 30_000) { readerTry = Date.now(); api('/run/pb-mc-bridge', 'POST', 6000).catch(() => {}); }
    const now = OPTIONAL.map(pageVisible).join();
    if (now === sig) return;
    const was = sig.split(',');
    sig = now;
    OPTIONAL.forEach((id, i) => {
      if (now.split(',')[i] === 'true' && was[i] === 'false' && visMode(id) === 'auto') toast(id === 'minecraft' ? 'Minecraft page is available' : 'You are on air: Meeting page is available', 'ok');
    });
    buildLayout();
  };
  setInterval(check, 3000);
  setTimeout(check, 1500);
}
