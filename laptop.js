'use strict';
/* Set Phone v8: LAPTOP mode. A scene with device = 'laptop' plays as a Mac-style desktop
   (menu bar, browser window, dock) running "We Mail", a broadcast-safe webmail lookalike.
   Open the Set Phone link on the laptop, press Play: it goes full screen.
   Inbox lines (scene.inbox): "Sender Name <address> | Subject | Body (use // for a new paragraph) | Date shown | flags"
   flags: u = unread, s = starred, i = important. */

const WM_LOGO = 'lib/ui/wemail-icon.png';
const WM_LOGO_SVG = '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#0f5f63"/><path d="M10 15h28v19H10z" fill="#fff"/><path d="M10 15l14 11 14-11" fill="none" stroke="#ff7a59" stroke-width="3.4" stroke-linejoin="round"/></svg>';
const wmLogoImg = (cls) => `<img class="${cls}" src="${WM_LOGO}" alt="" onerror="this.outerHTML=WM_LOGO_SVG.replace('<svg ','<svg class=&quot;${cls}&quot; ')">`;

function parseInbox(txt) {
  return String(txt || '').split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
    const [from, subject, body, date, flags] = l.split('|').map(s => (s || '').trim());
    const m = from.match(/^(.*?)\s*<([^>]+)>\s*$/);
    return { id: 'm' + i, name: m ? m[1] : from, addr: m ? m[2] : '', subject, body: body || '', date: date || '', unread: /u/.test(flags || ''), star: /s/.test(flags || ''), imp: /i/.test(flags || '') };
  });
}
const COLORS = ['#e57373', '#f06292', '#ba68c8', '#7986cb', '#4fc3f7', '#4db6ac', '#81c784', '#ffb74d', '#a1887f', '#90a4ae'];
function senderAv(mail, size = 'sm') {
  const s = P.scene;
  const dom = a => (a || '').split('@')[1] || '';
  if (s.companyLogo && mail.addr && dom(mail.addr) === dom(s.mailAddress)) return `<span class="wm-av ${size}" style="background-image:url('${s.companyLogo}')"></span>`;
  const pic = (s.senderPhotos || {})[mail.name];
  if (pic) return `<span class="wm-av ${size}" style="background-image:url('${pic}')"></span>`;
  const c = COLORS[[...mail.name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % COLORS.length];
  return `<span class="wm-av ${size}" style="background:${c}">${esc((mail.name || '?')[0].toUpperCase())}</span>`;
}
/* subject that STARTS with the words wins over "Re: ..." replies that only contain them */
function findMail(q) {
  q = String(q).toLowerCase().trim(); if (!q) return null;
  const subj = m => m.subject.toLowerCase();
  return P.mails.find(m => subj(m).startsWith(q)) || P.mails.find(m => subj(m).includes(q)) || P.mails.find(m => m.name.toLowerCase().includes(q)) || null;
}
const snip = t => String(t || '').replace(/\s*\/\/\s*/g, ' ').slice(0, 140);

function laptopStart(scene) {
  P.mails = parseInbox(scene.inbox);
  P.openMail = scene.openFirst ? findMail(scene.openFirst) : null;
  if (P.openMail) P.openMail.unread = false;
  P.hl = '';
  const st = $('#stage');
  st.classList.add('laptop');
  $('#fakeStatus').hidden = true; $('#fakeHome').hidden = true; $('#notch').hidden = true;
  st.style.setProperty('--top', '0px'); st.style.setProperty('--stagetop', '0px');
  try { const d = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d); } catch (e) {}
}

function menuClock() {
  const d = (P.date || '').split(' ');
  return `${esc((d[0] || '').slice(0, 3))} ${esc(d[1] || '')} ${esc((d[2] || '').slice(0, 3))}&nbsp;&nbsp;${esc(P.clock)}`;
}
function laptopHTML() {
  const s = P.scene;
  const bg = s.wallpaper ? `background-image:url('${s.wallpaper}')` : 'background:linear-gradient(135deg,#2b3a55,#6b4f7a 55%,#c98a6b)';
  const unread = P.mails.filter(m => m.unread).length;
  const me = s.mailUser || 'Me';
  const meAv = s.contactPhoto ? `<span class="wm-av me" style="background-image:url('${s.contactPhoto}')"></span>` : `<span class="wm-av me" style="background:#7b5ea7">${esc(me[0])}</span>`;
  const side = [['Inbox', unread, true, '<path d="M4 4h16v16H4zM4 13h5l1.5 2h3L15 13h5"/>'], ['Starred', 0, false, '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.4l6.1-.8z"/>'],
    ['Snoozed', 0, false, '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>'], ['Important', 0, false, '<path d="M4 6h12l4 6-4 6H4l4-6z"/>'], ['Sent', 0, false, '<path d="M3 12l18-8-7 18-3-7z"/>'],
    ['Drafts', 2, false, '<path d="M6 3h9l4 4v14H6zM14 3v5h5"/>'], ['More', 0, false, '<path d="M6 9l6 6 6-6"/>']]
    .map(([t, n, on, p]) => `<div class="wm-nav${on ? ' on' : ''}"><svg viewBox="0 0 24 24">${p}</svg><span>${t}</span>${n ? `<b>${n}</b>` : ''}</div>`).join('');
  const labels = (s.mailLabels || 'Work, Clients, Family, Varsity admin').split(',').map(x => x.trim()).filter(Boolean)
    .map((t, i) => `<div class="wm-nav lbl"><i style="background:${COLORS[(i * 3 + 2) % COLORS.length]}"></i><span>${esc(t)}</span></div>`).join('');
  let main;
  if (P.openMail) {
    const m = P.openMail;
    let body = esc(m.body).split(/\s*\/\/\s*/).map(p => `<p>${p}</p>`).join('');
    if (P.hl) { const h = esc(P.hl); body = body.split(h).join(`<mark>${h}</mark>`); }
    main = `<div class="wm-tool"><button class="wm-ib" id="wmBack" title="Back to Inbox"><svg viewBox="0 0 24 24"><path d="M20 12H5M11 6l-6 6 6 6"/></svg></button>
        <span class="wm-ib"><svg viewBox="0 0 24 24"><path d="M5 8h14M7 8v11h10V8M10 4h4"/></svg></span><span class="wm-ib"><svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM4 7l8 6 8-6"/></svg></span><span class="wm-ib"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg></span>
        <span class="wm-sp"></span><span class="wm-cnt">${P.mails.indexOf(m) + 1} of ${(s.mailTotal || 1284).toLocaleString('en-ZA')}</span></div>
      <div class="wm-read"><h2>${esc(m.subject)} <span class="wm-chip">Inbox</span>${m.imp ? '<span class="wm-chip red">Important</span>' : ''}</h2>
        <div class="wm-from">${senderAv(m, 'lg')}<div><b>${esc(m.name)}</b> <span class="wm-addr">&lt;${esc(m.addr)}&gt;</span><div class="wm-to">to ${esc(s.mailToLine || 'me')}</div></div><span class="wm-sp"></span><span class="wm-date">${esc(m.date)}</span></div>
        <div class="wm-body">${body}</div>
        <div class="wm-replybar"><span>↩ Reply</span><span>↪ Forward</span></div></div>`;
  } else {
    const rows = P.mails.map(m => `<div class="wm-row${m.unread ? ' unread' : ''}" data-id="${m.id}"><span class="wm-cb"></span><span class="wm-star${m.star ? ' on' : ''}">★</span><span class="wm-imp${m.imp ? ' on' : ''}"></span>
      <span class="wm-name">${esc(m.name)}</span><span class="wm-subj"><b>${esc(m.subject)}</b><span class="wm-snip"> - ${esc(snip(m.body))}</span></span><span class="wm-when">${esc(m.date)}</span></div>`).join('');
    main = `<div class="wm-tool"><span class="wm-cb"></span><span class="wm-ib"><svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2-5M19 4v4h-4"/></svg></span><span class="wm-ib"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg></span>
        <span class="wm-sp"></span><span class="wm-cnt">1-50 of ${(s.mailTotal || 1284).toLocaleString('en-ZA')}</span></div>
      <div class="wm-tabs"><span class="on">Primary</span><span>Promotions</span><span>Updates</span></div>
      <div class="wm-list">${rows}</div>`;
  }
  const dock = ['#1e90ff', '#ff9f0a', '#34c759', '#ff375f', '#5e5ce6', '#0f5f63', '#8e8e93'].map((c, i) => i === 5 ? `<span class="dk on">${wmLogoImg('dk-img')}</span>` : `<span class="dk" style="background:linear-gradient(180deg,${c},${c}cc)"></span>`).join('');
  return `<div class="scr lap" style="${bg}">
    <div class="mac-bar"><span class="mac-dot"></span><b>Browser</b><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Bookmarks</span><span>Window</span><span>Help</span><span class="wm-sp"></span>
      <svg viewBox="0 0 16 12" class="mi"><path d="M8 11.5l2.4-2.9a3.6 3.6 0 0 0-4.8 0zM3.4 6.3a7 7 0 0 1 9.2 0l1.5-1.8a9.4 9.4 0 0 0-12.2 0zM.2 2.6a12 12 0 0 1 15.6 0L16 2.3 15.8 2A12.4 12.4 0 0 0 .2 2z"/></svg><span class="mac-batt"><i></i></span><span>${menuClock()}</span></div>
    <div class="win">
      <div class="win-top"><i class="tl r"></i><i class="tl y"></i><i class="tl g"></i><span class="nav">‹ ›</span>
        <div class="url"><svg viewBox="0 0 14 18" width="9"><path d="M3 7V5a4 4 0 0 1 8 0v2h.5A1.5 1.5 0 0 1 13 8.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 1 16.5v-8A1.5 1.5 0 0 1 2.5 7zm1.8 0h4.4V5a2.2 2.2 0 0 0-4.4 0z" fill="#888"/></svg> mail.wemail.co.za/inbox${P.openMail ? '/' + P.openMail.id : ''}</div></div>
      <div class="wm">
        <div class="wm-head"><span class="wm-ib"><svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg></span>${wmLogoImg('wm-logo')}<span class="wm-brand">We Mail</span>
          <div class="wm-search"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>Search mail</div><span class="wm-sp"></span>${meAv}</div>
        <div class="wm-body2"><div class="wm-side"><div class="wm-compose"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>Compose</div>${side}<div class="wm-lh">Labels</div>${labels}</div>
          <div class="wm-main">${main}</div></div>
      </div>
    </div>
    <div class="dock">${dock}</div>
  </div>`;
}
function bindLaptop() {
  document.querySelectorAll('.wm-row').forEach(r => r.addEventListener('click', () => { const m = P.mails.find(x => x.id === r.dataset.id); if (m) { m.unread = false; P.openMail = m; P.hl = ''; render(); } }));
  $('#wmBack')?.addEventListener('click', () => { P.openMail = null; render(); });
}
function macNotify(m) {
  play('notif');
  const b = $('#banner');
  b.innerHTML = `<div class="mac-n">${wmLogoImg('mn-ic')}<div><div class="mn-top"><b>We Mail</b><span>now</span></div><div class="mn-t">${esc(m.name)}</div><div class="mn-s">${esc(m.subject)}</div><div class="mn-s light">${esc(snip(m.body).slice(0, 70))}</div></div></div>`;
  b.hidden = false; b.dataset.app = 'mail';
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('show')));
  clearTimeout(P.bannerT); P.bannerT = setTimeout(hideBanner, 6000);
}
/* laptop cues; returns true when handled */
function laptopExec(ev) {
  switch (ev.type) {
    case 'mail_in': {
      const m = { id: uid(), name: ev.from || 'Sender', addr: ev.address || '', subject: ev.subject || '', body: ev.body || '', date: ev.time || P.clock, unread: true, star: false, imp: !!ev.important };
      P.mails.unshift(m); render();
      if (ev.notify !== '' && ev.notify !== false) macNotify(m);
      return true;
    }
    case 'mail_open': {
      const m = findMail(ev.subject || '') || P.mails[0];
      if (m) { m.unread = false; P.openMail = m; P.hl = ''; render(); }
      return true;
    }
    case 'mail_highlight': P.hl = ev.text || ''; render(); setTimeout(() => $('.wm-body mark')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); return true;
    case 'mail_inbox': P.openMail = null; P.hl = ''; render(); return true;
    case 'clock': P.clock = ev.time || P.clock; if (ev.date) P.date = ev.date; render(); return true;
  }
  return false;
}
/* trackpad pinch-in on a Mac (Safari gesture events, Chrome ctrl+wheel) = back to Director */
(() => {
  let acc = 0, t = null;
  document.addEventListener('gesturechange', e => { if (!$('#stage').hidden && $('#stage').classList.contains('laptop') && e.scale < 0.6) stopPlay(); });
  window.addEventListener('wheel', e => {
    if ($('#stage').hidden || !e.ctrlKey) return;
    e.preventDefault(); acc += e.deltaY; clearTimeout(t); t = setTimeout(() => { acc = 0; }, 400);
    if (acc > 120) { acc = 0; stopPlay(); }
  }, { passive: false });
})();
