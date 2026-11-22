'use strict';
/* Set Phone: scripted phone prop for film sets.
   Director mode = build scenes. Play mode = what the camera sees.
   Hidden controls in Play mode: tap top-left corner = next cue;
   pinch in (two fingers squeezed together in the middle) or hold top-right corner 2 s = back to Director. */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const STANDALONE = !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));

/* ================= STORAGE ================= */
// Two stores: 'scenes' (each scene has a .group = production name) and 'library' (images: {id, group, kind, name, data}).
const DB = {
  db: null, mem: { scenes: new Map(), library: new Map() },
  open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open('setphone', 2);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('scenes')) db.createObjectStore('scenes', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', { keyPath: 'id' });
        };
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => res();
      } catch (e) { res(); }
    });
  },
  store(name, mode) { return this.db.transaction(name, mode).objectStore(name); },
  all(name = 'scenes') {
    if (!this.db) return Promise.resolve([...this.mem[name].values()]);
    return new Promise(res => { const r = this.store(name, 'readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
  },
  put(s, name = 'scenes') {
    if (!this.db) { this.mem[name].set(s.id, s); return Promise.resolve(); }
    return new Promise(res => { const r = this.store(name, 'readwrite').put(s); r.onsuccess = r.onerror = () => res(); });
  },
  del(id, name = 'scenes') {
    if (!this.db) { this.mem[name].delete(id); return Promise.resolve(); }
    return new Promise(res => { const r = this.store(name, 'readwrite').delete(id); r.onsuccess = r.onerror = () => res(); });
  }
};
const groupOf = s => s.group || 'My scenes';
const LS = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

/* Image library: built-in packs (files listed in lib/library.json, cached offline) + images saved on the phone (DB 'library'). */
let BUILTIN = null;
async function builtinLib() {
  if (BUILTIN) return BUILTIN;
  try { const j = await (await fetch('lib/library.json')).json(); BUILTIN = (j.items || []).map(x => ({ ...x, data: 'lib/' + x.file, builtin: true })); }
  catch (e) { BUILTIN = []; }
  return BUILTIN;
}
async function allLib() { return [...await builtinLib(), ...await DB.all('library')]; }
const LIB_KINDS = [['avatar', 'Profile photos'], ['wallpaper', 'Wallpapers'], ['chatbg', 'Chat backgrounds'], ['photo', 'Photos']];
const sortScenes = a => a.sort((x, y) => (x.order || 50) - (y.order || 50) || x.name.localeCompare(y.name));
function fromPreset(p) {
  const s = JSON.parse(JSON.stringify(p));
  s.id = uid();
  s.events = (s.events || []).map(e => ({ id: uid(), ...e }));
  return s;
}

/* ================= SOUND ================= */
const SND = {};
['ring', 'alarm', 'ringback', 'in', 'notif', 'sent', 'end', 'buzz'].forEach(n => { const a = new Audio(n + '.wav'); a.preload = 'auto'; SND[n] = a; });
SND.ring.loop = SND.alarm.loop = SND.ringback.loop = SND.buzz.loop = true;
let unlocked = false;
function unlockAudio() {
  if (unlocked) return; unlocked = true;
  Object.values(SND).forEach(a => {
    a.muted = true;
    const p = a.play();
    if (p) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  });
}
function play(n) {
  const mode = P.scene?.sound || 'all';
  if (mode === 'none') return;
  if (mode === 'calls' && !['ring', 'alarm', 'ringback', 'end', 'buzz'].includes(n)) return;
  const a = SND[n]; try { a.currentTime = 0; a.muted = false; const p = a.play(); if (p) p.catch(() => {}); } catch (e) {}
}
function hush(...names) { (names.length ? names : Object.keys(SND)).forEach(n => { try { SND[n].pause(); SND[n].currentTime = 0; } catch (e) {} }); }
let extAudio = null;

/* Ringing with ring mode: ring | vibrate | both | silent.
   iPhone web apps cannot drive the vibration motor, so "vibrate" = buzz sound + haptic ticks
   (iOS 18 switch-checkbox trick, weak and experimental) + navigator.vibrate on Android. */
const hapticSwitch = (() => { const l = document.createElement('label'); l.style.cssText = 'position:fixed;left:-99px;top:-99px;opacity:0'; const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); l.append(i); document.body.append(l); return l; })();
let hapT = null;
function startRing(tone, mode) {
  mode = mode || 'ring';
  if (mode === 'ring' || mode === 'both') play(tone);
  if (mode === 'vibrate' || mode === 'both') {
    play('buzz');
    if (P.scene?.sound === 'none') return;
    const t0 = Date.now();
    hapT = setInterval(() => { const ph = (Date.now() - t0) % 1600; if (ph < 900) hapticSwitch.click(); }, 70);
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(Array(30).fill([900, 700]).flat());
  }
}
function stopRing() { hush('ring', 'alarm', 'buzz', 'ringback'); clearInterval(hapT); hapT = null; if (navigator.vibrate) navigator.vibrate(0); }

/* ================= ICONS ================= */
const I = {
  back: '<svg viewBox="0 0 13 22"><path d="M11 2L2 11l9 9"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="3"/><path d="M16 10.5l5-3v9l-5-3z"/></svg>',
  phoneS: '<svg viewBox="0 0 24 24"><path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 12l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  sticker: '<svg viewBox="0 0 24 24"><path d="M20 13V8a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h5z"/><path d="M13 20v-3a4 4 0 0 1 4-4h3"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  hang: '<svg viewBox="0 0 24 24" style="transform:rotate(135deg)"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>',
  bubble: '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.6 1.3 4.9 3.4 6.5L4.5 22l4.1-2.2c1.1.3 2.2.5 3.4.5 5.5 0 10-3.9 10-8.6S17.5 3 12 3z"/></svg>',
  msg: '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>',
  alarm: '<svg viewBox="0 0 24 24"><path d="M22 5.7 17.4 1.8l-1.3 1.5 4.6 3.9zM7.9 3.4 6.6 1.9 2 5.7l1.3 1.5zM12.5 8H11v6l4.7 2.9.8-1.2-4-2.4zM12 4a9 9 0 1 0 9 9 9 9 0 0 0-9-9zm0 16a7 7 0 1 1 7-7 7 7 0 0 1-7 7z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23A6.9 6.9 0 0 0 19 11zm-4 .16V5a3 3 0 0 0-5.94-.6zM4.27 3 3 4.27l6 6V11a3 3 0 0 0 4.26 2.72l1.66 1.66A5 5 0 0 1 7 11H5.3a6.8 6.8 0 0 0 5.7 6.72V21h2v-3.28a6.9 6.9 0 0 0 2.54-.9L19.73 21 21 19.73z"/></svg>',
  addp: '<svg viewBox="0 0 24 24"><path d="M15 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
  vid: '<svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z"/></svg>',
  keypad: '<svg viewBox="0 0 24 24">' + [0, 1, 2, 3].map(r => [0, 1, 2].map(c => (r < 3 || c === 1) ? `<circle cx="${6 + c * 6}" cy="${3.5 + r * 5.7}" r="2.2"/>` : '').join('')).join('') + '</svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  torch: '<svg viewBox="0 0 24 24"><path d="M7 2h10v4l-3 4v12h-4V10L7 6z"/></svg>',
  camF: '<svg viewBox="0 0 24 24"><path d="M9 4 7.2 6H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.2L15 4zm3 4.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><path d="M12 2 2 7v2h20V7zM4 10v8h3v-8zm6.5 0v8h3v-8zM17 10v8h3v-8zM2 20v2h20v-2z"/></svg>',
  lock: '<svg viewBox="0 0 14 18" fill="#fff"><path d="M3 7V5a4 4 0 0 1 8 0v2h.5A1.5 1.5 0 0 1 13 8.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 1 16.5v-8A1.5 1.5 0 0 1 2.5 7zm1.8 0h4.4V5a2.2 2.2 0 0 0-4.4 0z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><path d="M3 5h18v14H3zm1.5 1.5v.4L12 12l7.5-5.1v-.4z"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><path d="M12 12c-2-5-6-5-6-2s4 2 6 2zm0 0c5-2 5-6 2-6s-2 4-2 6zm0 0c2 5 6 5 6 2s-4-2-6-2zm0 0c-5 2-5 6-2 6s2-4 2-6z"/></svg>'
};
const TICKS = n => n == 0 ? '<svg class="tk one" viewBox="0 0 12 12"><path d="M6 1.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM6 3.5V6l1.6 1"/></svg>'
  : n == 1 ? '<svg class="tk one" viewBox="0 0 12 11"><path d="M1.5 6l3 3 6-7.5"/></svg>'
  : `<svg class="tk${n == 3 ? ' read' : ''}" viewBox="0 0 17 11"><path d="M1 6l3 3 6-7.5M7.2 8.3l.8.7 6-7.5"/></svg>`;
const APPS = {
  chat: { bg: () => P.scene?.look === 'exact' ? '#25d366' : 'linear-gradient(160deg,#3fd1a0,#139a74)', ic: I.bubble },
  messages: { bg: () => 'linear-gradient(180deg,#5af575,#14c13a)', ic: I.msg, name: 'Messages' },
  phone: { bg: () => 'linear-gradient(180deg,#5af575,#14c13a)', ic: I.phone, name: 'Phone' },
  bank: { bg: () => 'linear-gradient(160deg,#0b3d5c,#0a6b6b)', ic: I.bank, name: 'Bank' },
  clock: { bg: () => '#111', ic: I.alarm, name: 'Clock' },
  mail: { bg: () => 'linear-gradient(180deg,#1e9bff,#1170ee)', ic: I.mail, name: 'Mail' }
};
const appName = a => a === 'chat' ? (P.scene?.appName || 'Chats') : (APPS[a]?.name || a);
function avatarHTML(photo, name, cls = 'av') {
  if (photo) return `<div class="${cls}" style="background-image:url('${photo}')"></div>`;
  const ini = String(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `<div class="${cls}" style="background:linear-gradient(180deg,#a5abb3,#828a94)">${esc(ini)}</div>`;
}

/* ================= PLAY STATE ================= */
const P = { scene: null, token: 0, screen: 'lock', ov: null, msgs: [], status: '', typing: false, notifs: [], clock: '', date: '', call: null, unread: 0,
  waitTap: null, skipSleep: null, block: null, pending: null, revealed: 0, bannerT: null, wallTop: '#000' };

class Stop extends Error {}
const alive = tok => { if (tok !== P.token) throw new Stop(); };
function sleep(ms, tok) {
  return new Promise(res => {
    const done = () => { clearTimeout(t); if (P.skipSleep === done) P.skipSleep = null; res(); };
    const t = setTimeout(done, ms); P.skipSleep = done;
  }).then(() => alive(tok));
}
function waitTap(tok) {
  flashCue(true);
  return new Promise(res => { P.waitTap = () => { P.waitTap = null; flashCue(false); res(); }; }).then(() => alive(tok));
}
function waitBlock(tok) { return new Promise(res => { P.block = why => { P.block = null; res(why || 'cue'); }; }).then(v => { alive(tok); return v; }); }
function flashCue(on) { $('#cueFlash').classList.toggle('on', on); }

function cue() { // hidden top-left tap
  if (P.waitTap) return P.waitTap();
  if (P.block) return P.block('cue');
  if (P.skipSleep) return P.skipSleep();
}

function parseHistory(txt) {
  const out = [];
  String(txt || '').split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
    if (l.startsWith('--')) return out.push({ kind: 'day', text: l.slice(2).trim() });
    if (l.startsWith('!')) return out.push({ kind: 'sys', text: l.slice(1).trim() });
    const dir = l[0] === '>' ? 'out' : l[0] === '<' ? 'in' : null;
    if (!dir) return;
    const [text, time, ticks] = l.slice(1).split('|').map(s => (s || '').trim());
    out.push({ kind: 'text', dir, text, time: time || '', ticks: ticks === '' || ticks == null ? 3 : +ticks });
  });
  return out;
}
function parseStack(txt) {
  return String(txt || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [app, title, text, time] = l.split('|').map(s => (s || '').trim());
    return { app: APPS[app] ? app : 'chat', title, text, time: time || '' };
  });
}

async function startPlay(scene, rehearse) {
  unlockAudio();
  P.token++; const tok = P.token;
  releaseWaiters();
  Object.assign(P, { scene, screen: scene.startScreen || 'lock', ov: null, msgs: parseHistory(scene.history), status: scene.status || '', typing: false,
    notifs: parseStack(scene.lockStack), clock: scene.lockTime || '9:41', date: scene.lockDate || '', call: null, unread: 0, pending: null, revealed: 0 });
  const st = $('#stage');
  st.className = `${scene.theme === 'dark' ? 'dark' : 'light'} ${scene.look === 'exact' ? 'exact' : 'alike'}${rehearse ? ' rehearse' : ''}`;
  $('#director').hidden = true; st.hidden = false;
  $('#fakeStatus').hidden = STANDALONE; $('#fakeHome').hidden = STANDALONE; $('#notch').hidden = STANDALONE;
  document.documentElement.style.setProperty('--safeb', STANDALONE ? 'env(safe-area-inset-bottom)' : '30px');
  st.style.setProperty('--top', STANDALONE ? '0px' : '47px');
  st.style.setProperty('--stagetop', STANDALONE ? 'env(safe-area-inset-top)' : '0px');
  if (scene.device === 'laptop') laptopStart(scene);
  P.wallTop = await topColor(scene.wallpaper);
  render();
  keepAwake(true);
  try {
    const evs = scene.events || [];
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.trigger === 'tap') await waitTap(tok);
      if (+ev.delay > 0) await sleep(+ev.delay * 1000, tok);
      // One broken cue (missing photo, odd value) must never stop the rest of the take.
      try { await exec(ev, tok); } catch (e) { if (e instanceof Stop) throw e; console.error('cue', i + 1, e); }
    }
  } catch (e) { if (!(e instanceof Stop)) console.error(e); }
}

/* Keep the screen on while playing (Screen Wake Lock; iOS 16.4+, home-screen apps from iOS 18.4). */
let wake = null, wantWake = false;
async function keepAwake(on) {
  wantWake = on;
  try {
    if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    if (!on && wake) { await wake.release(); wake = null; }
  } catch (e) { wake = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantWake) keepAwake(true);
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', () => flushSave());
function releaseWaiters() { ['waitTap', 'skipSleep', 'block'].forEach(k => { const f = P[k]; P[k] = null; if (f) f('stop'); }); flashCue(false); }
function stopPlay() {
  if ($('#stage').hidden) return;
  keepAwake(false);
  P.token++; releaseWaiters(); stopRing(); hush(); if (extAudio) extAudio.pause();
  if (P.call?.timer) clearInterval(P.call.timer);
  P.call = null; P.ov = null;
  $('#stage').hidden = true; $('#director').hidden = false; $('#stage').classList.remove('laptop');
  try { if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
  document.activeElement?.blur?.();
  setTheme('#f2f2f7');
  renderDirector();
}

/* ================= EVENTS ================= */
async function exec(ev, tok) {
  const s = P.scene;
  if (s.device === 'laptop' && laptopExec(ev)) return;
  switch (ev.type) {
    case 'msg_in': case 'voice_in': case 'photo_in': {
      P.typing = false;
      const m = { dir: 'in', time: ev.time || '', id: uid() };
      if (ev.type === 'msg_in') Object.assign(m, { kind: 'text', text: ev.text });
      if (ev.type === 'voice_in') Object.assign(m, { kind: 'voice', length: ev.length || '0:10', audio: ev.audio || '' });
      if (ev.type === 'photo_in') Object.assign(m, { kind: 'photo', image: ev.image || '', text: ev.caption || '' });
      P.msgs.push(m);
      if (onChat()) { play('in'); refreshChat(); }
      else { P.unread++; notify({ app: 'chat', title: s.contactName, text: ev.type === 'msg_in' ? ev.text : ev.type === 'voice_in' ? '🎤 Voice message (' + m.length + ')' : '📷 Photo' + (ev.caption ? ': ' + ev.caption : ''), photo: s.contactPhoto }); if (P.screen === 'home' && !P.ov) render(); }
      break;
    }
    case 'msg_out': case 'voice_out': case 'photo_out': {
      if (ev.type === 'msg_out' && ev.actorTypes && onChat()) {
        P.pending = { text: ev.text || '' }; P.revealed = 0; syncInput();
        await waitBlock(tok);
        P.pending = null; const inp = $('#cInput'); if (inp) inp.value = ''; syncInput();
      }
      const m = { dir: 'out', time: ev.time || '', ticks: ev.ticks == null ? 1 : +ev.ticks, id: uid() };
      if (ev.type === 'msg_out') Object.assign(m, { kind: 'text', text: ev.text });
      if (ev.type === 'voice_out') Object.assign(m, { kind: 'voice', length: ev.length || '0:10', audio: ev.audio || '' });
      if (ev.type === 'photo_out') Object.assign(m, { kind: 'photo', image: ev.image || '', text: ev.caption || '' });
      P.msgs.push(m);
      if (onChat()) { play('sent'); refreshChat(); }
      break;
    }
    case 'ticks': {
      const last = [...P.msgs].reverse().find(m => m.dir === 'out');
      if (last) { last.ticks = +ev.ticks; if (onChat()) refreshChat(false); }
      break;
    }
    case 'typing':
      P.typing = true; refreshHead();
      await sleep((+ev.seconds || 2) * 1000, tok);
      P.typing = false; refreshHead();
      break;
    case 'status': P.status = ev.text || ''; refreshHead(); break;
    case 'banner': notify({ app: ev.app || 'messages', title: ev.from, text: ev.text }); break;
    case 'missed': notify({ app: 'phone', title: ev.from + ((+ev.count > 1) ? ` (${ev.count})` : ''), text: 'Missed Call' }); break;
    case 'clock': P.clock = ev.time || P.clock; if (ev.date) P.date = ev.date; render(); break;
    case 'alarm': {
      P.clock = ev.time || P.clock; P.ov = { type: 'alarm', label: ev.label || 'Alarm' }; render(); startRing('alarm', ev.ringMode);
      await waitBlock(tok); stopRing(); P.ov = null; render();
      break;
    }
    case 'call_in': {
      P.call = { name: ev.name || s.contactName, photo: ev.photo || (ev.name === s.contactName || !ev.name ? s.contactPhoto : ''), kind: ev.kind || 'phone', state: 'ringing' };
      P.ov = { type: 'call' }; render(); startRing('ring', ev.ringMode);
      let missT = null;
      if (+ev.ringFor > 0) missT = setTimeout(() => P.block && P.block('missed'), +ev.ringFor * 1000);
      const why = await waitBlock(tok); clearTimeout(missT); stopRing();
      if (why === 'answer' || why === 'cue') answerCall();
      else {
        const name = P.call.name; P.call = null; P.ov = null; render();
        if (why === 'missed') notify({ app: 'phone', title: name, text: 'Missed Call' });
      }
      break;
    }
    case 'call_out': {
      P.call = { name: ev.name || s.contactName, photo: ev.photo || '', kind: ev.kind || 'phone', state: 'calling' };
      P.ov = { type: 'call' }; render(); play('ringback');
      await sleep((+ev.ringSeconds || 8) * 1000, tok);
      if (!P.call || P.call.state !== 'calling') break; // ended by actor
      hush('ringback');
      if (ev.result === 'answer') answerCall();
      else if (ev.result === 'fail') { P.call.state = 'failed'; play('end'); render(); }
      else play('ringback');
      break;
    }
    case 'call_end': endCall(); break;
    case 'bank': P.ov = { type: 'bank', ev }; render(); break;
    case 'image': P.ov = { type: 'image', image: ev.image }; render(); break;
    case 'goto':
      if (ev.screen !== 'stay') { P.screen = ev.screen || 'chat'; if (P.screen === 'chat') P.unread = 0; }
      if (!P.ov || P.ov.type !== 'call') P.ov = null; render(); break;
    case 'wait': default: break;
  }
}
const onChat = () => P.screen === 'chat' && !P.ov;

function answerCall() {
  stopRing();
  P.call.state = 'active'; P.call.t0 = Date.now();
  P.call.timer = setInterval(() => { const el = $('#callTimer'); if (el) el.textContent = mmss((Date.now() - P.call.t0) / 1000); }, 500);
  render();
}
function endCall() {
  if (!P.call) return;
  stopRing();
  if (P.call.timer) clearInterval(P.call.timer);
  const wasRinging = P.call.state === 'ringing';
  if (P.call.state === 'active' || P.call.state === 'calling') play('end');
  P.call = null; if (P.ov?.type === 'call') P.ov = null; render();
  if (wasRinging && P.block) P.block('decline');
  if (P.skipSleep) P.skipSleep();
}
const mmss = s => { s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };

function notify(n) {
  n.time = 'now';
  const onLock = P.screen === 'lock' && (!P.ov || P.ov.type !== 'call');
  if (onLock) { P.notifs.unshift(n); play('notif'); if (!P.ov) render(); return; }
  play('notif');
  const b = $('#banner');
  b.innerHTML = notifHTML(n); b.hidden = false; b.dataset.app = n.app;
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('show')));
  clearTimeout(P.bannerT);
  P.bannerT = setTimeout(hideBanner, 4500);
}
function hideBanner() { const b = $('#banner'); b.classList.remove('show'); setTimeout(() => { if (!b.classList.contains('show')) b.hidden = true; }, 400); }

/* ================= RENDER ================= */
function setTheme(c) { const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', c); }
function chrome(sbText, sbBg, overlay, homeBar) {
  const st = $('#stage');
  st.style.setProperty('--sb', sbText); st.style.setProperty('--sbbg', overlay ? 'transparent' : sbBg);
  st.classList.toggle('overlaystatus', !!overlay);
  st.style.setProperty('--hb', homeBar || sbText);
  st.style.setProperty('--bannertop', (STANDALONE ? 8 : 52) + 'px');
  setTheme(sbBg);
  $('#fsTime').textContent = P.clock;
}
function render() {
  const sc = $('#screen');
  if (P.scene?.device === 'laptop') { sc.innerHTML = laptopHTML(); bindLaptop(); setTheme('#000'); return; }
  if (P.ov?.type === 'call') { sc.innerHTML = callHTML(); bindCall(); chrome('#fff', '#1b1d22', true); return; }
  if (P.ov?.type === 'alarm') { sc.innerHTML = alarmHTML(); bindAlarm(); chrome('#fff', P.wallTop, true); return; }
  if (P.ov?.type === 'bank') { sc.innerHTML = bankHTML(P.ov.ev); chrome('#fff', '#0b3d5c', false, '#000'); return; }
  if (P.ov?.type === 'image') { sc.innerHTML = `<div class="scr image">${P.ov.image ? `<img src="${P.ov.image}">` : '<div style="color:#777;padding:30px;text-align:center">No picture yet. Add it in Director mode.</div>'}</div>`; chrome('#fff', '#000', true); return; }
  if (P.screen === 'lock') { sc.innerHTML = lockHTML(); bindLock(); chrome('#fff', P.wallTop, true); return; }
  if (P.screen === 'home') { sc.innerHTML = homeHTML(); bindHome(); chrome('#fff', P.wallTop, true); return; }
  // chat
  sc.innerHTML = chatHTML(); bindChat(); refreshChat();
  const dark = P.scene.theme === 'dark';
  chrome(dark ? '#fff' : '#000', getComputedStyle($('#stage')).getPropertyValue('--head').trim() || (dark ? '#121212' : '#f6f6f6'), false);
}

function notifHTML(n) {
  const a = APPS[n.app] || APPS.chat;
  const icon = n.photo ? `<div class="n-icon"><img src="${n.photo}"></div>` : `<div class="n-icon" style="background:${a.bg()}">${a.ic}</div>`;
  return `<div class="notif"><div class="n-icon-wrap">${icon}</div><div class="n-body"><div class="n-top"><div class="n-title">${esc(n.title)}</div><div class="n-time">${esc(n.time)}</div></div><div class="n-text">${esc(n.text)}</div>${n.photo ? `<div class="n-count">${esc(appName(n.app))}</div>` : ''}</div></div>`;
}
function lockHTML() {
  const s = P.scene;
  const bg = s.wallpaper ? `background-image:url('${s.wallpaper}')` : 'background:linear-gradient(180deg,#3a4a63,#1b2433 60%,#121821)';
  const list = P.notifs.slice(0, 8).map(n => `<div class="lk-n" data-app="${n.app}">${notifHTML(n)}</div>`).join('');
  return `<div class="scr lock ${s.theme === 'dark' ? 'darknotif' : ''}" style="${bg}">
    <div class="lk-top"><div class="lk-lockicon">${I.lock}</div><div class="lk-date">${esc(P.date)}</div><div class="lk-time">${esc(P.clock)}</div></div>
    <div class="lk-notifs">${list}</div>
    <div class="lk-bottom"><div class="lk-btn">${I.torch}</div><div class="lk-btn">${I.camF}</div></div></div>`;
}
function bindLock() {
  const el = $('#screen .lock'); let y0 = null;
  el.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => { if (y0 != null && y0 - e.changedTouches[0].clientY > 70) goScreen('home'); y0 = null; });
  el.querySelectorAll('.lk-n').forEach(n => n.addEventListener('click', () => goScreen(n.dataset.app === 'chat' ? 'chat' : 'home')));
}
function goScreen(s) { P.screen = s; if (s === 'chat') P.unread = 0; render(); }

function homeHTML() {
  const s = P.scene;
  const hw = s.homeWallpaper || s.wallpaper;
  const bg = hw ? `background-image:url('${hw}')` : 'background:radial-gradient(120% 70% at 20% 10%,#ff9a8b 0%,transparent 55%),radial-gradient(110% 70% at 90% 40%,#7f7fd5 0%,transparent 60%),radial-gradient(120% 80% at 30% 100%,#1fa2ff 0%,transparent 60%),#2b2d6e';
  const app = (name, bgc, ic, extra = '', id = '') => `<div class="h-app" ${id ? `id="${id}"` : ''}><div class="h-ic" style="background:${bgc}">${ic}${extra}</div>${name ? esc(name) : ''}</div>`;
  const badge = P.unread ? `<span class="badge">${P.unread}</span>` : '';
  const dow = (P.date.split(' ')[0] || 'Monday');
  const dnum = (P.date.match(/\d+/) || ['3'])[0];
  const g = (a, b) => `linear-gradient(180deg,${a},${b})`;
  const svg = (inner, fill = '#fff') => `<svg viewBox="0 0 24 24" style="fill:${fill}">${inner}</svg>`;
  return `<div class="scr home" style="${bg}">
    <div class="h-widgets">
      <div><div class="wg weather"><div class="city">Johannesburg</div><div class="deg">24°</div><div class="cond">☀︎ Sunny</div><div class="hl">H:27° L:14°</div></div><div class="wg-cap">Weather</div></div>
      <div><div class="wg cal"><div class="dow">${esc(dow.toUpperCase())}</div><div class="dnum">${esc(dnum)}</div><div class="ev">No more events today<small>Tap to add</small></div></div><div class="wg-cap">Calendar</div></div>
    </div>
    <div class="h-grid">
      ${app('FaceTime', g('#5cf777', '#0abf3a'), svg('<path d="M15 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3.5l5 4v-11z"/>'))}
      ${app('Photos', '#fff', `<svg viewBox="0 0 24 24" style="width:44px;height:44px">${['#f9c82e', '#f6852c', '#e83a5b', '#a64fd2', '#3a7ef2', '#2cc2d1', '#5fd248', '#b8de3c'].map((c, i) => `<ellipse cx="12" cy="6.6" rx="2.6" ry="4.6" fill="${c}" opacity=".85" transform="rotate(${i * 45} 12 12)"/>`).join('')}</svg>`)}
      ${app('Camera', g('#f2f2f4', '#b5b5ba'), svg(I.camF.replace(/<\/?svg[^>]*>/g, ''), '#3a3a3c'))}
      ${app('Clock', '#000', `<svg viewBox="0 0 24 24" style="width:46px;height:46px"><circle cx="12" cy="12" r="10.5" fill="#fff"/><path d="M12 5.5V12l4 2.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M12 12 8 17" stroke="#ff9500" stroke-width="1" /></svg>`)}
      ${app('Maps', g('#e9f5e1', '#bfe2a8'), `<svg viewBox="0 0 24 24" style="width:44px;height:44px"><path d="M2 16 22 6" stroke="#f7c843" stroke-width="3"/><path d="M8 2 13 22" stroke="#fff" stroke-width="2.4"/><circle cx="16" cy="9" r="3.4" fill="#ff3b30"/></svg>`)}
      ${app('Weather', g('#4aa0f0', '#1d6fd1'), svg('<circle cx="9" cy="9" r="4" fill="#ffd60a"/><path d="M7 19h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1A3 3 0 0 0 7 19z"/>'))}
      ${app('Notes', g('#fff8c8', '#fff'), `<svg viewBox="0 0 24 24" style="width:60px;height:60px"><rect x="0" y="0" width="24" height="7" fill="#ffd52e"/>${[11, 14, 17, 20].map(y => `<path d="M3 ${y}h18" stroke="#ddd" stroke-width=".5"/>`).join('')}</svg>`)}
      ${app('Reminders', '#fff', `<svg viewBox="0 0 24 24" style="width:44px;height:44px">${[['#007aff', 6], ['#ff3b30', 12], ['#ff9500', 18]].map(([c, y]) => `<circle cx="6" cy="${y}" r="2.2" fill="${c}"/><path d="M10 ${y}h10" stroke="#ccc" stroke-width="1.2"/>`).join('')}</svg>`)}
      ${app('Bank', APPS.bank.bg(), I.bank)}
      ${app('Wallet', '#000', `<svg viewBox="0 0 24 24" style="width:44px;height:44px"><rect x="3" y="5" width="18" height="5" rx="1.5" fill="#34c759"/><rect x="3" y="8" width="18" height="5" rx="1.5" fill="#ffcc00"/><rect x="3" y="11" width="18" height="5" rx="1.5" fill="#ff3b30"/><rect x="3" y="13" width="18" height="7" rx="2" fill="#2c2c2e"/></svg>`)}
      ${app(s.appName || 'Chats', APPS.chat.bg(), I.bubble, badge, 'hChat')}
      ${app('Settings', g('#a0a0a6', '#6d6d72'), I.gear)}
    </div>
    <div class="h-dots"><i class="on"></i><i></i><i></i></div>
    <div class="h-dock">${app('', APPS.phone.bg(), I.phone)}${app('', g('#f9f9f9', '#e3e3e8'), svg('<circle cx="12" cy="12" r="9.5" fill="#1e8cff"/><path d="M16.5 7.5 10.4 10.4 7.5 16.5 13.6 13.6z" fill="#fff"/><path d="M13.6 13.6 10.4 10.4 7.5 16.5z" fill="#ff3b30"/>'))}${app('', APPS.messages.bg(), I.msg)}${app('', g('#fc5c7d', '#fa233b'), svg('<path d="M9 17.5V6l10-2v11.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="17" cy="15.5" r="2.5"/>'))}</div>
  </div>`;
}
function bindHome() { $('#hChat')?.addEventListener('click', () => goScreen('chat')); }

function chatHTML() {
  const s = P.scene;
  const bg = s.chatWallpaper ? `style="background-image:url('${s.chatWallpaper}')"` : '';
  return `<div class="scr chat" ${bg}>
    <div class="c-head">
      <button class="c-back" id="cBack">${I.back}${+s.unreadBack ? `<span class="cnt">${+s.unreadBack}</span>` : ''}</button>
      ${avatarHTML(s.contactPhoto, s.contactName)}
      <div class="c-who"><div class="c-name">${esc(s.contactName)}</div><div class="c-status" id="cStatus"></div></div>
      <div class="c-icons">${I.video}${I.phoneS}</div>
    </div>
    <div class="c-list" id="cList"></div>
    <div class="c-foot">
      <span class="fi">${I.plus}</span>
      <div class="c-field"><input id="cInput" type="text" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="send"><span id="cStick">${I.sticker}</span></div>
      <span class="fi" id="cCam">${I.cam}</span><span class="fi" id="cMic">${I.mic}</span>
      <button class="c-send" id="cSend" hidden>${I.send}</button>
    </div></div>`;
}
function bindChat() {
  $('#cBack').addEventListener('click', () => goScreen('home'));
  const inp = $('#cInput');
  inp.addEventListener('input', () => {
    if (P.pending) {
      const full = P.pending.text, n = inp.value.length;
      P.revealed = n > P.revealed ? Math.min(full.length, n) : Math.max(0, n);
      inp.value = full.slice(0, P.revealed);
    } else if (!P.scene.liveTyping) inp.value = '';
    syncInput();
  });
  const send = e => {
    e.preventDefault();
    if (P.pending) { if (P.block) P.block('sent'); return; }
    const t = inp.value.trim(); if (!t) return;
    const now = new Date(); const m = { kind: 'text', dir: 'out', text: t, ticks: 1, time: P.msgs.length ? lastTime() : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, id: uid() };
    P.msgs.push(m); inp.value = ''; syncInput(); play('sent'); refreshChat();
    setTimeout(() => { m.ticks = Math.max(m.ticks, 2); if (onChat()) refreshChat(false); }, 1200);
  };
  $('#cSend').addEventListener('pointerdown', send);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(e); });
  syncInput();
}
function lastTime() { for (let i = P.msgs.length - 1; i >= 0; i--) if (P.msgs[i].time) return P.msgs[i].time; return ''; }
function syncInput() {
  const inp = $('#cInput'); if (!inp) return;
  const has = inp.value.length > 0;
  $('#cSend').hidden = !has; $('#cCam').hidden = has; $('#cMic').hidden = has;
}
function refreshHead() {
  const el = $('#cStatus'); if (!el) return;
  el.textContent = P.typing ? 'typing…' : P.status;
}
function refreshChat(scroll = true) {
  const list = $('#cList'); if (!list) return;
  refreshHead();
  let prev = null;
  list.innerHTML = P.msgs.map(m => {
    if (m.kind === 'day') { prev = null; return `<div class="daychip">${esc(m.text)}</div>`; }
    if (m.kind === 'sys') { prev = null; return `<div class="sysnote">🔒 ${esc(m.text)}</div>`; }
    const first = !prev || prev !== m.dir; prev = m.dir;
    const meta = `<span class="m-meta${m.kind === 'photo' && !m.text ? ' onimg' : ''}">${esc(m.time)}${m.dir === 'out' ? TICKS(m.ticks) : ''}</span>`;
    if (m.kind === 'photo') return `<div class="msg m-photo ${m.dir}${first ? ' first' : ''}">${m.image ? `<img src="${m.image}">` : '<div style="height:200px;background:#bbb;border-radius:7px"></div>'}${m.text ? `<div class="m-cap">${esc(m.text)}${meta}</div>` : meta}</div>`;
    if (m.kind === 'voice') return `<div class="msg m-voice ${m.dir}${first ? ' first' : ''}" data-id="${m.id}">
        ${m.dir === 'in' ? avatarHTML(P.scene.contactPhoto, P.scene.contactName, 'v-av') : ''}
        <button class="v-play">${I.play}</button><div class="v-wave">${wave(m.id)}<span class="v-dot"></span></div>
        ${m.dir === 'out' ? avatarHTML('', 'Me', 'v-av') : ''}<span class="v-len">${esc(m.length)}</span>${meta}</div>`;
    return `<div class="msg ${m.dir}${first ? ' first' : ''}">${esc(m.text)}${meta}</div>`;
  }).join('');
  list.querySelectorAll('.m-voice .v-play').forEach(b => b.addEventListener('click', () => playVoice(b.closest('.m-voice'))));
  if (scroll) list.scrollTop = list.scrollHeight;
}
function wave(id) {
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: 34 }, (_, i) => { h = (h * 1103515245 + 12345) >>> 0; const v = 4 + (h % 22) * (0.5 + 0.5 * Math.sin(i / 3)); return `<i style="height:${Math.max(3, v).toFixed(0)}px"></i>`; }).join('');
}
function playVoice(el) {
  const m = P.msgs.find(x => x.id === el.dataset.id); if (!m) return;
  const [mm, ss] = String(m.length).split(':').map(Number); let dur = (mm || 0) * 60 + (ss || 0) || 10;
  if (extAudio) extAudio.pause();
  if (m.audio) { extAudio = new Audio(m.audio); extAudio.play().catch(() => {}); }
  const bars = el.querySelectorAll('.v-wave i'), dot = el.querySelector('.v-dot'), lenEl = el.querySelector('.v-len'), btn = el.querySelector('.v-play');
  btn.innerHTML = I.pause; const t0 = Date.now();
  const tick = () => {
    const p = Math.min(1, (Date.now() - t0) / 1000 / dur);
    bars.forEach((b, i) => b.classList.toggle('on', i / bars.length < p));
    dot.style.left = `calc(${p * 100}% - 6px)`; lenEl.textContent = mmss(p * dur).replace(/^0/, '');
    if (p < 1 && el.isConnected) requestAnimationFrame(tick); else { btn.innerHTML = I.play; lenEl.textContent = m.length; if (extAudio) extAudio.pause(); }
  };
  tick();
}

function callHTML() {
  const c = P.call, s = P.scene;
  const bgi = c.photo ? `<div class="bgimg" style="background-image:url('${c.photo}')"></div>` : '<div class="bgimg none"></div>';
  const sub = c.kind === 'app' ? `${esc(s.appName || 'Chats')} Audio…` : 'mobile';
  if (c.state === 'ringing') {
    const locked = P.screen === 'lock';
    return `<div class="scr call">${bgi}
      <div class="cl-top"><div class="cl-name">${esc(c.name)}</div><div class="cl-sub2">${sub}</div></div>
      ${avatarHTML(c.photo, c.name, 'cl-av')}
      <div class="cl-mid"><div class="cl-small"><span class="ci">${I.alarm}</span>Remind Me</div><div class="cl-small"><span class="ci">${I.msg}</span>Message</div></div>
      ${locked ? `<div class="slide" id="slide"><span class="txt">slide to answer</span><div class="knob" id="knob">${I.phone}</div></div>`
        : `<div class="cl-btns"><div class="cl-b" id="decl"><span class="ci red">${I.hang}</span>Decline</div><div class="cl-b" id="acc"><span class="ci green">${I.phone}</span>Accept</div></div>`}
    </div>`;
  }
  const line = c.state === 'calling' ? (c.kind === 'app' ? 'Ringing…' : 'calling mobile…') : c.state === 'failed' ? 'Call Failed' : `<span id="callTimer">${mmss((Date.now() - (c.t0 || Date.now())) / 1000)}</span>`;
  if (c.state === 'failed') return `<div class="scr call">${bgi}<div class="cl-top"><div class="cl-name">${esc(c.name)}</div><div class="cl-sub2">${line}</div></div>${avatarHTML(c.photo, c.name, 'cl-av')}
    <div class="cl-fail"><div class="cl-b" id="cancel"><span class="ci" style="background:rgba(255,255,255,.25)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg></span>Cancel</div><div class="cl-b" id="again"><span class="ci green">${I.phone}</span>Call Again</div></div></div>`;
  return `<div class="scr call">${bgi}<div class="cl-top"><div class="cl-name">${esc(c.name)}</div><div class="cl-sub2">${line}</div></div>${avatarHTML(c.photo, c.name, 'cl-av')}
    <div class="incall-grid">
      <div class="ig"><span class="ci tg">${I.speaker}</span>speaker</div><div class="ig"><span class="ci">${I.vid}</span>FaceTime</div><div class="ig"><span class="ci tg">${I.mute}</span>mute</div>
      <div class="ig"><span class="ci">${I.addp}</span>add</div><div class="ig" id="endc"><span class="ci red">${I.hang}</span>end</div><div class="ig"><span class="ci">${I.keypad}</span>keypad</div>
    </div><div class="endrow"></div></div>`;
}
function bindCall() {
  $('#acc')?.addEventListener('click', () => P.block && P.block('answer'));
  $('#decl')?.addEventListener('click', () => { if (P.block) P.block('decline'); });
  $('#endc')?.addEventListener('click', endCall);
  $('#cancel')?.addEventListener('click', endCall);
  $('#again')?.addEventListener('click', endCall);
  document.querySelectorAll('.ig .ci.tg').forEach(b => b.addEventListener('click', () => b.classList.toggle('on')));
  const knob = $('#knob');
  if (knob) {
    const track = $('#slide'); let x0 = null, max = 0;
    knob.addEventListener('pointerdown', e => { x0 = e.clientX; max = track.clientWidth - knob.clientWidth - 12; knob.setPointerCapture(e.pointerId); knob.style.transition = 'none'; });
    knob.addEventListener('pointermove', e => { if (x0 == null) return; const dx = Math.max(0, Math.min(max, e.clientX - x0)); knob.style.transform = `translateX(${dx}px)`; });
    const up = e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (dx > max * 0.85) { if (P.block) P.block('answer'); } else { knob.style.transition = 'transform .25s'; knob.style.transform = ''; } };
    knob.addEventListener('pointerup', up); knob.addEventListener('pointercancel', up);
  }
}
function alarmHTML() {
  const s = P.scene;
  const bg = s.wallpaper ? `background-image:url('${s.wallpaper}')` : 'background:linear-gradient(180deg,#3a4a63,#121821)';
  return `<div class="scr alarm" style="${bg}"><div class="al-lbl"><span style="width:20px;height:20px;display:inline-block;fill:#fff">${I.alarm}</span>${esc(P.ov.label)}</div>
    <div class="al-time">${esc(P.clock)}</div><button class="al-snooze" id="alSnooze">Snooze</button><button class="al-stop" id="alStop">Stop</button></div>`;
}
function bindAlarm() { ['#alSnooze', '#alStop'].forEach(id => $(id).addEventListener('click', () => P.block && P.block('stop'))); }
function bankHTML(ev) {
  const tx = String(ev.tx || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [d, desc, amt] = l.split('|').map(x => (x || '').trim()); return `<div class="bk-row"><span>${esc(desc)}<small>${esc(d)}</small></span><span class="${/^-/.test(amt) ? 'neg' : ''}">${esc(amt)}</span></div>`; }).join('');
  return `<div class="scr bank"><div class="bk-top" style="padding-top:${STANDALONE ? 14 : 10}px"><div class="bk-name">${esc(ev.bank || 'Bank')}<span style="opacity:.8;font-weight:500;font-size:14px">Accounts</span></div>
    <div class="bk-acc">${esc(ev.account || '')}</div><div class="bk-lbl">Available balance</div><div class="bk-bal">${esc(ev.balance || '')}</div><div class="bk-num">${esc(ev.number || '')}</div></div>
    <div class="bk-actions">${BANK_BTNS.map(([a, f]) => `<div class="bk-a"><i><img src="lib/ui/bank-${f}.png" onerror="this.replaceWith(document.createRange().createContextualFragment(BANK_SVG['${f}']))"></i>${a}</div>`).join('')}</div>
    ${tx ? `<div class="bk-tx"><h4>Recent transactions</h4>${tx}</div>` : ''}</div>`;
}
const BANK_BTNS = [['Pay', 'pay'], ['Transfer', 'transfer'], ['Buy', 'buy'], ['Statements', 'statements'], ['Cards', 'cards'], ['Scan to pay', 'scan'], ['Airtime', 'airtime'], ['Settings', 'settings']];
const BANK_SVG = {
  pay: '<svg viewBox="0 0 24 24"><path d="M3 11.5 21 3l-6.5 18-3.2-7.3z"/><path d="M11.3 13.7 21 3"/></svg>',
  transfer: '<svg viewBox="0 0 24 24"><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/></svg>',
  buy: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>',
  statements: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>'
};
function topColor(url) {
  return new Promise(res => {
    if (!url) return res('#1f2a3a');
    const im = new Image();
    im.onload = () => { try { const c = document.createElement('canvas'); c.width = 20; c.height = 4; const x = c.getContext('2d'); x.drawImage(im, 0, 0, im.width, Math.max(1, im.height * 0.08), 0, 0, 20, 4); const d = x.getImageData(0, 0, 20, 4).data; let r = 0, g = 0, b = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } res(`rgb(${r / n | 0},${g / n | 0},${b / n | 0})`); } catch (e) { res('#000'); } };
    im.onerror = () => res('#000'); im.src = url;
  });
}

/* hidden zones */
(() => {
  $('#cueZone').addEventListener('pointerdown', e => { e.preventDefault(); cue(); });
  let t = null;
  const ex = $('#exitZone');
  ex.addEventListener('pointerdown', e => { e.preventDefault(); t = setTimeout(stopPlay, 2000); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => ex.addEventListener(k, () => clearTimeout(t)));

  // Pinch in (two fingers that start apart and squeeze together near the middle) = back to Director.
  // Actors don't pinch a chat by accident, and it works anywhere on screen, unlike the tiny corner.
  const stage = $('#stage'); let pin = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  stage.addEventListener('touchstart', e => {
    if (e.touches.length !== 2) { pin = null; return; }
    const [a, b] = e.touches, d = dist(a, b);
    const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
    const central = Math.abs(mx - innerWidth / 2) < innerWidth * 0.3 && Math.abs(my - innerHeight / 2) < innerHeight * 0.3;
    pin = d > 90 && central ? { d0: d } : null;
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (e.touches.length === 2) e.preventDefault(); // no page zoom on set
    if (!pin || e.touches.length !== 2) return;
    if (dist(e.touches[0], e.touches[1]) < pin.d0 * 0.5) { pin = null; stopPlay(); }
  }, { passive: false });
  stage.addEventListener('touchend', () => { pin = null; });
  // iOS Safari ignores user-scalable=no: block its pinch-zoom and double-tap zoom so the prop never zooms on camera.
  ['gesturestart', 'gesturechange'].forEach(k => document.addEventListener(k, e => e.preventDefault()));
  $('#banner').addEventListener('click', () => { const app = $('#banner').dataset.app; hideBanner(); if (app === 'chat') goScreen('chat'); });
  document.addEventListener('keydown', e => {
    if ($('#stage').hidden || e.target.id === 'cInput') return;
    if (e.key === 'Escape') stopPlay();
    if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); cue(); }
  });
  const fit = () => { const h = window.visualViewport ? visualViewport.height : innerHeight; document.documentElement.style.setProperty('--app-h', h + 'px'); if (!$('#stage').hidden) window.scrollTo(0, 0); const l = $('#cList'); if (l) l.scrollTop = l.scrollHeight; };
  (window.visualViewport || window).addEventListener('resize', fit); fit();
})();

/* ================= DIRECTOR ================= */
const D = { scenes: [], edit: null, saveT: null };
const TICK_OPTS = [['1', 'One grey tick (sent)'], ['2', 'Two grey ticks (delivered)'], ['3', 'Two blue ticks (read)'], ['0', 'Clock (still sending)']];
const TYPES = {
  msg_in: { l: 'Message in', f: [['text', 'area', 'Text'], ['time', 'text', 'Time shown', '10:42']] },
  msg_out: { l: 'Message out (sent by the actor)', f: [['text', 'area', 'Text'], ['time', 'text', 'Time shown', '10:43'], ['ticks', 'sel', 'Ticks when sent', TICK_OPTS], ['actorTypes', 'check', 'Actor types it: each key press shows the next letters, waits for Send']] },
  ticks: { l: 'Change ticks on last sent message', f: [['ticks', 'sel', 'New ticks', TICK_OPTS]] },
  typing: { l: 'Typing… in header', f: [['seconds', 'num', 'Seconds', 3]] },
  status: { l: 'Header status (online / last seen)', f: [['text', 'text', 'Status text', 'online']] },
  voice_in: { l: 'Voice note in', f: [['length', 'text', 'Plays for (m:ss, shown on the bubble)', '0:14'], ['time', 'text', 'Time shown'], ['audio', 'audio', 'Audio file (optional, plays when tapped)']] },
  voice_out: { l: 'Voice note out', f: [['length', 'text', 'Plays for (m:ss, shown on the bubble)', '0:14'], ['time', 'text', 'Time shown'], ['ticks', 'sel', 'Ticks', TICK_OPTS], ['audio', 'audio', 'Audio file (optional)']] },
  photo_in: { l: 'Photo in', f: [['image', 'img', 'Photo'], ['caption', 'text', 'Caption'], ['time', 'text', 'Time shown']] },
  photo_out: { l: 'Photo out', f: [['image', 'img', 'Photo'], ['caption', 'text', 'Caption'], ['time', 'text', 'Time shown'], ['ticks', 'sel', 'Ticks', TICK_OPTS]] },
  banner: { l: 'Notification from someone else', f: [['app', 'sel', 'App', [['messages', 'Messages (SMS)'], ['chat', 'Chat app'], ['phone', 'Phone'], ['bank', 'Bank'], ['mail', 'Mail']]], ['from', 'text', 'From'], ['text', 'area', 'Text']] },
  missed: { l: 'Missed call notification', f: [['from', 'text', 'From'], ['count', 'num', 'How many', 1]] },
  alarm: { l: 'Alarm (waits for Stop)', f: [['time', 'text', 'Alarm time', '11:00'], ['label', 'text', 'Label', 'Alarm'], ['ringMode', 'sel', 'Ring mode', [['ring', 'Ring'], ['vibrate', 'Vibrate (buzz sound + haptic)'], ['both', 'Ring + vibrate'], ['silent', 'Silent (screen only)']]]] },
  call_in: { l: 'Incoming call', f: [['name', 'text', 'Caller name'], ['photo', 'img', 'Caller photo'], ['kind', 'sel', 'Call type', [['phone', 'Phone call (mobile)'], ['app', 'Chat app audio call']]], ['ringMode', 'sel', 'Ring mode', [['ring', 'Ring'], ['vibrate', 'Vibrate (buzz sound + haptic)'], ['both', 'Ring + vibrate'], ['silent', 'Silent (screen only)']]], ['ringFor', 'num', 'Becomes missed after (seconds, 0 = rings until answered)', 0]] },
  call_out: { l: 'Outgoing call', f: [['name', 'text', 'Calling'], ['photo', 'img', 'Photo'], ['kind', 'sel', 'Call type', [['phone', 'Phone call (mobile)'], ['app', 'Chat app audio call']]], ['ringSeconds', 'num', 'Rings for (seconds)', 10], ['result', 'sel', 'Then', [['fail', 'Call Failed (rings out)'], ['answer', 'Answered (call timer)'], ['none', 'Keeps ringing until cue / end']]]] },
  call_end: { l: 'End the call', f: [] },
  bank: { l: 'Banking app balance', f: [['bank', 'text', 'Bank name (fictional)', 'Ubuntu Bank'], ['account', 'text', 'Account name'], ['number', 'text', 'Account number', '•••• 4471'], ['balance', 'text', 'Balance', 'R5,000.00'], ['tx', 'area', 'Transactions, one per line: date | description | amount']] },
  image: { l: 'Full-screen picture', f: [['image', 'img', 'Picture']] },
  clock: { l: 'Change lock-screen clock', f: [['time', 'text', 'Time', '11:00'], ['date', 'text', 'Date']] },
  goto: { l: 'Go to screen', f: [['screen', 'sel', 'Screen', [['chat', 'Chat'], ['lock', 'Lock screen'], ['home', 'Home screen']]]] },
  wait: { l: 'Cue point only (does nothing)', f: [] },
  mail_in: { l: 'Laptop: new email arrives', f: [['from', 'text', 'From (name)'], ['address', 'text', 'From (email address)'], ['subject', 'text', 'Subject'], ['body', 'area', 'Body (// = new paragraph)'], ['time', 'text', 'Time shown', '10:59'], ['important', 'check', 'Mark Important'], ['notify', 'sel', 'Pop-up in the corner', [['true', 'Yes, with ding'], ['', 'No pop-up']]]] },
  mail_open: { l: 'Laptop: open an email', f: [['subject', 'text', 'Subject or sender (any part of it)']] },
  mail_highlight: { l: 'Laptop: highlight words (cursor selects them)', f: [['text', 'area', 'Exact words to highlight in the open email']] },
  mail_inbox: { l: 'Laptop: back to the inbox', f: [] }
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); }
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
}
function save() { clearTimeout(D.saveT); const s = D.edit; D.saveT = setTimeout(() => { D.saveT = null; DB.put(s); }, 350); }
function flushSave() { if (D.saveT && D.edit) { clearTimeout(D.saveT); D.saveT = null; return DB.put(D.edit); } return Promise.resolve(); }
function lab(text, input) { return el('label', { class: 'f' }, el('span', {}, text), input); }
function fText(o, k, ph) { const i = el('input', { type: 'text', placeholder: ph || '' }); i.value = o[k] ?? ''; i.oninput = () => { o[k] = i.value; save(); }; return i; }
function fNum(o, k, def) { const i = el('input', { type: 'number', step: 'any', inputmode: 'decimal' }); i.value = o[k] ?? def ?? 0; i.oninput = () => { o[k] = i.value === '' ? 0 : +i.value; save(); }; return i; }
function fArea(o, k, ph) { const i = el('textarea', { placeholder: ph || '' }); i.value = o[k] ?? ''; i.oninput = () => { o[k] = i.value; save(); }; return i; }
function fSel(o, k, opts, onc) { const i = el('select'); opts.forEach(([v, t]) => i.append(el('option', { value: v }, t))); i.value = o[k] ?? opts[0][0]; if (o[k] == null) o[k] = opts[0][0]; i.onchange = () => { o[k] = i.value; save(); onc && onc(); }; return i; }
function fCheck(o, k, text) { const i = el('input', { type: 'checkbox' }); i.checked = !!o[k]; i.onchange = () => { o[k] = i.checked; save(); }; return el('label', { class: 'f check' }, i, el('span', {}, text)); }
function pick(accept) { return new Promise(res => { const f = $('#filePick'); f.value = ''; f.accept = accept; f.onchange = () => res(f.files[0] || null); f.click(); }); }
function readURL(file) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); }); }
async function shrink(file, max = 1170) {
  const url = await readURL(file);
  return new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.86)); }; im.onerror = () => res(url); im.src = url; });
}
function fImg(o, k, text, kind = 'photo') {
  const wrap = el('div', { class: 'row' });
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(o[k] ? el('img', { class: 'thumb' + (kind === 'wallpaper' || kind === 'chatbg' ? ' tall' : ''), src: o[k] }) : el('span', { class: 'thumb' + (kind === 'wallpaper' || kind === 'chatbg' ? ' tall' : '') }),
      el('button', { class: 'btn small primary', onclick: e => { e.preventDefault(); openLibrary(kind, src => { o[k] = src; save(); draw(); }); } }, 'Library'),
      el('button', { class: 'btn small', onclick: async e => { e.preventDefault(); const f = await pick('image/*'); if (!f) return; o[k] = await shrink(f); save(); draw(); } }, 'Camera roll'),
      o[k] ? el('button', { class: 'btn small', onclick: e => { e.preventDefault(); o[k] = ''; save(); draw(); } }, 'Remove') : '');
  };
  draw(); return el('div', { class: 'f' }, el('span', {}, text), wrap);
}

/* Library sheet: pick an image (or manage the library when onPick is null). */
async function openLibrary(kind, onPick) {
  let curKind = kind || 'avatar', curGroup = 'All';
  const sheet = el('div', { class: 'sheet' }); const box = el('div', { class: 'sheet-box' }); sheet.append(box);
  const close = () => sheet.remove();
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  document.body.append(sheet);
  const draw = async () => {
    const items = await allLib();
    const groups = ['All', ...new Set(items.map(x => x.group || 'General'))];
    const shown = items.filter(x => x.kind === curKind && (curGroup === 'All' || (x.group || 'General') === curGroup));
    box.innerHTML = '';
    box.append(el('div', { class: 'sheet-head' }, el('b', {}, onPick ? 'Choose from library' : 'Image library'), el('button', { class: 'btn small', onclick: close }, 'Done')));
    box.append(el('div', { class: 'chips' }, ...LIB_KINDS.map(([k, t]) => el('button', { class: 'chip' + (k === curKind ? ' on' : ''), onclick: () => { curKind = k; draw(); } }, t))));
    box.append(el('div', { class: 'chips' }, ...groups.map(g => el('button', { class: 'chip small' + (g === curGroup ? ' on' : ''), onclick: () => { curGroup = g; draw(); } }, g))));
    const grid = el('div', { class: 'lib-grid' + (curKind === 'wallpaper' || curKind === 'chatbg' ? ' tall' : '') });
    shown.forEach(x => {
      const cell = el('div', { class: 'lib-cell' }, el('img', { src: x.data, loading: 'lazy' }), el('span', {}, x.name || ''));
      cell.addEventListener('click', async () => {
        if (onPick) { onPick(x.data); close(); return; }
        if (x.builtin) return alert('Built-in image (comes with the app).');
        if (confirm(`Remove "${x.name}" from the library?`)) { await DB.del(x.id, 'library'); draw(); }
      });
      grid.append(cell);
    });
    if (!shown.length) grid.append(el('p', { class: 'muted' }, 'Nothing here yet. Add one from the camera roll.'));
    box.append(grid);
    box.append(el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn primary', onclick: async () => {
        const f = await pick('image/*'); if (!f) return;
        const name = prompt('Name for this image (e.g. "Thabo")', f.name.replace(/\.[^.]+$/, '')) || 'Image';
        const g = curGroup === 'All' ? (prompt('Which production is it for?', LS.get('sp-group', 'My scenes')) || 'My scenes') : curGroup;
        await DB.put({ id: uid(), group: g, kind: curKind, name, data: await shrink(f, curKind === 'avatar' ? 600 : 1300) }, 'library'); draw();
      } }, '+ Add from camera roll')));
  };
  draw();
}
function fAudio(o, k, text) {
  const wrap = el('div', { class: 'row' });
  const draw = () => {
    wrap.innerHTML = '';
    wrap.append(el('span', { class: 'muted' }, o[k] ? 'Audio added' : 'None'),
      el('button', { class: 'btn small', onclick: async e => { e.preventDefault(); const f = await pick('audio/*'); if (!f) return; if (f.size > 8e6) return alert('Keep voice notes under 8 MB.'); o[k] = await readURL(f); save(); draw(); } }, o[k] ? 'Change' : 'Choose audio'),
      o[k] ? el('button', { class: 'btn small', onclick: e => { e.preventDefault(); o[k] = ''; save(); draw(); } }, 'Remove') : '');
  };
  draw(); return el('div', { class: 'f' }, el('span', {}, text), wrap);
}

async function renderDirector() {
  D.scenes = sortScenes(await DB.all());
  const m = $('#d-main'); m.innerHTML = '';
  if (D.edit) return renderEditor(m);
  const groups = [...new Set(D.scenes.map(groupOf))];
  let cur = LS.get('sp-group', groups[0] || 'My scenes');
  if (!groups.includes(cur)) cur = groups[0] || 'My scenes';
  LS.set('sp-group', cur);

  // production switcher
  m.append(el('div', { class: 'prod-bar' },
    el('div', { class: 'chips', style: 'flex:1' }, ...groups.map(g => el('button', { class: 'chip' + (g === cur ? ' on' : ''), onclick: () => { LS.set('sp-group', g); renderDirector(); } }, `${g} (${D.scenes.filter(s => groupOf(s) === g).length})`)),
      el('button', { class: 'chip add', onclick: newGroup }, '+ Production'))));

  const inGroup = D.scenes.filter(s => groupOf(s) === cur);
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'ev-head', style: 'margin-bottom:6px' }, el('h3', { style: 'margin:0' }, cur),
    el('button', { class: 'btn small', 'aria-label': 'Production options', onclick: () => actionSheet(cur, [
      ['Rename production', () => renameGroup(cur)],
      ['Export (back up / send to another phone)', () => exportGroup(cur)],
      ['Import scenes into it', () => importFile(cur)],
      ['Delete production', () => deleteGroup(cur), true]]) }, '•••')));
  if (!inGroup.length) card.append(el('p', { class: 'muted' }, 'No scenes yet. Tap "+ New scene" or Import a scene file.'));
  inGroup.forEach((s, i) => {
    card.append(el('div', { class: 'scene-row' },
      el('div', { class: 'scene-main', onclick: () => { D.edit = s; renderDirector(); } },
        el('div', { class: 't' }, s.name), el('div', { class: 'muted' }, s.device === 'laptop' ? `${(s.events || []).length} cues · laptop · We Mail` : `${(s.events || []).length} cues · starts on ${s.startScreen || 'lock'} · ${s.contactName || ''}`)),
      el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:4px' },
        el('button', { class: 'btn small', title: 'Move up', onclick: () => moveScene(inGroup, i, -1) }, '↑'),
        el('button', { class: 'btn small go', onclick: () => startPlay(s, false) }, '▶ Play'))));
  });
  card.append(el('div', { class: 'row', style: 'margin-top:10px' },
    el('button', { class: 'btn primary', onclick: () => newScene(cur) }, '+ New scene')));
  m.append(card);

  m.append(el('div', { class: 'card help', html: `<h3>On set</h3><ul>
    <li><b>Play</b>, hand the phone over.</li>
    <li><b>Next cue:</b> tap the top-left corner.</li>
    <li><b>Back here:</b> pinch in with two fingers in the middle (or hold the top-right corner 2 s).</li></ul>` }));
  if (!DB.db) m.append(el('div', { class: 'card warn' }, 'This browser is not saving: scenes vanish when the app closes. Open Set Phone from the Home Screen icon in Safari (not a private tab).'));
  m.append(el('details', { class: 'card help' }, el('summary', {}, 'More: library, backup, checklist'),
    el('div', { class: 'row', style: 'margin:8px 0' },
      el('button', { class: 'btn', onclick: () => openLibrary('avatar', null) }, 'Image library'),
      el('button', { class: 'btn', onclick: exportAll }, 'Back up everything'),
      el('button', { class: 'btn', onclick: addPresets }, 'Add demo scene')),
    el('p', { class: 'muted' }, 'Everything is saved on this phone only. Export a production to back it up or send it to another phone.'),
    el('div', { html: `<h3 style="margin-top:10px">Before a take</h3><ul><li>Guided Access on (Settings › Accessibility) so the actor cannot leave the app.</li><li>Airplane mode or Do Not Disturb.</li><li>Phone clock set to the scene time.</li><li>Ringer on, volume up (or scene set to Silent).</li><li>Brightness up. The app keeps the screen awake while playing.</li><li><b>Rehearse</b> shows the hidden corners and an orange dot while a cue waits for you.</li></ul>` })));
}
/* Small bottom sheet of actions: items = [label, fn, danger?] */
function actionSheet(title, items) {
  const sheet = el('div', { class: 'sheet' }); const box = el('div', { class: 'sheet-box' }); sheet.append(box);
  const close = () => sheet.remove();
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  box.append(el('div', { class: 'sheet-head' }, el('b', {}, title), el('button', { class: 'btn small', onclick: close }, 'Cancel')));
  items.forEach(([t, fn, danger]) => box.append(el('button', { class: 'btn' + (danger ? ' danger' : ''), style: 'display:block;width:100%;margin-top:8px;text-align:left', onclick: () => { close(); fn(); } }, t)));
  document.body.append(sheet);
}
async function moveScene(list, i, d) {
  const j = i + d; if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) { list[k].order = k + 1; await DB.put(list[k]); }
  renderDirector();
}
async function newGroup() {
  const g = (prompt('Name of the production (e.g. "My Short Film")') || '').trim(); if (!g) return;
  LS.set('sp-group', g); await newScene(g);
}
async function renameGroup(g) {
  const n = (prompt('New name for this production', g) || '').trim(); if (!n || n === g) return;
  for (const s of D.scenes.filter(s => groupOf(s) === g)) { s.group = n; await DB.put(s); }
  for (const x of (await DB.all('library')).filter(x => x.group === g)) { x.group = n; await DB.put(x, 'library'); }
  LS.set('sp-group', n); renderDirector();
}
async function deleteGroup(g) {
  const list = D.scenes.filter(s => groupOf(s) === g);
  if (!confirm(`Delete the production "${g}" and its ${list.length} scene(s) from this phone? This cannot be undone. Export it first if unsure.`)) return;
  for (const s of list) await DB.del(s.id);
  LS.set('sp-group', ''); renderDirector();
}
async function newScene(group) {
  const g = group || LS.get('sp-group', 'My scenes');
  const n = D.scenes.filter(s => groupOf(s) === g).length;
  const s = { id: uid(), group: g, name: `Scene ${n + 1}`, order: n + 1, contactName: 'Contact', status: 'online', theme: 'light', look: 'alike', appName: 'Chats', startScreen: 'chat', lockTime: '10:00', lockDate: 'Monday 14 June', sound: 'all', liveTyping: false, unreadBack: 0, lockStack: '', history: '-- Today', events: [] };
  await DB.put(s); D.edit = s; renderDirector();
}
async function addPresets() { for (const p of window.PRESETS || []) await DB.put(fromPreset(p)); renderDirector(); }
function download(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
}
async function exportGroup(g) {
  const lib = (await DB.all('library')).filter(x => x.group === g);
  download({ app: 'set-phone', version: 2, group: g, scenes: D.scenes.filter(s => groupOf(s) === g), library: lib }, `${new Date().toISOString().slice(0, 10)} ${g} - Set Phone.json`);
}
async function exportAll() { download({ app: 'set-phone', version: 2, scenes: D.scenes, library: await DB.all('library') }, `${new Date().toISOString().slice(0, 10)} Set Phone backup.json`); }
async function importFile(curGroup) {
  const f = await pick('.json,application/json'); if (!f) return;
  let j; try { j = JSON.parse(await f.text()); } catch (e) { return alert('That file is not a Set Phone file.'); }
  const list = j.scenes || (Array.isArray(j) ? j : [j]);
  const fileGroup = j.group || list.find(s => s.group)?.group;
  const g = (prompt('Import into which production?', fileGroup || curGroup || 'My scenes') || '').trim(); if (!g) return;
  await importData(j, list, g);
}
async function importData(j, list, g) {
  // same id = update that scene (re-importing a pack refreshes it instead of duplicating)
  for (const s of list) { if (!s.id) s.id = uid(); s.group = g; s.events = (s.events || []).map(e => ({ id: e.id || uid(), ...e })); await DB.put(s); }
  for (const x of j.library || []) { await DB.put({ ...x, id: x.id || uid(), group: g }, 'library'); }
  LS.set('sp-group', g); renderDirector();
  alert(`Imported ${list.length} scene(s)${(j.library || []).length ? ` and ${j.library.length} image(s)` : ''} into "${g}".`);
}

function renderEditor(m) {
  const s = D.edit;
  const top = el('div', { class: 'row', style: 'margin:6px 0 2px' },
    el('button', { class: 'btn small', onclick: () => { DB.put(s); D.edit = null; renderDirector(); } }, `‹ ${groupOf(s)}`),
    el('span', { style: 'flex:1' }),
    el('button', { class: 'btn small', onclick: async () => { const c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.name += ' (copy)'; await DB.put(c); D.edit = c; renderDirector(); } }, 'Duplicate'),
    el('button', { class: 'btn small danger', onclick: async () => { if (!confirm(`Delete "${s.name}"? This cannot be undone (export first if unsure).`)) return; await DB.del(s.id); D.edit = null; renderDirector(); } }, 'Delete'));
  m.append(top);
  if (s.note) m.append(el('div', { class: 'card muted' }, s.note));
  if (s.device === 'laptop') { m.append(el('div', { class: 'card' }, el('h3', {}, 'Laptop scene (We Mail)'),
    lab('Scene name', fText(s, 'name')),
    lab('Device', fSel(s, 'device', [['laptop', 'Laptop (Mac desktop + We Mail)'], ['phone', 'Phone']], () => renderDirector())),
    el('div', { class: 'grid2' }, lab('Her name', fText(s, 'mailUser')), lab('Her email address', fText(s, 'mailAddress'))),
    el('div', { class: 'grid2' }, lab('Menu bar time', fText(s, 'lockTime', '10:59')), lab('Date', fText(s, 'lockDate', 'Sunday 4 April'))),
    lab('Email open when Play starts (part of its subject, empty = inbox)', fText(s, 'openFirst')),
    lab('Inbox, one email per line: Name <address> | Subject | Body (// = new paragraph) | Date shown | flags (u unread, s starred, i important)', fArea(s, 'inbox')),
    fImg(s, 'contactPhoto', 'Her profile picture (top right)', 'avatar'),
    fImg(s, 'wallpaper', 'Desktop wallpaper', 'wallpaper'),
    fImg(s, 'companyLogo', 'Company logo (shown for senders from her company)', 'avatar'),
    el('details', { class: 'more' }, el('summary', {}, 'More options'),
      lab('Production', fSel(s, 'group', [...new Set([groupOf(s), ...D.scenes.map(groupOf)])].map(g => [g, g]), () => LS.set('sp-group', s.group))),
      lab('Labels in the side bar (comma separated)', fText(s, 'mailLabels', 'Work, Clients, Family')),
      lab('Sounds', fSel(s, 'sound', [['all', 'All sounds'], ['none', 'Silent (add in post)']])))));
  } else {
  // Essentials first; everything else folds away under "More options".
  m.append(el('div', { class: 'card' }, el('h3', {}, 'Scene'),
    lab('Scene name', fText(s, 'name')),
    lab('Device', fSel(s, 'device', [['phone', 'Phone'], ['laptop', 'Laptop (Mac desktop + We Mail)']], () => { if (s.device === 'laptop' && !s.inbox) s.inbox = 'HR <hr@company.co.za> | Welcome | Hello // Regards | Thu 1 Apr | u'; save(); renderDirector(); })),
    el('div', { class: 'grid2' }, lab('Contact name', fText(s, 'contactName')), lab('Starts on', fSel(s, 'startScreen', [['lock', 'Lock screen'], ['home', 'Home screen'], ['chat', 'Chat']]))),
    fImg(s, 'contactPhoto', 'Contact profile photo', 'avatar'),
    el('div', { class: 'grid2' }, lab('Phone time', fText(s, 'lockTime', '10:42')), lab('Date', fText(s, 'lockDate', 'Saturday 3 April'))),
    lab('Chat already on screen (one per line: "< text | 10:41" in, "> text | 10:42 | 3" out with ticks, "-- Today" date chip, "! note")', fArea(s, 'history')),
    el('details', { class: 'more' }, el('summary', {}, 'More options (look, wallpapers, sounds, notifications)'),
      lab('Production', fSel(s, 'group', [...new Set([groupOf(s), ...D.scenes.map(groupOf)])].map(g => [g, g]), () => LS.set('sp-group', s.group))),
      el('div', { class: 'grid2' },
        lab('Look', fSel(s, 'look', [['alike', 'Lookalike (broadcast safe)'], ['exact', 'Exact WhatsApp-style']], () => { if (s.look === 'exact' && (!s.appName || s.appName === 'Chats')) s.appName = 'WhatsApp'; if (s.look === 'alike' && s.appName === 'WhatsApp') s.appName = 'Chats'; save(); renderDirector(); })),
        lab('Theme', fSel(s, 'theme', [['light', 'Light'], ['dark', 'Dark']]))),
      el('div', { class: 'grid2' }, lab('Header status', fText(s, 'status', 'online')), lab('App name on notifications', fText(s, 'appName'))),
      fImg(s, 'wallpaper', 'Lock screen wallpaper', 'wallpaper'),
      fImg(s, 'homeWallpaper', 'Home screen wallpaper (empty = same as lock screen)', 'wallpaper'),
      fImg(s, 'chatWallpaper', 'Chat background (optional)', 'chatbg'),
      el('div', { class: 'grid2' }, lab('Sounds', fSel(s, 'sound', [['all', 'All sounds'], ['calls', 'Only ring + alarm'], ['none', 'Silent (add in post)']])), lab('Unread number on back button', fNum(s, 'unreadBack', 0))),
      fCheck(s, 'liveTyping', 'Actor can type their own messages freely (live typing)'),
      lab('Lock-screen notifications already there (one per line: app | title | text | time; app = chat, messages, phone, bank, mail)', fArea(s, 'lockStack')))));
  }

  const evWrap = el('div');
  const drawEvents = () => {
    evWrap.innerHTML = '';
    (s.events || []).forEach((ev, i) => {
      const T = TYPES[ev.type] || { l: ev.type, f: [] };
      const card = el('div', { class: 'card ev' + (ev.trigger === 'tap' ? ' tap' : '') });
      const move = d => { const j = i + d; if (j < 0 || j >= s.events.length) return; [s.events[i], s.events[j]] = [s.events[j], s.events[i]]; save(); drawEvents(); };
      card.append(el('div', { class: 'ev-head' }, el('b', {}, `${i + 1}. ${T.l}`),
        el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:4px' },
          el('button', { class: 'btn small', onclick: () => move(-1) }, '↑'), el('button', { class: 'btn small', onclick: () => move(1) }, '↓'),
          el('button', { class: 'btn small', onclick: () => { s.events.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(ev)), id: uid() }); save(); drawEvents(); } }, '⧉'),
          el('button', { class: 'btn small danger', onclick: () => { s.events.splice(i, 1); save(); drawEvents(); } }, '✕'))));
      card.append(el('div', { class: 'grid2' },
        lab('Starts', fSel(ev, 'trigger', [['tap', 'On my hidden tap'], ['auto', 'Automatically']], drawEvents)),
        lab(ev.trigger === 'tap' ? 'Then wait (seconds)' : 'After (seconds)', fNum(ev, 'delay', 0))));
      T.f.forEach(([k, kind, label, extra]) => {
        if (kind === 'text') card.append(lab(label, fText(ev, k, extra)));
        if (kind === 'area') card.append(lab(label, fArea(ev, k)));
        if (kind === 'num') { if (ev[k] == null) ev[k] = extra; card.append(lab(label, fNum(ev, k, extra))); }
        if (kind === 'sel') card.append(lab(label, fSel(ev, k, extra)));
        if (kind === 'check') card.append(fCheck(ev, k, label));
        if (kind === 'img') card.append(fImg(ev, k, label, k === 'photo' ? 'avatar' : 'photo'));
        if (kind === 'audio') card.append(fAudio(ev, k, label));
      });
      evWrap.append(card);
    });
  };
  drawEvents();
  const typeSel = el('select');
  const CUE_GROUPS = [['Chat', ['msg_in', 'msg_out', 'voice_in', 'voice_out', 'photo_in', 'photo_out', 'typing', 'ticks', 'status']],
    ['Calls and alarms', ['call_in', 'call_out', 'call_end', 'missed', 'alarm']],
    ['Phone screens', ['banner', 'goto', 'clock', 'bank', 'image']], ['Laptop (We Mail)', ['mail_in', 'mail_open', 'mail_highlight', 'mail_inbox', 'clock']], ['Other', ['wait']]];
  CUE_GROUPS.forEach(([g, keys]) => typeSel.append(el('optgroup', { label: g }, ...keys.filter(k => TYPES[k]).map(k => el('option', { value: k }, TYPES[k].l)))));
  m.append(el('div', { class: 'card' }, el('h3', {}, 'Cues (in order)'), el('p', { class: 'muted' }, 'Orange = waits for your hidden tap. Blue = runs by itself after its seconds.')));
  m.append(evWrap);
  m.append(el('div', { class: 'card' }, el('div', { class: 'row' }, typeSel,
    el('button', { class: 'btn primary', onclick: () => { s.events = s.events || []; s.events.push({ id: uid(), type: typeSel.value, trigger: 'tap', delay: 0 }); save(); drawEvents(); evWrap.lastChild?.scrollIntoView({ behavior: 'smooth' }); } }, '+ Add cue'))));
  m.append(el('div', { class: 'sticky-bar' },
    el('button', { class: 'btn', onclick: async () => { clearTimeout(D.saveT); D.saveT = null; await DB.put(s); startPlay(s, true); } }, 'Rehearse'),
    el('button', { class: 'btn go', onclick: async () => { clearTimeout(D.saveT); D.saveT = null; await DB.put(s); startPlay(s, false); } }, '▶ Play')));
}

/* ================= BOOT ================= */
(async () => {
  await DB.open();
  // Ask iOS/Android not to clear our stored scenes and photos when space runs low.
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
  if (!(await DB.all()).length) for (const p of window.PRESETS || []) await DB.put(fromPreset(p));
  renderDirector();
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/sw/.test(location.search); // no offline cache while testing on the PC
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !local) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
