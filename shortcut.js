/* Stashd: "Run JavaScript on Web Page" script for the iPhone Shortcut.
   Runs inside the store page in your own Safari and sends the product details to Stashd. */
var q = function (s) { var e = document.querySelector(s); return e ? (e.getAttribute('content') || '').trim() : ''; };
var txt = function (e) { return e ? (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : ''; };
var r = {
  u: location.href,
  t: q('meta[property="og:title"]') || document.title,
  b: q('meta[property="og:site_name"]'),
  i: q('meta[property="og:image"]'),
  p: q('meta[property="product:price:amount"]') || q('meta[property="og:price:amount"]'),
  c: q('meta[property="product:price:currency"]') || q('meta[property="og:price:currency"]')
};
document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
  try {
    [].concat(JSON.parse(s.textContent)).forEach(function f(n) {
      if (!n || typeof n !== 'object') return;
      if (n['@graph']) [].concat(n['@graph']).forEach(f);
      if (!/Product/.test([].concat(n['@type']).join(' '))) return;
      var o = [].concat(n.offers || [])[0] || {};
      if (o.offers) o = [].concat(o.offers)[0] || o;
      r.t = n.name || r.t;
      r.b = (n.brand && (n.brand.name || (typeof n.brand === 'string' ? n.brand : ''))) || r.b;
      var im = [].concat(n.image || [])[0]; r.i = (im && (im.url || im)) || r.i;
      r.p = o.price || o.lowPrice || r.p;
      r.c = o.priceCurrency || r.c;
      if (o.availability) r.s = /OutOfStock|SoldOut/i.test(o.availability);
    });
  } catch (e) {}
});
if (!r.p) {
  // No structured price: look for the visible one, most specific selectors first, skipping crossed-out prices.
  var pick = function (sels, wantOld) {
    for (var i = 0; i < sels.length; i++) {
      var els = document.querySelectorAll(sels[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j], t = txt(el);
        if (!/\d/.test(t) || t.length > 24) continue;
        if (!wantOld && el.closest('del, s, [class*="old" i], [class*="compare" i], [class*="crossed" i], [class*="original" i]')) continue;
        return t;
      }
    }
    return '';
  };
  r.pt = pick(['[itemprop=price]', '[class*="money-amount__main" i]', '[class*="price-current" i]', '[class*="current-price" i]', '[class*="sale-price" i]', '[class*="price__current" i]', '[class*="product-price" i] span', '[class*="price" i] span', '[class*="price" i]'], false);
  r.wt = pick(['[class*="price" i] del', '[class*="price" i] s', 'del', 's', '[class*="old-price" i]', '[class*="price-old" i]', '[class*="compare" i]', '[class*="crossed" i]', '[class*="original-price" i]'], true);
}
if (r.s == null) r.s = /\b(sold out|out of stock|agotado)\b/i.test(txt(document.querySelector('[class*="stock" i], [class*="availability" i], button[disabled][class*="add" i]')));
completion(JSON.stringify(r));
