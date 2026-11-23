/* Stashd web app.
   Cloud mode (config.js has a Supabase key): accounts, boards and items live in Supabase.
   Local test mode (no key): everything is stored in this browser (localStorage). */
(function () {
  'use strict';

  var BREVO_FORM = 'https://ce2511d3.sibforms.com/serve/MUIFAGWBoXMZ0PhFB65Hri17rnly6SI4WLFuhUGEddRvKbr7EYvpj55CW81ejWZb82cq64RB2h6aXwq9DImojPK7ewUeJs9eRsTXxQFsSMsCkY9TR9tGpE_W5o4W6P09a2Po62M8uuD5vTj1S_Zg0Dg79Rh1i6huAwZ_bBedav0tHyg2vVTurIBhL6q2mFO6RiITi5x-_zIP2sbD4g==';
  var SAMPLE_URL = 'https://www.nesaaonline.com/products/embroidered-gabardine-pants-in-beige';
  var CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR'];
  var KEY = { users: 'stashd:users', session: 'stashd:session', pending: 'stashd:pending', data: function (id) { return 'stashd:data:' + id; } };

  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var user = null, db = null, ui = { board: 'all', tab: 'tobuy' };

  /* ---------- helpers ---------- */
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast("Couldn't save. This browser's storage is full or blocked."); return false; }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeImg(u) { return /^(https?:\/\/|data:image\/)/i.test(u || '') ? u : ''; }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.from(b).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function num(v) { if (v === '' || v == null) return null; var n = parseFloat(String(v).replace(/[^\d.]/g, '')); return isFinite(n) ? n : null; }
  function fmt(n) { var frac = Math.abs(n % 1) > 0.004; return new Intl.NumberFormat('en', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 }).format(n); }
  function moneyR(n, c) { return n == null ? '' : (c ? c + ' ' : '') + new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(Math.round(n)); }
  function money(n, c) { return n == null ? '' : (c ? c + ' ' : '') + fmt(n); }
  function pct(it) { return (it.price != null && it.was_price != null && it.was_price > it.price) ? Math.round((it.was_price - it.price) / it.was_price * 100) : 0; }
  // When a store blocks reading: guess the product name from the link, e.g. ".../100-leather-bomber-jacket-p06318252.html"
  function titleFromUrl(url) {
    try {
      var segs = new URL(url).pathname.split('/').filter(Boolean).map(function (s) { return decodeURIComponent(s); });
      var best = segs.map(function (s) { return s.replace(/\.(html?|aspx?|php)$/i, '').replace(/[-_]p?\d{5,}$/i, '').replace(/^p?\d{5,}[-_]/i, ''); })
        .filter(function (s) { return /[a-z]/i.test(s) && s.split(/[-_]/).length >= 2 && !/^(en|ar|uk|us|eg|products?|collections?|shop|item|p)$/i.test(s) && !/^[a-z]{2}[-_][a-z]{2}$/i.test(s) && !/^productpage/i.test(s); })
        .sort(function (a, b) { return b.length - a.length; })[0];
      if (!best) return '';
      var words = best.split(/[-_+]+/).filter(Boolean);
      if (/^\d+$/.test(words[0]) && words[1] && /^(cotton|leather|linen|wool|silk|cashmere|polyester|viscose)$/i.test(words[1])) words[0] += '%';
      var t = words.join(' ').toLowerCase();
      return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 120);
    } catch (e) { return ''; }
  }
  function hostBrand(url) { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch (e) { return ''; } }
  function boardName(id) { var b = db.boards.find(function (x) { return x.id === id; }) || (db.shared || []).find(function (x) { return x.id === id; }); return b ? b.name : ''; }
  function persist() { return CLOUD ? true : save(KEY.data(user.id), db); }
  var toastTimer;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600); }

  /* ---------- backend ---------- */
  var CFG = window.STASHD_CONFIG || {};
  var CLOUD = !!(CFG.supabaseUrl && CFG.supabaseKey);
  var sb = null;
  var COLS = ['id', 'user_id', 'board_id', 'url', 'title', 'brand', 'image_url', 'price', 'was_price', 'currency', 'size', 'sizes', 'note', 'sold_out', 'bought', 'in_budget', 'home_price', 'home_currency', 'created_at'];
  function row(it) { var r = {}; COLS.forEach(function (k) { if (it[k] !== undefined) r[k] = it[k]; }); return r; }
  function base() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function syncFail(e) { if (window.console) console.error(e); toast("Couldn't sync. " + ((e && e.message) || 'Check your connection.')); return false; }
  function done(r) { return r.error ? syncFail(r.error) : true; }
  var saveTimers = {};
  var api = {
    saveItem: function (it) { clearTimeout(saveTimers[it.id]); return CLOUD ? sb.from('items').upsert(row(it)).then(done, syncFail) : Promise.resolve(persist()); },
    saveItemSoon: function (it) { clearTimeout(saveTimers[it.id]); if (!CLOUD) return persist(); saveTimers[it.id] = setTimeout(function () { api.saveItem(it); }, 600); },
    deleteItem: function (id) {
      clearTimeout(saveTimers[id]);
      if (!CLOUD) return Promise.resolve(persist());
      // A delete that isn't allowed removes 0 rows without an error, so check what came back.
      return sb.from('items').delete().eq('id', id).select('id').then(function (r) {
        if (r.error) return syncFail(r.error);
        if (!r.data || !r.data.length) { toast('Couldn\'t delete it. Only the person who added it or the board owner can.'); return false; }
        return true;
      }, syncFail);
    },
    saveBoard: function (b) { return CLOUD ? sb.from('boards').upsert({ id: b.id, user_id: b.user_id, name: b.name, created_at: b.created_at, visibility: b.visibility || 'private', link_token: b.link_token || null, in_budget: b.in_budget !== false, budget: b.budget == null ? null : b.budget }).then(done, syncFail) : Promise.resolve(persist()); },
    deleteBoard: function (id) { return CLOUD ? sb.from('boards').delete().eq('id', id).then(done, syncFail) : Promise.resolve(persist()); },
    saveProfile: function () {
      if (!CLOUD) { saveUser(); return Promise.resolve(true); }
      sb.from('profiles').update({ name: user.name, currency: user.currency }).eq('id', user.id).then(function () {});
      return sb.auth.updateUser({ data: { name: user.name, currency: user.currency } }).then(done, syncFail);
    },
    photo: function (it, dataUrl) {
      if (!CLOUD) return Promise.resolve(dataUrl);
      return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) {
        var path = user.id + '/' + it.id + '-' + Date.now() + '.jpg';
        return sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true }).then(function (r) {
          if (r.error) throw r.error;
          return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
        });
      });
    }
  };

  function extractUrl(text) {
    if (!text) return '';
    var m = String(text).match(/https?:\/\/[^\s<>"']+/i);
    if (m) return m[0].replace(/[).,]+$/, '');
    var d = String(text).trim().match(/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i);
    return d ? 'https://' + d[0] : '';
  }

  /* ---------- money: exchange rates + prices in my currency ---------- */
  // Rates: ExchangeRate-API open access (daily, attribution required), backup: fawazahmed0 currency feed. Cached per day on the device.
  var FX_CREDIT = '<a class="fxc" href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a>';
  var fxMem = {};
  async function getRates(base) {
    base = String(base || '').toUpperCase(); if (!base) return null;
    var key = 'stashd:fx:' + base, c = fxMem[base] || load(key, null);
    if (c && Date.now() - c.t < 12 * 3600 * 1000) return (fxMem[base] = c).r;
    try {
      var r = await fetchT('https://open.er-api.com/v6/latest/' + base, 8000), j = await r.json();
      if (j && j.result === 'success' && j.rates) { c = { t: Date.now(), r: j.rates }; fxMem[base] = c; try { localStorage.setItem(key, JSON.stringify(c)); } catch (e) {} return c.r; }
    } catch (e) {}
    try {
      var r2 = await fetchT('https://latest.currency-api.pages.dev/v1/currencies/' + base.toLowerCase() + '.json', 8000), j2 = await r2.json(), m = j2 && j2[base.toLowerCase()];
      if (m) { var out = {}; Object.keys(m).forEach(function (k) { out[k.toUpperCase()] = m[k]; }); c = { t: Date.now(), r: out }; fxMem[base] = c; try { localStorage.setItem(key, JSON.stringify(c)); } catch (e) {} return out; }
    } catch (e) {}
    return c ? c.r : null;
  }
  // Starting currency for a new account, from the phone's time zone / language. People can change it on their profile.
  function defaultCurrency() {
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    var TZ = { 'Africa/Cairo': 'EGP', 'Europe/London': 'GBP', 'Asia/Dubai': 'AED', 'Asia/Riyadh': 'SAR', 'Asia/Kuwait': 'KWD', 'Asia/Qatar': 'QAR' };
    if (TZ[tz]) return TZ[tz];
    if (/^Europe\/(Paris|Berlin|Madrid|Rome|Amsterdam|Brussels|Vienna|Dublin|Lisbon|Helsinki|Athens|Luxembourg)$/.test(tz)) return 'EUR';
    var region = ((navigator.language || '').split('-')[1] || '').toUpperCase();
    var RG = { EG: 'EGP', GB: 'GBP', AE: 'AED', SA: 'SAR', KW: 'KWD', QA: 'QAR', US: 'USD', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR' };
    return RG[region] || (/^America\//.test(tz) ? 'USD' : 'USD');
  }
  function myCurrency() { return (user && user.currency) || defaultCurrency(); }
  function cachedRate(from, to) { var c = fxMem[to] || load('stashd:fx:' + to, null); return c && c.r && c.r[from] ? c.r[from] : null; }
  async function convert(amount, from, to) {
    if (amount == null || !from || !to) return null;
    if (from === to) return amount;
    var r = await getRates(to);
    return r && r[from] ? Math.round(amount / r[from] * 100) / 100 : null;
  }
  // An item's price in my currency (for totals and budgets).
  function homeAmt(it) {
    if (it.price == null) return null;
    var home = myCurrency();
    if (!it.currency || it.currency === home) return +it.price;
    if (it.home_currency === home && it.home_price != null) return +it.home_price;
    var rt = cachedRate(it.currency, home);
    return rt ? Math.round(it.price / rt * 100) / 100 : null;
  }
  function homeSum(items) {
    var sum = 0, missing = 0;
    items.forEach(function (i) { if (i.price == null) return; var a = homeAmt(i); if (a == null) missing++; else sum += a; });
    return { sum: sum, missing: missing };
  }
  // Best guess at a store's currency from its address, for when the page doesn't say.
  function guessCurrency(url) {
    var u; try { u = new URL(url); } catch (e) { return ''; }
    var h = u.hostname.toLowerCase(), path = u.pathname.toLowerCase();
    if (/\.co\.uk$|\.uk$/.test(h) || /^\/(uk|gb|en-gb|en_gb)(\/|$)/.test(path)) return 'GBP';
    if (/\.eg$/.test(h) || /^\/(eg|en-eg|ar-eg)(\/|$)/.test(path)) return 'EGP';
    if (/\.ae$/.test(h) || /^\/(ae|en-ae|ar-ae)(\/|$)/.test(path)) return 'AED';
    if (/\.sa$/.test(h) || /^\/(sa|en-sa|ar-sa)(\/|$)/.test(path)) return 'SAR';
    if (/\.kw$/.test(h)) return 'KWD';
    if (/\.qa$/.test(h)) return 'QAR';
    if (/\.(de|fr|it|es|nl|ie|be|at|pt|fi|gr)$/.test(h) || /^\/(de|fr|it|es|nl|ie|eu)(\/|$)/.test(path)) return 'EUR';
    if (/^\/(us|en-us)(\/|$)/.test(path) || /(^|\.)(sephora|amazon|ulta|nordstrom|target|walmart|macys)\.com$/.test(h)) return 'USD';
    return '';
  }

  function totals(items, fallbackCur) {
    var by = {}, order = [];
    items.forEach(function (i) { if (i.price != null) { var c = i.currency || ''; if (!(c in by)) { by[c] = 0; order.push(c); } by[c] += i.price; } });
    return order.length ? order.map(function (c) { return money(by[c], c); }).join(' + ') : money(0, fallbackCur);
  }

  /* ---------- sheets ---------- */
  function sheet(html, opts) {
    closeSheet();
    var locked = opts && opts.locked;
    var o = document.createElement('div');
    o.className = 'overlay' + (locked ? ' locked' : '');
    o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + (locked ? '' : '<button class="x" type="button" aria-label="Close">×</button>') + html + '</div>';
    document.body.appendChild(o);
    document.body.classList.add('locked');
    if (!locked) o.addEventListener('click', function (e) { if (e.target === o || e.target.closest('.x')) closeSheet(); });
    return o.querySelector('.sheet');
  }
  function askConfirm(message, okLabel) {
    return new Promise(function (resolve) {
      var o = document.createElement('div');
      o.className = 'overlay ask';
      o.innerHTML = '<div class="sheet small" role="alertdialog" aria-modal="true"><p class="askmsg">' + esc(message) + '</p>' +
        '<div class="row"><button class="btn" type="button" data-no>Cancel</button><button class="btn primary danger-bg" type="button" data-yes>' + esc(okLabel || 'Delete') + '</button></div></div>';
      document.body.appendChild(o);
      function done(v) { o.remove(); resolve(v); }
      o.querySelector('[data-yes]').onclick = function () { done(true); };
      o.querySelector('[data-no]').onclick = function () { done(false); };
      o.addEventListener('click', function (e) { if (e.target === o) done(false); });
      setTimeout(function () { o.querySelector('[data-yes]').focus(); }, 50);
    });
  }
  function closeSheet() { document.querySelectorAll('.overlay').forEach(function (o) { o.remove(); }); document.body.classList.remove('locked'); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.querySelector('.overlay.locked')) closeSheet(); });
  // Broken product photos: fall back to the plain colour block.
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG') { var p = t.parentNode; t.remove(); if (p && p.classList) p.classList.add('none'); }
  }, true);

  /* ---------- accounts ---------- */
  async function hash(pw, salt) {
    var data = new TextEncoder().encode(salt + ':' + pw);
    if (window.crypto && crypto.subtle) {
      var buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    }
    var h = 0; for (var i = 0; i < data.length; i++) h = (h * 31 + data[i]) | 0; return 'w' + h;
  }

  function subscribeBrevo(email) {
    // Posts into a hidden frame so the page doesn't navigate away.
    var f = document.getElementById('brevoFrame');
    if (!f) { f = document.createElement('iframe'); f.name = f.id = 'brevoFrame'; f.hidden = true; f.title = 'Newsletter sign-up'; document.body.appendChild(f); }
    var form = document.createElement('form');
    form.method = 'POST'; form.action = BREVO_FORM; form.target = 'brevoFrame'; form.hidden = true;
    [['EMAIL', email], ['email_address_check', ''], ['locale', 'en']].forEach(function (p) {
      var i = document.createElement('input'); i.type = 'hidden'; i.name = p[0]; i.value = p[1]; form.appendChild(i);
    });
    document.body.appendChild(form); form.submit(); form.remove();
  }

  function hasPending() { try { return !!sessionStorage.getItem(KEY.pending); } catch (e) { return false; } }
  function takePending() { try { var v = sessionStorage.getItem(KEY.pending); sessionStorage.removeItem(KEY.pending); return v; } catch (e) { return ''; } }
  function takePendingData() {
    try { var v = sessionStorage.getItem('stashd:pendingData'); sessionStorage.removeItem('stashd:pendingData'); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  /* Details sent by the iPhone Shortcut, read from the page in the user's own Safari (shortcut.js). */
  var CUR_SIGNS = [[/£/, 'GBP'], [/€/, 'EUR'], [/US\$|\$/, 'USD'], [/EGP|L\.?E\b|ج\.?م/i, 'EGP'], [/SAR|ر\.?س/i, 'SAR'], [/AED|د\.?إ/i, 'AED'], [/KWD|د\.?ك/i, 'KWD'], [/QAR|ر\.?ق/i, 'QAR']];
  function amount(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[^\d.,]/g, '');
    if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
    var n = parseFloat(s); return isFinite(n) && n > 0 ? n : null;
  }
  function currencyIn(s) { for (var i = 0; i < CUR_SIGNS.length; i++) if (CUR_SIGNS[i][0].test(s || '')) return CUR_SIGNS[i][1]; return ''; }
  function fromShortcut(d) {
    if (!d || typeof d !== 'object') return null;
    var base = extractUrl(d.u) || '';
    var out = {
      ok: !!(d.t && String(d.t).trim()), viaShortcut: true,
      title: String(d.t || '').replace(/\s*[|–-]\s*(zara|h&m|mango)[^|–-]*$/i, '').trim().slice(0, 140),
      brand: String(d.b || '').trim().slice(0, 60),
      image_url: absUrl(d.i, base),
      price: amount(d.p) != null ? amount(d.p) : amount(d.pt),
      was_price: amount(d.wt),
      currency: String(d.c || currencyIn(d.pt) || currencyIn(d.wt) || '').toUpperCase().slice(0, 3),
      sold_out: d.s === true
    };
    if (out.was_price != null && (out.price == null || out.was_price <= out.price)) out.was_price = null;
    return out;
  }

  /* ---- validation ---- */
  var EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
  var COMMON_PW = ['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop', '11111111', '00000000',
    'abc12345', 'abcd1234', 'iloveyou', 'iloveyou1', 'letmein1', 'welcome1', 'admin123', 'football1', 'princess1', 'sunshine1', 'monkey123',
    '1q2w3e4r', 'q1w2e3r4', 'passw0rd', 'p@ssw0rd', 'stashd123', 'stashd2026', 'egypt123', 'cairo123', 'shopping1'];
  var POPULAR_DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'me.com', 'msn.com'];
  function editDist(a, b) {
    var d = []; for (var i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (var j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function emailSuggestion(email) {
    var at = email.lastIndexOf('@'); if (at < 1) return '';
    var dom = email.slice(at + 1);
    if (!dom || POPULAR_DOMAINS.indexOf(dom) >= 0) return '';
    var best = '', bestD = 3;
    POPULAR_DOMAINS.forEach(function (p) { var dd = editDist(dom, p); if (dd < bestD) { bestD = dd; best = p; } });
    return best && bestD <= 2 ? email.slice(0, at + 1) + best : '';
  }
  function pwChecks(pw, email) {
    var low = pw.toLowerCase(), local = (email.split('@')[0] || '').toLowerCase();
    return {
      len: pw.length >= 8 && pw.length <= 72,
      mix: /[a-z]/i.test(pw) && /\d/.test(pw),
      safe: pw.length > 0 && COMMON_PW.indexOf(low) < 0 && !(local.length >= 3 && low.indexOf(local) >= 0) && !/^(.)\1+$/.test(pw)
    };
  }
  function pwStrength(pw) {
    var s = 0;
    if (pw.length >= 8) s++; if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s <= 2 ? 1 : s === 3 ? 2 : 3;
  }

  var GOOGLE_SVG = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  var APPLE_SVG = '<svg width="17" height="20" viewBox="0 0 17 20" aria-hidden="true"><path fill="currentColor" d="M14.2 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.7 4.8 2 5.8 1.1 7.4c-1.9 3.2-.5 8 1.3 10.6.9 1.3 2 2.7 3.3 2.6 1.3-.1 1.8-.8 3.4-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.4zM11.6 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>';

  function providers() { var p = CFG.providers || {}; return CLOUD ? ['google', 'apple'].filter(function (k) { return p[k]; }) : []; }

  function renderAuth(mode, note, prefill) {
    mode = mode || (!CLOUD && Object.keys(load(KEY.users, {})).length ? 'signin' : 'signup');
    var up = mode === 'signup', prov = providers();
    document.body.classList.remove('tabs');
    document.title = 'Stashd · ' + (up ? 'Create account' : 'Sign in');
    app.innerHTML =
      '<main class="auth">' +
        '<h1 class="wm">Stash<span>d</span></h1>' +
        '<p class="tagline">Like it. Stash it. Buy it.</p>' +
        '<ul class="perks"><li>Save from any store or ad</li><li>Sort it into boards</li><li>Mark what you bought</li></ul>' +
        (note ? '<p class="notice">' + esc(note) + '</p>' : hasPending() ? '<p class="notice">Sign in to stash the link you just shared.</p>' : '') +
        '<div class="seg" role="tablist">' +
          '<button type="button" role="tab" data-mode="signup" aria-selected="' + up + '">Create account</button>' +
          '<button type="button" role="tab" data-mode="signin" aria-selected="' + !up + '">Sign in</button>' +
        '</div>' +
        (prov.length ? '<div class="oauth">' +
          (prov.indexOf('apple') >= 0 ? '<button class="btn block apple" type="button" data-oauth="apple">' + APPLE_SVG + (up ? 'Sign up' : 'Sign in') + ' with Apple</button>' : '') +
          (prov.indexOf('google') >= 0 ? '<button class="btn block google" type="button" data-oauth="google">' + GOOGLE_SVG + (up ? 'Sign up' : 'Sign in') + ' with Google</button>' : '') +
          '</div><p class="divider"><span>or with email</span></p>' : '') +
        '<form id="authForm" novalidate>' +
          (up && !CLOUD ? '<label class="field"><span>Name</span><input type="text" name="name" autocomplete="given-name" autocapitalize="words" maxlength="50" enterkeyhint="next" aria-describedby="nameErr" required><small class="ferr" id="nameErr"></small></label>' : '') +
          '<label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="254" enterkeyhint="next" aria-describedby="emailErr" required value="' + esc(prefill || '') + '"><small class="ferr" id="emailErr"></small></label>' +
          '<label class="field"><span>Password</span><span class="pw"><input type="password" name="password" maxlength="72" autocomplete="' + (up ? 'new-password' : 'current-password') + '" enterkeyhint="go" aria-describedby="pwErr' + (up ? ' pwRules' : '') + '" required>' +
            '<button type="button" class="show" aria-label="Show password" aria-pressed="false">Show</button></span><small class="ferr" id="pwErr"></small></label>' +
          (up ? '<div class="meter" aria-hidden="true"><i></i><i></i><i></i></div>' +
            '<ul class="rules" id="pwRules" aria-live="polite">' +
              '<li data-rule="len">At least 8 characters</li><li data-rule="mix">Letters and at least one number</li><li data-rule="safe">Not too easy to guess</li></ul>' : '') +
          (up ? '<label class="check"><input type="checkbox" name="news"><span>Email me Stashd news and launch updates (optional). Unsubscribe any time.</span></label>' : '') +
          '<p class="err" id="authErr" role="alert"></p>' +
          '<div id="authActions"></div>' +
          '<button class="btn primary block" type="submit">' + (up ? 'Create account' : 'Sign in') + '</button>' +
          (CLOUD && !up ? '<p style="text-align:center;margin-top:.75rem"><button class="link" type="button" id="forgotBtn">Forgot your password?</button></p>' : '') +
          (up ? '<p class="fine" style="margin-top:.9rem">By creating an account, you agree to our <a href="privacy.html">privacy policy</a>.</p>' : '') +
        '</form>' +
        '<p class="fine">' + (CLOUD ? 'Your stash is saved to your account, so it\'s there on any device you sign in on.' : 'Test version: your account and stash are saved in this browser, on this device only.') + ' <a href="privacy.html">Privacy</a></p>' +
      '</main>';

    app.querySelectorAll('[data-mode]').forEach(function (b) {
      b.onclick = function () { renderAuth(b.dataset.mode, '', String(new FormData(document.getElementById('authForm')).get('email') || '').trim()); };
    });
    app.querySelectorAll('[data-oauth]').forEach(function (b) { b.onclick = function () { oauth(b.dataset.oauth, b); }; });

    var form = document.getElementById('authForm'), err = document.getElementById('authErr');
    var f = { name: form.elements.name, email: form.elements.email, pw: form.elements.password };
    var touched = {};
    function setErr(input, id, msg) {
      var el = document.getElementById(id);
      el.innerHTML = msg || '';
      if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      return !msg;
    }
    function checkName() {
      if (!f.name) return true;
      var v = f.name.value.trim();
      return setErr(f.name, 'nameErr', !v ? 'Add your name.' : !/\p{L}/u.test(v) ? 'Use letters in your name.' : '');
    }
    function checkEmail(final) {
      var v = f.email.value.trim().toLowerCase();
      if (!v) return setErr(f.email, 'emailErr', 'Add your email.');
      if (!EMAIL_RE.test(v)) return setErr(f.email, 'emailErr', 'That email doesn\'t look right. Check for typos.');
      var sug = up && final !== 'quiet' ? emailSuggestion(v) : '';
      setErr(f.email, 'emailErr', '');
      if (sug) { document.getElementById('emailErr').innerHTML = '<span class="sug">Did you mean <button type="button" class="link" id="sugBtn">' + esc(sug) + '</button>?</span>'; document.getElementById('sugBtn').onclick = function () { f.email.value = sug; checkEmail(); }; }
      return true;
    }
    function checkPw() {
      var pw = f.pw.value;
      if (!up) return setErr(f.pw, 'pwErr', pw ? '' : 'Add your password.');
      var c = pwChecks(pw, f.email.value.trim());
      app.querySelectorAll('[data-rule]').forEach(function (li) { li.classList.toggle('ok', !!c[li.dataset.rule]); });
      var m = app.querySelector('.meter'); m.dataset.level = pw ? (c.len && c.mix && c.safe ? pwStrength(pw) : 1) : 0;
      if (!pw) return setErr(f.pw, 'pwErr', 'Choose a password.');
      if (pw.length > 72) return setErr(f.pw, 'pwErr', 'Keep it under 72 characters.');
      return setErr(f.pw, 'pwErr', c.len && c.mix && c.safe ? '' : 'Your password needs to tick all three boxes below.');
    }
    [['name', checkName], ['email', checkEmail], ['pw', checkPw]].forEach(function (p) {
      var el = f[p[0]]; if (!el) return;
      el.addEventListener('blur', function () { if (el.value) { touched[p[0]] = true; p[1](); } });
      el.addEventListener('input', function () {
        if (p[0] === 'pw' && up) { var keep = touched.pw; checkPw(); if (!keep) setErr(f.pw, 'pwErr', ''); }
        else if (touched[p[0]]) p[1]('quiet');
        err.textContent = ''; document.getElementById('authActions').innerHTML = '';
      });
    });
    var show = form.querySelector('.show');
    show.onclick = function () {
      var on = f.pw.type === 'password'; f.pw.type = on ? 'text' : 'password';
      show.textContent = on ? 'Hide' : 'Show'; show.setAttribute('aria-pressed', on); show.setAttribute('aria-label', on ? 'Hide password' : 'Show password');
    };

    form.onsubmit = async function (e) {
      e.preventDefault();
      touched = { name: true, email: true, pw: true };
      var btn0 = form.querySelector('[type=submit]');
      var ok = [checkName(), checkEmail('quiet'), checkPw()];
      if (ok.indexOf(false) >= 0) { var bad = form.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
      var email = f.email.value.trim().toLowerCase(), pw = f.pw.value, name = f.name ? f.name.value.trim().replace(/\s+/g, ' ') : '';
      var news = !!(form.elements.news && form.elements.news.checked);
      if (CLOUD) return cloudAuth(up, name, email, pw, news, err, btn0);
      var users = load(KEY.users, {});
      if (up) {
        if (users[email]) return (err.textContent = 'There\'s already an account with that email on this device. Sign in instead.');
        var salt = uid();
        users[email] = { id: uid(), name: name, email: email, salt: salt, hash: await hash(pw, salt), currency: defaultCurrency(), created_at: new Date().toISOString() };
        if (!save(KEY.users, users)) return;
        if (news) subscribeBrevo(email);
        signIn(users[email], 'Welcome to Stashd, ' + name + '!');
      } else {
        var u = users[email];
        if (!u || u.hash !== await hash(pw, u.salt)) return (err.textContent = 'Email or password is wrong. (Accounts only exist on the device you created them on.)');
        signIn(u, 'Welcome back, ' + u.name + '!');
      }
    };
    var fb = document.getElementById('forgotBtn');
    if (fb) fb.onclick = async function () {
      touched.email = true;
      if (!checkEmail('quiet')) { f.email.focus(); return (err.textContent = 'Type your email above first, then tap Forgot your password.'); }
      fb.disabled = true;
      var r = await sb.auth.resetPasswordForEmail(f.email.value.trim().toLowerCase(), { redirectTo: base() });
      fb.disabled = false;
      if (r.error) return (err.textContent = friendly(r.error));
      renderInbox(f.email.value.trim().toLowerCase(), 'reset');
    };
  }

  function renderInbox(email, kind) {
    var reset = kind === 'reset';
    app.innerHTML = '<main class="auth"><h1 class="wm">Stash<span>d</span></h1>' +
      '<h2 class="inbox-h">Check your inbox</h2>' +
      '<p>We sent a link to <b>' + esc(email) + '</b>. Tap it to ' + (reset ? 'set a new password' : 'confirm your email and start stashing') + '.</p>' +
      '<p class="muted" style="margin-top:.6rem">Can\'t find it? Look in Spam or Junk. It can take a minute.</p>' +
      '<div class="stack"><button class="btn block" type="button" id="resendBtn">Send it again</button>' +
      '<button class="btn primary block" type="button" id="toSignIn">Back to sign in</button>' +
      '<button class="link" type="button" id="otherEmail">Use a different email</button></div>' +
      '<p class="err" id="inboxErr" role="alert" style="margin-top:.75rem"></p></main>';
    var rb = document.getElementById('resendBtn'), ie = document.getElementById('inboxErr');
    function cooldown(s) {
      rb.disabled = true; rb.textContent = 'Send it again (' + s + 's)';
      var t = setInterval(function () { s--; if (s <= 0) { clearInterval(t); rb.disabled = false; rb.textContent = 'Send it again'; } else rb.textContent = 'Send it again (' + s + 's)'; }, 1000);
    }
    cooldown(60);
    rb.onclick = async function () {
      var r = reset ? await sb.auth.resetPasswordForEmail(email, { redirectTo: base() })
        : await sb.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: base() } });
      if (r.error) { ie.textContent = friendly(r.error); return; }
      ie.textContent = ''; toast('Sent again'); cooldown(60);
    };
    document.getElementById('toSignIn').onclick = function () { renderAuth('signin', '', email); };
    document.getElementById('otherEmail').onclick = function () { renderAuth(reset ? 'signin' : 'signup'); };
  }

  async function oauth(provider, btn) {
    btn.disabled = true;
    var r = await sb.auth.signInWithOAuth({ provider: provider, options: { redirectTo: base() } });
    if (r.error) { btn.disabled = false; document.getElementById('authErr').textContent = friendly(r.error); }
  }

  function friendly(e) {
    var m = (e && e.message) || '', code = (e && e.code) || '';
    if (/invalid login|invalid_credentials/i.test(m + code)) return 'Email or password is wrong.';
    if (/not confirmed|email_not_confirmed/i.test(m + code)) return 'Confirm your email first. The link is in your inbox.';
    if (/already registered|already exists|user_already_exists/i.test(m + code)) return 'There\'s already an account with that email. Sign in instead.';
    if (/weak_password|password should/i.test(m + code)) return 'That password is too weak. Use at least 8 characters with letters and a number.';
    if (/rate limit|too many|over_email_send_rate_limit|over_request_rate_limit/i.test(m + code)) return 'Too many tries. Wait a few minutes and try again.';
    if (/provider is not enabled|unsupported provider/i.test(m)) return 'That sign-in option isn\'t switched on yet.';
    if (/fetch|network/i.test(m)) return 'Can\'t reach Stashd. Check your connection.';
    return m || 'Something went wrong. Try again.';
  }

  async function cloudAuth(up, name, email, pw, news, err, btn) {
    btn.disabled = true; err.textContent = '';
    var label = btn.textContent; btn.textContent = up ? 'Creating account…' : 'Signing in…';
    var actions = document.getElementById('authActions');
    try {
      if (up) {
        var r = await sb.auth.signUp({ email: email, password: pw, options: { data: { currency: defaultCurrency() }, emailRedirectTo: base() } });
        if (r.error) { err.textContent = friendly(r.error); return; }
        // Supabase hides whether an email is taken: an existing account comes back with no identities.
        if (r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0) {
          err.textContent = 'There\'s already a Stashd account with this email.';
          actions.innerHTML = '<div class="row" style="margin-bottom:.75rem"><button class="btn" type="button" id="goSignIn">Sign in</button><button class="btn" type="button" id="goReset">Reset password</button></div>';
          document.getElementById('goSignIn').onclick = function () { renderAuth('signin', '', email); };
          document.getElementById('goReset').onclick = async function () {
            var x = await sb.auth.resetPasswordForEmail(email, { redirectTo: base() });
            if (x.error) err.textContent = friendly(x.error); else renderInbox(email, 'reset');
          };
          return;
        }
        if (news) subscribeBrevo(email);
        if (r.data.session) return startCloud(r.data.session.user, '');
        renderInbox(email, 'signup');
      } else {
        var s = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (s.error) {
          err.textContent = friendly(s.error);
          if (/not confirmed|email_not_confirmed/i.test(s.error.message + (s.error.code || ''))) {
            actions.innerHTML = '<button class="btn block" type="button" id="resendC" style="margin-bottom:.75rem">Resend confirmation email</button>';
            document.getElementById('resendC').onclick = async function () {
              var x = await sb.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: base() } });
              if (x.error) err.textContent = friendly(x.error); else renderInbox(email, 'signup');
            };
          }
          return;
        }
        startCloud(s.data.user, 'Welcome back!');
      }
    } catch (e) { err.textContent = friendly(e); }
    finally { if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = label; } }
  }

  var noteList = [];
  async function loadNotes() {
    if (!CLOUD || !sb) return;
    var r = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
    noteList = r.error ? [] : r.data;
    var b = document.getElementById('bellBtn'); if (b) b.outerHTML = bellHtml(); bindBell();
  }
  function bellHtml() {
    var n = noteList.filter(function (x) { return !x.read_at; }).length;
    return '<button class="icon soft bell" type="button" id="bellBtn" aria-label="Notifications' + (n ? ', ' + n + ' new' : '') + '">' + BELL_SVG + (n ? '<span class="badge">' + (n > 9 ? '9+' : n) + '</span>' : '') + '</button>';
  }
  function bindBell() { var b = document.getElementById('bellBtn'); if (b) b.onclick = openNotes; }
  async function openNotes() {
    var KIND = { price_drop: ['↓', 'Price dropped'], price_up: ['↑', 'Price went up'], back_in_stock: ['✓', 'Back in stock'], sold_out: ['×', 'Sold out'] };
    var s = sheet('<h2>Notifications</h2>' + (noteList.length ? '<div class="noteList">' + noteList.map(function (n) {
      var k = KIND[n.kind] || ['•', n.kind];
      return '<button class="note' + (n.read_at ? '' : ' unread') + ' k-' + esc(n.kind) + '" type="button" data-note="' + esc(n.item_id || '') + '"><span class="nic">' + k[0] + '</span><span><b>' + k[1] + '</b> · ' + esc(n.title || 'An item') +
        '<small>' + (n.kind === 'price_drop' || n.kind === 'price_up' ? esc(money(n.new_price, n.currency)) + ' <s>' + esc(fmt(n.old_price)) + '</s> · ' : '') + esc(ago(n.created_at)) + '</small></span></button>';
    }).join('') + '</div><div class="stack"><button class="link" type="button" id="clearNotes">Clear all</button></div>'
      : '<div class="empty" style="padding:1.5rem 0"><p>No notifications yet. We check your items about once a day and tell you here when a price drops or something is back in stock.</p></div>'));
    s.querySelectorAll('[data-note]').forEach(function (b) { b.onclick = function () { var id = b.dataset.note; closeSheet(); if (id && db.items.some(function (i) { return i.id === id; })) openItem(id); }; });
    var cl = s.querySelector('#clearNotes');
    if (cl) cl.onclick = async function () { await sb.from('notifications').delete().eq('user_id', user.id); noteList = []; closeSheet(); renderHome(); };
    if (noteList.some(function (n) { return !n.read_at; })) {
      var now = new Date().toISOString();
      await sb.from('notifications').update({ read_at: now }).eq('user_id', user.id).is('read_at', null);
      noteList.forEach(function (n) { n.read_at = n.read_at || now; });
      var b = document.getElementById('bellBtn'); if (b) { b.outerHTML = bellHtml(); bindBell(); }
    }
  }
  async function startCloud(au, msg) {
    var md = au.user_metadata || {};
    user = { id: au.id, email: au.email, name: md.name || md.full_name || md.given_name || (au.email || '').split('@')[0], currency: String(md.currency || '').toUpperCase() || defaultCurrency() };
    app.innerHTML = '<p class="boot loading" style="justify-content:center">Loading your stash…</p>';
    var BCOLS = 'id,user_id,name,visibility,link_token,in_budget,budget,save_count,created_at';
    var res = await Promise.all([
      sb.from('boards').select(BCOLS).eq('user_id', au.id).order('created_at'),
      sb.from('profiles').select('username,name,currency').eq('id', au.id).maybeSingle(),
      sb.from('board_members').select('role,b:boards(' + BCOLS + ')').eq('user_id', au.id)
    ]).catch(function (e) { return [{ error: e }, {}, {}]; });
    var ownIds = (res[0].data || []).map(function (b) { return b.id; });
    var itemsRes = res[0].error ? {} : await sb.from('items').select('*')
      .or('user_id.eq.' + au.id + (ownIds.length ? ',board_id.in.(' + ownIds.join(',') + ')' : '')).order('created_at', { ascending: false });
    if (res[0].error || itemsRes.error) {
      var e = res[0].error || itemsRes.error;
      app.innerHTML = '<div class="empty"><h2>Couldn\'t load your stash</h2><p>' + esc(friendly(e)) + '</p><button class="btn primary" id="retry" type="button">Try again</button></div>';
      document.getElementById('retry').onclick = function () { startCloud(au, msg); };
      return;
    }
    if (res[1].data) { user.username = res[1].data.username || ''; if (res[1].data.name) user.name = res[1].data.name; if (res[1].data.currency) user.currency = res[1].data.currency; }
    if (res[1].data && !res[1].data.currency) sb.from('profiles').update({ currency: user.currency }).eq('id', au.id).then(function () {});
    var shared = (res[2].data || []).filter(function (m) { return m.b; }).map(function (m) { return Object.assign({}, m.b, { role: m.role }); });
    if (shared.length) {
      var owners = await sb.from('profiles').select('id,username,name').in('id', shared.map(function (b) { return b.user_id; }));
      shared.forEach(function (b) { b.owner = (owners.data || []).find(function (o) { return o.id === b.user_id; }) || null; });
    }
    db = { boards: res[0].data, items: itemsRes.data, shared: shared };
    cache = {};
    if (!db.boards.length) {
      var seed = [newBoard('Outfits', 0), newBoard('Gifts', 1)];
      var ins = await sb.from('boards').insert(seed).select(BCOLS);
      db.boards = ins.error ? [] : ins.data;
    }
    loadNotes(); await loadSaved();
    afterSignIn(msg);
    ensureUsername();
  }

  function localStashes() {
    if (load('stashd:imported', false)) return [];
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('stashd:data:') === 0) { var d = load(k, null); if (d && d.items && d.items.length) out.push(d); }
      }
    } catch (e) {}
    return out;
  }

  async function importLocal(btn) {
    btn.disabled = true; btn.textContent = 'Moving your items…';
    var stashes = localStashes(), moved = 0;
    for (var s = 0; s < stashes.length; s++) {
      var d = stashes[s], map = {};
      for (var b = 0; b < d.boards.length; b++) {
        var lb = d.boards[b], found = db.boards.find(function (x) { return x.name.toLowerCase() === lb.name.toLowerCase(); });
        if (!found) { found = newBoard(lb.name); if (await api.saveBoard(found)) db.boards.push(found); else continue; }
        map[lb.id] = found.id;
      }
      for (var i = 0; i < d.items.length; i++) {
        var it = Object.assign({}, d.items[i], { id: uid(), user_id: user.id, board_id: map[d.items[i].board_id] || null });
        if (/^data:image\//.test(it.image_url || '')) { try { it.image_url = await api.photo(it, it.image_url); } catch (e) { it.image_url = ''; } }
        if (await api.saveItem(it)) { db.items.push(it); moved++; }
      }
    }
    save('stashd:imported', true);
    renderHome(); toast(moved ? 'Moved ' + moved + ' item' + (moved === 1 ? '' : 's') + ' to your account' : 'Nothing was moved');
  }

  function openNewPassword() {
    var s = sheet('<h2>Set a new password</h2><form id="pwForm" novalidate><label class="field"><span>New password</span><input type="password" name="pw" minlength="6" autocomplete="new-password" required></label>' +
      '<p class="err" id="pwErr"></p><button class="btn primary block" type="submit">Save password</button></form>');
    s.querySelector('#pwForm').onsubmit = async function (e) {
      e.preventDefault();
      var pw = s.querySelector('[name=pw]').value;
      if (pw.length < 6) return (s.querySelector('#pwErr').textContent = 'Use at least 6 characters.');
      var r = await sb.auth.updateUser({ password: pw });
      if (r.error) return (s.querySelector('#pwErr').textContent = friendly(r.error));
      closeSheet(); toast('Password updated');
    };
  }

  function signIn(u, msg) {
    user = u; save(KEY.session, u.id);
    db = load(KEY.data(u.id), null);
    if (!db) { db = { boards: [newBoard('Outfits', 0), newBoard('Gifts', 1)], items: [] }; persist(); }
    afterSignIn(msg);
  }
  function afterSignIn(msg) {
    ui = { board: 'all', tab: 'tobuy' };
    route();
    if (db.items.some(function (i) { return i.currency && i.currency !== user.currency; }))
      getRates(user.currency).then(function () { if (!document.querySelector('.overlay') && document.querySelector('.home .chips')) renderHome(); });
    var p = takePending(), pre = takePendingData();
    if (p) openSave(p, pre); else if (msg) toast(msg);
  }
  async function signOut() {
    if (CLOUD) { try { await sb.auth.signOut(); } catch (e) {} }
    else { try { localStorage.removeItem(KEY.session); } catch (e) {} }
    user = db = null; cache = {}; closeSheet(); history.replaceState(null, '', location.pathname); renderAuth('signin');
  }
  function saveUser() { var users = load(KEY.users, {}); users[user.email] = user; save(KEY.users, users); }
  function newBoard(name, n) { return { id: uid(), user_id: user.id, name: name, visibility: 'private', link_token: null, in_budget: true, created_at: new Date(Date.now() + (n || 0)).toISOString() }; }

  /* ---------- home ---------- */
  function droppedRecently(it) {
    return it.prev_price != null && it.price != null && +it.price < +it.prev_price && !it.bought &&
      it.price_changed_at && Date.now() - new Date(it.price_changed_at).getTime() < 14 * 864e5;
  }
  function ago(iso) {
    if (!iso) return '';
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 2 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  }
  // Re-check one item's price and stock on the store (cloud only). Resolves to { status, item, changes } or null.
  async function refreshItem(it) {
    if (!CLOUD || !sb || !it.url) return null;
    try {
      var r = await Promise.race([sb.functions.invoke('read-link', { body: { action: 'refresh', item_id: it.id } }), new Promise(function (res) { setTimeout(function () { res(null); }, 15000); })]);
      if (!r || r.error || !r.data || !r.data.ok) return null;
      ['price', 'was_price', 'currency', 'sold_out', 'home_price', 'home_currency', 'prev_price', 'price_changed_at', 'last_checked_at', 'check_status'].forEach(function (k) { if (k in r.data.item) it[k] = r.data.item[k]; });
      return r.data;
    } catch (e) { return null; }
  }
  function changeText(c, cur) {
    return c.kind === 'price_drop' ? 'Price dropped to ' + money(c.new_price, cur) + ' (was ' + fmt(c.old_price) + ')'
      : c.kind === 'price_up' ? 'Price went up to ' + money(c.new_price, cur) + ' (was ' + fmt(c.old_price) + ')'
      : c.kind === 'back_in_stock' ? 'Back in stock!' : 'Now sold out';
  }
  function tagsHtml(it, inline) {
    var p = pct(it), s = (it.sold_out ? '<span class="t sold">Sold out</span>' : '') + (p ? '<span class="t off">−' + p + '%</span>' : '') +
      (droppedRecently(it) ? '<span class="t drop">↓ Price dropped</span>' : '');
    return s ? '<div class="tags' + (inline ? ' inline' : '') + '">' + s + '</div>' : '';
  }
  function letter(it) { return '<span class="letter" aria-hidden="true">' + esc((it.brand || it.title || '?').charAt(0).toUpperCase()) + '</span>'; }

  /* ---------- boards ---------- */
  function boardChips(it) {
    var opts = db.boards.concat((db.shared || []).filter(function (b) { return b.role === 'editor'; }));
    return '<div class="chips wrap" data-role="boards">' + opts.map(function (b) {
      return '<button class="chip" type="button" data-pick-board="' + esc(b.id) + '" aria-pressed="' + (it.board_id === b.id) + '">' + esc(b.name) + '</button>';
    }).join('') + '<button class="chip ghost" type="button" data-new-board>+ New</button></div>';
  }
  function bindBoardChips(root, it, onChange) {
    root.querySelectorAll('[data-pick-board]').forEach(function (c) {
      c.onclick = function () {
        it.board_id = it.board_id === c.dataset.pickBoard ? null : c.dataset.pickBoard;
        root.querySelectorAll('[data-pick-board]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.pickBoard === it.board_id); });
        onChange();
      };
    });
    var nb = root.querySelector('[data-new-board]');
    if (nb) nb.onclick = function () { promptBoard(function (b) { it.board_id = b.id; var wrap = root.querySelector('[data-role=boards]'); wrap.outerHTML = boardChips(it); bindBoardChips(root, it, onChange); onChange(); }, nb); };
  }

  /* ---------- size / details ---------- */
  function sizeHtml(it) {
    if (it.sizes && it.sizes.length) {
      return '<h3>Size</h3><div class="chips wrap">' + it.sizes.map(function (s) {
        return '<button class="chip" type="button" data-size="' + esc(s) + '" aria-pressed="' + (it.size === s) + '">' + esc(s) + '</button>';
      }).join('') + '</div>';
    }
    return '<label class="field" style="margin-top:1rem"><span>Size (optional)</span><input type="text" data-f="size" value="' + esc(it.size) + '" maxlength="20" placeholder="e.g. 36, M, One size"></label>';
  }
  function bindSize(root, it, onChange) {
    root.querySelectorAll('[data-size]').forEach(function (c) {
      c.onclick = function () {
        it.size = it.size === c.dataset.size ? '' : c.dataset.size;
        root.querySelectorAll('[data-size]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.size === it.size); });
        onChange();
      };
    });
  }

  function priceHtml(it) {
    var home = myCurrency();
    var curOpts = CURRENCIES.indexOf(it.currency) < 0 && it.currency ? [it.currency].concat(CURRENCIES) : CURRENCIES;
    return '<div class="pricebox">' +
      '<div class="pr3"><label class="field"><span>Price</span><input type="text" inputmode="decimal" data-f="price" value="' + (it.price == null ? '' : it.price) + '" placeholder="0"></label>' +
      '<label class="field"><span>Currency</span><select data-f="currency">' + curOpts.map(function (c) { return '<option' + (c === it.currency ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Old price</span><input type="text" inputmode="decimal" data-f="was_price" value="' + (it.was_price == null ? '' : it.was_price) + '" placeholder="If on sale"></label></div>' +
      '<div class="conv" data-conv' + (it.currency && it.currency !== home ? '' : ' hidden') + '>' +
        '<label class="field"><span>In ' + esc(home) + ' (your currency)</span><input type="text" inputmode="decimal" data-home value="' + (it.home_price == null ? '' : it.home_price) + '" placeholder="Converting…"></label>' +
        '<small class="muted" data-convnote></small></div>' +
    '</div>';
  }
  // Keeps the converted price in step with price/currency unless the user typed it in themselves.
  function bindPrice(root, it, onChange) {
    var home = myCurrency(), box = root.querySelector('[data-conv]'), input = root.querySelector('[data-home]'), note = root.querySelector('[data-convnote]');
    if (!box) return function () {};
    var manual = false, seq = 0;
    input.addEventListener('input', function () { manual = true; it.home_price = num(input.value); it.home_currency = home; note.textContent = 'Typed in by you.'; onChange('home_price'); });
    async function sync() {
      var foreign = it.currency && it.currency !== home;
      box.hidden = !foreign;
      if (!foreign) { it.home_price = it.price; it.home_currency = home; return; }
      if (manual || it.price == null) return;
      var my = ++seq; note.textContent = 'Converting…';
      var v = await convert(it.price, it.currency, home);
      if (my !== seq) return;
      if (v == null) { note.textContent = 'Couldn\'t get today\'s rate. Type the price in ' + home + ' if you know it.'; return; }
      it.home_price = v; it.home_currency = home; input.value = v;
      note.innerHTML = '1 ' + esc(it.currency) + ' ≈ ' + esc(fmt(Math.round(v / it.price * 100) / 100)) + ' ' + esc(home) + ' today · ' + FX_CREDIT;
      onChange('home_price');
    }
    if (it.home_price == null || it.home_currency !== home) sync();
    else note.innerHTML = 'Saved at about ' + esc(fmt(Math.round(it.home_price / (it.price || 1) * 100) / 100)) + ' ' + esc(home) + ' per ' + esc(it.currency) + ' · ' + FX_CREDIT;
    return function (f) { if (f === 'price' || f === 'currency') { manual = false; sync(); } };
  }

  function detailsHtml(it, open) {
    return '<details class="edit"' + (open ? ' open' : '') + '><summary>Edit details</summary>' +
      '<label class="field"><span>Title</span><input type="text" data-f="title" value="' + esc(it.title) + '" maxlength="140"></label>' +
      '<label class="field"><span>Store</span><input type="text" data-f="brand" value="' + esc(it.brand) + '" maxlength="60"></label>' +
      '<label class="field"><span>Photo</span><input type="file" accept="image/*" data-photo></label>' +
      '<label class="field"><span>Link</span><input type="url" data-f="url" value="' + esc(it.url) + '" inputmode="url"></label>' +
    '</details>';
  }
  function bindFields(root, it, onChange) {
    root.querySelectorAll('[data-f]').forEach(function (el) {
      var f = el.dataset.f;
      var handler = function () {
        var v = el.value;
        if (f === 'price' || f === 'was_price') it[f] = num(v);
        else if (f === 'url') it.url = extractUrl(v) || v.trim();
        else it[f] = v.trim();
        onChange(f);
      };
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', handler);
    });
    var ph = root.querySelector('[data-photo]');
    if (ph) ph.onchange = function () { var file = ph.files && ph.files[0]; if (file) { toast('Adding photo…'); shrinkPhoto(file).then(function (d) { return api.photo(it, d); }).then(function (u) { it.image_url = u; onChange('image_url'); }).catch(function () { toast("Couldn't add that photo."); }); } };
  }
  function shrinkPhoto(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onerror = rej;
      r.onload = function () {
        var img = new Image();
        img.onerror = rej;
        img.onload = function () {
          var max = 800, sc = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.78));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function convLine(it) {
    if (!user || it.price == null || !it.currency || it.currency === user.currency) return '';
    var a = homeAmt(it);
    return a == null ? '' : '<small class="conv1">≈ ' + esc(money(a, user.currency)) + '</small>';
  }
  function previewHtml(it) {
    var img = safeImg(it.image_url);
    return '<div class="preview"><div class="pimg' + (img ? '' : ' none') + '">' + (img ? '<img src="' + esc(img) + '" alt="" referrerpolicy="no-referrer">' : letter(it)) + '</div>' +
      '<div><b>' + esc(it.title || 'Untitled item') + '</b>' + (it.brand ? '<small class="brand">' + esc(it.brand) + '</small>' : '') +
      (it.price != null ? '<div class="price">' + esc(money(it.price, it.currency)) + (it.was_price > it.price ? '<s>' + esc(fmt(it.was_price)) + '</s>' : '') + '</div>' : '') +
      convLine(it) + tagsHtml(it, true) + '</div></div>';
  }

  /* ---------- link reading ---------- */
  function fetchT(u, ms, opt) {
    var c = window.AbortController ? new AbortController() : null;
    var t = c && setTimeout(function () { c.abort(); }, ms || 8000);
    return fetch(u, Object.assign({ credentials: 'omit' }, opt || {}, c ? { signal: c.signal } : {})).finally(function () { if (t) clearTimeout(t); });
  }
  function absUrl(u, base) { if (!u) return ''; if (typeof u === 'object') u = u.src || u.url || ''; try { return new URL(String(u).replace(/^\/\//, 'https://'), base).href; } catch (e) { return ''; } }

  async function readLink(url) {
    var u; try { u = new URL(url); } catch (e) { return { ok: false }; }
    var blocked = false, reader = '';

    // 0) Stashd's own link reader (Supabase Edge Function "read-link"), when it's deployed.
    if (CLOUD && sb && user) {
      try {
        var fr = await Promise.race([
          sb.functions.invoke('read-link', { body: { url: url } }),
          new Promise(function (res) { setTimeout(function () { res(null); }, 15000); })
        ]);
        if (fr && !fr.error && fr.data && fr.data.ok) return Object.assign({}, fr.data, { ok: true, viaReader: true });
        if (!fr) reader = 'timeout';
        else if (fr.error) { var st = fr.error.context && fr.error.context.status; reader = st === 404 ? 'not_deployed' : st === 401 || st === 403 ? 'auth' : 'error ' + (st || fr.error.message || ''); }
        else if (fr.data) reader = fr.data.error || 'no_product';
        if (reader === 'blocked') blocked = true;
      } catch (e) { reader = 'error ' + (e && e.message || ''); }
    }

    // 1) Shopify stores (e.g. Nesaa) expose product data at /products/<handle>.js
    var m = u.pathname.match(/^(.*?\/products\/[^/?#]+)/);
    if (m) {
      try {
        var r = await fetchT(u.origin + m[1].replace(/\.(js|json|oembed)$/, '') + '.js', 8000, { headers: { Accept: 'application/json' } });
        if (r.ok) {
          var p = await r.json();
          var vid = u.searchParams.get('variant');
          var v = vid && (p.variants || []).find(function (x) { return String(x.id) === vid; });
          var sizeOpt = (p.options || []).find(function (o) { return /size|مقاس/i.test(o && (o.name || o)); });
          var currency = '';
          try { var c = await fetchT(u.origin + '/cart.js', 4000); if (c.ok) currency = (await c.json()).currency || ''; } catch (e) {}
          var price = (v || p).price, was = (v || p).compare_at_price;
          return {
            ok: true, source: 'shopify',
            title: p.title || '', brand: p.vendor || '',
            image_url: absUrl((v && v.featured_image) || p.featured_image || (p.images && p.images[0]), u.origin),
            price: price != null ? price / 100 : null,
            was_price: was && was > price ? was / 100 : null,
            currency: currency, sold_out: (v || p).available === false,
            sizes: sizeOpt && sizeOpt.values ? sizeOpt.values.map(String).slice(0, 20) : []
          };
        }
      } catch (e) {}
    }

    // 2) The page itself (works only when the store allows it)
    try {
      var r2 = await fetchT(url, 8000);
      if (r2.ok && /html/i.test(r2.headers.get('content-type') || '')) {
        var meta = parseHtml(await r2.text(), url);
        if (meta.title) return Object.assign({ ok: true, source: 'page' }, meta);
      }
    } catch (e) {}

    // 3) Microlink free API: title, photo and store name (no price). Free tier is rate-limited.
    try {
      var r3 = await fetchT('https://api.microlink.io/?url=' + encodeURIComponent(url), 10000);
      if (r3.ok) {
        var j = await r3.json();
        if (j.status === 'success' && j.data && j.data.title) {
          return { ok: true, source: 'microlink', title: j.data.title, brand: j.data.publisher || '', image_url: absUrl(j.data.image && j.data.image.url, url) };
        }
      }
    } catch (e) {}
    return { ok: false, blocked: blocked, reader: reader };
  }

  function parseHtml(html, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    function meta(n) { var el = doc.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]'); return el ? (el.getAttribute('content') || '').trim() : ''; }
    var out = {
      title: meta('og:title') || (doc.title || '').trim(), brand: meta('og:site_name'),
      image_url: absUrl(meta('og:image'), base),
      price: num(meta('product:price:amount') || meta('og:price:amount')),
      currency: meta('product:price:currency') || meta('og:price:currency'), sold_out: /out ?of ?stock/i.test(meta('product:availability') || meta('og:availability'))
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try {
        var j = JSON.parse(s.textContent), nodes = [].concat(j['@graph'] || j);
        nodes.forEach(function (n) {
          if (!n || !/Product/.test([].concat(n['@type']).join(' '))) return;
          var o = [].concat(n.offers || [])[0] || {};
          if (o.offers) o = [].concat(o.offers)[0] || o;
          out.title = out.title || n.name;
          out.brand = out.brand || (n.brand && (n.brand.name || n.brand)) || '';
          out.image_url = out.image_url || absUrl([].concat(n.image || [])[0], base);
          if (out.price == null) out.price = num(o.price || o.lowPrice);
          out.currency = out.currency || o.priceCurrency || '';
          if (/OutOfStock|SoldOut/i.test(o.availability || '')) out.sold_out = true;
        });
      } catch (e) {}
    });
    return out;
  }

  /* ---------- add + save ---------- */
  function openAdd() {
    var canPaste = !!(navigator.clipboard && navigator.clipboard.readText);
    var s = sheet('<h2>Add a link</h2><p class="muted" style="margin-bottom:1rem">Paste a product link from any store or ad.</p>' +
      '<form id="addForm" novalidate><label class="field"><span>Link</span><input type="url" name="url" inputmode="url" autocomplete="off" placeholder="https://…" required></label>' +
      '<p class="err" id="addErr"></p><div class="row">' + (canPaste ? '<button class="btn" type="button" id="pasteBtn">Paste</button>' : '') + '<button class="btn primary" type="submit">Next</button></div></form>' +
      '<div class="stack"><button class="link" type="button" id="sampleBtn">Try a sample link (Nesaa pants)</button><button class="link" type="button" id="setupBtn">Set up Share to Stashd</button></div>');
    var input = s.querySelector('input[name=url]');
    setTimeout(function () { input.focus(); }, 60);
    s.querySelector('#addForm').onsubmit = function (e) {
      e.preventDefault();
      var url = extractUrl(input.value);
      if (!url) { s.querySelector('#addErr').textContent = "That doesn't look like a link."; return; }
      openSave(url);
    };
    if (canPaste) s.querySelector('#pasteBtn').onclick = function () {
      navigator.clipboard.readText().then(function (t) { var url = extractUrl(t); if (url) openSave(url); else { input.value = t; s.querySelector('#addErr').textContent = 'No link found on your clipboard.'; } })
        .catch(function () { s.querySelector('#addErr').textContent = 'Paste was blocked. Long-press the box and tap Paste instead.'; });
    };
    s.querySelector('#sampleBtn').onclick = function () { openSave(SAMPLE_URL); };
    s.querySelector('#setupBtn').onclick = openSetup;
  }

  // url: link to save. pre: details from the Safari Shortcut. src: an existing item to copy (no reading needed).
  async function openSave(url, pre, src) {
    var dupe = db.items.find(function (i) { return i.url === url; });
    var it = {
      id: uid(), user_id: user.id, board_id: ['owner', 'editor'].indexOf(roleOf(ui.board)) >= 0 ? ui.board : (db.boards[0] ? db.boards[0].id : null),
      url: url, title: '', brand: hostBrand(url), image_url: '', price: null, was_price: null, currency: myCurrency(),
      size: '', note: '', sold_out: false, bought: false, created_at: '', sizes: []
    };
    var s = sheet('<h2>' + (src ? 'Save to my stash' : 'Save to Stashd') + '</h2><div id="prev">' + previewHtml(it) + '</div><div id="saveBody"><p class="loading muted">Reading the link…</p></div>');
    var info = src ? { ok: true, copied: true, title: src.title, brand: src.brand, image_url: src.image_url, price: src.price, was_price: src.was_price, currency: src.currency, sold_out: src.sold_out, sizes: src.sizes || [] } : fromShortcut(pre);
    if (!src && (!info || !info.ok || info.price == null)) {     // nothing (or no price) from the Shortcut: try the reader too
      var more = await readLink(url).catch(function () { return { ok: false }; });
      if (!info || !info.ok) info = more;
      else ['image_url', 'price', 'was_price', 'currency', 'sizes', 'brand'].forEach(function (k) { if ((info[k] == null || info[k] === '') && more[k] != null && more[k] !== '') info[k] = more[k]; });
    }
    if (!document.body.contains(s)) return;
    ['title', 'brand', 'image_url', 'price', 'was_price', 'sold_out', 'sizes'].forEach(function (k) { if (info[k] != null && info[k] !== '') it[k] = info[k]; });
    if (info.currency) it.currency = String(info.currency).toUpperCase();
    else if (guessCurrency(url)) it.currency = guessCurrency(url);
    if (src && src.size) it.size = src.size;
    if (!it.title) it.title = titleFromUrl(url);
    if (!info.ok && it.brand) it.brand = it.brand.charAt(0).toUpperCase() + it.brand.slice(1);
    var needsHelp = !info.ok || it.price == null;
    var hint = info.blocked ? 'This store blocks automatic reading. We filled in what we could from the link. Add the price (and a photo if you like) below.'
      : !info.ok ? "Couldn't read this page automatically. Add the details below."
      : it.price == null ? 'Got the basics. Add the price below so it counts in your total.' : '';

    var prev = s.querySelector('#prev'), body = s.querySelector('#saveBody');
    prev.innerHTML = previewHtml(it);
    var READER = { not_deployed: 'not found. Check it\'s deployed and named exactly read-link.', auth: 'refused the request. Sign out and back in, then try again.',
      blocked: 'the store blocked it.', no_product: 'it opened the page but found no product details.', unreachable: 'it couldn\'t open the page.',
      not_a_page: 'the link isn\'t a web page.', bad_url: 'the link isn\'t valid.', timeout: 'it took too long.' };
    var readerLine = info.copied ? '' : info.viaShortcut ? 'Read from the page in your Safari.' : info.viaReader ? 'Read by the Stashd reader.' : info.reader ? 'Stashd reader: ' + (READER[info.reader] || info.reader) : '';
    body.innerHTML = (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') + (readerLine ? '<p class="muted small" style="margin-top:.5rem">' + esc(readerLine) + '</p>' : '') +
      (dupe ? '<p class="hint">You already stashed this link. Saving again adds a second copy.</p>' : '') +
      '<h3>Price</h3>' + priceHtml(it) +
      '<h3>Board</h3>' + boardChips(it) + sizeHtml(it) +
      '<label class="field" style="margin-top:1rem"><span>Note (optional)</span><textarea data-f="note" maxlength="300" placeholder="Wait for payday? Ask for it as a gift?"></textarea></label>' +
      detailsHtml(it, needsHelp && !info.title) +
      '<div class="stack"><button class="btn primary block" type="button" id="stashBtn">Stash it</button></div>';
    var priceSync = null;
    var refresh = function (f) { if (!f || f !== 'note') prev.innerHTML = previewHtml(it); if (priceSync) priceSync(f); };
    bindBoardChips(body, it, refresh); bindSize(body, it, refresh); bindFields(body, it, refresh);
    priceSync = bindPrice(body, it, refresh);
    body.querySelector('#stashBtn').onclick = async function () {
      var btn = this;
      if (!it.title) it.title = it.brand ? it.brand + ' item' : 'Untitled item';
      it.created_at = new Date().toISOString();
      btn.disabled = true; btn.textContent = 'Stashing…';
      if (!it.currency || it.currency === user.currency) { it.home_price = it.price; it.home_currency = user.currency; }
      if (!it.sizes || !it.sizes.length) it.sizes = [];
      db.items.push(it);
      if (!(await api.saveItem(it))) { db.items.pop(); btn.disabled = false; btn.textContent = 'Stash it'; return; }
      if (it.board_id && cache[it.board_id]) cache[it.board_id].unshift(it);
      if (location.search) history.replaceState(null, '', location.pathname);
      closeSheet(); ui.tab = 'tobuy'; if (it.board_id && roleOf(it.board_id) === 'editor') ui.board = it.board_id; renderHome();
      toast('Saved' + (it.board_id ? ' to ' + boardName(it.board_id) : '') + ' · just now');
    };
  }

  /* ---------- item ---------- */
  function openItem(id) {
    var it = db.items.find(function (i) { return i.id === id; });
    if (!it) Object.keys(cache).some(function (k) { it = (cache[k] || []).find(function (i) { return i.id === id; }); return it; });
    if (!it) return;
    if (CLOUD && !canEditItem(it)) return openItemView(it);
    var mine = it.user_id === user.id, canDelete = mine || roleOf(it.board_id) === 'owner';
    var img = safeImg(it.image_url);
    var s = sheet(
      '<div class="hero-img' + (img ? '' : ' none') + '" id="iHero">' + (img ? '<img src="' + esc(img) + '" alt="" referrerpolicy="no-referrer">' : letter(it)) + tagsHtml(it) + '</div>' +
      '<div id="iHead"></div>' +
      '<div class="row act">' +
        (safeLink(it.url) ? '<a class="btn primary" id="openStore" href="' + esc(safeLink(it.url)) + '" target="_blank" rel="noopener noreferrer">Open store page</a>' : '') +
        '<button class="btn" type="button" id="boughtBtn"></button>' +
      '</div>' +
      '<h3>Price</h3>' + priceHtml(it) +
      (CLOUD && safeLink(it.url) ? '<div class="refresh"><button class="btn small" type="button" id="refreshBtn">↻ Refresh price</button><small class="muted" id="checkedAt"></small></div><div id="history"></div>' : '') +
      (mine ? '<h3>Board <span class="muted small">· tap one to move it</span></h3>' + boardChips(it) : '') +
      '<div class="stack" style="margin-top:.6rem"><button class="btn block" type="button" id="copyBtn">Copy to another board</button></div>' +
      sizeHtml(it) +
      '<label class="field" style="margin-top:1rem"><span>Note</span><textarea data-f="note" maxlength="300" placeholder="Add a note">' + esc(it.note) + '</textarea></label>' +
      switchHtml('soldSw', 'Sold out', '', it.sold_out) +
      (mine && !(CLOUD && sharedBoard(it.board_id)) ? switchHtml('budgetSw', 'Count in budget and totals', 'Turn off for gifts, wishes or anything you\'re not paying for.', it.in_budget !== false) : '') +
      detailsHtml(it, false) +
      (canDelete ? '<div class="stack"><button class="link danger" type="button" id="delBtn">Delete item</button></div>'
        : '<p class="muted small" style="margin-top:1rem;text-align:center">Only the person who added this item or the board owner can delete it.</p>'));
    var head = s.querySelector('#iHead'), hero = s.querySelector('#iHero'), bb = s.querySelector('#boughtBtn');
    function paint() {
      head.innerHTML = '<h2 style="margin-right:0">' + esc(it.title || 'Untitled item') + '</h2>' +
        '<p class="muted"><span class="brand">' + esc(it.brand) + '</span>' + (it.board_id ? ' · ' + esc(boardName(it.board_id)) : '') + '</p>' +
        (it.price != null ? '<div class="price">' + esc(money(it.price, it.currency)) + (it.was_price > it.price ? '<s>' + esc(fmt(it.was_price)) + '</s>' : '') + '</div>' : '') + convLine(it);
      var t = hero.querySelector('.tags'); if (t) t.remove(); hero.insertAdjacentHTML('beforeend', tagsHtml(it));
      bb.textContent = it.bought ? '↩ Move to To buy' : '✓ Mark as bought';
    }
    var change = function (f) {
      api.saveItemSoon(it); paint(); renderHome();
      if (f === 'image_url') { hero.classList.remove('none'); hero.innerHTML = '<img src="' + esc(safeImg(it.image_url)) + '" alt="">' + tagsHtml(it); }
      if (f === 'url') { var a = s.querySelector('#openStore'); if (a && safeLink(it.url)) a.href = safeLink(it.url); }
    };
    paint();
    var priceSync = null, change0 = change;
    change = function (f) { change0(f); if (priceSync) priceSync(f); };
    bindBoardChips(s, it, function () { change0('board'); toast(it.board_id ? 'Moved to ' + boardName(it.board_id) : 'Removed from the board'); });
    bindSize(s, it, change); bindFields(s, it, change);
    priceSync = bindPrice(s, it, change0);
    s.querySelector('#copyBtn').onclick = function () { pickBoard('Copy to…', it.board_id, function (bid) { copyItem(it, bid); }); };
    s.querySelector('#soldSw').onchange = function (e) { it.sold_out = e.target.checked; change(); };
    var bs = s.querySelector('#budgetSw'); if (bs) bs.onchange = function (e) { it.in_budget = e.target.checked; change(); toast(it.in_budget ? 'Counted in your budget' : 'Left out of your budget'); };
    var STATUS = { blocked: 'This store blocks automatic checks, so the price stays as saved. Type the new price if it changed.', no_product: 'Couldn\'t find the price on the page right now.', unreachable: 'Couldn\'t open the store page right now.' };
    function paintChecked() {
      var el = s.querySelector('#checkedAt'); if (!el) return;
      el.textContent = it.last_checked_at ? 'Checked ' + ago(it.last_checked_at) + (it.check_status === 'blocked' ? ' · store blocks checks' : '') : 'Checked automatically about once a day';
    }
    async function loadHistory() {
      var el = s.querySelector('#history'); if (!el || !sb) return;
      var h = await sb.from('price_history').select('price,currency,sold_out,checked_at').eq('item_id', it.id).order('checked_at', { ascending: false }).limit(30);
      var rows = (h.data || []).filter(function (r, i, a) { return i === a.length - 1 || +r.price !== +a[i + 1].price || r.sold_out !== a[i + 1].sold_out; }).slice(0, 5);
      el.innerHTML = rows.length > 1 ? '<details class="hist"><summary>Price history</summary>' + rows.map(function (r) {
        return '<div><span>' + esc(new Date(r.checked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })) + '</span><b>' + esc(money(r.price, r.currency || it.currency)) + '</b>' + (r.sold_out ? '<em>sold out</em>' : '') + '</div>';
      }).join('') + '</details>' : '';
    }
    paintChecked(); loadHistory();
    var rb = s.querySelector('#refreshBtn');
    if (rb) rb.onclick = async function () {
      rb.disabled = true; rb.textContent = 'Checking…';
      var r = await refreshItem(it);
      rb.disabled = false; rb.textContent = '↻ Refresh price';
      if (!r) return toast('Couldn\'t check right now. Try again later.');
      paint(); paintChecked(); loadHistory(); renderHome();
      var pi = s.querySelector('[data-f=price]'); if (pi) pi.value = it.price == null ? '' : it.price;
      var hi = s.querySelector('[data-home]'); if (hi) hi.value = it.home_price == null ? '' : it.home_price;
      toast(r.changes.length ? r.changes.map(function (c) { return changeText(c, it.currency); }).join(' · ') : STATUS[r.status] || 'No change. Price is still ' + money(it.price, it.currency) + '.');
    };
    bb.onclick = async function () {
      if (!it.bought && CLOUD && safeLink(it.url)) {             // get the latest price before it counts as spent
        bb.disabled = true; bb.textContent = 'Checking the latest price…';
        var r = await refreshItem(it);
        if (r && r.changes.some(function (c) { return c.kind === 'price_drop' || c.kind === 'price_up'; })) toast('Price updated to ' + money(it.price, it.currency));
      }
      it.bought = !it.bought; api.saveItem(it); closeSheet(); renderHome();
      setTimeout(function () { toast(it.bought ? 'Marked as bought at ' + money(it.price, it.currency) + '. Enjoy it!' : 'Moved back to To buy'); }, 900);
    };
    var del = s.querySelector('#delBtn');
    if (del) del.onclick = async function () {
      if (!(await askConfirm('Delete "' + (it.title || 'this item') + '"? This can\'t be undone.', 'Delete'))) return;
      del.disabled = true; del.textContent = 'Deleting…';
      if (!(await api.deleteItem(it.id))) { del.disabled = false; del.textContent = 'Delete item'; return; }
      db.items = db.items.filter(function (i) { return i.id !== it.id; });
      Object.keys(cache).forEach(function (k) { if (cache[k]) cache[k] = cache[k].filter(function (i) { return i.id !== it.id; }); });
      closeSheet(); renderHome(); toast('Item deleted');
    };
  }
  // Pick one of my boards (or a board shared with me where I can add).
  function pickBoard(title, current, done) {
    var opts = db.boards.concat((db.shared || []).filter(function (b) { return b.role === 'editor'; }));
    var s = sheet('<h2>' + esc(title) + '</h2><div class="people" id="pickList">' + opts.map(function (b) {
      return '<button class="person" type="button" data-pick="' + esc(b.id) + '"' + (b.id === current ? ' disabled' : '') + '><span class="av">' + esc(b.name.charAt(0).toUpperCase()) + '</span><span><b>' + esc(b.name) + '</b><small>' +
        (b.id === current ? 'It\'s already here' : sharedBoard(b.id) ? 'Shared by @' + esc((b.owner && b.owner.username) || '') : (CLOUD && b.visibility === 'public' ? 'Public' : 'Private')) + '</small></span></button>';
    }).join('') + '</div><div class="chips wrap" style="margin-top:.8rem"><button class="chip ghost" type="button" data-new-board>+ New board</button></div>');
    s.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { closeSheet(); done(b.dataset.pick); }; });
    var nb = s.querySelector('[data-new-board]');
    nb.onclick = function () { promptBoard(function (b) { closeSheet(); renderHome(); done(b.id); }, nb); };
  }
  async function copyItem(src, bid) {
    var mine = src.user_id === user.id;
    var it = {
      id: uid(), user_id: user.id, board_id: bid, url: src.url, title: src.title, brand: src.brand, image_url: src.image_url,
      price: src.price, was_price: src.was_price, currency: src.currency, home_price: src.home_currency === user.currency ? src.home_price : null, home_currency: src.home_currency === user.currency ? src.home_currency : null,
      size: src.size || '', sizes: src.sizes || [], note: mine ? (src.note || '') : '', sold_out: !!src.sold_out, bought: false, in_budget: true, created_at: new Date().toISOString()
    };
    if (it.price != null && it.currency && it.currency !== user.currency && it.home_price == null) {
      it.home_price = await convert(it.price, it.currency, user.currency); it.home_currency = it.home_price == null ? null : user.currency;
    }
    if (!(await api.saveItem(it))) return;
    db.items.push(it);
    if (cache[bid]) cache[bid].unshift(it);
    toast('Copied to ' + boardName(bid));
    if (user && document.querySelector('.home .chips')) renderHome();
  }
  function safeLink(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

  /* ---------- account menu + share setup ---------- */
  function openMenu() {
    var s = sheet('<h2>' + esc(user.name) + '</h2><p class="muted" style="margin-top:-.6rem;margin-bottom:1rem">' + (user.username ? '@' + esc(user.username) + ' · ' : '') + esc(user.email) + '</p>' +
      (CLOUD ? '<div class="row" style="margin-bottom:1rem"><button class="btn" type="button" id="mProfile">My profile</button><button class="btn" type="button" id="mPeople">Find people</button></div>' : '') +
      '<label class="field"><span>Your currency</span><select id="curSel">' + CURRENCIES.map(function (c) { return '<option' + (c === user.currency ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<div class="stack">' +
        '<button class="btn block" type="button" id="mSetup">Set up Share to Stashd</button>' +
        '<a class="btn block" href="privacy.html">Privacy policy</a>' +
        '<button class="btn block" type="button" id="mOut">Sign out</button>' +
        '<button class="link danger" type="button" id="mDel">Delete my account and stash</button>' +
      '</div><p class="fine">' + (CLOUD ? 'Your stash is synced to your account.' : 'Test version. Everything is saved in this browser only.') + '</p>');
    s.querySelector('#curSel').onchange = function (e) { user.currency = e.target.value; api.saveProfile(); getRates(user.currency).then(function () { if (!document.querySelector('.overlay')) renderHome(); }); renderHome(); toast('New items will use ' + user.currency); };
    s.querySelector('#mSetup').onclick = openSetup;
    var mp = s.querySelector('#mProfile'); if (mp) mp.onclick = function () { if (user.username) nav({ u: user.username }); else ensureUsername(); };
    var mpe = s.querySelector('#mPeople'); if (mpe) mpe.onclick = function () { nav({ explore: 1 }); };
    s.querySelector('#mOut').onclick = signOut;
    s.querySelector('#mDel').onclick = function () {
      askConfirm('Delete your account and everything in your stash? This can\'t be undone.', 'Delete account').then(function (ok) { if (ok) deleteAccount(); });
    };
  }

  async function deleteAccount() {
    if (CLOUD) {
      try {
        var l = await sb.storage.from('photos').list(user.id, { limit: 1000 });
        if (l.data && l.data.length) await sb.storage.from('photos').remove(l.data.map(function (f) { return user.id + '/' + f.name; }));
      } catch (e) {}
      var r = await sb.rpc('delete_my_account');
      if (r.error) return toast("Couldn't delete your account. " + friendly(r.error));
    } else {
      var users = load(KEY.users, {}); delete users[user.email]; save(KEY.users, users);
      try { localStorage.removeItem(KEY.data(user.id)); } catch (e) {}
    }
    await signOut(); toast('Account deleted');
  }

  function openSetup() {
    var script = '';
    var isAndroid = /Android/i.test(navigator.userAgent);
    var safari =
      '<h3>iPhone: Share from Safari (works with Zara too)</h3>' +
      '<p class="muted small">One-time setup, about 3 minutes. Stashd reads the product from the page you\'re looking at.</p>' +
      '<p class="stepnum">Step 1 · Allow scripts</p>' +
      '<ol class="steps"><li>Open the <b>Settings</b> app.</li><li>Tap <b>Apps</b> → <b>Shortcuts</b> → <b>Advanced</b>.<br><span class="muted small">On older iOS: Settings → Shortcuts → Advanced.</span></li><li>Turn on <b>Allow Running Scripts</b>.</li></ol>' +
      '<p class="stepnum">Step 2 · Copy the script</p>' +
      '<div class="stack" style="margin-top:0"><button class="btn primary block" type="button" id="copyScript" disabled>Copy script</button></div>' +
      '<p class="stepnum">Step 3 · Make the shortcut</p>' +
      '<ol class="steps">' +
        '<li>Open the <b>Shortcuts</b> app and tap <b>+</b> (top right).</li>' +
        '<li>Tap <b>Search Actions</b> at the bottom, type <b>Run JavaScript</b>, and tap <b>Run JavaScript on Web Page</b>.</li>' +
        '<li>In that block, tap the grey code. Select all, tap <b>Delete</b>, then tap and hold → <b>Paste</b>. Tap <b>Done</b>.</li>' +
        '<li>If the block says <b>Web Page</b> in blue, tap it and choose <b>Shortcut Input</b>.</li>' +
        '<li>Tap <b>Search Actions</b> again, type <b>Open URLs</b>, and tap it. It should read <b>Open JavaScript Result</b>.</li>' +
        '<li>Tap the name at the top → <b>Rename</b> → type <b>Stashd</b>.</li>' +
        '<li>Tap <b>ⓘ</b> (or the name → <b>Details</b>) and turn on <b>Show in Share Sheet</b>. Tap <b>Done</b>.</li>' +
      '</ol>' +
      '<p class="stepnum">Step 4 · Use it</p>' +
      '<ol class="steps"><li>Open a product page in <b>Safari</b>.</li><li>Tap <b>Share</b> (square with an arrow), scroll down and tap <b>Stashd</b>.</li><li>The first time, tap <b>Always Allow</b>.</li></ol>';
    var apps =
      '<h3>From Instagram, TikTok and other apps</h3>' +
      '<p class="muted">Tap <b>Share</b> → <b>Copy link</b>. Then open Stashd, tap <b>+</b> and <b>Paste</b>.</p>' +
      '<p class="muted small">Tip: for stores that block reading (like Zara), tap the link to open it in Safari first, then use Share → Stashd.</p>' +
      (CLOUD ? '' : '<p class="hint">Use Stashd in Safari rather than from a home-screen icon. On iPhone, a home-screen web app keeps a separate stash.</p>');
    var android =
      '<h3>Android</h3>' +
      '<ol class="steps">' +
        '<li>Open this page in <b>Chrome</b>.</li>' +
        '<li>Tap <b>⋮</b> then <b>Add to Home screen</b> (or <b>Install app</b>).</li>' +
        '<li>Now tap <b>Share</b> in any app and pick <b>Stashd</b>.</li>' +
      '</ol>';
    var s = sheet('<h2>Share to Stashd</h2><p class="muted">Save things from any app without copy-pasting into WhatsApp.</p>' +
      (isAndroid ? android + safari + apps : safari + apps + android) +
      '<h3>Anywhere</h3><p class="muted">Copy the product link, open Stashd and tap <b>+</b> then <b>Paste</b>.</p>' +
      '<textarea class="copy" id="scriptBox" readonly rows="4" aria-label="Shortcut script" style="margin-top:.6rem;font-family:ui-monospace,monospace;font-size:.75rem"></textarea>');
    function copy(text, label) {
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast(label + ' copied'); })
        .catch(function () { window.prompt('Copy this', text); });
    }
    s.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { copy(b.dataset.copy, 'Link'); }; });
    var cs = s.querySelector('#copyScript'), box = s.querySelector('#scriptBox');
    fetch('shortcut.js?v=' + Date.now()).then(function (r) { return r.text(); }).then(function (txt) {
      script = txt.replace(/var STASHD = '[^']*';/, "var STASHD = '" + base() + "';"); box.value = script; cs.disabled = false;
    }).catch(function () { box.value = 'Couldn\'t load the script. Check your connection.'; });
    cs.onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(script) : Promise.reject()).then(function () { toast('Script copied'); })
        .catch(function () { box.focus(); box.select(); toast('Select all and copy the script below'); });
    };
  }


  /* ---------- social: usernames, profiles, follows, shared boards ---------- */
  var USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
  var PEOPLE_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.4 1.9 5 4.9"/></svg>';
  var LOCK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var cache = {};   // items of boards shared with me, by board id

  function cleanUsername(v) { return String(v || '').trim().replace(/^@/, '').toLowerCase(); }
  function suggestUsername(name) { return cleanUsername(name).normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 16); }
  async function usernameStatus(u) {
    if (!u) return 'Pick a username.';
    if (u.length < 3) return 'At least 3 characters.';
    if (u.length > 20) return '20 characters at most.';
    if (!USERNAME_RE.test(u)) return 'Use only lowercase letters, numbers, dots and underscores.';
    if (/^[._]|[._]$|\.\./.test(u)) return 'Can\'t start or end with a dot or underscore.';
    var r = await sb.rpc('username_available', { u: u });
    if (r.error) return '';
    return r.data ? '' : '@' + u + ' is taken. Try another.';
  }
  function bindUsername(input, errEl, okEl) {
    var t, seq = 0, state = { ok: false, pending: null };
    function run() {
      var my = ++seq, u = cleanUsername(input.value);
      if (input.value !== u && u === input.value.toLowerCase().trim().replace(/^@/, '')) input.value = u;
      state.ok = false;
      state.pending = usernameStatus(u).then(function (msg) {
        if (my !== seq) return state.pending;
        errEl.textContent = msg; if (okEl) okEl.textContent = msg || !u ? '' : '@' + u + ' is free';
        if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
        state.ok = !msg; return state.ok;
      });
      return state.pending;
    }
    input.addEventListener('input', function () { clearTimeout(t); if (okEl) okEl.textContent = ''; t = setTimeout(run, 350); });
    state.check = function () { clearTimeout(t); return run(); };
    return state;
  }

  function roleOf(bid) {
    if (!bid) return null;
    if (db.boards.some(function (b) { return b.id === bid; })) return 'owner';
    var s = (db.shared || []).find(function (b) { return b.id === bid; });
    return s ? s.role : null;
  }
  function sharedBoard(bid) { return (db.shared || []).find(function (b) { return b.id === bid; }); }
  function canEditItem(it) { return it.user_id === user.id || ['owner', 'editor'].indexOf(roleOf(it.board_id)) >= 0; }
  function boardLink(b) { return base() + '?b=' + b.id + (b.visibility !== 'public' && b.link_token ? '&k=' + b.link_token : ''); }
  function shareLink(url, title) {
    if (navigator.share) return navigator.share({ title: title, url: url }).catch(function () {});
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link copied'); })
      .catch(function () { window.prompt('Copy this link', url); });
  }
  function avatar(p, cls) { return '<span class="av' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + esc(((p && (p.name || p.username)) || '?').charAt(0).toUpperCase()) + '</span>'; }
  function personRow(p, extra) {
    return '<button class="person" type="button" data-user="' + esc(p.username || '') + '">' + avatar(p) +
      '<span><b>' + esc(p.name || p.username) + '</b><small>@' + esc(p.username || '') + '</small></span>' + (extra || '') + '</button>';
  }
  function bindPeople(root) {
    root.querySelectorAll('[data-user]').forEach(function (b) { b.onclick = function () { if (b.dataset.user) { closeSheet(); nav({ u: b.dataset.user }); } }; });
  }

  /* routing: ?u=username (profile), ?b=board[&k=key] (board link) */
  var navDepth = 0;
  function nav(params) {
    var q = new URLSearchParams(params || {}).toString();
    history.pushState(null, '', location.pathname + (q ? '?' + q : '')); navDepth++;
    route();
  }
  function goHome() { if (location.search) { history.pushState(null, '', location.pathname); navDepth++; } route(); }
  function route() {
    closeSheet();
    var p = new URLSearchParams(location.search);
    if (CLOUD && p.get('explore')) return renderExplore();
    if (CLOUD && p.get('u')) return renderProfile(p.get('u'));
    if (CLOUD && p.get('b')) return renderBoardPage(p.get('b'), p.get('k'));
    if (user) return renderHome();
    renderAuth();
  }
  window.addEventListener('popstate', function () { navDepth = Math.max(0, navDepth - 1); if (user || CLOUD) route(); });

  function topbar(title) {
    return '<header class="top sub"><button class="icon back" type="button" id="backBtn" aria-label="Back">‹</button>' +
      '<a class="wm small" href="./" id="homeLink">Stash<span>d</span></a>' + (title || '<span style="width:2.75rem"></span>') + '</header>';
  }
  function bindTopbar() {
    document.getElementById('backBtn').onclick = function () { if (navDepth > 0) history.back(); else goHome(); };
    document.getElementById('homeLink').onclick = function (e) { e.preventDefault(); goHome(); };
  }

  function openEditProfile() {
    var s = sheet('<h2>Edit profile</h2><form id="epForm" novalidate>' +
      '<label class="field"><span>Name</span><input type="text" name="name" maxlength="50" value="' + esc(user.name) + '"></label>' +
      '<label class="field"><span>Username</span><span class="at"><input type="text" name="username" autocapitalize="off" spellcheck="false" maxlength="20" value="' + esc(user.username || '') + '"></span><small class="ferr" id="unErr"></small><small class="fok" id="unOk"></small></label>' +
      '<p class="err" id="epErr"></p><button class="btn primary block" type="submit">Save</button></form>');
    var input = s.querySelector('[name=username]'), st = bindUsername(input, s.querySelector('#unErr'), s.querySelector('#unOk'));
    s.querySelector('#epForm').onsubmit = async function (e) {
      e.preventDefault();
      var name = s.querySelector('[name=name]').value.trim().replace(/\s+/g, ' '), u = cleanUsername(input.value);
      if (!name) return (s.querySelector('#epErr').textContent = 'Add your name.');
      if (u !== user.username && !(await st.check())) return input.focus();
      var r = await sb.from('profiles').update({ name: name, username: u }).eq('id', user.id);
      if (r.error) return (s.querySelector('#epErr').textContent = /duplicate|unique/i.test(r.error.message) ? '@' + u + ' is taken.' : friendly(r.error));
      user.name = name; user.username = u; api.saveProfile(); closeSheet(); toast('Profile saved'); route();
    };
  }

  function openPeople() {
    var s = sheet('<h2>Find people</h2><label class="field"><span class="sr">Search</span><input type="search" id="pq" placeholder="Search by name or @username" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label><div id="pres" class="people"></div>');
    var q = s.querySelector('#pq'), res = s.querySelector('#pres'), t, seq = 0;
    setTimeout(function () { q.focus(); }, 60);
    q.oninput = function () {
      clearTimeout(t);
      t = setTimeout(async function () {
        var v = q.value.trim().replace(/^@/, '').replace(/[,()%*\\]/g, '');
        if (v.length < 2) { res.innerHTML = ''; return; }
        var my = ++seq;
        var r = await sb.from('profiles').select('id,username,name').not('username', 'is', null).neq('id', user ? user.id : '00000000-0000-0000-0000-000000000000')
          .or('username.ilike.' + v.toLowerCase() + '%,name.ilike.%' + v + '%').limit(20);
        if (my !== seq) return;
        res.innerHTML = r.error ? '<p class="err">' + esc(friendly(r.error)) + '</p>' : r.data.length ? r.data.map(function (p) { return personRow(p); }).join('') : '<p class="muted">No one found.</p>';
        bindPeople(res);
      }, 250);
    };
  }

  async function openFollowList(p, kind) {
    var followers = kind === 'followers';
    var s = sheet('<h2>' + (followers ? 'Followers' : 'Following') + '</h2><div class="people"><p class="loading muted">Loading…</p></div>');
    var r = await sb.from('follows').select(followers ? 'p:profiles!follows_follower_id_fkey(id,username,name)' : 'p:profiles!follows_following_id_fkey(id,username,name)')
      .eq(followers ? 'following_id' : 'follower_id', p.id).order('created_at', { ascending: false }).limit(200);
    var box = s.querySelector('.people');
    if (r.error) { box.innerHTML = '<p class="err">' + esc(friendly(r.error)) + '</p>'; return; }
    var list = r.data.map(function (x) { return x.p; }).filter(function (x) { return x && x.username; });
    box.innerHTML = list.length ? list.map(function (x) { return personRow(x); }).join('') : '<p class="muted">' + (followers ? 'No followers yet.' : 'Not following anyone yet.') + '</p>';
    bindPeople(box);
  }

  async function renderBoardPage(bid, key) {
    if (user && (roleOf(bid))) {           // my board or one shared with me: open it in my stash
      history.replaceState(null, '', location.pathname); ui.board = bid; ui.tab = 'tobuy'; renderHome(); return;
    }
    var tabs = user ? tabbarHtml('') : '';
    function fin() { bindTopbar(); if (user) bindTabbar(); }
    app.innerHTML = '<div class="home has-tabs">' + topbar() + '<p class="loading muted">Loading…</p></div>' + tabs; fin();
    var r = await sb.rpc('shared_board', { bid: bid, k: key || null });
    if (r.error || !r.data) {
      app.innerHTML = '<div class="home">' + topbar() + '<div class="empty"><h2>This board is private</h2><p>' +
        (user ? 'Ask the owner to add you, or to switch on link sharing.' : 'Sign in if it was shared with you.') + '</p>' +
        (user ? '' : '<button class="btn primary" type="button" id="toAuth">Sign in</button>') + '</div></div>' + tabs;
      fin(); var ta = document.getElementById('toAuth'); if (ta) ta.onclick = function () { renderAuth('signin'); };
      return;
    }
    var d = r.data, b = d.board, owner = d.owner || {}, items = d.items || [];
    document.title = b.name + ' · Stashd';
    var pub = b.visibility === 'public', canSave = pub && user && b.user_id !== user.id;
    if (pub) { var sc = await sb.from('boards').select('save_count').eq('id', b.id).maybeSingle(); b.save_count = (sc.data && sc.data.save_count) || 0; }
    function meta() {
      return (owner.username ? '<button class="link" type="button" id="ownerLink">@' + esc(owner.username) + '</button>' : esc(owner.name || '')) +
        ' · ' + items.length + ' item' + (items.length === 1 ? '' : 's') + (pub ? ' · <span id="saveCount">' + b.save_count + ' save' + (b.save_count === 1 ? '' : 's') + '</span>' : ' · ' + LOCK + ' by link');
    }
    app.innerHTML = '<div class="home has-tabs">' + topbar() +
      '<section class="bhead2"><div class="bt"><h2>' + esc(b.name) + '</h2></div><p class="muted small" id="bmeta">' + meta() + '</p>' +
        '<div class="bact">' +
          (canSave ? '<button class="btn ' + (savedIds.has(b.id) ? '' : 'primary') + ' small" type="button" id="saveB">' + (savedIds.has(b.id) ? '✓ Saved' : 'Save') + '</button>' : '') +
          (!user ? '<button class="btn primary small" type="button" id="joinB">Sign up to save</button>' : '') +
          '<button class="icon soft" type="button" id="shareB" aria-label="Share board">' + SHARE_SVG + '</button>' +
        '</div></section>' +
      (items.length ? '<section class="grid">' + items.map(cardHtml).join('') + '</section>' : '<div class="empty"><p>Nothing in this board yet.</p></div>') +
    '</div>' + tabs;
    fin();
    function bindMeta() { var ol = document.getElementById('ownerLink'); if (ol) ol.onclick = function () { nav({ u: owner.username }); }; }
    bindMeta();
    document.getElementById('shareB').onclick = function () { shareLink(location.href, b.name + ' on Stashd'); };
    var jb = document.getElementById('joinB'); if (jb) jb.onclick = function () { renderAuth('signup'); };
    var svb = document.getElementById('saveB');
    if (svb) svb.onclick = async function () {
      svb.disabled = true; var on = await toggleSave(b); svb.disabled = false;
      if (on === null) return;
      svb.textContent = on ? '✓ Saved' : 'Save'; svb.classList.toggle('primary', !on);
      document.getElementById('bmeta').innerHTML = meta(); bindMeta();
    };
    app.querySelectorAll('.card').forEach(function (c) { c.onclick = function () { var it = items.find(function (i) { return i.id === c.dataset.id; }); if (it) openItemView(it); }; });
  }

  function openItemView(it) {
    var img = safeImg(it.image_url);
    var s = sheet('<div class="hero-img' + (img ? '' : ' none') + '">' + (img ? '<img src="' + esc(img) + '" alt="" referrerpolicy="no-referrer">' : letter(it)) + tagsHtml(it) + '</div>' +
      '<h2 style="margin-right:0">' + esc(it.title || 'Untitled item') + '</h2>' +
      '<p class="muted"><span class="brand">' + esc(it.brand || '') + '</span>' + (it.size ? ' · Size ' + esc(it.size) : '') + (it.bought ? ' · Bought' : '') + '</p>' +
      (it.price != null ? '<div class="price">' + esc(money(it.price, it.currency)) + (it.was_price > it.price ? '<s>' + esc(fmt(it.was_price)) + '</s>' : '') + '</div>' : '') +
      (it.note ? '<p class="hint">' + esc(it.note) + '</p>' : '') +
      '<div class="stack">' + (safeLink(it.url) ? '<a class="btn primary block" href="' + esc(safeLink(it.url)) + '" target="_blank" rel="noopener noreferrer">Open store page</a>' : '') +
      (user ? '<button class="btn block" type="button" id="copyToMine">Save to my board</button>' : '') + '</div>');
    var c = s.querySelector('#copyToMine'); if (c) c.onclick = function () { pickBoard('Save to…', null, function (bid) { copyItem(it, bid); }); };
  }

  async function loadShared(bid) {
    var r = await sb.from('items').select('*').eq('board_id', bid).order('created_at', { ascending: false });
    cache[bid] = r.error ? [] : r.data;
    if (r.error) toast(friendly(r.error));
    if (ui.board === bid) renderHome();
  }

  /* ---------- icons + small UI helpers ---------- */
  function svg(d, sw) { return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
  var BELL_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  var HOME_SVG = svg('<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/>');
  var SEARCH_SVG = svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>');
  var SHARE_SVG = svg('<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>');
  var MORE_SVG = svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>');
  var LINK_SVG = svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>');
  var CHAT_SVG = svg('<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>');
  var GEAR_SVG = svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', 1.6);
  var membersCache = {};

  function switchHtml(id, label, desc, on) {
    return '<label class="switch"><span><b>' + label + '</b>' + (desc ? '<small>' + desc + '</small>' : '') + '</span><input type="checkbox" role="switch" id="' + id + '"' + (on ? ' checked' : '') + '><i aria-hidden="true"></i></label>';
  }
  function boardById(id) { return db.boards.find(function (b) { return b.id === id; }) || (db.shared || []).find(function (b) { return b.id === id; }) || null; }
  // Does this item count toward my "Left to spend"?
  function counts(it) {
    if (it.in_budget === false) return false;
    if (!it.board_id) return true;
    var b = db.boards.find(function (x) { return x.id === it.board_id; });
    return b ? b.in_budget !== false : false;
  }
  async function loadMembers(b) {
    var r = await sb.from('board_members').select('user_id,role,created_at,p:profiles(id,username,name)').eq('board_id', b.id).order('created_at');
    membersCache[b.id] = r.error ? [] : r.data.filter(function (m) { return m.p; });
    return membersCache[b.id];
  }
  function stackHtml(b) {
    var owner = roleOf(b.id) === 'owner' ? user : b.owner;
    var ms = membersCache[b.id] || [];
    var people = [owner].concat(ms.map(function (m) { return m.p; })).filter(Boolean);
    return '<span class="stackav">' + people.slice(0, 4).map(function (p) { return avatar(p); }).join('') + (people.length > 4 ? '<span class="av more">+' + (people.length - 4) + '</span>' : '') + '</span>';
  }

  /* ---------- tab bar ---------- */
  function tabbarHtml(active) {
    function tab(id, label, icon) { return '<button class="tab" type="button" data-go="' + id + '"' + (active === id ? ' aria-current="page"' : '') + '>' + icon + '<span>' + label + '</span></button>'; }
    return '<nav class="tabbar" aria-label="Main">' + tab('home', 'Stash', HOME_SVG) + (CLOUD ? tab('explore', 'Explore', SEARCH_SVG) : '') +
      '<button class="tab add" type="button" data-go="add" aria-label="Add a link"><span class="plus">+</span></button>' +
      tab('profile', CLOUD ? 'Profile' : 'Account', avatar(user, 'sm')) + '</nav>';
  }
  function bindTabbar() {
    document.body.classList.add('tabs');
    app.querySelectorAll('[data-go]').forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.go;
        if (g === 'home') { if (location.search) goHome(); else { ui.board = 'all'; renderHome(); window.scrollTo(0, 0); } }
        else if (g === 'explore') nav({ explore: 1 });
        else if (g === 'add') openAdd();
        else if (g === 'profile') { if (!CLOUD) openMenu(); else if (user.username) nav({ u: user.username }); else ensureUsername(); }
      };
    });
  }

  /* ---------- home ---------- */
  function renderHome() {
    document.title = 'Stashd';
    if (ui.board !== 'all' && !boardName(ui.board)) ui.board = 'all';
    var shB = CLOUD ? sharedBoard(ui.board) : null, ownB = db.boards.find(function (b) { return b.id === ui.board; });
    var ownIds = db.boards.map(function (b) { return b.id; });
    if (shB && cache[ui.board] === undefined) { cache[ui.board] = null; loadShared(ui.board); }
    var cur = ownB || shB;
    if (CLOUD && cur && membersCache[cur.id] === undefined) { membersCache[cur.id] = []; loadMembers(cur).then(function () { if (ui.board === cur.id && !document.querySelector('.overlay')) renderHome(); }); }
    var inBoard = shB ? (cache[ui.board] || [])
      : ui.board === 'all' ? db.items.filter(function (i) { return !i.board_id || ownIds.indexOf(i.board_id) >= 0; })
      : db.items.filter(function (i) { return i.board_id === ui.board; });
    var toBuy = inBoard.filter(function (i) { return !i.bought; }), bought = inBoard.filter(function (i) { return i.bought; });
    var tabItems = ui.tab === 'bought' ? bought : toBuy;
    var list = tabItems.slice().sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });

    // Summary under the tabs: what's in this tab, in my currency.
    var notes = [], inTotals;
    if (shB) { inTotals = tabItems; notes.push('Not in your totals'); }
    else if (ownB) { inTotals = tabItems.filter(function (i) { return i.in_budget !== false; }); }
    else { inTotals = tabItems.filter(counts); }
    var skipped = tabItems.length - inTotals.length, hs = homeSum(inTotals);
    if (skipped) notes.push(skipped + ' excluded');
    if (hs.missing) notes.push(hs.missing + ' without a ' + user.currency + ' price');
    if (ownB && ownB.in_budget === false && ui.board !== 'all') notes.push('Not in your totals');
    var sumLabel = ui.tab === 'bought' ? 'Spent' : 'To buy', sumVal = moneyR(hs.sum, user.currency), sumNote = notes.join(' · ');
    var showSum = !(ownB && ownB.budget != null && ownB.budget !== '');   // the budget card already shows it

    app.innerHTML =
      '<div class="home has-tabs">' +
        '<header class="top"><h1 class="wm">Stash<span>d</span></h1>' + (CLOUD ? bellHtml() : '') + '</header>' +
        '<nav class="chips" aria-label="Boards">' +
          '<button class="chip" type="button" data-board="all" aria-pressed="' + (ui.board === 'all') + '">All</button>' +
          db.boards.map(function (b) { return '<button class="chip" type="button" data-board="' + esc(b.id) + '" aria-pressed="' + (ui.board === b.id) + '">' + (CLOUD && b.visibility !== 'public' ? LOCK + ' ' : '') + esc(b.name) + '</button>'; }).join('') +
          (db.shared || []).map(function (b) { return '<button class="chip shared" type="button" title="Shared by @' + esc((b.owner && b.owner.username) || '') + '" data-board="' + esc(b.id) + '" aria-pressed="' + (ui.board === b.id) + '">' + PEOPLE_SVG.replace(/22/g, '14') + ' ' + esc(b.name) + '</button>'; }).join('') +
          '<button class="chip ghost" type="button" id="newBoardBtn">+ Board</button>' +
        '</nav>' +
        (cur ? boardHeaderHtml(cur, !!ownB, inBoard) : '') +
        '<div class="seg" role="tablist">' +
          '<button type="button" role="tab" data-tab="tobuy" aria-selected="' + (ui.tab === 'tobuy') + '">To buy · ' + toBuy.length + '</button>' +
          '<button type="button" role="tab" data-tab="bought" aria-selected="' + (ui.tab === 'bought') + '">Bought · ' + bought.length + '</button>' +
        '</div>' +
        (CLOUD && localStashes().length ? '<div class="hint" style="margin:0 0 1rem">You have items from the test version saved on this device. <div class="row" style="margin-top:.6rem"><button class="btn primary" type="button" id="importBtn">Move them to my account</button><button class="btn" type="button" id="importNo">No thanks</button></div></div>' : '') +
        (showSum ? '<div class="sum"><div><span class="muted">' + sumLabel + '</span>' + (sumNote ? '<small>' + esc(sumNote) + '</small>' : '') + '</div><strong>' + esc(sumVal) + '</strong></div>' : '') +
        (shB && cache[ui.board] === null ? '<p class="loading muted">Loading…</p>'
          : list.length ? '<section class="grid">' + list.map(cardHtml).join('') + '</section>'
          : cur ? '<div class="empty"><h2>' + (ui.tab === 'bought' ? 'Nothing bought here yet' : 'This board is empty') + '</h2>' + (ui.tab === 'bought' || (shB && shB.role !== 'editor') ? '' : '<p>Tap + to add something you love.</p>') + '</div>'
          : emptyHtml()) +
      '</div>' + tabbarHtml('home');

    bindTabbar(); bindBell();
    document.getElementById('newBoardBtn').onclick = function () { openBoardEditor(null); };
    app.querySelectorAll('[data-board]').forEach(function (b) { b.onclick = function () { ui.board = b.dataset.board; renderHome(); }; });
    app.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { ui.tab = b.dataset.tab; renderHome(); }; });
    app.querySelectorAll('.card').forEach(function (c) { c.onclick = function () { openItem(c.dataset.id); }; });
    var es = document.getElementById('emptyAdd'); if (es) es.onclick = openAdd;
    var ss = document.getElementById('emptySetup'); if (ss) ss.onclick = openSetup;
    var ib = document.getElementById('importBtn'); if (ib) ib.onclick = function () { importLocal(ib); };
    var inb = document.getElementById('importNo'); if (inb) inb.onclick = function () { save('stashd:imported', true); renderHome(); };
    if (cur) bindBoardHeader(cur, !!ownB);
    var sel = app.querySelector('.chip[aria-pressed=true]'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function budgetHtml(b, items) {
    var cur = user.currency;
    var counted = items.filter(function (i) { return i.in_budget !== false; });
    var spent = homeSum(counted.filter(function (i) { return i.bought; })).sum, toBuy = homeSum(counted.filter(function (i) { return !i.bought; })).sum;
    if (b.budget == null || b.budget === '') return '<button class="budget empty" type="button" id="budgetBtn">＋ Add a budget</button>';
    // Left = budget − spent (bought) − planned (to buy)
    var B = +b.budget, left = B - spent - toBuy;
    var sp = B ? Math.min(100, spent / B * 100) : 100, tb = B ? Math.max(0, Math.min(100 - sp, toBuy / B * 100)) : 0;
    return '<button class="budget" type="button" id="budgetBtn" aria-label="Budget ' + esc(moneyR(B, cur)) + '. Edit budget">' +
      '<span class="brow"><b' + (left < 0 ? ' class="over"' : '') + '>' + esc(moneyR(Math.abs(left), cur)) + '</b><span>' + (left < 0 ? 'over' : 'left') + '</span></span>' +
      '<span class="bar' + (left < 0 ? ' is-over' : '') + '" aria-hidden="true"><i style="width:' + sp.toFixed(1) + '%"></i><i class="tb" style="width:' + tb.toFixed(1) + '%"></i></span>' +
      '<small class="blegend"><span><span class="dot sp"></span>Spent ' + esc(moneyR(spent)) + '</span><span><span class="dot tb"></span>Planned ' + esc(moneyR(toBuy)) + '</span><span class="of">of ' + esc(moneyR(B)) + '</span></small></button>';
  }
  function boardHeaderHtml(b, own, items) {
    var n = items.length;
    var secret = CLOUD && b.visibility !== 'public';
    return '<section class="bhead2">' +
      '<div class="bt"><h2>' + esc(b.name) + '</h2>' + (secret ? '<span class="lockb" title="Private board">' + LOCK.replace(/12/g, '16') + '</span>' : '') + '</div>' +
      '<p class="muted small">' + n + ' item' + (n === 1 ? '' : 's') + (own ? (secret ? ' · Private' : CLOUD ? ' · Public' + (b.save_count ? ' · ' + b.save_count + ' save' + (b.save_count === 1 ? '' : 's') : '') : '') : ' · Shared by @' + esc((b.owner && b.owner.username) || '') + ' · ' + (b.role === 'editor' ? 'you can add' : 'view only')) + '</p>' +
      '<div class="bact">' +
        (CLOUD ? '<button class="collab" type="button" id="collabBtn" aria-label="' + (own ? 'Invite collaborators' : 'See who\'s on this board') + '">' + stackHtml(b) + (own ? '<span class="av add">+</span>' : '') + '</button>' : '') +
        '<span class="grow"></span>' +
        (CLOUD ? '<button class="icon soft" type="button" id="shareB" aria-label="Share board">' + SHARE_SVG + '</button>' : '') +
        '<button class="icon soft" type="button" id="moreB" aria-label="' + (own ? 'Edit board' : 'Board info') + '">' + MORE_SVG + '</button>' +
      '</div>' + (own ? budgetHtml(b, items) : '') + '</section>';
  }
  function bindBoardHeader(b, own) {
    var bb = document.getElementById('budgetBtn'); if (bb) bb.onclick = function () { openBoardEditor(b, null, 'budget'); };
    var cb = document.getElementById('collabBtn'); if (cb) cb.onclick = function () { own ? openInvite(b) : openBoardInfo(b); };
    var sh = document.getElementById('shareB'); if (sh) sh.onclick = function () { openShare(b); };
    document.getElementById('moreB').onclick = function () { own ? openBoardEditor(b) : openBoardInfo(b); };
  }

  function emptyHtml() {
    if (ui.tab === 'bought') return '<div class="empty"><h2>Nothing bought yet</h2><p>Open an item and tap Mark as bought. Treat yourself.</p></div>';
    return '<div class="empty"><h2>Your stash is empty</h2><p>Paste a product link, or share one straight to Stashd from any app.</p>' +
      '<button class="btn primary" id="emptyAdd" type="button">Add a link</button><br><button class="link" id="emptySetup" type="button">Set up Share to Stashd</button></div>';
  }

  function cardHtml(it) {
    var img = safeImg(it.image_url);
    var sub = [it.brand ? '<span class="brand">' + esc(it.brand) + '</span>' : '', it.price != null ? esc(money(it.price, it.currency)) : ''].filter(Boolean).join(' · ');
    return '<button class="card" type="button" data-id="' + esc(it.id) + '">' +
      '<div class="ph' + (img ? '' : ' none') + '">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : letter(it)) + tagsHtml(it) + '</div>' +
      '<div class="meta"><b>' + esc(it.title || 'Untitled item') + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + convLine(it) +
      (it.in_budget === false ? '<small class="nb">Not in budget</small>' : '') + '</div></button>';
  }

  /* ---------- create / edit board ---------- */
  function openBoardEditor(b, done, focus) {
    var isNew = !b;
    var d = b || { name: '', visibility: 'private', in_budget: true, budget: null };
    var s = sheet('<h2>' + (isNew ? 'Create board' : 'Edit board') + '</h2><form id="beForm" novalidate>' +
      '<label class="field"><span>Name</span><input type="text" name="name" maxlength="40" placeholder="Like “Eid outfits” or “Home”" value="' + esc(d.name) + '" autocapitalize="sentences" required><small class="ferr" id="beErr"></small></label>' +
      (CLOUD ? switchHtml('secretSw', 'Private', 'On: only you and people you invite can see it. Off: public on your profile.', d.visibility !== 'public') : '') +
      '<label class="field" style="margin-top:1rem"><span>Budget (optional)</span><span class="cur"><input type="text" inputmode="decimal" name="budget" placeholder="e.g. 10,000" value="' + (d.budget == null ? '' : esc(d.budget)) + '"><em>' + esc(user.currency) + '</em></span>' +
        '<small class="help">We\'ll show what\'s left as you mark things bought.</small></label>' +
      switchHtml('budgetSw', 'Include in my totals', 'Count this board in To buy and Spent under All.', d.in_budget !== false) +
      (!isNew && CLOUD ? '<h3>Collaborators</h3><button class="person" type="button" id="manageCollab">' + stackHtml(b) + '<span><b>Invite or manage people</b><small>Choose who can view or add</small></span><em>›</em></button>' : '') +
      '<div class="stack"><button class="btn primary block" type="submit">' + (isNew ? 'Create' : 'Done') + '</button>' +
      (isNew ? '' : '<button class="link danger" type="button" id="bDel">Delete board</button>') + '</div></form>');
    if (isNew) setTimeout(function () { s.querySelector('[name=name]').focus(); }, 80);
    if (focus === 'budget') setTimeout(function () { s.querySelector('[name=budget]').focus(); }, 80);
    var mc = s.querySelector('#manageCollab'); if (mc) mc.onclick = function () { openInvite(b); };
    s.querySelector('#beForm').onsubmit = function (e) {
      e.preventDefault();
      var name = s.querySelector('[name=name]').value.trim().replace(/\s+/g, ' ');
      if (!name) { s.querySelector('#beErr').textContent = 'Give your board a name.'; return s.querySelector('[name=name]').focus(); }
      var secret = s.querySelector('#secretSw'), inBudget = s.querySelector('#budgetSw').checked;
      if (isNew) {
        b = newBoard(name.slice(0, 40)); db.boards.push(b);
      } else b.name = name.slice(0, 40);
      b.visibility = secret && !secret.checked ? 'public' : 'private';
      b.in_budget = inBudget;
      var bv = s.querySelector('[name=budget]').value.trim(); b.budget = bv ? num(bv) : null;
      api.saveBoard(b); closeSheet();
      if (done) return done(b);
      if (isNew) { ui.board = b.id; ui.tab = 'tobuy'; toast('Board "' + b.name + '" created'); }
      renderHome();
    };
    var del = s.querySelector('#bDel');
    if (del) del.onclick = async function () {
      if (!(await askConfirm('Delete the board "' + b.name + '"? Your items stay in All.' + (CLOUD ? ' People you shared it with lose access.' : ''), 'Delete board'))) return;
      db.boards = db.boards.filter(function (x) { return x.id !== b.id; });
      db.items = db.items.filter(function (i) { return i.board_id !== b.id || i.user_id === user.id; });
      db.items.forEach(function (i) { if (i.board_id === b.id) i.board_id = null; });
      api.deleteBoard(b.id); ui.board = 'all'; closeSheet(); renderHome(); toast('Board deleted');
    };
  }
  // "+ New" inside the Save / item sheets: an inline name box, so the sheet stays open.
  function promptBoard(done, btn) {
    if (!btn) return openBoardEditor(null, done);
    var wrap = document.createElement('span'); wrap.className = 'newb';
    wrap.innerHTML = '<input type="text" maxlength="40" placeholder="Board name" aria-label="New board name"><button class="chip" type="button">Add</button>';
    btn.replaceWith(wrap);
    var input = wrap.querySelector('input'); input.focus();
    function add() {
      var name = input.value.trim(); if (!name) return input.focus();
      var b = newBoard(name.slice(0, 40)); db.boards.push(b); api.saveBoard(b); toast('Board "' + b.name + '" created'); done(b);
    }
    wrap.querySelector('button').onclick = add;
    input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  }

  /* ---------- share + invite (Pinterest-style) ---------- */
  function openShare(b) {
    var own = roleOf(b.id) === 'owner';
    var s = sheet('<h2>Share board</h2><p class="muted small" id="shareNote"></p>' +
      '<div class="sharerow">' +
        '<button type="button" id="sCopy"><span class="sico">' + LINK_SVG + '</span>Copy link</button>' +
        '<a id="sWa" target="_blank" rel="noopener noreferrer"><span class="sico">' + CHAT_SVG + '</span>WhatsApp</a>' +
        (navigator.share ? '<button type="button" id="sMore"><span class="sico">' + SHARE_SVG + '</span>More</button>' : '') +
      '</div>' +
      (own && b.visibility !== 'public' ? switchHtml('linkSw', 'Anyone with the link can view', 'Turning it off makes old links stop working.', !!b.link_token) : '') +
      (own ? '<div class="stack"><button class="btn block" type="button" id="sInvite">Invite collaborators</button></div>' : ''));
    var url;
    function paint() {
      url = own ? boardLink(b) : base() + '?b=' + b.id;
      s.querySelector('#shareNote').textContent = b.visibility === 'public' ? 'Anyone with the link can see this board.'
        : b.link_token ? 'Anyone with the link can view it. Only collaborators can add.' : 'Only you and collaborators can open this link.';
      s.querySelector('#sWa').href = 'https://wa.me/?text=' + encodeURIComponent(b.name + ' on Stashd: ' + url);
    }
    paint();
    s.querySelector('#sCopy').onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link copied'); }).catch(function () { window.prompt('Copy this link', url); });
    };
    var m = s.querySelector('#sMore'); if (m) m.onclick = function () { navigator.share({ title: b.name + ' on Stashd', url: url }).catch(function () {}); };
    var ls = s.querySelector('#linkSw'); if (ls) ls.onchange = function () { b.link_token = ls.checked ? uid() : null; api.saveBoard(b); paint(); toast(ls.checked ? 'Link sharing on' : 'Link sharing off'); };
    var inv = s.querySelector('#sInvite'); if (inv) inv.onclick = function () { openInvite(b); };
  }

  async function openInvite(b) {
    var role = 'editor';
    var s = sheet('<h2>Invite collaborators</h2>' +
      '<div class="seg" role="radiogroup" aria-label="Access for people you invite"><button type="button" role="radio" data-role="editor">Can add</button><button type="button" role="radio" data-role="viewer">View only</button></div>' +
      '<p class="muted small" id="roleNote" style="margin:-.4rem 0 .9rem"></p>' +
      '<label class="field"><span class="sr">Search people</span><input type="search" id="iq" placeholder="Search by name or @username" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>' +
      '<h3 id="resTitle">People you follow</h3><div class="people" id="ires"><p class="loading muted">Loading…</p></div>' +
      '<h3>On this board</h3><div class="people" id="imem"></div>');
    function paintRole() {
      s.querySelectorAll('[data-role]').forEach(function (x) { x.setAttribute('aria-selected', x.dataset.role === role); x.setAttribute('aria-checked', x.dataset.role === role); });
      s.querySelector('#roleNote').textContent = role === 'editor' ? 'They can see the board and add or edit items.' : 'They can see the board but not change it.';
    }
    paintRole();
    s.querySelectorAll('[data-role]').forEach(function (x) { x.onclick = function () { role = x.dataset.role; paintRole(); }; });
    var members = await loadMembers(b), results = [];
    function isMember(id) { return members.some(function (m) { return m.user_id === id; }); }
    function paintResults() {
      var el = s.querySelector('#ires');
      el.innerHTML = results.length ? results.map(function (p) {
        return '<div class="person">' + avatar(p) + '<span><b>' + esc(p.name || p.username) + '</b><small>@' + esc(p.username) + '</small></span>' +
          (isMember(p.id) ? '<em>Added</em>' : '<button class="btn small" type="button" data-invite="' + esc(p.id) + '">Invite</button>') + '</div>';
      }).join('') : '<p class="muted small">' + (s.querySelector('#iq').value.trim() ? 'No one found.' : 'Search for friends by name or @username.') + '</p>';
      el.querySelectorAll('[data-invite]').forEach(function (btn) {
        btn.onclick = async function () {
          btn.disabled = true;
          var r = await sb.from('board_members').upsert({ board_id: b.id, user_id: btn.dataset.invite, role: role });
          if (r.error) { btn.disabled = false; return toast(friendly(r.error)); }
          members = await loadMembers(b); paintResults(); paintMembers(); renderHome();
          toast('Invited · ' + (role === 'editor' ? 'can add' : 'view only'));
        };
      });
    }
    function paintMembers() {
      var el = s.querySelector('#imem');
      el.innerHTML = '<div class="person">' + avatar(user) + '<span><b>' + esc(user.name) + ' (you)</b><small>Owner</small></span></div>' +
        members.map(function (m) {
          return '<div class="person">' + avatar(m.p) + '<span><b>' + esc(m.p.name || m.p.username) + '</b><small>@' + esc(m.p.username || '') + '</small></span>' +
            '<select data-mrole="' + esc(m.user_id) + '" aria-label="Access for @' + esc(m.p.username || '') + '"><option value="editor"' + (m.role === 'editor' ? ' selected' : '') + '>Can add</option><option value="viewer"' + (m.role === 'viewer' ? ' selected' : '') + '>View only</option></select>' +
            '<button class="icon rm" type="button" data-mrm="' + esc(m.user_id) + '" aria-label="Remove @' + esc(m.p.username || '') + '">×</button></div>';
        }).join('');
      el.querySelectorAll('[data-mrole]').forEach(function (sel) {
        sel.onchange = async function () { var x = await sb.from('board_members').update({ role: sel.value }).eq('board_id', b.id).eq('user_id', sel.dataset.mrole); toast(x.error ? friendly(x.error) : 'Access updated'); members = await loadMembers(b); };
      });
      el.querySelectorAll('[data-mrm]').forEach(function (btn) {
        btn.onclick = async function () { var x = await sb.from('board_members').delete().eq('board_id', b.id).eq('user_id', btn.dataset.mrm); if (x.error) return toast(friendly(x.error)); members = await loadMembers(b); paintMembers(); paintResults(); renderHome(); toast('Removed'); };
      });
    }
    paintMembers();
    var f = await sb.from('follows').select('p:profiles!follows_following_id_fkey(id,username,name)').eq('follower_id', user.id).limit(30);
    results = ((f.data || []).map(function (x) { return x.p; })).filter(function (p) { return p && p.username; });
    paintResults();
    var q = s.querySelector('#iq'), t, seq = 0;
    q.oninput = function () {
      clearTimeout(t);
      t = setTimeout(async function () {
        var v = q.value.trim().replace(/^@/, '').replace(/[,()%*\\]/g, ''), my = ++seq;
        if (v.length < 2) { s.querySelector('#resTitle').textContent = 'People you follow'; results = ((f.data || []).map(function (x) { return x.p; })).filter(function (p) { return p && p.username; }); return paintResults(); }
        var r = await sb.from('profiles').select('id,username,name').not('username', 'is', null).neq('id', user.id).or('username.ilike.' + v.toLowerCase() + '%,name.ilike.%' + v + '%').limit(20);
        if (my !== seq) return;
        s.querySelector('#resTitle').textContent = 'Results'; results = r.data || []; paintResults();
      }, 250);
    };
  }

  async function openBoardInfo(b) {
    var s = sheet('<h2>' + esc(b.name) + '</h2><p class="muted">Shared with you by ' + (b.owner && b.owner.username ? '<button class="link" type="button" id="ownerLink">@' + esc(b.owner.username) + '</button>' : 'its owner') +
      '. You can ' + (b.role === 'editor' ? 'view it and add items' : 'view it') + '.</p>' +
      '<h3>People on this board</h3><div class="people" id="members"><p class="loading muted">Loading…</p></div>' +
      '<div class="stack"><button class="btn block" type="button" id="shareBtn">Share</button><button class="link danger" type="button" id="leave">Leave board</button></div>');
    var ol = s.querySelector('#ownerLink'); if (ol) ol.onclick = function () { closeSheet(); nav({ u: b.owner.username }); };
    s.querySelector('#shareBtn').onclick = function () { openShare(b); };
    s.querySelector('#leave').onclick = async function () {
      if (!(await askConfirm('Leave "' + b.name + '"? You\'ll need to be invited again to see it.', 'Leave'))) return;
      var r = await sb.from('board_members').delete().eq('board_id', b.id).eq('user_id', user.id);
      if (r.error) return toast(friendly(r.error));
      db.shared = db.shared.filter(function (x) { return x.id !== b.id; }); ui.board = 'all'; closeSheet(); renderHome(); toast('You left the board');
    };
    var ms = await loadMembers(b), el = s.querySelector('#members');
    el.innerHTML = (b.owner ? personRow(b.owner, '<em>Owner</em>') : '') + ms.map(function (m) { return personRow(m.p, '<em>' + (m.user_id === user.id ? 'You · ' : '') + (m.role === 'editor' ? 'Can add' : 'View only') + '</em>'); }).join('');
    bindPeople(el);
  }

  /* ---------- profile setup (after sign-up, or first Google sign-in) ---------- */
  async function ensureUsername() {
    if (user.username) return;
    var local = (user.email || '').split('@')[0];
    var name0 = user.name && user.name !== local ? user.name : '';
    var s = sheet('<h2>Set up your profile</h2><p class="muted" style="margin-bottom:1rem">Friends find you by your username. You can change it later.</p>' +
      '<form id="unForm" novalidate>' +
        '<label class="field"><span>Name</span><input type="text" name="name" autocomplete="name" autocapitalize="words" maxlength="50" value="' + esc(name0) + '"><small class="ferr" id="nmErr"></small></label>' +
        '<label class="field"><span>Username</span><span class="at"><input type="text" name="username" autocapitalize="off" autocomplete="username" spellcheck="false" maxlength="20" value="' + esc(suggestUsername(name0)) + '"></span>' +
        '<small class="ferr" id="unErr"></small><small class="fok" id="unOk"></small><small class="help">Letters, numbers, dots and underscores.</small></label>' +
        '<label class="field"><span>Your currency</span><select name="currency">' + CURRENCIES.concat(CURRENCIES.indexOf(myCurrency()) < 0 ? [myCurrency()] : []).map(function (c) { return '<option' + (c === myCurrency() ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
          '<small class="help">Totals and budgets use this. Prices in other currencies are converted to it.</small></label>' +
        '<button class="btn primary block" type="submit">Continue</button></form>', { locked: true });
    var nameIn = s.querySelector('[name=name]'), input = s.querySelector('[name=username]'), edited = false;
    var st = bindUsername(input, s.querySelector('#unErr'), s.querySelector('#unOk'));
    input.addEventListener('input', function () { edited = true; });
    nameIn.addEventListener('input', function () { if (!edited) { input.value = suggestUsername(nameIn.value); st.check(); } });
    if (input.value) st.check();
    if (!name0) setTimeout(function () { nameIn.focus(); }, 80);
    s.querySelector('#unForm').onsubmit = async function (e) {
      e.preventDefault();
      var name = nameIn.value.trim().replace(/\s+/g, ' ');
      s.querySelector('#nmErr').textContent = name ? '' : 'Add your name.';
      if (!name) return nameIn.focus();
      if (!(await st.check())) return input.focus();
      var u = cleanUsername(input.value);
      var curPick = s.querySelector('[name=currency]').value;
      var r = await sb.from('profiles').upsert({ id: user.id, username: u, name: name, currency: curPick });
      if (r.error) { s.querySelector('#unErr').textContent = /duplicate|unique/i.test(r.error.message) ? '@' + u + ' was just taken. Try another.' : friendly(r.error); return; }
      user.username = u; user.name = name; user.currency = curPick; api.saveProfile(); closeSheet(); toast('Welcome, ' + name.split(' ')[0] + '!'); route();
    };
  }

  /* ---------- profiles ---------- */
  function boardCard(b, c, tag) {
    c = c || { n: 0, img: '' };
    return '<button class="bcard" type="button" data-bid="' + esc(b.id) + '"><span class="bimg' + (c.img ? '' : ' none') + '">' + (c.img ? '<img src="' + esc(c.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
      (tag ? '<span class="btag">' + tag + '</span>' : '') + '</span>' +
      '<b>' + esc(b.name) + '</b><small>' + c.n + ' item' + (c.n === 1 ? '' : 's') + '</small></button>';
  }
  async function renderProfile(username) {
    document.title = '@' + username + ' · Stashd';
    var tabs = user ? tabbarHtml('profile') : '';
    app.innerHTML = '<div class="home has-tabs">' + topbar() + '<p class="loading muted">Loading…</p></div>' + tabs; bindTopbar(); if (user) bindTabbar();
    var pr = await sb.from('profiles').select('id,username,name').eq('username', cleanUsername(username)).maybeSingle();
    if (pr.error || !pr.data) {
      app.innerHTML = '<div class="home has-tabs">' + topbar() + '<div class="empty"><h2>No one here</h2><p>We couldn\'t find @' + esc(username) + '.</p></div></div>' + tabs; bindTopbar(); if (user) bindTabbar(); return;
    }
    var p = pr.data, me = user && user.id === p.id;
    var q = await Promise.all([
      sb.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', p.id),
      sb.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', p.id),
      user && !me ? sb.from('follows').select('follower_id').eq('follower_id', user.id).eq('following_id', p.id).maybeSingle() : Promise.resolve({ data: null }),
      me ? Promise.resolve({ data: db.boards }) : sb.from('boards').select('id,name,visibility,created_at').eq('user_id', p.id).order('created_at')
    ]);
    var boards = q[3].data || [];
    var shared = me ? (db.shared || []) : boards.filter(function (b) { return b.visibility !== 'public' && user && sharedBoard(b.id); });   // secret boards I was invited to
    var mine = me ? boards : boards.filter(function (b) { return b.visibility === 'public'; });
    var savedBoards = [];
    if (me) {
      var sv = await sb.from('board_saves').select('created_at,b:boards(id,name,visibility,user_id,save_count)').eq('user_id', user.id).order('created_at', { ascending: false });
      savedBoards = (sv.data || []).map(function (x) { return x.b; }).filter(function (b) { return b && b.visibility === 'public'; });
    }
    var all = mine.concat(me ? shared : [], savedBoards), covers = {};
    if (all.length) {
      var it = await sb.from('items').select('board_id,image_url,created_at').in('board_id', all.map(function (b) { return b.id; })).order('created_at', { ascending: false }).limit(1000);
      (it.data || []).forEach(function (i) { var c = covers[i.board_id] || (covers[i.board_id] = { n: 0, img: '' }); c.n++; if (!c.img && safeImg(i.image_url)) c.img = i.image_url; });
    }
    var following = !!q[2].data, nFollowers = q[0].count || 0;
    function paint() {
      app.innerHTML = '<div class="home has-tabs">' + topbar(me ? '<button class="icon soft" type="button" id="settingsBtn" aria-label="Settings">' + GEAR_SVG + '</button>' : '') +
        '<section class="profile">' + avatar(p, 'big') + '<h1>' + esc(p.name || p.username) + '</h1><p class="muted">@' + esc(p.username) + '</p>' +
          '<div class="counts"><button type="button" id="fwers"><b>' + nFollowers + '</b> follower' + (nFollowers === 1 ? '' : 's') + '</button><button type="button" id="fwing"><b>' + (q[1].count || 0) + '</b> following</button></div>' +
          (me ? '<div class="row"><button class="btn" type="button" id="editP">Edit profile</button><button class="btn" type="button" id="shareP">Share profile</button></div>'
            : user ? '<button class="btn ' + (following ? '' : 'primary') + ' follow" type="button" id="followBtn">' + (following ? 'Following' : 'Follow') + '</button>'
            : '<button class="btn primary follow" type="button" id="joinBtn">Sign up to follow</button>') +
        '</section>' +
        '<h2 class="sec">' + (me ? 'Your boards' : 'Boards') + '</h2>' +
        (mine.length ? '<section class="boards">' + mine.map(function (b) { return boardCard(b, covers[b.id], me && b.visibility !== 'public' ? LOCK + ' Private' : ''); }).join('') + '</section>'
          : '<p class="muted">' + (me ? 'No boards yet.' : 'No public boards yet.') + '</p>') +
        (me ? '<p class="muted small" style="margin-top:.6rem">Others see only your public boards.</p>' : '') +
        (shared.length ? '<h2 class="sec">Shared with you</h2><section class="boards">' + shared.map(function (b) { return boardCard(b, covers[b.id], PEOPLE_SVG.replace(/22/g, '12') + ' Shared'); }).join('') + '</section>' : '') +
        (savedBoards.length ? '<h2 class="sec">Saved boards</h2><section class="boards">' + savedBoards.map(function (b) { return boardCard(b, covers[b.id], '♡ ' + (b.save_count || 0)); }).join('') + '</section>' : '') +
      '</div>' + tabs;
      bindTopbar(); if (user) bindTabbar();
      document.getElementById('fwers').onclick = function () { openFollowList(p, 'followers'); };
      document.getElementById('fwing').onclick = function () { openFollowList(p, 'following'); };
      app.querySelectorAll('[data-bid]').forEach(function (b) { b.onclick = function () { nav({ b: b.dataset.bid }); }; });
      var fb = document.getElementById('followBtn');
      if (fb) fb.onclick = async function () {
        fb.disabled = true;
        var r = following ? await sb.from('follows').delete().eq('follower_id', user.id).eq('following_id', p.id)
          : await sb.from('follows').insert({ follower_id: user.id, following_id: p.id });
        if (r.error) { fb.disabled = false; return toast(friendly(r.error)); }
        following = !following; nFollowers += following ? 1 : -1; paint();
      };
      var jb = document.getElementById('joinBtn'); if (jb) jb.onclick = function () { renderAuth('signup'); };
      var ep = document.getElementById('editP'); if (ep) ep.onclick = openEditProfile;
      var sp = document.getElementById('shareP'); if (sp) sp.onclick = function () { shareLink(base() + '?u=' + p.username, (p.name || p.username) + ' on Stashd'); };
      var sb2 = document.getElementById('settingsBtn'); if (sb2) sb2.onclick = openMenu;
    }
    paint();
  }

  /* ---------- explore + saved boards ---------- */
  var savedIds = new Set();
  async function loadSaved() {
    if (!CLOUD || !sb || !user) return;
    var r = await sb.from('board_saves').select('board_id').eq('user_id', user.id);
    savedIds = new Set((r.data || []).map(function (x) { return x.board_id; }));
  }
  async function toggleSave(b) {
    if (!user) { renderAuth('signup'); return null; }
    var on = savedIds.has(b.id);
    var r = on ? await sb.from('board_saves').delete().eq('user_id', user.id).eq('board_id', b.id)
      : await sb.from('board_saves').insert({ user_id: user.id, board_id: b.id });
    if (r.error) { toast(friendly(r.error)); return null; }
    if (on) { savedIds.delete(b.id); b.save_count = Math.max(0, (b.save_count || 0) - 1); }
    else { savedIds.add(b.id); b.save_count = (b.save_count || 0) + 1; }
    toast(on ? 'Removed from your saved boards' : 'Saved to your profile');
    return !on;
  }
  // Up to 3 photos and the item count for each board
  async function boardCovers(ids) {
    var m = {};
    if (!ids.length) return m;
    var r = await sb.from('items').select('board_id,image_url,created_at').in('board_id', ids).order('created_at', { ascending: false }).limit(800);
    (r.data || []).forEach(function (i) { var c = m[i.board_id] || (m[i.board_id] = { n: 0, imgs: [] }); c.n++; if (c.imgs.length < 3 && safeImg(i.image_url)) c.imgs.push(i.image_url); });
    return m;
  }
  function tileHtml(b, c, owner) {
    c = c || { n: 0, imgs: [] };
    var im = function (u, cls) { return '<span class="' + cls + '">' + (u ? '<img src="' + esc(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>'; };
    return '<button class="tile" type="button" data-bid="' + esc(b.id) + '"><span class="col">' + im(c.imgs[0], 'c1') + '<span class="col2">' + im(c.imgs[1], 'c2') + im(c.imgs[2], 'c3') + '</span></span>' +
      '<b>' + esc(b.name) + '</b><small>' + (owner && owner.username ? '@' + esc(owner.username) + ' · ' : '') + c.n + ' item' + (c.n === 1 ? '' : 's') +
      (b.save_count ? ' · ' + b.save_count + ' save' + (b.save_count === 1 ? '' : 's') : '') + '</small></button>';
  }
  async function renderExplore() {
    document.title = 'Explore · Stashd';
    app.innerHTML = '<div class="home has-tabs"><header class="top"><h1 class="wm">Explore</h1></header>' +
      '<label class="field"><span class="sr">Search</span><input type="search" id="xq" placeholder="Search people and boards" autocapitalize="off" spellcheck="false" enterkeyhint="search"></label>' +
      '<div id="xres"></div><h2 class="sec" id="xh">Popular boards</h2><section class="tiles" id="xpop"><p class="loading muted">Loading…</p></section></div>' + (user ? tabbarHtml('explore') : '');
    if (user) bindTabbar();
    var pop = document.getElementById('xpop');
    // Search works straight away, before popular boards finish loading.
    var q = document.getElementById('xq'), res = document.getElementById('xres'), tmr, seq = 0;
    q.oninput = function () {
      clearTimeout(tmr);
      tmr = setTimeout(async function () {
        var v = q.value.trim().replace(/^@/, '').replace(/[,()%*\\]/g, ''), my = ++seq;
        if (v.length < 2) { res.innerHTML = ''; document.getElementById('xh').hidden = false; pop.hidden = false; return; }
        var rr = await Promise.all([
          sb.from('profiles').select('id,username,name').not('username', 'is', null).or('username.ilike.' + v.toLowerCase() + '%,name.ilike.%' + v + '%').limit(8),
          sb.from('boards').select('id,name,user_id,save_count').eq('visibility', 'public').ilike('name', '%' + v + '%').order('save_count', { ascending: false }).limit(12)
        ]);
        if (my !== seq) return;
        var people = (rr[0].data || []).filter(function (p) { return !user || p.id !== user.id; }), bs = rr[1].data || [];
        res.innerHTML = (people.length ? '<h2 class="sec">People</h2><div class="people">' + people.map(function (p) { return personRow(p); }).join('') + '</div>' : '') +
          (bs.length ? '<h2 class="sec">Boards</h2><div class="people">' + bs.map(function (b) {
            return '<button class="person" type="button" data-bid="' + esc(b.id) + '"><span class="av">' + esc(b.name.charAt(0).toUpperCase()) + '</span><span><b>' + esc(b.name) + '</b><small>' + (b.save_count || 0) + ' saves</small></span></button>';
          }).join('') + '</div>' : '') + (!people.length && !bs.length ? '<p class="muted">Nothing found for "' + esc(v) + '".</p>' : '');
        document.getElementById('xh').hidden = true; pop.hidden = true;
        bindPeople(res);
        res.querySelectorAll('[data-bid]').forEach(function (x) { x.onclick = function () { nav({ b: x.dataset.bid }); }; });
      }, 250);
    };

    var r = await sb.from('boards').select('id,name,user_id,save_count,created_at').eq('visibility', 'public').neq('user_id', user ? user.id : '00000000-0000-0000-0000-000000000000')
      .order('save_count', { ascending: false }).order('created_at', { ascending: false }).limit(40);
    var boards = r.data || [];
    var covers = await boardCovers(boards.map(function (b) { return b.id; }));
    boards = boards.filter(function (b) { return covers[b.id] && covers[b.id].n; });
    var owners = {};
    if (boards.length) {
      var o = await sb.from('profiles').select('id,username,name').in('id', boards.map(function (b) { return b.user_id; }));
      (o.data || []).forEach(function (p) { owners[p.id] = p; });
    }
    if (!document.body.contains(pop)) return;
    pop.innerHTML = boards.length ? boards.map(function (b) { return tileHtml(b, covers[b.id], owners[b.user_id]); }).join('')
      : '<p class="muted">No public boards yet. Make one of yours public to be the first!</p>';
    pop.querySelectorAll('[data-bid]').forEach(function (x) { x.onclick = function () { nav({ b: x.dataset.bid }); }; });
  }

  /* ---------- start ---------- */
  async function boot() {
    var p = new URLSearchParams(location.search);
    var shared = extractUrl([p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' '));
    if (p.get('d')) {            // from the Safari Shortcut: product details read on the page
      try { var d = JSON.parse(p.get('d')); shared = extractUrl(d.u) || shared; sessionStorage.setItem('stashd:pendingData', JSON.stringify(d)); } catch (e) {}
    }
    if (p.has('url') || p.has('text') || p.has('title') || p.has('d')) {
      ['url', 'text', 'title', 'd'].forEach(function (k) { p.delete(k); });
      var q = p.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    }
    if (shared) { try { sessionStorage.setItem(KEY.pending, shared); } catch (e) {} }
    if (CLOUD) {
      if (!window.supabase || !window.supabase.createClient) {
        app.innerHTML = '<div class="empty"><h2>Can\'t reach Stashd</h2><p>Check your connection and reload the page.</p></div>';
        return;
      }
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
      sb.auth.onAuthStateChange(function (ev) { if (ev === 'PASSWORD_RECOVERY') setTimeout(openNewPassword, 0); });
      var got = await sb.auth.getSession();
      var ses = got && got.data && got.data.session;
      if (ses) startCloud(ses.user, location.hash.indexOf('type=signup') >= 0 ? 'Email confirmed. Welcome to Stashd!' : '');
      else route();
      return;
    }
    var sid = load(KEY.session, null), users = load(KEY.users, {});
    var u = sid && Object.keys(users).map(function (k) { return users[k]; }).find(function (x) { return x.id === sid; });
    if (u) signIn(u); else renderAuth();
  }
  boot();
})();
