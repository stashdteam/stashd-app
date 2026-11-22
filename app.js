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
  function fmt(n) { return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n); }
  function money(n, c) { return n == null ? '' : (c ? c + ' ' : '') + fmt(n); }
  function pct(it) { return (it.price != null && it.was_price != null && it.was_price > it.price) ? Math.round((it.was_price - it.price) / it.was_price * 100) : 0; }
  function hostBrand(url) { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch (e) { return ''; } }
  function boardName(id) { var b = db.boards.find(function (x) { return x.id === id; }); return b ? b.name : ''; }
  function persist() { return CLOUD ? true : save(KEY.data(user.id), db); }
  var toastTimer;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600); }

  /* ---------- backend ---------- */
  var CFG = window.STASHD_CONFIG || {};
  var CLOUD = !!(CFG.supabaseUrl && CFG.supabaseKey);
  var sb = null;
  var COLS = ['id', 'user_id', 'board_id', 'url', 'title', 'brand', 'image_url', 'price', 'was_price', 'currency', 'size', 'sizes', 'note', 'sold_out', 'bought', 'created_at'];
  function row(it) { var r = {}; COLS.forEach(function (k) { if (it[k] !== undefined) r[k] = it[k]; }); return r; }
  function base() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
  function syncFail(e) { if (window.console) console.error(e); toast("Couldn't sync. " + ((e && e.message) || 'Check your connection.')); return false; }
  function done(r) { return r.error ? syncFail(r.error) : true; }
  var saveTimers = {};
  var api = {
    saveItem: function (it) { clearTimeout(saveTimers[it.id]); return CLOUD ? sb.from('items').upsert(row(it)).then(done, syncFail) : Promise.resolve(persist()); },
    saveItemSoon: function (it) { clearTimeout(saveTimers[it.id]); if (!CLOUD) return persist(); saveTimers[it.id] = setTimeout(function () { api.saveItem(it); }, 600); },
    deleteItem: function (id) { clearTimeout(saveTimers[id]); return CLOUD ? sb.from('items').delete().eq('id', id).then(done, syncFail) : Promise.resolve(persist()); },
    saveBoard: function (b) { return CLOUD ? sb.from('boards').upsert({ id: b.id, user_id: b.user_id, name: b.name, created_at: b.created_at }).then(done, syncFail) : Promise.resolve(persist()); },
    deleteBoard: function (id) { return CLOUD ? sb.from('boards').delete().eq('id', id).then(done, syncFail) : Promise.resolve(persist()); },
    saveProfile: function () {
      if (!CLOUD) { saveUser(); return Promise.resolve(true); }
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

  function totals(items, fallbackCur) {
    var by = {}, order = [];
    items.forEach(function (i) { if (i.price != null) { var c = i.currency || ''; if (!(c in by)) { by[c] = 0; order.push(c); } by[c] += i.price; } });
    return order.length ? order.map(function (c) { return money(by[c], c); }).join(' + ') : money(0, fallbackCur);
  }

  /* ---------- sheets ---------- */
  function sheet(html) {
    closeSheet();
    var o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><button class="x" type="button" aria-label="Close">×</button>' + html + '</div>';
    document.body.appendChild(o);
    document.body.classList.add('locked');
    o.addEventListener('click', function (e) { if (e.target === o || e.target.closest('.x')) closeSheet(); });
    return o.querySelector('.sheet');
  }
  function closeSheet() { document.querySelectorAll('.overlay').forEach(function (o) { o.remove(); }); document.body.classList.remove('locked'); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
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
          (up ? '<label class="field"><span>Name</span><input type="text" name="name" autocomplete="given-name" autocapitalize="words" maxlength="50" enterkeyhint="next" aria-describedby="nameErr" required><small class="ferr" id="nameErr"></small></label>' : '') +
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
      var ok = [checkName(), checkEmail('quiet'), checkPw()];
      if (ok.indexOf(false) >= 0) { var bad = form.querySelector('[aria-invalid=true]'); if (bad) bad.focus(); return; }
      var email = f.email.value.trim().toLowerCase(), pw = f.pw.value, name = f.name ? f.name.value.trim().replace(/\s+/g, ' ') : '';
      var news = !!(form.elements.news && form.elements.news.checked);
      if (CLOUD) return cloudAuth(up, name, email, pw, news, err, form.querySelector('[type=submit]'));
      var users = load(KEY.users, {});
      if (up) {
        if (users[email]) return (err.textContent = 'There\'s already an account with that email on this device. Sign in instead.');
        var salt = uid();
        users[email] = { id: uid(), name: name, email: email, salt: salt, hash: await hash(pw, salt), currency: 'EGP', created_at: new Date().toISOString() };
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
        var r = await sb.auth.signUp({ email: email, password: pw, options: { data: { name: name, currency: 'EGP' }, emailRedirectTo: base() } });
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
        if (r.data.session) return startCloud(r.data.session.user, 'Welcome to Stashd, ' + name + '!');
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

  async function startCloud(au, msg) {
    var md = au.user_metadata || {};
    user = { id: au.id, email: au.email, name: md.name || md.full_name || md.given_name || (au.email || '').split('@')[0], currency: md.currency || 'EGP' };
    app.innerHTML = '<p class="boot loading" style="justify-content:center">Loading your stash…</p>';
    var res = await Promise.all([
      sb.from('boards').select('id,user_id,name,created_at').order('created_at'),
      sb.from('items').select('*').order('created_at', { ascending: false })
    ]).catch(function (e) { return [{ error: e }, {}]; });
    if (res[0].error || res[1].error) {
      var e = res[0].error || res[1].error;
      app.innerHTML = '<div class="empty"><h2>Couldn\'t load your stash</h2><p>' + esc(friendly(e)) + '</p><button class="btn primary" id="retry" type="button">Try again</button></div>';
      document.getElementById('retry').onclick = function () { startCloud(au, msg); };
      return;
    }
    db = { boards: res[0].data, items: res[1].data };
    if (!db.boards.length) {
      var seed = [newBoard('Outfits', 0), newBoard('Gifts', 1)];
      var ins = await sb.from('boards').insert(seed).select('id,user_id,name,created_at');
      db.boards = ins.error ? [] : ins.data;
    }
    afterSignIn(msg);
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
    renderHome();
    var p = takePending();
    if (p) openSave(p); else if (msg) toast(msg);
  }
  async function signOut() {
    if (CLOUD) { try { await sb.auth.signOut(); } catch (e) {} }
    else { try { localStorage.removeItem(KEY.session); } catch (e) {} }
    user = db = null; closeSheet(); renderAuth('signin');
  }
  function saveUser() { var users = load(KEY.users, {}); users[user.email] = user; save(KEY.users, users); }
  function newBoard(name, n) { return { id: uid(), user_id: user.id, name: name, created_at: new Date(Date.now() + (n || 0)).toISOString() }; }

  /* ---------- home ---------- */
  function renderHome() {
    document.title = 'Stashd';
    if (ui.board !== 'all' && !boardName(ui.board)) ui.board = 'all';
    var inBoard = ui.board === 'all' ? db.items : db.items.filter(function (i) { return i.board_id === ui.board; });
    var toBuy = inBoard.filter(function (i) { return !i.bought; }), bought = inBoard.filter(function (i) { return i.bought; });
    var list = (ui.tab === 'bought' ? bought : toBuy).slice().sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });

    app.innerHTML =
      '<div class="home">' +
        '<header class="top"><h1 class="wm">Stash<span>d</span></h1><div class="actions">' +
          '<button class="icon add" id="addBtn" type="button" aria-label="Add a link">+</button>' +
          '<button class="icon me" id="meBtn" type="button" aria-label="Account and settings">' + esc((user.name || '?').charAt(0).toUpperCase()) + '</button>' +
        '</div></header>' +
        '<nav class="chips" aria-label="Boards">' +
          '<button class="chip" type="button" data-board="all" aria-pressed="' + (ui.board === 'all') + '">All</button>' +
          db.boards.map(function (b) { return '<button class="chip" type="button" data-board="' + esc(b.id) + '" aria-pressed="' + (ui.board === b.id) + '">' + esc(b.name) + '</button>'; }).join('') +
          (ui.board !== 'all' ? '<button class="chip ghost" type="button" id="editBoard">Edit board</button>' : '') +
          '<button class="chip ghost" type="button" id="newBoardBtn">+ Board</button>' +
        '</nav>' +
        '<div class="seg" role="tablist">' +
          '<button type="button" role="tab" data-tab="tobuy" aria-selected="' + (ui.tab === 'tobuy') + '">To buy · ' + toBuy.length + '</button>' +
          '<button type="button" role="tab" data-tab="bought" aria-selected="' + (ui.tab === 'bought') + '">Bought · ' + bought.length + '</button>' +
        '</div>' +
        (CLOUD && localStashes().length ? '<div class="hint" style="margin:0 0 1rem">You have items from the test version saved on this device. <div class="row" style="margin-top:.6rem"><button class="btn primary" type="button" id="importBtn">Move them to my account</button><button class="btn" type="button" id="importNo">No thanks</button></div></div>' : '') +
        '<div class="sum"><span class="muted">' + (ui.tab === 'bought' ? 'Spent' : 'Left to spend') + '</span><strong>' + esc(totals(ui.tab === 'bought' ? bought : toBuy, user.currency)) + '</strong></div>' +
        (list.length ? '<section class="grid">' + list.map(cardHtml).join('') + '</section>' : emptyHtml()) +
      '</div>';

    document.getElementById('addBtn').onclick = openAdd;
    document.getElementById('meBtn').onclick = openMenu;
    document.getElementById('newBoardBtn').onclick = function () { promptBoard(function (b) { ui.board = b.id; renderHome(); }); };
    var eb = document.getElementById('editBoard'); if (eb) eb.onclick = openBoardEdit;
    app.querySelectorAll('[data-board]').forEach(function (b) { b.onclick = function () { ui.board = b.dataset.board; renderHome(); }; });
    app.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { ui.tab = b.dataset.tab; renderHome(); }; });
    app.querySelectorAll('.card').forEach(function (c) { c.onclick = function () { openItem(c.dataset.id); }; });
    var es = document.getElementById('emptyAdd'); if (es) es.onclick = openAdd;
    var ss = document.getElementById('emptySetup'); if (ss) ss.onclick = openSetup;
    var ib = document.getElementById('importBtn'); if (ib) ib.onclick = function () { importLocal(ib); };
    var inb = document.getElementById('importNo'); if (inb) inb.onclick = function () { save('stashd:imported', true); renderHome(); };
  }

  function emptyHtml() {
    if (ui.tab === 'bought') return '<div class="empty"><h2>Nothing bought yet</h2><p>Open an item and tap Mark as bought. Treat yourself.</p></div>';
    return '<div class="empty"><h2>Your stash is empty</h2><p>Paste a product link, or share one straight to Stashd from any app.</p>' +
      '<button class="btn primary" id="emptyAdd" type="button">Add a link</button><br><button class="link" id="emptySetup" type="button">Set up Share to Stashd</button></div>';
  }

  function tagsHtml(it, inline) {
    var p = pct(it), s = (it.sold_out ? '<span class="t sold">Sold out</span>' : '') + (p ? '<span class="t off">−' + p + '%</span>' : '');
    return s ? '<div class="tags' + (inline ? ' inline' : '') + '">' + s + '</div>' : '';
  }
  function letter(it) { return '<span class="letter" aria-hidden="true">' + esc((it.brand || it.title || '?').charAt(0).toUpperCase()) + '</span>'; }

  function cardHtml(it) {
    var img = safeImg(it.image_url);
    var sub = [it.brand ? '<span class="brand">' + esc(it.brand) + '</span>' : '', it.price != null ? esc(money(it.price, it.currency)) : ''].filter(Boolean).join(' · ');
    return '<button class="card" type="button" data-id="' + esc(it.id) + '">' +
      '<div class="ph' + (img ? '' : ' none') + '">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : letter(it)) + tagsHtml(it) + '</div>' +
      '<div class="meta"><b>' + esc(it.title || 'Untitled item') + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div></button>';
  }

  /* ---------- boards ---------- */
  function promptBoard(done) {
    var name = (window.prompt('Name your new board', '') || '').trim();
    if (!name) return;
    var b = newBoard(name.slice(0, 40)); db.boards.push(b); api.saveBoard(b); toast('Board "' + b.name + '" added');
    done(b);
  }
  function openBoardEdit() {
    var b = db.boards.find(function (x) { return x.id === ui.board; }); if (!b) return;
    var s = sheet('<h2>Edit board</h2><label class="field"><span>Board name</span><input type="text" id="bName" maxlength="40" value="' + esc(b.name) + '"></label>' +
      '<div class="stack"><button class="btn primary" id="bSave" type="button">Save</button><button class="btn danger" id="bDel" type="button">Delete board</button></div>' +
      '<p class="muted" style="margin-top:.75rem;font-size:.875rem">Deleting a board keeps its items. They stay under All.</p>');
    s.querySelector('#bSave').onclick = function () { var n = s.querySelector('#bName').value.trim(); if (n) { b.name = n.slice(0, 40); api.saveBoard(b); } closeSheet(); renderHome(); };
    s.querySelector('#bDel').onclick = function () {
      if (!confirm('Delete the board "' + b.name + '"? Its items stay in All.')) return;
      db.boards = db.boards.filter(function (x) { return x.id !== b.id; });
      db.items.forEach(function (i) { if (i.board_id === b.id) i.board_id = null; });
      api.deleteBoard(b.id); ui.board = 'all'; closeSheet(); renderHome(); toast('Board deleted');
    };
  }
  function boardChips(it) {
    return '<div class="chips wrap" data-role="boards">' + db.boards.map(function (b) {
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
    if (nb) nb.onclick = function () { promptBoard(function (b) { it.board_id = b.id; var wrap = root.querySelector('[data-role=boards]'); wrap.outerHTML = boardChips(it); bindBoardChips(root, it, onChange); onChange(); }); };
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

  function detailsHtml(it, open) {
    var curOpts = CURRENCIES.indexOf(it.currency) < 0 && it.currency ? [it.currency].concat(CURRENCIES) : CURRENCIES;
    return '<details class="edit"' + (open ? ' open' : '') + '><summary>Edit details</summary>' +
      '<label class="field"><span>Title</span><input type="text" data-f="title" value="' + esc(it.title) + '" maxlength="140"></label>' +
      '<label class="field"><span>Store</span><input type="text" data-f="brand" value="' + esc(it.brand) + '" maxlength="60"></label>' +
      '<div class="two"><label class="field"><span>Price</span><input type="text" inputmode="decimal" data-f="price" value="' + (it.price == null ? '' : it.price) + '"></label>' +
      '<label class="field"><span>Old price</span><input type="text" inputmode="decimal" data-f="was_price" value="' + (it.was_price == null ? '' : it.was_price) + '" placeholder="If on sale"></label></div>' +
      '<label class="field"><span>Currency</span><select data-f="currency">' + curOpts.map(function (c) { return '<option' + (c === it.currency ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
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

  function previewHtml(it) {
    var img = safeImg(it.image_url);
    return '<div class="preview"><div class="pimg' + (img ? '' : ' none') + '">' + (img ? '<img src="' + esc(img) + '" alt="" referrerpolicy="no-referrer">' : letter(it)) + '</div>' +
      '<div><b>' + esc(it.title || 'Untitled item') + '</b>' + (it.brand ? '<small class="brand">' + esc(it.brand) + '</small>' : '') +
      (it.price != null ? '<div class="price">' + esc(money(it.price, it.currency)) + (it.was_price > it.price ? '<s>' + esc(fmt(it.was_price)) + '</s>' : '') + '</div>' : '') +
      tagsHtml(it, true) + '</div></div>';
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
    return { ok: false };
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

  async function openSave(url) {
    var dupe = db.items.find(function (i) { return i.url === url; });
    var it = {
      id: uid(), user_id: user.id, board_id: ui.board !== 'all' ? ui.board : (db.boards[0] ? db.boards[0].id : null),
      url: url, title: '', brand: hostBrand(url), image_url: '', price: null, was_price: null, currency: user.currency || 'EGP',
      size: '', note: '', sold_out: false, bought: false, created_at: '', sizes: []
    };
    var s = sheet('<h2>Save to Stashd</h2><div id="prev">' + previewHtml(it) + '</div><div id="saveBody"><p class="loading muted">Reading the link…</p></div>');
    var info = await readLink(url).catch(function () { return { ok: false }; });
    if (!document.body.contains(s)) return;
    ['title', 'brand', 'image_url', 'price', 'was_price', 'sold_out', 'sizes'].forEach(function (k) { if (info[k] != null && info[k] !== '') it[k] = info[k]; });
    if (info.currency) it.currency = String(info.currency).toUpperCase();
    if (!it.title) it.title = '';
    var needsHelp = !info.ok || it.price == null;
    var hint = !info.ok ? "Couldn't read this page automatically. Add the details below."
      : it.price == null ? 'Got the basics. Add the price below so it counts in your total.' : '';

    var prev = s.querySelector('#prev'), body = s.querySelector('#saveBody');
    prev.innerHTML = previewHtml(it);
    body.innerHTML = (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
      (dupe ? '<p class="hint">You already stashed this link. Saving again adds a second copy.</p>' : '') +
      '<h3>Board</h3>' + boardChips(it) + sizeHtml(it) +
      '<label class="field" style="margin-top:1rem"><span>Note (optional)</span><textarea data-f="note" maxlength="300" placeholder="Wait for payday? Ask for it as a gift?"></textarea></label>' +
      detailsHtml(it, needsHelp) +
      '<div class="stack"><button class="btn primary block" type="button" id="stashBtn">Stash it</button></div>';
    var refresh = function (f) { if (!f || f !== 'note') prev.innerHTML = previewHtml(it); };
    bindBoardChips(body, it, refresh); bindSize(body, it, refresh); bindFields(body, it, refresh);
    body.querySelector('#stashBtn').onclick = async function () {
      var btn = this;
      if (!it.title) it.title = it.brand ? it.brand + ' item' : 'Untitled item';
      it.created_at = new Date().toISOString();
      btn.disabled = true; btn.textContent = 'Stashing…';
      db.items.push(it);
      if (!(await api.saveItem(it))) { db.items.pop(); btn.disabled = false; btn.textContent = 'Stash it'; return; }
      closeSheet(); ui.tab = 'tobuy'; renderHome();
      toast('Saved' + (it.board_id ? ' to ' + boardName(it.board_id) : '') + ' · just now');
    };
  }

  /* ---------- item ---------- */
  function openItem(id) {
    var it = db.items.find(function (i) { return i.id === id; }); if (!it) return;
    var img = safeImg(it.image_url);
    var s = sheet(
      '<div class="hero-img' + (img ? '' : ' none') + '" id="iHero">' + (img ? '<img src="' + esc(img) + '" alt="" referrerpolicy="no-referrer">' : letter(it)) + tagsHtml(it) + '</div>' +
      '<div id="iHead"></div>' +
      '<h3>Board</h3>' + boardChips(it) + sizeHtml(it) +
      '<label class="field" style="margin-top:1rem"><span>Note</span><textarea data-f="note" maxlength="300" placeholder="Add a note">' + esc(it.note) + '</textarea></label>' +
      '<label class="switch"><span>Sold out</span><input type="checkbox" role="switch" id="soldSw"' + (it.sold_out ? ' checked' : '') + '><i aria-hidden="true"></i></label>' +
      '<div class="stack">' +
        '<button class="btn primary block" type="button" id="boughtBtn"></button>' +
        (safeLink(it.url) ? '<a class="btn block" id="openStore" href="' + esc(safeLink(it.url)) + '" target="_blank" rel="noopener noreferrer">Open store page</a>' : '') +
      '</div>' +
      detailsHtml(it, false) +
      '<div class="stack"><button class="link danger" type="button" id="delBtn">Delete item</button></div>');
    var head = s.querySelector('#iHead'), hero = s.querySelector('#iHero'), bb = s.querySelector('#boughtBtn');
    function paint() {
      head.innerHTML = '<h2 style="margin-right:0">' + esc(it.title || 'Untitled item') + '</h2>' +
        '<p class="muted"><span class="brand">' + esc(it.brand) + '</span>' + (it.board_id ? ' · ' + esc(boardName(it.board_id)) : '') + '</p>' +
        (it.price != null ? '<div class="price">' + esc(money(it.price, it.currency)) + (it.was_price > it.price ? '<s>' + esc(fmt(it.was_price)) + '</s>' : '') + '</div>' : '');
      var t = hero.querySelector('.tags'); if (t) t.remove(); hero.insertAdjacentHTML('beforeend', tagsHtml(it));
      bb.textContent = it.bought ? 'Move back to To buy' : 'Mark as bought';
    }
    var change = function (f) {
      api.saveItemSoon(it); paint(); renderHome();
      if (f === 'image_url') { hero.classList.remove('none'); hero.innerHTML = '<img src="' + esc(safeImg(it.image_url)) + '" alt="">' + tagsHtml(it); }
      if (f === 'url') { var a = s.querySelector('#openStore'); if (a && safeLink(it.url)) a.href = safeLink(it.url); }
    };
    paint();
    bindBoardChips(s, it, change); bindSize(s, it, change); bindFields(s, it, change);
    s.querySelector('#soldSw').onchange = function (e) { it.sold_out = e.target.checked; change(); };
    bb.onclick = function () { it.bought = !it.bought; api.saveItem(it); closeSheet(); renderHome(); toast(it.bought ? 'Marked as bought. Enjoy it!' : 'Moved back to To buy'); };
    s.querySelector('#delBtn').onclick = function () {
      if (!confirm('Delete "' + (it.title || 'this item') + '"?')) return;
      db.items = db.items.filter(function (i) { return i.id !== it.id; }); api.deleteItem(it.id); closeSheet(); renderHome(); toast('Item deleted');
    };
  }
  function safeLink(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

  /* ---------- account menu + share setup ---------- */
  function openMenu() {
    var s = sheet('<h2>' + esc(user.name) + '</h2><p class="muted" style="margin-top:-.6rem;margin-bottom:1rem">' + esc(user.email) + '</p>' +
      '<label class="field"><span>Default currency</span><select id="curSel">' + CURRENCIES.map(function (c) { return '<option' + (c === user.currency ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<div class="stack">' +
        '<button class="btn block" type="button" id="mSetup">Set up Share to Stashd</button>' +
        '<a class="btn block" href="privacy.html">Privacy policy</a>' +
        '<button class="btn block" type="button" id="mOut">Sign out</button>' +
        '<button class="link danger" type="button" id="mDel">Delete my account and stash</button>' +
      '</div><p class="fine">' + (CLOUD ? 'Your stash is synced to your account.' : 'Test version. Everything is saved in this browser only.') + '</p>');
    s.querySelector('#curSel').onchange = function (e) { user.currency = e.target.value; api.saveProfile(); renderHome(); toast('New items will use ' + user.currency); };
    s.querySelector('#mSetup').onclick = openSetup;
    s.querySelector('#mOut').onclick = signOut;
    s.querySelector('#mDel').onclick = function () {
      if (!confirm('Delete your account and everything in your stash on this device? This can\'t be undone.')) return;
      deleteAccount();
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
    var shareUrl = base() + '?url=';
    var isAndroid = /Android/i.test(navigator.userAgent);
    var iphone =
      '<h3>iPhone and iPad (one-time, about 2 minutes)</h3>' +
      '<ol class="steps">' +
        '<li>Open the <b>Shortcuts</b> app and tap <b>+</b> to make a new shortcut.</li>' +
        '<li>Search for the action <b>URL Encode</b> and add it. Tap its blue input and choose <b>Shortcut Input</b>.</li>' +
        '<li>Add the action <b>Open URLs</b>. In its box, paste the link below, then tap the variable bar and add <b>URL Encoded Text</b> right after it.</li>' +
        '<li>Tap the shortcut name at the top, rename it <b>Stashd</b>, then tap <b>ⓘ</b> and turn on <b>Show in Share Sheet</b>.</li>' +
        '<li>Done! In Safari, Instagram or TikTok tap <b>Share</b>, scroll down and tap <b>Stashd</b>.</li>' +
      '</ol>' +
      '<code class="copy" id="shareLink">' + esc(shareUrl) + '</code><button class="btn block" type="button" id="copyBtn">Copy link</button>' +
      (CLOUD ? '' : '<p class="hint">Use Stashd in Safari rather than from a home-screen icon. On iPhone, a home-screen web app keeps a separate stash.</p>');
    var android =
      '<h3>Android</h3>' +
      '<ol class="steps">' +
        '<li>Open this page in <b>Chrome</b>.</li>' +
        '<li>Tap <b>⋮</b> then <b>Add to Home screen</b> (or <b>Install app</b>).</li>' +
        '<li>Now tap <b>Share</b> in any app and pick <b>Stashd</b>.</li>' +
      '</ol>';
    var s = sheet('<h2>Share to Stashd</h2><p class="muted">Save things from any app without copy-pasting into WhatsApp.</p>' +
      (isAndroid ? android + iphone : iphone + android) +
      '<h3>Anywhere</h3><p class="muted">Copy the product link, open Stashd and tap <b>+</b> then <b>Paste</b>.</p>');
    s.querySelector('#copyBtn').onclick = function () {
      (navigator.clipboard ? navigator.clipboard.writeText(shareUrl) : Promise.reject()).then(function () { toast('Link copied'); })
        .catch(function () { var r = document.createRange(); r.selectNodeContents(s.querySelector('#shareLink')); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Select and copy the link'); });
    };
  }

  /* ---------- start ---------- */
  async function boot() {
    var p = new URLSearchParams(location.search);
    var shared = extractUrl([p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' '));
    if (p.has('url') || p.has('text') || p.has('title')) {
      ['url', 'text', 'title'].forEach(function (k) { p.delete(k); });
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
      else renderAuth();
      return;
    }
    var sid = load(KEY.session, null), users = load(KEY.users, {});
    var u = sid && Object.keys(users).map(function (k) { return users[k]; }).find(function (x) { return x.id === sid; });
    if (u) signIn(u); else renderAuth();
  }
  boot();
})();
