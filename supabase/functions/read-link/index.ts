// Stashd link reader + price checker (Supabase Edge Function "read-link"). Deploy with "Verify JWT" OFF:
// this file checks who is calling itself.
//   { url }                         signed-in user: read a product link (title, store, photo, price, old price, currency, stock, sizes)
//   { action: "refresh", item_id }  signed-in user: re-check one saved item's price and stock now
//   { action: "cron" }              the hourly scheduled job (header x-cron-secret): re-check items not checked for ~20 hours
// Runs on Supabase's servers, so it isn't blocked by the browser rules that stop a web page from reading other websites.
// Some big brands block automated reading even from servers; their saved price is then left as it is.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BYTES = 3_000_000;

type Product = {
  ok: boolean; source?: string; title?: string; brand?: string; image_url?: string;
  price?: number | null; was_price?: number | null; currency?: string; sold_out?: boolean; sizes?: string[];
  error?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Only public http(s) addresses: no localhost, private networks or bare IPs.
export function safeUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith("[")) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  u.username = ""; u.password = "";
  return u;
}

async function get(url: URL, accept: string, ms = 9000): Promise<{ status: number; type: string; text: string; url: URL } | null> {
  let cur = url;
  for (let hop = 0; hop < 5; hop++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    let res: Response;
    try {
      res = await fetch(cur, {
        redirect: "manual", signal: ctrl.signal,
        headers: { "User-Agent": UA, "Accept": accept, "Accept-Language": "en-GB,en;q=0.9,ar;q=0.6" },
      });
    } catch { clearTimeout(t); return null; }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(t);
      const next = safeUrl(new URL(res.headers.get("location")!, cur).href);
      if (!next) return null;
      cur = next; continue;
    }
    const reader = res.body?.getReader();
    let size = 0; const chunks: Uint8Array[] = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (done || !value) break;
        size += value.length; chunks.push(value);
        if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); break; }
      }
    }
    clearTimeout(t);
    const buf = new Uint8Array(size); let o = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - o)), o); o += c.length; if (o >= size) break; }
    return { status: res.status, type: res.headers.get("content-type") || "", text: new TextDecoder().decode(buf), url: cur };
  }
  return null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,]/g, "");
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");   // 1.299,00
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
function symbolCurrency(s: string) { return /£/.test(s) ? "GBP" : /€/.test(s) ? "EUR" : /\$/.test(s) ? "USD" : ""; }
function decode(s: string) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).trim();
}
function abs(u: unknown, base: URL): string {
  if (!u) return "";
  if (typeof u === "object") u = (u as Record<string, unknown>).url || (u as Record<string, unknown>).contentUrl || "";
  if (Array.isArray(u)) u = u[0];
  try { const r = new URL(String(u).replace(/^\/\//, "https://"), base); return /^https?:$/.test(r.protocol) ? r.href : ""; } catch { return ""; }
}

// 1) Shopify stores expose clean product data at /products/<handle>.js
async function shopify(u: URL): Promise<Product | null> {
  const m = u.pathname.match(/^(.*?\/products\/[^/?#]+)/);
  if (!m) return null;
  const r = await get(new URL(u.origin + m[1].replace(/\.(js|json|oembed)$/, "") + ".js"), "application/json");
  if (!r || r.status !== 200 || !/json|javascript/.test(r.type)) return null;
  let p: any; try { p = JSON.parse(r.text); } catch { return null; }
  if (!p || !p.title) return null;
  const vid = u.searchParams.get("variant");
  const v = vid ? (p.variants || []).find((x: any) => String(x.id) === vid) : null;
  const src = v || p;
  let currency = "";
  const c = await get(new URL(u.origin + "/cart.js"), "application/json", 4000);
  if (c && c.status === 200) { try { currency = JSON.parse(c.text).currency || ""; } catch { /* ignore */ } }
  const sizeOpt = (p.options || []).find((o: any) => /size|مقاس/i.test(o?.name || String(o)));
  const price = src.price != null ? src.price / 100 : null;
  const was = src.compare_at_price && src.compare_at_price > src.price ? src.compare_at_price / 100 : null;
  return {
    ok: true, source: "shopify", title: p.title, brand: p.vendor || "",
    image_url: abs((v && v.featured_image) || p.featured_image || (p.images || [])[0], u),
    price, was_price: was, currency, sold_out: src.available === false,
    sizes: sizeOpt?.values ? sizeOpt.values.map(String).slice(0, 20) : [],
  };
}

// 2) Any page: product data published for Google (JSON-LD) and social previews (Open Graph)
export function parseHtml(html: string, base: URL): Product {
  const meta = (name: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    return c ? decode(c) : "";
  };
  const out: Product = {
    ok: false, source: "page",
    title: meta("og:title") || meta("twitter:title") || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || ""),
    brand: meta("og:site_name") || meta("product:brand"),
    image_url: abs(meta("og:image") || meta("og:image:secure_url") || meta("twitter:image"), base),
    price: num(meta("product:price:amount") || meta("og:price:amount") || meta("price")),
    was_price: null,
    currency: meta("product:price:currency") || meta("og:price:currency") || meta("priceCurrency"),
    sold_out: /out ?of ?stock|sold ?out/i.test(meta("product:availability") || meta("og:availability")),
    sizes: [],
  };
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const nodes: any[] = [];
  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    nodes.push(x);
    if (x["@graph"]) walk(x["@graph"]);
    if (x.hasVariant) walk(x.hasVariant);
  };
  for (const b of blocks) { try { walk(JSON.parse(b.trim())); } catch { /* skip bad JSON */ } }
  const isProduct = (n: any) => /Product|ProductGroup/.test([].concat(n["@type"] || []).join(" "));
  const prod = nodes.find(isProduct);
  if (prod) {
    const offers = ([] as any[]).concat(prod.offers || []).flatMap((o: any) => o?.offers ? [].concat(o.offers) : [o]);
    const variants = ([] as any[]).concat(prod.hasVariant || []);
    const allOffers = offers.concat(variants.flatMap((v: any) => [].concat(v.offers || [])));
    const o = allOffers.find((x: any) => x && (x.price != null || x.lowPrice != null)) || {};
    out.title = prod.name ? decode(String(prod.name)) : out.title;
    out.brand = (prod.brand && (prod.brand.name || (typeof prod.brand === "string" ? prod.brand : ""))) || out.brand;
    out.image_url = abs(([] as any[]).concat(prod.image || [])[0], base) || out.image_url;
    if (out.price == null) out.price = num(o.price ?? o.lowPrice);
    out.currency = out.currency || o.priceCurrency || "";
    const spec = ([] as any[]).concat(o.priceSpecification || []).find((s: any) => /ListPrice|StrikethroughPrice/i.test(String(s?.priceType || "")));
    if (spec) out.was_price = num(spec.price);
    if (allOffers.length) out.sold_out = allOffers.every((x: any) => /OutOfStock|SoldOut|Discontinued/i.test(String(x?.availability || "")));
    const sizes = variants.map((v: any) => v.size).filter(Boolean).map(String);
    if (sizes.length) out.sizes = [...new Set(sizes)].slice(0, 20);
  }
  // Microdata: <span itemprop="price" content="22.00">
  if (out.price == null) {
    const ip = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) || html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
    if (ip) out.price = num(ip[1]);
    const ic = html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([A-Za-z]{3})["']/i);
    if (ic && !out.currency) out.currency = ic[1];
  }
  // Price data the page loads for its own app (e.g. Sephora: "listPrice":"$22.00")
  if (out.price == null) {
    const sale = html.match(/"(?:salePrice|currentPrice|finalPrice)"\s*:\s*"?([£$€]?\s?\d[\d.,]*)/i);
    const list = html.match(/"(?:listPrice|regularPrice|originalPrice)"\s*:\s*"?([£$€]?\s?\d[\d.,]*)/i) || html.match(/"price"\s*:\s*"([£$€]\s?\d[\d.,]*)"/i);
    const pick = sale || list;
    if (pick) {
      out.price = num(pick[1]);
      if (sale && list) out.was_price = num(list[1]);
      if (!out.currency) out.currency = symbolCurrency(pick[1]);
    }
  }
  if (out.was_price != null && out.price != null && out.was_price <= out.price) out.was_price = null;
  out.title = (out.title || "").slice(0, 200);
  out.ok = !!out.title && !/access denied|just a moment|attention required|robot|captcha/i.test(out.title);
  return out;
}

export async function readLink(u: URL): Promise<Product> {
  const s = await shopify(u).catch(() => null);
  if (s) return s;
  const r = await get(u, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8");
  if (!r) return { ok: false, error: "unreachable" };
  if (r.status === 403 || r.status === 429 || r.status === 503) return { ok: false, error: "blocked" };
  if (r.status !== 200 || !/html/i.test(r.type)) return { ok: false, error: "not_a_page" };
  const p = parseHtml(r.text, r.url);
  if (!p.ok) return { ok: false, error: "no_product" };
  if (p.currency) p.currency = p.currency.toUpperCase().slice(0, 3);
  return p;
}

/* ---------------- price checks ---------------- */
type Item = Record<string, any>;
type Note = { kind: "price_drop" | "price_up" | "back_in_stock" | "sold_out"; old_price: number | null; new_price: number | null };

// What changes for a saved item after re-reading its page. Pure, so it's easy to test.
export function planUpdate(item: Item, res: Product, now: string) {
  const upd: Record<string, unknown> = { last_checked_at: now, check_status: res.ok ? "ok" : (res.error || "failed") };
  const notes: Note[] = [];
  if (!res.ok) return { upd, notes, hist: null as Record<string, unknown> | null };   // blocked / unreadable: keep the saved price
  const itemCur = String(item.currency || "").toUpperCase(), resCur = String(res.currency || "").toUpperCase();
  const sameCurrency = !itemCur || !resCur || itemCur === resCur;                     // never mix currencies (e.g. a store showing GBP to our server)
  const old = item.price == null ? null : Number(item.price);
  if (res.price != null && sameCurrency && (old == null || Math.abs(old - res.price) >= 0.01)) {
    upd.price = res.price; upd.prev_price = old; upd.price_changed_at = now;
    upd.was_price = res.was_price ?? null;
    if (!itemCur && resCur) upd.currency = resCur;
    if (old != null) notes.push({ kind: res.price < old ? "price_drop" : "price_up", old_price: old, new_price: res.price });
  }
  if (typeof res.sold_out === "boolean" && res.sold_out !== !!item.sold_out) {
    upd.sold_out = res.sold_out;
    notes.push({ kind: res.sold_out ? "sold_out" : "back_in_stock", old_price: null, new_price: (upd.price as number) ?? old });
  }
  const hist = { item_id: item.id, price: (upd.price as number) ?? old, currency: (upd.currency as string) || itemCur || null, sold_out: (upd.sold_out as boolean) ?? !!item.sold_out, checked_at: now };
  return { upd, notes, hist };
}

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// deno-lint-ignore no-explicit-any
let _admin: any = null;
// deno-lint-ignore no-explicit-any
function admin(): any { return _admin ??= createClient(SB_URL, SERVICE_KEY, { auth: { persistSession: false } }); }
function bearer(req: Request) { return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim(); }
async function signedInUser(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  return error || !data?.user ? null : { user: data.user, token };
}

const rateCache = new Map<string, Record<string, number>>();
async function toHome(amount: number, from: string, home: string): Promise<number | null> {
  if (!from || !home || from === home) return amount;
  if (!rateCache.has(home)) {
    const r = await get(new URL("https://open.er-api.com/v6/latest/" + encodeURIComponent(home)), "application/json", 6000);
    try { const j = r && r.status === 200 ? JSON.parse(r.text) : null; if (j?.rates) rateCache.set(home, j.rates); } catch { /* ignore */ }
  }
  const rate = rateCache.get(home)?.[from];
  return rate ? Math.round(amount / rate * 100) / 100 : null;
}

// Re-read one item and save what changed. Notifications only for scheduled checks (the user sees manual ones right away).
async function checkItem(item: Item, notify: boolean) {
  const u = safeUrl(item.url || "");
  const res: Product = u ? await readLink(u).catch(() => ({ ok: false, error: "failed" })) : { ok: false, error: "bad_url" };
  const now = new Date().toISOString();
  const { upd, notes, hist } = planUpdate(item, res, now);
  if (upd.price != null && item.home_currency) {
    const cur = String(upd.currency || item.currency || "");
    const hp = await toHome(upd.price as number, cur, item.home_currency);
    if (hp != null) upd.home_price = hp;
  }
  const { data: saved } = await admin().from("items").update(upd).eq("id", item.id).select("*").maybeSingle();
  if (hist) await admin().from("price_history").insert(hist);
  if (notify && notes.length && !item.bought) {
    await admin().from("notifications").insert(notes.map((n) => ({
      user_id: item.user_id, item_id: item.id, kind: n.kind, old_price: n.old_price, new_price: n.new_price,
      currency: (upd.currency as string) || item.currency || null, title: String(item.title || "").slice(0, 140),
    })));
  }
  return { status: res.ok ? "ok" : (res.error || "failed"), item: saved || { ...item, ...upd }, changes: notes };
}

async function runCron(req: Request) {
  const given = req.headers.get("x-cron-secret") || "";
  const { data: sec } = await admin().from("app_secrets").select("value").eq("name", "cron").maybeSingle();
  if (!given || !sec?.value || given !== sec.value) return json({ ok: false, error: "auth" }, 401);
  const cutoff = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { data: items, error } = await admin().from("items").select("*").eq("bought", false).not("url", "is", null)
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`).order("last_checked_at", { ascending: true, nullsFirst: true }).limit(40);
  if (error) return json({ ok: false, error: error.message }, 500);
  let changed = 0;
  const queue = [...(items || [])];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) { const it = queue.shift()!; const r = await checkItem(it, true).catch(() => null); if (r?.changes.length) changed++; }
  }));
  return json({ ok: true, checked: items?.length || 0, changed });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let body: { url?: string; action?: string; item_id?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    if (body.action === "cron") return await runCron(req);
    const who = await signedInUser(req);
    if (!who) return json({ ok: false, error: "auth" }, 401);
    if (body.action === "refresh") {
      // Read the item as the user, so they can only refresh items they're allowed to see and edit.
      // deno-lint-ignore no-explicit-any
      const db: any = createClient(SB_URL, ANON_KEY || SERVICE_KEY, { global: { headers: { Authorization: `Bearer ${who.token}` } }, auth: { persistSession: false } });
      const { data: item } = await db.from("items").select("*").eq("id", body.item_id || "").maybeSingle();
      if (!item) return json({ ok: false, error: "not_found" }, 404);
      const role = item.user_id === who.user.id ? "owner" : (await db.rpc("board_role", { bid: item.board_id })).data;
      if (!["owner", "editor"].includes(role)) return json({ ok: false, error: "auth" }, 403);
      return json({ ok: true, ...(await checkItem(item, false)) });
    }
    const u = safeUrl(body.url || "");
    if (!u) return json({ ok: false, error: "bad_url" }, 400);
    return json(await readLink(u));
  } catch { return json({ ok: false, error: "failed" }); }
}

Deno.serve(handler);
