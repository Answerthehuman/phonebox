// Meeting controls and the "On air" banner.
//  - The PC agent already knows when an app is using the microphone or the camera (D.state.privacy: mic, camera,
//    micApps, cameraApps). While that is true a small "On air" pill shows on every page; tapping it opens this page.
//    Nothing switches page by itself.
//  - Each service gets its own buttons, drawn the way that app draws them (Meet: round grey buttons, Teams: rounded
//    purple buttons and a red Leave, Discord: round dark buttons) with icons instead of text. They send the app's own
//    keyboard shortcuts through the agent's shortcuts (ids "pb-mt-*", installed by tools/install-shortcuts.py). The keys go
//    to the window in front on the PC, so the call window must be in front, or the app must have the shortcut set as a
//    global one (Discord: Settings > Keybinds). "Open" brings the app up.
//  - The icons are drawn here as simple line glyphs in the style of each app; the apps' own icon files are not used.
import { D, api, cfg, curPage, goPage, h, haptic, pages, store, toast } from '../main.js';
import { W } from '../registry.js';
import { ensurePage, visMode } from '../visibility.js';

const svg = (inner, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
const SLASH = '<path d="M4 4l16 16" stroke-width="2.2"/>';
const ICON = {
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>'),
  cam: svg('<rect x="3" y="6.5" width="12" height="11" rx="2.5"/><path d="M15 10.5l6-3.2v9.4l-6-3.2"/>'),
  camOff: svg('<rect x="3" y="6.5" width="12" height="11" rx="2.5"/><path d="M15 10.5l6-3.2v9.4l-6-3.2"/>' + SLASH),
  share: svg('<rect x="3" y="4" width="18" height="12.5" rx="2.2"/><path d="M8.5 20.5h7M12 16.5v4M12 13V7.5M9.3 10l2.7-2.7 2.7 2.7"/>'),
  hand: svg('<path d="M8 13.5V6.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6.5a1.5 1.5 0 0 1 3 0v7c0 4.2-2.6 6.5-6 6.5-2.5 0-4.2-1.1-5.5-3.2L3.8 14a1.5 1.5 0 0 1 2.5-1.6L8 14.5"/>'),
  chat: svg('<path d="M4 5.5h16v11H9.5L5 20.5v-4H4z"/><path d="M8 10h8M8 13h5"/>'),
  cc: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.2 10.4a2.1 2.1 0 1 0 0 3.2M16.6 10.4a2.1 2.1 0 1 0 0 3.2"/>'),
  leave: svg('<path d="M2.8 14.3c5.4-5 12.6-5 18.4 0l-2.2 2.8-3.4-1.7v-2.6a9.5 9.5 0 0 0-4.8 0v2.6L5 17.1z" fill="currentColor"/>'),
  deaf: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.2" height="6.5" rx="1.6"/><rect x="16.8" y="14" width="4.2" height="6.5" rx="1.6"/>'),
  open: svg('<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
};
// the little mark on each service's tab
const MARK = {
  // Google Meet's camera mark (its own five colours), Teams' purple tile with the T and a second person, and Discord's own
  // icon, copied from the installed app (icons/discord.png)
  meet: '<svg viewBox="0 0 87.5 72"><path fill="#00832d" d="M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z"/><path fill="#0066da" d="M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z"/><path fill="#e94235" d="M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z"/><path fill="#2684fc" d="M20.5 20.5H0v31h20.5z"/><path fill="#00ac47" d="M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.85.135 4.85-2.37V11c0-2.535-2.945-3.925-4.91-2.32zM49.5 36v15.5h-29V72h43c3.315 0 6-2.685 6-6V53.08z"/><path fill="#ffba00" d="M63.5 0h-43v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z"/><path fill="#00832d" d="M49.5 36v-15.5h-29V36z"/></svg>',
  teams: '<svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="18" rx="3.2" fill="#4b53bc"/><circle cx="18.2" cy="6.2" r="3" fill="#7b83eb"/><path d="M13.5 10.5h6.4c1.1 0 2 .9 2 2V17a3.2 3.2 0 0 1-3.2 3.2h-.4a3.2 3.2 0 0 1-3.2-3.2z" fill="#7b83eb"/><path d="M4.4 8.6h7.2M8 8.6V16" stroke="#fff" stroke-width="2.1" stroke-linecap="round" fill="none"/></svg>',
  discord: '<img src="icons/discord.png" alt="">',
};

// what each service offers: [id suffix, label, icon, kind]   kind: mic | cam | danger | open (drawn differently)
const SERVICES = {
  meet: {
    name: 'Google Meet', look: 'meet', note: 'Meet answers these keys only while its tab is in front.',
    keys: [['mic', 'Microphone', 'mic', 'mic'], ['cam', 'Camera', 'cam', 'cam'], ['hand', 'Raise hand', 'hand'], ['chat', 'Chat', 'chat'], ['cc', 'Captions', 'cc']],
  },
  teams: {
    name: 'Microsoft Teams', look: 'teams', note: '', front: true,
    keys: [['mic', 'Mute', 'mic', 'mic'], ['cam', 'Camera', 'cam', 'cam'], ['share', 'Share', 'share'], ['hand', 'Raise hand', 'hand'], ['leave', 'Leave', 'leave', 'danger']],
  },
  discord: {
    name: 'Discord', look: 'discord', note: 'To mute while a game is in front, set these two as keybinds in Discord (Settings > Keybinds).', front: true,
    keys: [['mic', 'Mute', 'mic', 'mic'], ['deaf', 'Deafen', 'deaf']],
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
    // the explanation and the phone-camera tip sit in the top right; the buttons take everything below
    const side = h('div', 'mt-side', note, phoneCam);
    box.append(h('div', 'mt-top', badge, side), chips, grid);

    let svc = store.get('mt-svc', 'meet');
    let liveSince = 0, camOn = null;
    const chipBtns = ORDER.map((k) => {
      const b = h('button', 'mt-chip');
      b.type = 'button'; b.dataset.k = k;
      b.innerHTML = `<i class="mt-mark">${MARK[SERVICES[k].look]}</i>${SERVICES[k].name}`;
      b.addEventListener('click', () => { haptic(); svc = k; store.set('mt-svc', k); box.dataset.pinned = '1'; build(); });
      chips.append(b); return b;
    });

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
      if (s.front) list.push(['front', 'Open app', 'open', 'open']);
      box.dataset.look = s.look;
      grid.replaceChildren(...list.map(([suffix, label, icon, kind]) => {
        const id = `pb-mt-${svc}-${suffix}`;
        const b = h('button', 'mt-key ' + (kind || ''));
        b.type = 'button'; b.dataset.id = id; b.dataset.icon = icon; b.disabled = !have(id);
        b.innerHTML = `<span class="mt-ico">${ICON[icon]}</span><span class="mt-k-label">${label}</span>`;
        b.setAttribute('aria-label', label);
        b.addEventListener('click', () => press(b, id));
        return b;
      }));
      paintCam();
      const missing = [...grid.children].some((b) => b.disabled);
      note.textContent = missing ? 'Some keys are not installed on the PC yet: run tools/install-shortcuts.py on the laptop.' : s.note;
      note.classList.toggle('warn', missing);
    }
    // the camera button shows the real state: struck through while no app has the camera open
    function paintCam() {
      const b = grid.querySelector('.mt-key.cam .mt-ico');
      if (!b) return;
      const want = camOn === false ? 'camOff' : 'cam';
      if (b.parentElement.dataset.icon !== want) { b.innerHTML = ICON[want]; b.parentElement.dataset.icon = want; }
      b.parentElement.classList.toggle('off', camOn === false);
    }
    build();

    const paint = () => {
      const live = liveService(D.state?.privacy);
      badge.classList.toggle('live', !!live);
      const cam = live ? live.cam : null;
      if (cam !== camOn) { camOn = cam; paintCam(); }
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
    const find = () => pages.findIndex((p) => p.id === 'meeting');
    if (find() < 0) ensurePage('meeting');
    const at = find();
    if (at >= 0) goPage(at);
  });
  let last = '';
  const check = () => {
    const live = visMode('meeting') === 'hide' ? null : liveService(D.state?.privacy);   // "Hidden" in the overview also hides the pill
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
