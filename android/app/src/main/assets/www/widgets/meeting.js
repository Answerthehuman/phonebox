// Meeting controls and the "On air" banner (Patch 4).
//  - The PC agent already knows when an app is using the microphone or the camera (D.state.privacy: mic, camera,
//    micApps, cameraApps). While that is true a small "On air" pill shows on every page; tapping it opens this page.
//    Nothing switches page by itself.
//  - The buttons send the meeting app's own keyboard shortcuts through the agent's shortcuts (ids "pb-mt-*", installed
//    by tools/install-shortcuts.py). Keys go to the window in front on the PC, so the call window must be in front, or
//    the app must have the shortcut set as a global one (Discord: Settings > Keybinds). "Bring to front" opens the app.
import { D, api, cfg, curPage, goPage, h, haptic, pages, store, toast } from '../main.js';
import { W } from '../registry.js';

// what each service offers: [id suffix, label, hint, kind]  kind: 'mic' | 'cam' | 'danger' | undefined
const SERVICES = {
  meet: {
    name: 'Google Meet', note: 'Meet answers these keys only while its browser tab is in front.',
    keys: [['mic', 'Mute / unmute', 'Ctrl + D', 'mic'], ['cam', 'Camera', 'Ctrl + E', 'cam'], ['hand', 'Raise hand', 'Ctrl + Alt + H'], ['chat', 'Chat', 'Ctrl + Alt + C'], ['cc', 'Captions', 'C']],
  },
  teams: {
    name: 'Microsoft Teams', note: '', front: true,
    keys: [['mic', 'Mute / unmute', 'Ctrl + Shift + M', 'mic'], ['cam', 'Camera', 'Ctrl + Shift + O', 'cam'], ['share', 'Share screen', 'Ctrl + Shift + E'], ['hand', 'Raise hand', 'Ctrl + Shift + K'], ['leave', 'Leave call', 'Ctrl + Shift + H', 'danger']],
  },
  discord: {
    name: 'Discord', note: 'To mute while a game is in front, set these two as keybinds in Discord (Settings > Keybinds).', front: true,
    keys: [['mic', 'Mute / unmute', 'Ctrl + Shift + M', 'mic'], ['deaf', 'Deafen', 'Ctrl + Shift + D']],
  },
};
const ORDER = ['meet', 'teams', 'discord'];

// which service is using the microphone or camera, from the names the agent reports ("ms-teams", "Discord", "chrome" ...)
export function liveService(p) {
  if (!p || (!p.mic && !p.camera)) return null;
  const names = [...(p.micApps || []), ...(p.cameraApps || [])].join(' ').toLowerCase();
  const service = /teams/.test(names) ? 'teams' : /discord/.test(names) ? 'discord' : /chrome|msedge|edge|firefox|brave|opera|vivaldi/.test(names) ? 'meet' : null;
  return { service, mic: !!p.mic, cam: !!p.camera, names: [...new Set([...(p.micApps || []), ...(p.cameraApps || [])])] };
}

const have = (id) => (cfg.shortcuts || []).some((s) => s.id === id);

W.meeting = {
  bare: true,
  needs: ['state', 'tick'],
  create(box) {
    box.classList.add('mt');
    const badge = h('div', 'mt-badge'), badgeText = h('div', 'mt-badge-t'), clock = h('b', 'mt-clock');
    const chips = h('div', 'mt-chips'), grid = h('div', 'mt-grid'), note = h('div', 'mt-note');
    const phoneCam = h('details', 'mt-cam', h('summary', null, 'Use this phone as the laptop camera'),
      h('div', null, 'Windows 11 can do this without an app: Settings > Bluetooth & devices > Mobile devices > turn on "Use as a connected camera", pick this phone, and approve on it. It then shows up as a camera in Meet, Teams and Discord. Free apps such as Iriun or DroidCam work on Windows 10 too.'));
    badge.append(h('i', 'mt-dot'), badgeText, clock);
    box.append(badge, chips, grid, note, phoneCam);

    let svc = store.get('mt-svc', 'meet');
    let liveSince = 0;
    const chipBtns = ORDER.map((k) => { const b = h('button', 'mt-chip', SERVICES[k].name); b.type = 'button'; b.dataset.k = k; b.addEventListener('click', () => { haptic(); svc = k; store.set('mt-svc', k); build(); }); chips.append(b); return b; });

    const press = async (btn, id) => {
      haptic(); btn.classList.add('busy');
      let ok = false;
      try { await api('/run/' + encodeURIComponent(id), 'POST', 5000); ok = true; } catch (_) {}
      btn.classList.remove('busy'); btn.classList.add(ok ? 'ok' : 'err');
      setTimeout(() => btn.classList.remove('ok', 'err'), 800);
      if (!ok) toast('The PC did not take that key', 'err');
    };
    function build() {
      chipBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === svc));
      const s = SERVICES[svc], list = [...s.keys];
      if (s.front) list.push(['front', 'Bring to front', 'open the app']);
      grid.replaceChildren(...list.map(([suffix, label, hint, kind]) => {
        const id = `pb-mt-${svc}-${suffix}`;
        const b = h('button', 'mt-key ' + (kind || ''), h('span', 'mt-k-label', label), h('small', null, hint));
        b.type = 'button'; b.dataset.id = id; b.disabled = !have(id);
        b.addEventListener('click', () => press(b, id));
        return b;
      }));
      const missing = [...grid.children].some((b) => b.disabled);
      note.textContent = missing ? 'Some keys are not installed on the PC yet: run tools/install-shortcuts.py on the laptop.' : s.note;
      note.classList.toggle('warn', missing);
    }
    build();

    const paint = () => {
      const live = liveService(D.state?.privacy);
      badge.classList.toggle('live', !!live);
      if (live) {
        if (!liveSince) liveSince = Date.now();
        const who = live.service ? SERVICES[live.service].name : live.names.join(', ') || 'an app';
        badgeText.replaceChildren(h('b', null, 'On air'), h('small', null, `${who}  ·  microphone ${live.mic ? 'in use' : 'idle'}  ·  camera ${live.cam ? 'in use' : 'idle'}`));
        const sec = Math.floor((Date.now() - liveSince) / 1000);
        clock.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
        if (live.service && live.service !== svc && !box.dataset.pinned) { svc = live.service; build(); }
      } else {
        liveSince = 0; clock.textContent = '';
        badgeText.replaceChildren(h('b', null, 'Not in a call'), h('small', null, 'This turns red when an app uses the microphone or camera.'));
      }
    };
    chips.addEventListener('click', () => { box.dataset.pinned = '1'; });   // a manual choice sticks until the page is rebuilt
    paint();
    return { update() { paint(); if (grid.querySelector('button:disabled')) build(); } };
  },
};

// ---------------------------------------------------------------- the banner on every other page
export function initOnAir() {
  const pill = h('button', 'onair-pill');
  pill.type = 'button'; pill.id = 'onair'; pill.hidden = true;
  pill.append(h('i', 'mt-dot'), h('span', 'onair-t'));
  document.body.append(pill);
  pill.addEventListener('click', () => {
    haptic();
    const at = pages.findIndex((p) => p.id === 'meeting');
    if (at >= 0) goPage(at);
  });
  let last = '';
  const check = () => {
    const live = liveService(D.state?.privacy);
    const onPage = pages[curPage]?.id === 'meeting';
    const text = live ? `On air${live.service ? '  ·  ' + SERVICES[live.service].name : ''}` : '';
    const sig = text + '|' + onPage;
    if (sig === last) return;
    last = sig;
    pill.hidden = !live || onPage;
    pill.querySelector('.onair-t').textContent = text;
  };
  setInterval(check, 800);
}
