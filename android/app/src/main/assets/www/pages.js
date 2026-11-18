// The panel's fixed page set. These seven pages replace whatever layout the desktop agent sends, so the phone
// always shows the same short list. Set USE_FIXED_PAGES to false to go back to the layout saved in the agent's
// settings page (the 30-odd template pages).
export const USE_FIXED_PAGES = true;

export function fixedPages(portrait) {
  const page = (id, title, icon, widgets) => ({ id, title, icon, enabled: true, widgets: widgets.map((w, i) => ({ id: `${id}-${i}`, options: {}, ...w })) });
  return [
    page('home', 'Home', '🏠', [
      { type: 'clock', x: 0, y: 0, w: 6, h: 4, options: { status: true, weather: true } },
      { type: 'media', x: 6, y: 0, w: 6, h: 4 },
      { type: 'stat', x: 0, y: 4, w: 3, h: 2, options: { metric: 'cpu' } },
      { type: 'stat', x: 3, y: 4, w: 3, h: 2, options: { metric: 'gpu' } },
      { type: 'stat', x: 6, y: 4, w: 3, h: 2, options: { metric: 'ram' } },
      { type: 'stat', x: 9, y: 4, w: 3, h: 2, options: { metric: 'net' } },
    ]),
    // the record, lyrics and queue; its widget fills the page (twelve rows when the phone is held upright)
    page('apple-music', 'Music', '🎵', [{ type: 'musicstage', x: 0, y: 0, w: 12, h: portrait ? 12 : 6 }]),
    page('system', 'System', '📊', [
      { type: 'chart', x: 0, y: 0, w: 6, h: 3, options: { metrics: ['cpu'] } },
      { type: 'chart', x: 6, y: 0, w: 6, h: 3, options: { metrics: ['gpu'] } },
      { type: 'meters', x: 0, y: 3, w: 6, h: 3 },
      { type: 'chart', x: 6, y: 3, w: 6, h: 3, options: { metrics: ['down', 'up'] } },
    ]),
    page('sessions', 'Sessions', '✳️', [{ type: 'sessions', x: 0, y: 0, w: 12, h: 6, options: { tool: 'claude' } }]),
    page('quotas', 'AI quotas', '🎯', [
      { type: 'quotas', x: 0, y: 0, w: 12, h: 6, options: { providers: ['claude', 'codex', 'antigravity'], rotate: true, pageSize: 2, rotateInterval: 8 } },
    ]),
    page('shortcuts', 'Shortcuts', '⌘', [{ type: 'shortcuts', x: 0, y: 0, w: 12, h: 6, options: { columns: 4 } }]),
    // one clock: the phone's own time (set the phone to India Standard Time); weather for the place found by main.js
    page('clock', 'Clock', '🕰️', [
      { type: 'clock', x: 0, y: 0, w: 6, h: 2, options: { status: false, weather: false } },
      { type: 'weather', x: 0, y: 2, w: 6, h: 2 },
      { type: 'forecast', x: 0, y: 4, w: 6, h: 2, options: { mode: 'daily', days: 3 } },
      { type: 'calendar', x: 6, y: 0, w: 6, h: 6 },
    ]),
  ];
}
