/* Stashd web test app.
   Test version: accounts and items are stored in this browser (localStorage).
   Data shape follows the planned Supabase tables (boards, items) so it can move there later. */
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
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function num(v) { if (v === '' || v == null) return null; var n = parseFloat(String(v).replace(/[^\d.]/g, '')); return isFinite(n) ? n : null; }
  function fmt(n) { return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n); }
  function money(n, c) { return n == null ? '' : (c ? c + ' ' : '') + fmt(n); }
  function pct(it) { return (it.price != null && it.was_price != null && it.was_price > it.price) ? Math.round((it.was_price - it.price) / it.was_price * 100) : 0; }
  function hostBrand(url) { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0]; } catch (e) { return ''; } }
  function boardName(id) { var b = db.boards.find(function (x) { return x.id === id; }); return b ? b.name : ''; }
  function persist() { return save(KEY.data(user.id), db); }
  var toastTimer;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600); }

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

  /* ---------- accounts (local test mode) ---------- */
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

  function renderAuth(mode) {
    mode = mode || (Object.keys(load(KEY.users, {})).length ? 'signin' : 'signup');
    var up = mode === 'signup';
    document.title = 'Stashd · ' + (up ? 'Create account' : 'Sign in');
    app.innerHTML =
      '<main class="auth">' +
        '<h1 class="wm">Stash<span>d</span></h1>' +
        '<p class="tagline">Like it. Stash it. Buy it.</p>' +
        '<ul class="perks"><li>Save from any store or ad</li><li>Sort it into boards</li><li>Mark what you bought</li></ul>' +
        (hasPending() ? '<p class="notice">Sign in to stash the link you just shared.</p>' : '') +
        '<div class="seg" role="tablist">' +
          '<button type="button" role="tab" data-mode="signup" aria-selected="' + up + '">Create account</button>' +
          '<button type="button" role="tab" data-mode="signin" aria-selected="' + !up + '">Sign in</button>' +
        '</div>' +
        '<form id="authForm" novalidate>' +
          (up ? '<label class="field"><span>Name</span><input type="text" name="name" autocomplete="given-name" required></label>' : '') +
          '<label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" required></label>' +
          '<label class="field"><span>Password</span><input type="password" name="password" minlength="6" autocomplete="' + (up ? 'new-password' : 'current-password') + '" required></label>' +
          (up ? '<label class="check"><input type="checkbox" name="news"><span>Email me Stashd news and launch updates. You can unsubscribe at any time. See our <a href="privacy.html">privacy policy</a>.</span></label>' : '') +
          '<p class="err" id="authErr" role="alert"></p>' +
          '<button class="btn primary block" type="submit">' + (up ? 'Create account' : 'Sign in') + '</button>' +
        '</form>' +
        '<p class="fine">Test version: your account and stash are saved in this browser, on this device only. <a href="privacy.html">Privacy</a></p>' +
      '</main>';

    app.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { renderAuth(b.dataset.mode); }; });
    var form = document.getElementById('authForm'), err = document.getElementById('authErr');
    form.onsubmit = async function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var email = String(fd.get('email') || '').trim().toLowerCase(), pw = String(fd.get('password') || ''), name = String(fd.get('name') || '').trim();
      if (up && !name) return (err.textContent = 'Add your name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = 'That email doesn\'t look right.');
      if (pw.length < 6) return (err.textContent = 'Use at least 6 characters for your password.');
      var users = load(KEY.users, {});
      if (up) {
        if (users[email]) return (err.textContent = 'There\'s already an account with that email on this device. Sign in instead.');
        var salt = uid();
        users[email] = { id: uid(), name: name, email: email, salt: salt, hash: await hash(pw, salt), currency: 'EGP', created_at: new Date().toISOString() };
        if (!save(KEY.users, users)) return;
        if (fd.get('news')) subscribeBrevo(email);
        signIn(users[email], 'Welcome to Stashd, ' + name + '!');
      } else {
        var u = users[email];
        if (!u || u.hash !== await hash(pw, u.salt)) return (err.textContent = 'Email or password is wrong. (Accounts only exist on the device you created them on.)');
        signIn(u, 'Welcome back, ' + u.name + '!');
      }
    };
  }

  function signIn(u, msg) {
    user = u; save(KEY.session, u.id);
    db = load(KEY.data(u.id), null);
    if (!db) { db = { boards: [newBoard('Outfits'), newBoard('Gifts')], items: [] }; persist(); }
    ui = { board: 'all', tab: 'tobuy' };
    renderHome();
    var p = takePending();
    if (p) openSave(p); else if (msg) toast(msg);
  }
  function signOut() { try { localStorage.removeItem(KEY.session); } catch (e) {} user = db = null; closeSheet(); renderAuth('signin'); }
  function saveUser() { var users = load(KEY.users, {}); users[user.email] = user; save(KEY.users, users); }
  function newBoard(name) { return { id: uid(), user_id: user.id, name: name }; }

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
    var b = newBoard(name.slice(0, 40)); db.boards.push(b); persist(); toast('Board "' + b.name + '" added');
    done(b);
  }
  function openBoardEdit() {
    var b = db.boards.find(function (x) { return x.id === ui.board; }); if (!b) return;
    var s = sheet('<h2>Edit board</h2><label class="field"><span>Board name</span><input type="text" id="bName" maxlength="40" value="' + esc(b.name) + '"></label>' +
      '<div class="stack"><button class="btn primary" id="bSave" type="button">Save</button><button class="btn danger" id="bDel" type="button">Delete board</button></div>' +
      '<p class="muted" style="margin-top:.75rem;font-size:.875rem">Deleting a board keeps its items. They stay under All.</p>');
    s.querySelector('#bSave').onclick = function () { var n = s.querySelector('#bName').value.trim(); if (n) { b.name = n.slice(0, 40); persist(); } closeSheet(); renderHome(); };
    s.querySelector('#bDel').onclick = function () {
      if (!confirm('Delete the board "' + b.name + '"? Its items stay in All.')) return;
      db.boards = db.boards.filter(function (x) { return x.id !== b.id; });
      db.items.forEach(function (i) { if (i.board_id === b.id) i.board_id = null; });
      persist(); ui.board = 'all'; closeSheet(); renderHome(); toast('Board deleted');
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
    if (ph) ph.onchange = function () { var file = ph.files && ph.files[0]; if (file) shrinkPhoto(file).then(function (d) { it.image_url = d; onChange('image_url'); }).catch(function () { toast("Couldn't read that photo."); }); };
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
    body.querySelector('#stashBtn').onclick = function () {
      if (!it.title) it.title = it.brand ? it.brand + ' item' : 'Untitled item';
      it.created_at = new Date().toISOString();
      if (!it.sizes.length) delete it.sizes;
      db.items.push(it);
      if (!persist()) { db.items.pop(); return; }
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
      persist(); paint(); renderHome();
      if (f === 'image_url') { hero.classList.remove('none'); hero.innerHTML = '<img src="' + esc(safeImg(it.image_url)) + '" alt="">' + tagsHtml(it); }
      if (f === 'url') { var a = s.querySelector('#openStore'); if (a && safeLink(it.url)) a.href = safeLink(it.url); }
    };
    paint();
    bindBoardChips(s, it, change); bindSize(s, it, change); bindFields(s, it, change);
    s.querySelector('#soldSw').onchange = function (e) { it.sold_out = e.target.checked; change(); };
    bb.onclick = function () { it.bought = !it.bought; persist(); closeSheet(); renderHome(); toast(it.bought ? 'Marked as bought. Enjoy it!' : 'Moved back to To buy'); };
    s.querySelector('#delBtn').onclick = function () {
      if (!confirm('Delete "' + (it.title || 'this item') + '"?')) return;
      db.items = db.items.filter(function (i) { return i.id !== it.id; }); persist(); closeSheet(); renderHome(); toast('Item deleted');
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
      '</div><p class="fine">Test version. Everything is saved in this browser only.</p>');
    s.querySelector('#curSel').onchange = function (e) { user.currency = e.target.value; saveUser(); renderHome(); toast('New items will use ' + user.currency); };
    s.querySelector('#mSetup').onclick = openSetup;
    s.querySelector('#mOut').onclick = signOut;
    s.querySelector('#mDel').onclick = function () {
      if (!confirm('Delete your account and everything in your stash on this device? This can\'t be undone.')) return;
      var users = load(KEY.users, {}); delete users[user.email]; save(KEY.users, users);
      try { localStorage.removeItem(KEY.data(user.id)); } catch (e) {}
      signOut(); toast('Account deleted');
    };
  }

  function openSetup() {
    var base = location.origin + location.pathname.replace(/index\.html$/, '');
    var shareUrl = base + '?url=';
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
      '<p class="hint">Use Stashd in Safari rather than from a home-screen icon. On iPhone, a home-screen web app keeps a separate stash.</p>';
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
  function boot() {
    var p = new URLSearchParams(location.search);
    var shared = extractUrl([p.get('url'), p.get('text'), p.get('title')].filter(Boolean).join(' '));
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    if (shared) { try { sessionStorage.setItem(KEY.pending, shared); } catch (e) {} }
    var sid = load(KEY.session, null), users = load(KEY.users, {});
    var u = sid && Object.keys(users).map(function (k) { return users[k]; }).find(function (x) { return x.id === sid; });
    if (u) signIn(u); else renderAuth();
  }
  boot();
})();
