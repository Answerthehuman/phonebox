// Now Playing stage: a spinning record with the cover as its label, a tonearm, synced lyrics and large transport
// controls. It is a normal widget (type "musicstage") and main.js also adds one full-screen "Music" page that
// holds it, so it works without touching the saved layout.
//
// Lyrics come from LRCLIB (https://lrclib.net, free, no account): when a track plays, its title, artist, album and
// length are looked up there. Nothing else leaves the phone. Radio streams are never looked up.
import { toast, API, D, api, averageColor, emit, fmtTime, h, haptic, media, safeFetch, setArtColor, setMediaState, setVolDragging, store, t, volDragging } from '../main.js';
import { W } from '../registry.js';
import { integrationCommand, invalidateDeckState } from './controls.js';

// ---------------------------------------------------------------- lyrics
const LRC_HOST = 'https://lrclib.net/api';
const memo = new Map();       // key -> { synced: [{ t, text }] | null, plain: string | null } | 'none'
const pending = new Map();

/** "Song (feat. X) - 2011 Remaster" -> "Song": the plain title matches far more often. */
const cleanTitle = (s) => String(s || '')
  .replace(/\s*[(\[][^)\]]*(feat|ft\.|remaster|live|version|edit|mix|official|video|audio|lyrics?)[^)\]]*[)\]]/gi, '')
  .replace(/\s+-\s+(.*(remaster|live|version|edit|mix|mono|stereo).*)$/i, '')
  .trim();
const cleanArtist = (s) => String(s || '').split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0].trim();

function parseLrc(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!stamps.length) continue;
    const line = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) out.push({ t: (+m[1] * 60 + parseFloat(m[2].replace(':', '.'))) * 1000, text: line });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await safeFetch(url, { signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function fromRecord(rec) {
  if (!rec) return null;
  const synced = rec.syncedLyrics ? parseLrc(rec.syncedLyrics) : null;
  if (synced && synced.length) return { synced, plain: null };
  if (rec.plainLyrics) return { synced: null, plain: String(rec.plainLyrics) };
  return null;
}

export function loadLyrics(m) {
  const title = cleanTitle(m.title), artist = cleanArtist(m.artist);
  if (!title || m.app === 'Internet Radio') return Promise.resolve('none');
  const key = `${artist}|${title}|${Math.round((m.durMs || 0) / 1000)}`.toLowerCase();
  if (memo.has(key)) return Promise.resolve(memo.get(key));
  const saved = store.get('lrc:' + key, null);
  if (saved) { memo.set(key, saved); return Promise.resolve(saved); }
  if (pending.has(key)) return pending.get(key);
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (m.album) q.set('album_name', m.album);
  if (m.durMs > 0) q.set('duration', String(Math.round(m.durMs / 1000)));
  const p = (async () => {
    let res = null;
    try { res = fromRecord(await getJson(`${LRC_HOST}/get?${q}`)); } catch (_) { /* try the search below */ }
    if (!res) {
      const s = new URLSearchParams({ track_name: title, artist_name: artist });
      const list = await getJson(`${LRC_HOST}/search?${s}`);
      if (Array.isArray(list)) {
        // prefer a synced hit whose length is close to the track's
        const ranked = list.map((r) => ({ r, d: m.durMs > 0 && r.duration ? Math.abs(r.duration * 1000 - m.durMs) : 0, s: r.syncedLyrics ? 0 : 1 }))
          .sort((a, b) => a.s - b.s || a.d - b.d);
        for (const { r, d } of ranked) { if (d > 6000) continue; res = fromRecord(r); if (res) break; }
      }
    }
    res = res || 'none';
    memo.set(key, res);
    if (res !== 'none') {
      const index = store.get('lrc:index', []).filter((k) => k !== key);
      index.push(key);
      while (index.length > 24) store.set('lrc:' + index.shift(), null);
      store.set('lrc:index', index);
      store.set('lrc:' + key, res);
    }
    return res;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

// ---------------------------------------------------------------- the widget
const ico = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2.4v14H6zM20 5.5v13a.8.8 0 0 1-1.25.66L9.6 12.66a.8.8 0 0 1 0-1.32l9.15-6.5A.8.8 0 0 1 20 5.5z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M15.6 5H18v14h-2.4zM4 5.5v13a.8.8 0 0 0 1.25.66l9.15-6.5a.8.8 0 0 0 0-1.32l-9.15-6.5A.8.8 0 0 0 4 5.5z"/></svg>',
  play: '<svg class="i-play" viewBox="0 0 24 24"><path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12-7.4a1 1 0 0 0 0-1.72l-12-7.4A1 1 0 0 0 7 4.6z"/></svg>'
    + '<svg class="i-pause" viewBox="0 0 24 24"><rect x="5.5" y="4" width="4.4" height="16" rx="1.4"/><rect x="14.1" y="4" width="4.4" height="16" rx="1.4"/></svg>',
  // Spotify's lyrics glyph: a microphone leaning to the left
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(45 12 12)"><rect x="7.6" y="0.8" width="8.8" height="10.4" rx="4.4"/><path d="M7.6 5h8.8M7.6 8h8.8" stroke-width="1.4"/><rect x="9.8" y="12.6" width="4.4" height="9" rx="2.2"/></g></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.4S3.6 15.2 3.6 9.2A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8.4 2.6c0 6-8.4 11.2-8.4 11.2z"/></svg>',
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5h12M3.5 12h7.5M3.5 17.5h7.5"/><path d="M15 12.6v6.8l5.6-3.4z" fill="currentColor"/></svg>',
  speakerLo: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/></svg>',
  speakerHi: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15 8.6a4.8 4.8 0 0 1 0 6.8M17.4 6a8.4 8.4 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

W.musicstage = {
  bare: true,
  needs: ['state', 'fast'],
  create(box, ctx) {
    box.classList.add('ms-root');
    box.innerHTML = `
      <div class="ms-bg"><img alt=""></div><div class="ms-veil"></div>
      <div class="ms-stage">
        <div class="ms-glow"></div>
        <div class="ms-deck">
          <div class="ms-disc">
            <div class="ms-spin">
              <div class="ms-grooves"></div>
              <div class="ms-label"><img class="ms-art" alt=""><span class="ms-ph">♪</span></div>
              <i class="ms-hole"></i>
            </div>
            <div class="ms-sheen"></div>
          </div>
          <div class="ms-arm"><i class="ms-pivot"></i><i class="ms-bar"></i><i class="ms-head"></i></div>
        </div>
        <div class="ms-info">
          <div class="ms-source"></div>
          <div class="ms-title">${t('w.nothingPlaying')}</div>
          <div class="ms-artist">${t('w.startOnPc')}</div>
        </div>
        <div class="ms-lyrics" aria-live="off"><div class="ms-lines"></div><div class="ms-note"></div></div>
        <div class="ms-queue"><div class="ms-qlist"></div><div class="ms-note ms-qnote"></div></div>
        <div class="ms-dock">
          <div class="ms-prog"><span class="ms-pos">0:00</span><div class="ms-bar2"><div class="ms-fill"></div></div><span class="ms-dur">0:00</span></div>
          <div class="ms-ctl">
            <button class="ms-btn big" data-media="prev" aria-label="Previous">${ico.prev}</button>
            <button class="ms-btn big play" data-media="playpause" aria-label="Play/Pause">${ico.play}</button>
            <button class="ms-btn big" data-media="next" aria-label="Next">${ico.next}</button>
          </div>
          <div class="ms-tools">
            <button class="ms-ico" aria-label="Lyrics" data-act="lyrics">${ico.mic}</button>
            <button class="ms-ico" aria-label="Queue" data-act="queue">${ico.queue}</button>
            <button class="ms-ico ms-like" aria-label="Like" data-like>${ico.heart}</button>
          </div>
          <div class="ms-vol"><i class="lo">${ico.speakerLo}</i><input type="range" class="ms-volr" min="0" max="100" step="1" value="50"><i class="hi">${ico.speakerHi}</i></div>
        </div>
      </div>`;
    const q = (s) => box.querySelector(s);
    const art = q('.ms-art'), bg = q('.ms-bg img'), spin = q('.ms-spin'), vol = q('.ms-volr');
    const lines = q('.ms-lines'), note = q('.ms-note'), lyrics = q('.ms-lyrics');
    const fill = q('.ms-fill'), posEl = q('.ms-pos'), durEl = q('.ms-dur');
    let shownPos = '';
    let artId = -1, lyricKey = '', lyr = null, active = -1, view = store.get('ms-view', '');   // '', 'lyrics' or 'queue'
    let volTimer = 0, volumeRelease = 0, visible = true, raf = 0, angle = 0, omega = 0, last = 0, ro = null;
    // With the lyrics' controls hidden the page dots go too (same tap, as in Spotify); they come back with the controls,
    // when the view changes, or when another page is shown.
    const syncNav = () => document.body.classList.toggle('hide-dots', box.classList.contains('ms-bare') && visible);
    const paintView = () => {
      box.classList.toggle('lyr-on', !!view);          // either panel shrinks the record to the corner
      box.classList.toggle('show-queue', view === 'queue');
      if (view !== 'lyrics') box.classList.remove('ms-bare');
      syncNav();
      box.querySelectorAll('[data-act]').forEach((b) => b.classList.toggle('on', b.dataset.act === view));
    };
    paintView();

    // ---- layout: a tall (portrait) widget stacks the disc above the text
    const fit = () => box.classList.toggle('ms-tall', box.clientHeight > box.clientWidth * 1.05);
    if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe(box); }
    fit();
    window.addEventListener('resize', fit);

    // ---- art
    art.addEventListener('load', () => { art.classList.add('on'); bg.classList.add('on'); setArtColor(averageColor(art)); });
    art.addEventListener('error', () => { art.classList.remove('on'); bg.classList.remove('on'); });

    // ---- the record keeps its own angle so it spins up and winds down like a turntable instead of freezing
    const tickSpin = (now) => {
      raf = 0;
      if (!visible) { last = 0; return; }
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const target = media?.playing ? 36 : 0;               // degrees per second: a slow, calm turn (a real 33⅓ rpm record is 200)
      omega += (target - omega) * Math.min(1, dt / (target ? 700 : 1100));
      if (Math.abs(omega) < 0.05 && !target) omega = 0;
      angle = (angle + (omega * dt) / 1000) % 360;
      spin.style.transform = `rotate(${angle.toFixed(2)}deg)`;
      if (omega || target) raf = requestAnimationFrame(tickSpin);
      else last = 0;
    };
    const kick = () => { if (!raf && visible) raf = requestAnimationFrame(tickSpin); };
    if (window.IntersectionObserver) {
      new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) kick(); syncNav(); }).observe(box);
    }

    // ---- controls
    box.querySelectorAll('[data-media]').forEach((btn) => btn.addEventListener('click', async () => {
      haptic();
      const action = btn.dataset.media;
      if (action === 'playpause' && media) {
        media.playing = !media.playing; media.at = performance.now();
        box.classList.toggle('playing', media.playing); kick();
      }
      try {
        const res = await api('/media/' + action, 'POST');
        if (res && typeof res === 'object' && 'media' in res) setMediaState(res.media);
        invalidateDeckState(); emit('tick');
      } catch (_) {}
    }));
    // The views differ in layout (size and position of the record, title and controls). Animating left/top/width/height
    // re-runs layout every frame, which is what made this page stutter. Instead the new layout is applied at once and
    // each block is played from where it was to where it is with a transform (FLIP), which the GPU does on its own.
    const EASE = 'cubic-bezier(.22,.9,.24,1)';
    const moveFrom = (el, from, scale) => {
      if (!el.animate) return;
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left, dy = from.top - to.top, sx = scale && to.width ? from.width / to.width : 1;
      if (!dx && !dy && sx === 1) return;
      el.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: 420, easing: EASE });
    };
    const fadeIn = (el) => { if (el.animate) el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' }); };
    const deck = q('.ms-deck'), info = q('.ms-info'), dock = q('.ms-dock');
    const setView = (next) => {
      haptic();
      const deckFrom = deck.getBoundingClientRect();
      view = view === next ? '' : next; store.set('ms-view', view);
      paintView();
      moveFrom(deck, deckFrom, true); fadeIn(info); fadeIn(dock);
      if (view === 'lyrics') { active = -2; follow(true); }
      if (view === 'queue') loadQueue(true);
    };
    q('[data-act="lyrics"]').addEventListener('click', () => setView('lyrics'));
    q('[data-act="queue"]').addEventListener('click', () => setView('queue'));
    // Tap the empty space of the lyrics to hide the progress bar and controls (more room for the words), tap again to
    // bring them back, as in Spotify. A tap on a line itself still jumps to it.
    lyrics.addEventListener('click', (e) => {
      const ln = e.target.closest('.ms-line');
      if (ln && !ln.classList.contains('now')) return;   // another line: jump to it (handled on the line)
      haptic();
      box.classList.toggle('ms-bare');
      syncNav();
      setTimeout(() => follow(true), 60);
      setTimeout(() => follow(true), 420);
    });
    // ---- like: saves the playing Spotify track to Liked Songs (the agent's "favorite" action)
    const like = q('[data-like]');
    const likedIds = new Set(store.get('ms-liked', []));
    let curId = null;
    const paintLike = () => {
      const on = !!curId && likedIds.has(curId);
      like.classList.toggle('liked', on);
      like.setAttribute('aria-pressed', String(on));
      like.setAttribute('aria-label', on ? 'Liked' : 'Like');
      like.disabled = media?.app !== 'Spotify';
    };
    async function refreshCurrent() {
      try { const d = await api('/controls/spotify/state', 'GET', 15000); curId = d.connected ? d.current?.id || null : null; } catch (_) { curId = null; }
      paintLike();
    }
    like.addEventListener('click', async (e) => {
      e.stopPropagation(); haptic();
      if (!curId) await refreshCurrent();
      if (!curId) { toast('Spotify is not connected yet: PhoneBox settings → Control Deck → Spotify connection', 'err'); return; }
      if (likedIds.has(curId)) { toast('Already in Liked Songs. Remove it from the Spotify app.'); return; }
      like.classList.add('pop');
      try {
        await integrationCommand('spotify/action/favorite', {});
        likedIds.add(curId); store.set('ms-liked', [...likedIds].slice(-300));
        toast('Added to Liked Songs', 'ok');
      } catch (_) { toast('Could not add to Liked Songs', 'err'); }
      setTimeout(() => like.classList.remove('pop'), 500);
      paintLike();
    });
    // tap the record to flip between it and the last panel
    q('.ms-deck').addEventListener('click', () => setView(view ? view : 'lyrics'));
    q('.ms-bar2').addEventListener('click', async (e) => {
      if (!media || !media.durMs || !media.canSeek) return;
      const r = e.currentTarget.getBoundingClientRect();
      const ms = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * media.durMs);
      haptic(); media.posMs = ms; media.at = performance.now();
      try { await api('/media/seek?ms=' + ms, 'POST'); } catch (_) {}
    });
    const paintVol = (v) => vol.style.setProperty('--p', v + '%');
    vol.addEventListener('input', () => {
      clearTimeout(volumeRelease); setVolDragging(vol, true); paintVol(vol.value);
      clearTimeout(volTimer); volTimer = setTimeout(() => api('/volume?level=' + vol.value, 'POST').catch(() => {}), 120);
    });
    vol.addEventListener('change', () => { clearTimeout(volumeRelease); volumeRelease = setTimeout(() => setVolDragging(vol, false), 600); });
    vol.addEventListener('pointercancel', () => { clearTimeout(volTimer); setVolDragging(vol, false); });

    // ---- lyrics
    const showNote = (text) => { lines.replaceChildren(); note.textContent = text || ''; lyrics.classList.toggle('empty', !!text); };
    const buildLines = () => {
      active = -2;
      if (lyr === 'none' || !lyr) return showNote(lyr === 'none' ? 'No lyrics for this track' : '');
      note.textContent = ''; lyrics.classList.remove('empty');
      lyrics.classList.toggle('plain', !lyr.synced);
      if (lyr.synced) {
        lines.replaceChildren(...lyr.synced.map((l, i) => {
          const d = h('div', 'ms-line', l.text || '♪');
          if (!l.text) d.classList.add('gap');
          d.addEventListener('click', async (e) => {
            if (d.classList.contains('now')) return;   // the line being sung: the tap hides/shows the controls instead
            e.stopPropagation();
            if (!media?.canSeek) return;
            haptic(); media.posMs = l.t; media.at = performance.now();
            try { await api('/media/seek?ms=' + Math.round(l.t), 'POST'); } catch (_) {}
          });
          return d;
        }));
      } else {
        lines.replaceChildren(h('div', 'ms-plain', lyr.plain));
        lines.style.transform = '';
      }
    };
    const follow = (force) => {
      if (!lyr || lyr === 'none' || !lyr.synced || !media) return;
      const pos = media.posMs + (media.playing ? performance.now() - media.at : 0) + 250; // a hair early reads better
      let i = -1;
      const L = lyr.synced;
      let lo = 0, hi = L.length - 1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].t <= pos) { i = mid; lo = mid + 1; } else hi = mid - 1; }
      if (i === active && !force) return;
      const prev = active;
      active = i;
      const kids = lines.children;
      // lines further than 6 from both the old and the new position are already at their dimmest: leave them alone
      const full = force || prev < -1;
      const from = full ? 0 : Math.max(0, Math.min(prev, i) - 6), to = full ? kids.length - 1 : Math.min(kids.length - 1, Math.max(prev, i) + 6);
      for (let k = from; k <= to; k++) {
        const d = k - i;
        kids[k].classList.toggle('now', d === 0);
        kids[k].style.setProperty('--ld', Math.min(5, Math.abs(d)));
      }
      const el = kids[Math.max(0, i)];
      if (!el) return;
      const view = lyrics.clientHeight;
      const y = el.offsetTop + el.offsetHeight / 2 - view * 0.34;
      lines.style.transform = `translateY(${-Math.max(0, y)}px)`;
    };

    // ---- queue (Spotify, through the agent's Control Deck integration)
    const qlist = q('.ms-qlist'), qnote = q('.ms-qnote');
    let qAt = 0, qBusy = false, qSig = '', likeFor = null;
    const SPOTIFY_COVER = /^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/;
    async function loadQueue(force) {
      if (qBusy || (!force && performance.now() - qAt < 5000)) return;
      qBusy = true; qAt = performance.now();
      try {
        const data = await api('/controls/spotify/state', 'GET', 15000);
        const sig = JSON.stringify(data);
        if (sig === qSig && !force) return;
        qSig = sig;
        if (!data.connected) { qlist.replaceChildren(); qnote.textContent = 'Spotify is not connected to PhoneBox yet.\nOn your computer: PhoneBox settings → Control Deck → Spotify connection.'; return; }
        if (!data.queue?.length) { qlist.replaceChildren(); qnote.textContent = 'Nothing queued'; return; }
        qnote.textContent = '';
        qlist.replaceChildren(h('div', 'ms-qhead', 'Next in queue'), ...data.queue.map((item) => {
          const cover = h('span', 'ms-qcover');
          if (SPOTIFY_COVER.test(item.image || '')) { const im = h('img'); im.alt = ''; im.referrerPolicy = 'no-referrer'; im.onerror = () => im.remove(); im.src = item.image; cover.append(im); }
          const b = h('button', 'ms-qitem', cover, h('span', 'ms-qtxt', h('b', null, item.name || ''), h('small', null, item.artist || '')));
          b.type = 'button';
          b.addEventListener('click', async () => { haptic(); try { await integrationCommand('spotify/action/play-queued', { id: item.id }); qAt = 0; loadQueue(true); } catch (_) {} });
          return b;
        }));
      } catch (e) { qlist.replaceChildren(); qnote.textContent = 'Queue unavailable'; }
      finally { qBusy = false; }
    }

    const syncLyrics = (m) => {
      const key = m ? `${m.title}|${m.artist}|${m.durMs}` : '';
      if (key === lyricKey) return;
      lyricKey = key; lyr = null; active = -2; lines.style.transform = '';
      if (!m) return showNote('');
      if (m.app === 'Internet Radio') { lyr = 'none'; return showNote('Live radio'); }
      showNote('');
      loadLyrics(m).then((res) => { if (key !== lyricKey) return; lyr = res; buildLines(); follow(true); }, () => {
        if (key !== lyricKey) return; lyr = 'none'; buildLines();
      });
    };

    return {
      update(kind) {
        if (kind === 'fast') {
          if (!media) return;
          if (media.durMs > 0) {
            const pos = Math.min(media.durMs, media.posMs + (media.playing ? performance.now() - media.at : 0));
            fill.style.transform = `scaleX(${pos / media.durMs})`;
            const a1 = fmtTime(pos);
            if (a1 !== shownPos) { shownPos = a1; posEl.textContent = a1; durEl.textContent = '-' + fmtTime(media.durMs - pos); }
          } else if (media.app === 'Internet Radio') {
            fill.style.transform = media.playing ? 'scaleX(1)' : 'scaleX(0)';
            const a2 = fmtTime(Math.max(0, (media.posMs || 0) + (media.playing ? performance.now() - media.at : 0)));
            if (a2 !== shownPos) { shownPos = a2; posEl.textContent = a2; }
          }
          if (view === 'lyrics') follow(false);
          if (view === 'queue') loadQueue(false);
          return;
        }
        fit();
        const m = D.state?.media, a = D.state?.audio;
        vol.disabled = (!a || a.canControl === false);
        box.classList.toggle('volume-unavailable', vol.disabled);
        if (a && !volDragging) { vol.value = a.volume; paintVol(a.volume); }
        box.classList.toggle('idle', !m);
        box.classList.toggle('playing', !!m?.playing);
        kick();
        if (!m) {
          q('.ms-title').textContent = t('w.nothingPlaying');
          q('.ms-artist').textContent = t('w.pressToResume');
          q('.ms-source').textContent = '';
          fill.style.transform = 'scaleX(0)'; shownPos = ''; posEl.textContent = '0:00'; durEl.textContent = '0:00';
          if (artId !== 0) { artId = 0; art.classList.remove('on'); bg.classList.remove('on'); setArtColor(null); }
          syncLyrics(null);
          return;
        }
        q('.ms-source').textContent = m.app || 'Media';
        q('.ms-title').textContent = m.title || 'Unknown track';
        q('.ms-artist').textContent = [m.artist, m.album].filter(Boolean).join(' — ') || '—';
        if (m.app === 'Internet Radio' && !(m.durMs > 0)) q('.ms-dur').textContent = m.playing ? 'LIVE' : '0:00';
        if (m.artId !== artId) {
          artId = m.artId;
          if (m.artId) { art.src = bg.src = `${API}/art?id=${m.artId}`; }
          else { art.classList.remove('on'); bg.classList.remove('on'); setArtColor(null); }
        }
        if (m.title !== likeFor) { likeFor = m.title; curId = null; paintLike(); if (m.app === 'Spotify') refreshCurrent(); }
        syncLyrics(m);
      },
      destroy() { document.body.classList.remove('hide-dots'); clearTimeout(volTimer); clearTimeout(volumeRelease); setVolDragging(vol, false); if (raf) cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('resize', fit); },
    };
  },
};
