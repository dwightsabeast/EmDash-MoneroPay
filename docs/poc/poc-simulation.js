// xmr-pay proof of concept: the inline script from monero-payments-poc.html, extracted for reading.
// REFERENCE ONLY. Not production code, not a dependency. It runs in a browser page and models the
// EmDash host, the sandbox, monerod, wallet-rpc, the bridge and the price APIs in one file.
//
// What to port into the real plugin (phase 02): the section titled "xmr-pay plugin" (constants,
// counted(), onTime(), basis(), classify(), evaluate(), the four routes, the cron sweep, the watch list).
// What to port into tests: the "Scenarios" and "Attacks" sections, as scripted cases.
// Everything else (simulation, rendering, wire log) is demo scaffolding.
//
// Demo-only choices that differ from the spec: pool target 10 (spec: 50), invoices store the product
// title for the admin table, under-dust tips just expire.

(() => {
'use strict';

/* ======================================================================
   Constants from the spec
   ====================================================================== */
const ATOMIC = 10n ** 12n;                    // 1 XMR = 10^12 atomic units
const BLOCK_MS = 120_000;                     // ~2 min blocks
const INVOICE_WINDOW_MS = 30 * 60_000;
const LATE_WINDOW_MS = 24 * 3_600_000;
const PURGE_MS = 30 * 24 * 3_600_000;
const SILENT_MS = 5 * 60_000;
const SYNC_EVERY_MS = 15_000;
const TS_WINDOW_S = 300;
const POOL_TARGET = 10;                       // spec proposes 50
const DUST_ATOMIC = 100_000_000n;             // 0.0001 XMR
const TOLERANCE_PERMILLE = 995n;              // 99.5%
const FINAL_DEPTH = 10;                       // settled invoices stay watched until this deep (Monero's 10-block spend lock)
const RECONFIRM_BLOCKS = 5;                   // a payment knocked out by a reorg must be mined again within this many blocks
const WINDOW_BLOCKS = 15;                     // 30 minutes of 2-minute blocks
const EXPIRY_GRACE_BLOCKS = 3;                // allowance for a payment sent just before expiry and mined a little later
const PRESETS = { fast: [1, 3, 5], standard: [2, 5, 10], strict: [10, 10, 10] };
const MAX_OPEN_TOTAL = 40;
const MAX_PER_IP = 5;
const RATE_TTL_MS = 60_000;
const SYNC_PATH = '/_emdash/api/plugins/xmr-pay/bridge/sync';
const T0 = Date.parse('2026-10-01T11:00:00Z');

/* ======================================================================
   Small utilities
   ====================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = new TextEncoder();
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randBytes = n => crypto.getRandomValues(new Uint8Array(n));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddress = (prefix = '7') => prefix + [...randBytes(94)].map(b => B58[b % 58]).join('');
const ceilDiv = (a, b) => (a + b - 1n) / b;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const clone = v => (v == null ? v : structuredClone(v));
const iso = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const hms = ms => new Date(ms).toISOString().slice(11, 19);
const hm = ms => new Date(ms).toISOString().slice(11, 16);

function atomicToXmr(a) {                     // exact, 12 decimals
  a = BigInt(a);
  const whole = a / ATOMIC, frac = (a % ATOMIC).toString().padStart(12, '0');
  return `${whole}.${frac}`;
}
function xmr(a, min = 4) {                     // trimmed for display
  if (a == null) return '—';
  let s = atomicToXmr(a);
  const [w, f] = s.split('.');
  let t = f.replace(/0+$/, '');
  if (t.length < min) t = t.padEnd(min, '0');
  return `${w}.${t}`;
}
function xmrToAtomic(str) {
  if (!/^\d{1,6}(\.\d{1,12})?$/.test(str)) throw new Error('bad amount');
  const [w, f = ''] = str.split('.');
  return BigInt(w) * ATOMIC + BigInt(f.padEnd(12, '0'));
}
const fiatFmt = {};
function fiat(minor, cur) {
  fiatFmt[cur] ??= new Intl.NumberFormat('en-US', { style: 'currency', currency: cur });
  return fiatFmt[cur].format(Number(minor) / 100);
}
function ago(ms) {
  if (ms == null) return 'never';
  const s = Math.max(0, Math.round((sim.now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
}
function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ======================================================================
   Simulation clock and a serial queue (everything that changes state
   runs through it, so async crypto never interleaves)
   ====================================================================== */
const sim = { now: T0, speed: 30, booting: true, busy: false, scenario: false };
let queue = Promise.resolve();
const serial = fn => (queue = queue.then(fn).catch(e => { console.error(e); }));

/* ======================================================================
   Signing (WebCrypto). Falls back to HMAC if Ed25519 is missing, which is
   the spec's own fallback for open question 1.
   ====================================================================== */
const crypt = { mode: 'ed25519' };
async function detectEd25519() {
  try {
    const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const m = enc.encode('probe');
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, k.privateKey, m);
    return await crypto.subtle.verify({ name: 'Ed25519' }, k.publicKey, sig, m);
  } catch { return false; }
}
async function newKeypair() {
  if (crypt.mode === 'ed25519') {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    return { priv: kp.privateKey, pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) };
  }
  const secret = randBytes(32);
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return { priv: key, pub: b64(secret) };
}
const algo = () => (crypt.mode === 'ed25519' ? { name: 'Ed25519' } : { name: 'HMAC' });
async function sign(priv, bytes) { return new Uint8Array(await crypto.subtle.sign(algo(), priv, bytes)); }

/* ======================================================================
   Simulated Monero network (monerod) and the buyer's broadcasts
   ====================================================================== */
const chain = { height: 0, nextBlockAt: 0, blocks: [], txs: new Map(), mempool: [] };
function chainReset() {
  chain.height = 3_012_345; chain.nextBlockAt = T0 + 75_000; chain.blocks = []; chain.txs = new Map(); chain.mempool = [];
}
function broadcast(address, amount, opts = {}) {
  const tx = { txid: hex(randBytes(32)), to: address, amount: BigInt(amount), height: null, blockAt: null, at: sim.now,
    unlockTime: opts.unlockTime ?? 0, doubleSpendSeen: Boolean(opts.doubleSpendSeen) };
  chain.txs.set(tx.txid, tx); chain.mempool.push(tx.txid);
  wallet.onTx(tx);
  return tx;
}
function mineBlock(at) {
  at ??= sim.now;
  chain.height += 1;
  const ids = []; let conflicted = 0;
  for (const id of chain.mempool.splice(0)) {
    const tx = chain.txs.get(id); if (!tx) continue;
    if (tx.doubleSpendSeen) { chain.txs.delete(id); conflicted++; continue; }   // the conflicting spend was mined instead
    tx.height = chain.height; tx.blockAt = at; ids.push(id);
  }
  chain.blocks.push({ height: chain.height, txids: ids, at });
  if (chain.blocks.length > 800) chain.blocks.shift();
  chain.nextBlockAt = at + BLOCK_MS;
  if (conflicted) {
    logEvent({ lane: 'chain', title: `block ${chain.height}`, outcome: 'info', code: 'conflict', summary: `The conflicting spend was mined. ${conflicted} double-spent transaction${conflicted === 1 ? '' : 's'} left the mempool for good.` });
    wallet.poke('tx dropped');
  }
}
const confs = tx => (tx.height == null ? 0 : chain.height - tx.height + 1);
function reorg(depth, reverse = false) {
  // A competing chain of the same length wins. Normally our txs go back to the mempool and get mined again.
  // With reverse, the competing chain carries a conflicting spend of the same coins, so ours are gone for good.
  const cut = chain.height - depth;
  let moved = 0;
  for (const b of chain.blocks) {
    if (b.height <= cut) continue;
    for (const id of b.txids) {
      const tx = chain.txs.get(id); if (!tx) continue;
      if (reverse) chain.txs.delete(id); else { tx.height = null; tx.blockAt = null; chain.mempool.push(id); }
      moved++;
    }
    b.txids = [];
  }
  logEvent({ lane: 'chain', title: `reorg · ${depth} block${depth > 1 ? 's' : ''}`, outcome: 'info', code: reverse ? 'double-spend' : 'reorg',
    summary: reverse
      ? `A competing chain replaced blocks ${cut + 1}–${chain.height} and spent the same coins elsewhere. ${moved} payment${moved === 1 ? ' is' : 's are'} gone for good.`
      : `A competing chain replaced blocks ${cut + 1}–${chain.height}. ${moved} transaction${moved === 1 ? '' : 's'} went back to the mempool.` });
  wallet.poke('reorg');
}
function dropMempool() {
  const n = chain.mempool.length;
  for (const id of chain.mempool) chain.txs.delete(id);
  chain.mempool = [];
  logEvent({ lane: 'chain', title: 'mempool txs dropped', outcome: 'info', summary: `${n} unconfirmed transaction${n === 1 ? '' : 's'} vanished (for example a double-spend won). Snapshots overwrite, so the plugin forgets them on the next sync.` });
  wallet.poke('tx dropped');
}

/* ======================================================================
   Wallet host: monero-wallet-rpc with a view-only wallet
   ====================================================================== */
const wallet = {
  sub: new Map(), byAddr: new Map(), next: 1,
  reset() { this.sub = new Map(); this.byAddr = new Map(); this.next = 1; },
  createAddress() { const index = this.next++; const address = fakeAddress(); this.sub.set(index, address); this.byAddr.set(address, index); return { index, address }; },
  getTransfers(index) {                         // get_transfers in + pool, filtered by subaddr_indices
    const addr = this.sub.get(index); const out = [];
    if (!addr) return out;
    for (const tx of chain.txs.values()) if (tx.to === addr) out.push({
      txid: tx.txid, amount: tx.amount.toString(), confirmations: confs(tx),
      height: tx.height ?? 0,                                     // 0 while unmined
      timestamp: Math.floor((tx.blockAt ?? tx.at) / 1000),        // block time once mined, otherwise when the wallet first saw it
      double_spend_seen: tx.doubleSpendSeen, unlock_time: tx.unlockTime,
    });
    return out;
  },
  onTx(tx) { if (this.byAddr.has(tx.to)) this.poke('tx-notify'); },
  poke(reason) { if (bridge.running) bridge.poke = reason; },
};

/* ======================================================================
   Price APIs on the public internet (simulated)
   ====================================================================== */
const market = { rates: {}, up: {}, nextDriftAt: 0 };
function marketReset() {
  market.rates = { USD: 312.47, EUR: 287.9, GBP: 246.12 };
  market.up = { 'api.coingecko.com': true, 'api.kraken.com': true };
  market.nextDriftAt = T0 + 60_000;
}
function drift() { for (const c of Object.keys(market.rates)) market.rates[c] = +(market.rates[c] * (1 + (Math.random() - 0.5) * 0.004)).toFixed(2); }
const internet = {
  async fetch(url) {
    const u = new URL(url); const h = u.hostname;
    flash('e-price');
    if (!market.up[h]) {
      logEvent({ lane: 'price', title: `GET ${h}`, outcome: 'err', code: 'TIMEOUT', summary: `No answer from ${h} (taken down in this demo).`, req: { url } });
      throw new TypeError('network error');
    }
    let body;
    if (h === 'api.coingecko.com') {
      const cur = u.searchParams.get('vs_currencies');
      body = { monero: { [cur]: market.rates[cur.toUpperCase()] } };
    } else {
      const cur = u.searchParams.get('pair').slice(3);
      body = { error: [], result: { ['XXMRZ' + cur]: { c: [(market.rates[cur] * 0.9992).toFixed(8), '0.41020000'] } } };
    }
    logEvent({ lane: 'price', title: `GET ${h}`, outcome: 'ok', code: '200', summary: `Rate lookup, cached for a minute.`, req: { url }, res: body });
    return { ok: true, status: 200, json: async () => clone(body) };
  },
};

/* ======================================================================
   Site content (the products convention from the spec)
   ====================================================================== */
const PRODUCTS = [
  { id: 'prd_01', slug: 'handbook', title: 'Self-hosting handbook (PDF)', blurb: '180 pages, instant download', price: 12 },
  { id: 'prd_02', slug: 'membership', title: 'Annual membership', blurb: 'Member posts and the archive for a year', price: 150 },
  { id: 'prd_03', slug: 'workshop', title: 'Two-day workshop seat', blurb: 'In person, materials included', price: 1200 },
];
const POST = { id: 'pst_01', slug: 'why-the-wallet-calls-in', title: 'Why the wallet calls the site, not the other way round' };
const CONTENT = {
  products: PRODUCTS.map(p => ({ id: p.id, slug: p.slug, data: { title: p.title, price: p.price } })),
  posts: [{ id: POST.id, slug: POST.slug, data: { title: POST.title } }],
};

/* ======================================================================
   ===  xmr-pay plugin  =================================================
   What would live in src/plugin.ts. It only touches ctx: kv, storage,
   content (read), http (two hosts) and cron.
   ====================================================================== */
const MANIFEST = {
  slug: 'xmr-pay',
  publisher: 'did:plc:<your-atmosphere-did>',
  license: '<SPDX id>',
  name: 'Monero Payments',
  description: 'Accept Monero for products or tips. No keys in the plugin.',
  capabilities: ['content:read', 'network:request'],
  allowedHosts: ['api.coingecko.com', 'api.kraken.com'],
  storage: {
    pool: { indexes: ['status'], uniqueIndexes: ['addrIndex'] },
    invoices: { indexes: ['status', 'expiresAt', 'subaddress', ['kind', 'createdAt']], uniqueIndexes: ['token'] },
  },
  admin: {
    pages: [{ path: '/', label: 'Monero payments' }],
    widgets: [{ id: 'xmr-status', title: 'Monero payments', size: 'half' }],
  },
};
const LIVE = new Set(['new', 'seen', 'confirming']);
const fail = (code, extra) => ({ error: { code, ...extra } });

function requiredConfs(kind, fiatMinor, speed) {
  const p = PRESETS[speed] ?? PRESETS.standard;
  if (kind === 'tip' || fiatMinor == null) return p[0];
  const major = fiatMinor / 100;
  return major < 100 ? p[0] : major <= 1000 ? p[1] : p[2];
}

function validateCheckout(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { fail: 'Body must be a JSON object.' };
  if (j.kind !== 'product' && j.kind !== 'tip') return { fail: 'kind must be "product" or "tip".' };
  const str = (v, max) => (typeof v === 'string' && v.trim().length <= max ? v.trim() : undefined);
  const out = { kind: j.kind };
  if (j.email) { const e = str(j.email, 254); if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { fail: 'email is not a valid address.' }; out.email = e; }
  if (j.refundAddress) { const a = str(j.refundAddress, 106); if (!a || !/^[1-9A-HJ-NP-Za-km-z]{95,106}$/.test(a)) return { fail: 'refundAddress is not a Monero address.' }; out.refundAddress = a; }
  if (out.kind === 'product') {
    const p = str(j.product, 100); if (!p) return { fail: 'product is required.' };
    out.product = p;
    if ('amount' in j || 'price' in j) out.droppedAmount = true;   // never trusted
  } else {
    if (j.contentRef != null) {
      const c = j.contentRef;
      if (typeof c !== 'object' || !str(c.collection, 64) || !str(c.id, 100)) return { fail: 'contentRef needs collection and id.' };
      out.contentRef = { collection: c.collection, id: c.id };
    }
    if (j.amount != null && typeof j.amount === 'object') {
      if (j.amount.fiat != null) { const f = Number(j.amount.fiat); if (!(f > 0 && f <= 10_000)) return { fail: 'Fiat amount is out of range.' }; out.fiatMinor = Math.round(f * 100); }
      else if (j.amount.xmr != null) { if (!/^\d{1,6}(\.\d{1,12})?$/.test(String(j.amount.xmr))) return { fail: 'XMR amount is not valid.' }; out.xmr = String(j.amount.xmr); }
    }
    if (j.note) { const n = str(j.note, 280); if (n === undefined) return { fail: 'note is limited to 280 characters.' }; out.note = n.replace(/[\u0000-\u001f\u007f]/g, ''); }
  }
  return { ok: out };
}

async function getRate(ctx, cur) {
  const cached = await ctx.kv.get(`rate:${cur}`);
  if (cached && ctx.now() - cached.at < RATE_TTL_MS) return cached;
  const c = cur.toLowerCase();
  const sources = [
    { host: 'api.coingecko.com', url: `https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=${c}`, pick: j => Number(j?.monero?.[c]) },
    { host: 'api.kraken.com', url: `https://api.kraken.com/0/public/Ticker?pair=XMR${cur}`, pick: j => Number(Object.values(j?.result ?? {})[0]?.c?.[0]) },
  ];
  for (const s of sources) {
    try {
      const r = await ctx.http.fetch(s.url);
      const v = s.pick(await r.json());
      if (!(v > 0)) throw new Error('bad payload');
      const rate = { minor: Math.round(v * 100), source: s.host, at: ctx.now() };
      await ctx.kv.set(`rate:${cur}`, rate);
      return rate;
    } catch { ctx.note(`${s.host} did not answer`); }
  }
  throw Object.assign(new Error('no rate'), { code: 'RATE_UNAVAILABLE' });   // never fall back to a stale price
}

async function ipBucket(ctx, ip) {
  const day = new Date(ctx.now()).toISOString().slice(0, 10);
  const key = hex(await crypto.subtle.digest('SHA-256', enc.encode(`${ip}|${day}|xmr-pay`))).slice(0, 16);
  const all = (await ctx.kv.get('buckets')) ?? {};
  const cutoff = ctx.now() - INVOICE_WINDOW_MS;
  for (const k of Object.keys(all)) { all[k] = all[k].filter(t => t > cutoff); if (!all[k].length) delete all[k]; }
  return { key, all, count: (all[key] ?? []).length };
}

async function claimAddress(ctx, invoiceId) {
  const free = (await ctx.storage.pool.query({ status: 'free' })).sort((a, b) => a.addrIndex - b.addrIndex)[0];
  if (!free) return null;
  // Real plugin: storage.updateIf(status === 'free') so two checkouts can't claim one row.
  free.status = 'claimed'; free.invoiceId = invoiceId;
  await ctx.storage.pool.put(String(free.addrIndex), free);
  return free;
}

// A transfer counts only if it can be spent: no time lock, and no double-spend flag from wallet-rpc.
const counted = t => !t.doubleSpendSeen && t.unlockTime === '0';

// Was this payment made inside the invoice window? Best evidence first:
// the plugin saw it before expiry; else the wallet's mempool timestamp; else, if it was
// first reported already mined, its block height against the window (15 blocks + grace).
function onTime(inv, t) {
  if (t.seenAt <= inv.expiresAt) return true;
  if (t.poolTs != null) return t.poolTs * 1000 <= inv.expiresAt;
  return t.height > 0 && t.height <= inv.expiresHeight;
}

function totals(inv, only = () => true) {
  const use = inv.transfers.filter(t => counted(t) && only(t));
  const received = use.reduce((s, t) => s + BigInt(t.amountAtomic), 0n);
  const threshold = inv.kind === 'tip' ? BigInt(inv.minAtomic) : ceilDiv(BigInt(inv.expectedAtomic) * TOLERANCE_PERMILLE, 1000n);
  // Depth = confirmations of the shallowest transfer needed to reach the threshold, deepest first.
  let acc = 0n, depth = -1;
  for (const t of [...use].sort((a, b) => b.confirmations - a.confirmations)) {
    acc += BigInt(t.amountAtomic);
    if (acc >= threshold) { depth = t.confirmations; break; }
  }
  return { received, threshold, depth, ignored: inv.transfers.filter(t => !counted(t)).length };
}
// After expiry, only payments made in time count toward the invoice.
const basis = (inv, now) => (now >= inv.expiresAt ? totals(inv, t => onTime(inv, t)) : totals(inv));
const classify = (inv, t) => (t.received === 0n ? 'new' : t.received < t.threshold ? 'seen' : t.depth < inv.required ? 'confirming' : 'settled');
const hasLate = inv => inv.transfers.some(t => counted(t) && !onTime(inv, t));

async function evaluate(ctx, inv) {
  if (inv.adminFinal) return false;            // an admin decision is final
  const now = ctx.now(); const before = inv.status;
  const mark = () => JSON.stringify([inv.status, Boolean(inv.pendingExpiry), inv.reconfirmingSince ?? null]);
  const was = mark();
  const height = (await ctx.kv.get('bridge'))?.height ?? 0;
  const alert = async (kind, text) => { const a = (await ctx.kv.get('alerts')) ?? []; a.push({ id: inv.id, kind, at: now, text }); await ctx.kv.set('alerts', a); };

  if (before === 'settled') {
    const t = totals(inv);
    if (t.received < t.threshold) {
      // The money itself is gone (double-spent in a reorg, or flagged): alert at once.
      inv.status = 'review'; inv.reviewReason = 'reversed'; delete inv.reconfirmingSince;
      await alert('reversed', `${inv.id} settled, but its payment is no longer on the chain. Fulfillment was not reversed. Check the txids in your wallet.`);
    } else if (t.depth < inv.required) {
      // A reorg knocked it shallower, but the money is still there. Wait for it to be mined again.
      if (inv.reconfirmingSince == null) { inv.reconfirmingSince = height; ctx.note(`${inv.id}: lost depth in a reorg, re-confirming (no alert)`); }
      const stuck = inv.transfers.some(x => counted(x) && x.height === 0);
      if (stuck && height - inv.reconfirmingSince >= RECONFIRM_BLOCKS) {
        inv.status = 'review'; inv.reviewReason = 'reorg'; delete inv.reconfirmingSince;
        await alert('reorg', `${inv.id} dropped out of the chain in a reorg and has not been mined again after ${RECONFIRM_BLOCKS} blocks. Fulfillment was not reversed.`);
      }
    } else if (inv.reconfirmingSince != null) {
      delete inv.reconfirmingSince; ctx.note(`${inv.id}: back to ${t.depth} confirmations after the reorg`);
    }
  } else if (before === 'expired') {
    const s = classify(inv, totals(inv, x => onTime(inv, x)));
    if (s === 'confirming' || s === 'settled') {
      // Paid in time but reported after expiry (for example a bridge clock that runs ahead).
      inv.status = s; inv.reopened = true; if (s === 'settled') inv.settledAt = now;
      ctx.note(`${inv.id}: payment was made in time, reported after expiry`);
    } else if (hasLate(inv)) { inv.status = 'review'; inv.reviewReason = 'late'; }
  } else if (LIVE.has(before)) {
    const t = basis(inv, now);
    let s = classify(inv, t);
    inv.pendingExpiry = false;
    if ((s === 'new' || s === 'seen') && now >= inv.expiresAt) {
      if (inv.seq < inv.expiresAt) {
        // Expire on evidence: no snapshot from after the deadline yet (bridge silent), so wait.
        inv.pendingExpiry = true;
      } else if (hasLate(inv)) { s = 'review'; inv.reviewReason = 'late'; }
      else if (s === 'seen' && inv.kind === 'product') { s = 'review'; inv.reviewReason = 'underpaid'; }
      else s = 'expired';
    }
    inv.status = s;
    if (s === 'settled') {
      inv.settledAt = now;
      const all = totals(inv);
      if (inv.expectedAtomic && all.received > BigInt(inv.expectedAtomic) && inv.kind === 'product') inv.overpaidAtomic = (all.received - BigInt(inv.expectedAtomic)).toString();
    }
  }
  if (!LIVE.has(inv.status)) inv.pendingExpiry = false;
  if (inv.status !== before) {
    if (!LIVE.has(inv.status) && !inv.finalAt) inv.finalAt = now;
    ctx.note(`${inv.id}: ${before} → ${inv.status}${inv.status === 'review' ? ` (${inv.reviewReason})` : ''}`);
    if (inv.status === 'settled') ctx.note(inv.kind === 'tip' ? 'Tip received' : `Fulfillment: "${inv.label}" is paid`);
  } else if (inv.pendingExpiry && !JSON.parse(was)[1]) {
    ctx.note(`${inv.id}: window closed while the bridge is silent, waiting for a sync before expiring`);
  }
  return mark() !== was;
}

async function watchList(ctx) {
  const now = ctx.now(); const out = [];
  for (const inv of await ctx.storage.invoices.query({})) {
    if (LIVE.has(inv.status)) out.push(inv.addrIndex);
    else if ((inv.status === 'expired' || inv.status === 'review') && now < inv.expiresAt + LATE_WINDOW_MS) out.push(inv.addrIndex);
    // Settled invoices stay watched until the payment is 10 blocks deep, so a reorg can still be seen.
    else if (inv.status === 'settled' && now < inv.settledAt + LATE_WINDOW_MS && (inv.reconfirmingSince != null || totals(inv).depth < FINAL_DEPTH)) out.push(inv.addrIndex);
  }
  return out.sort((a, b) => a - b);
}

/* ---- route: POST checkout (public) ---- */
async function routeCheckout(req, ctx) {
  const settings = await ctx.kv.get('settings');
  if (!settings?.bridgePublicKey) return fail('NOT_CONFIGURED');
  const v = validateCheckout(req.json);
  if (v.fail) return fail('INVALID_REQUEST', { message: v.fail });
  const input = v.ok;
  if (input.droppedAmount) ctx.note('Dropped the amount sent by the client. The price comes from the product entry.');

  const open = (await ctx.storage.invoices.query({})).filter(i => LIVE.has(i.status)).length;
  const bucket = await ipBucket(ctx, req.meta.ip);
  if (open >= MAX_OPEN_TOTAL || bucket.count >= MAX_PER_IP) {
    ctx.note(`Bucket ${bucket.key.slice(0, 8)}… already has ${bucket.count} checkouts in the last 30 min`);
    return fail('TOO_MANY_OPEN');
  }

  let fiatMinor = null, productRef, label = 'Tip';
  if (input.kind === 'product') {
    const entry = await ctx.content.get('products', input.product);
    if (!entry || typeof entry.data.price !== 'number' || !(entry.data.price > 0)) return fail('PRODUCT_NOT_FOUND');
    fiatMinor = Math.round(entry.data.price * 100);
    productRef = { collection: 'products', id: entry.id };
    label = entry.data.title;
  } else if (input.fiatMinor) fiatMinor = input.fiatMinor;

  let rate;
  try { rate = await getRate(ctx, settings.currency); } catch { return fail('RATE_UNAVAILABLE'); }

  let expected = null;
  if (fiatMinor != null) expected = ceilDiv(BigInt(fiatMinor) * ATOMIC, BigInt(rate.minor));   // ⌈fiatMinor·10¹² / rateMinor⌉
  else if (input.xmr) expected = xmrToAtomic(input.xmr);
  if (input.kind === 'tip' && expected != null && expected < DUST_ATOMIC) return fail('AMOUNT_TOO_SMALL');

  const id = 'inv_' + hex(randBytes(4));
  const slot = await claimAddress(ctx, id);
  if (!slot) return fail('NO_ADDRESS_AVAILABLE');

  const now = ctx.now();
  // Chain height now, from the last sync plus blocks since (if the bridge has been quiet).
  const b = await ctx.kv.get('bridge');
  const createdHeight = b ? b.height + Math.floor((now - b.lastSyncAt) / BLOCK_MS) : 0;
  const inv = {
    id, token: b64url(randBytes(16)), kind: input.kind, productRef, contentRef: input.contentRef, label,
    createdHeight, expiresHeight: createdHeight + WINDOW_BLOCKS + EXPIRY_GRACE_BLOCKS,
    fiat: fiatMinor != null ? { amountMinor: fiatMinor, currency: settings.currency } : null,
    rate: { minor: rate.minor, currency: settings.currency, source: rate.source },
    expectedAtomic: expected?.toString() ?? null,
    minAtomic: input.kind === 'tip' ? DUST_ATOMIC.toString() : null,
    required: requiredConfs(input.kind, fiatMinor, settings.speed),
    subaddress: slot.address, addrIndex: slot.addrIndex, status: 'new',
    createdAt: now, expiresAt: now + INVOICE_WINDOW_MS, seq: 0, transfers: [],
  };
  if (input.email || input.refundAddress || input.note) inv.buyer = { email: input.email, refundAddress: input.refundAddress, note: input.note };
  await ctx.storage.invoices.put(id, inv);
  (bucket.all[bucket.key] ??= []).push(now);
  await ctx.kv.set('buckets', bucket.all);
  ctx.note(`${id} created on subaddress #${slot.addrIndex}, needs ${inv.required} confirmation${inv.required > 1 ? 's' : ''}`);

  const amountXmr = expected != null ? atomicToXmr(expected) : null;
  const q = [amountXmr && `tx_amount=${amountXmr}`, `tx_description=${encodeURIComponent(label)}`].filter(Boolean).join('&');
  return { token: inv.token, address: slot.address, amountAtomic: inv.expectedAtomic, amountXmr, uri: `monero:${slot.address}?${q}`, expiresAt: iso(inv.expiresAt), status: 'new' };
}

/* ---- route: GET status (public) ---- */
async function routeStatus(req, ctx) {
  const token = String(req.query.token ?? '');
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return fail('INVOICE_NOT_FOUND');
  const inv = await ctx.storage.invoices.findOne({ token });
  if (!inv) return fail('INVOICE_NOT_FOUND');
  if (await evaluate(ctx, inv)) await ctx.storage.invoices.put(inv.id, inv);   // lazy expiry
  const t = LIVE.has(inv.status) ? basis(inv, ctx.now()) : totals(inv);
  return {
    status: inv.status, confirmations: Math.max(0, t.depth), required: inv.required,
    amountAtomic: inv.expectedAtomic, receivedAtomic: t.received.toString(),
    expiresAt: iso(inv.expiresAt), settledAt: inv.settledAt ? iso(inv.settledAt) : null,
    pendingExpiry: Boolean(inv.pendingExpiry), reconfirming: inv.reconfirmingSince != null,
  };
}

/* ---- route: POST bridge/sync (public, signed, raw text body) ---- */
async function routeBridgeSync(req, ctx) {
  const settings = await ctx.kv.get('settings');
  if (!settings?.bridgePublicKey) return fail('NOT_CONFIGURED');
  const ts = req.headers['x-xmr-ts'], sig = req.headers['x-xmr-sig'];
  if (!ts || !sig) return fail('MISSING_SIGNATURE');
  // Headers and signature are checked before the body is parsed.
  if (!/^\d{9,11}$/.test(ts) || Math.abs(Math.floor(ctx.now() / 1000) - Number(ts)) > TS_WINDOW_S) {
    ctx.note(`x-xmr-ts is ${Math.round(Math.abs(ctx.now() / 1000 - Number(ts)))} s from the server clock (limit ${TS_WINDOW_S} s)`);
    return fail('STALE_TIMESTAMP');
  }
  if (!(await ctx.verify(settings.bridgePublicKey, sig, ts + '\n' + req.text))) return fail('BAD_SIGNATURE');
  let body;
  try { body = JSON.parse(req.text); } catch { return fail('INVALID_BODY'); }
  if (!Number.isSafeInteger(body?.seq) || !Number.isSafeInteger(body?.height) || !Array.isArray(body.addresses) || !Array.isArray(body.snapshots)) return fail('INVALID_BODY');

  const now = ctx.now();
  await ctx.kv.set('bridge', { lastSyncAt: now, height: body.height });

  let added = 0;
  for (const a of body.addresses) {
    if (!Number.isSafeInteger(a?.index) || typeof a.address !== 'string') continue;
    if (await ctx.storage.pool.get(String(a.index))) continue;
    await ctx.storage.pool.put(String(a.index), { addrIndex: a.index, address: a.address, status: 'free' });
    added++;
  }
  if (added) ctx.note(`Pool +${added} subaddress${added > 1 ? 'es' : ''}`);

  let ignored = 0;
  for (const snap of body.snapshots) {
    const slot = await ctx.storage.pool.get(String(snap?.index));
    if (!slot?.invoiceId) continue;
    const inv = await ctx.storage.invoices.get(slot.invoiceId);
    if (!inv) continue;
    if (body.seq <= inv.seq) { ignored++; continue; }         // not newer: ignore
    const known = new Map(inv.transfers.map(t => [t.txid, t]));
    const int = v => Number.isSafeInteger(v) && v >= 0;
    const next = (Array.isArray(snap.transfers) ? snap.transfers : [])
      .filter(t => /^[0-9a-f]{64}$/.test(t?.txid) && /^\d{1,20}$/.test(String(t.amount)) && int(t.confirmations) && int(t.height) && int(t.timestamp))
      .map(t => {
        const k = known.get(t.txid);
        return {
          txid: t.txid, amountAtomic: String(t.amount), confirmations: t.confirmations, height: t.height, timestamp: t.timestamp,
          doubleSpendSeen: t.doubleSpendSeen === true,
          unlockTime: /^\d{1,20}$/.test(String(t.unlockTime)) ? String(t.unlockTime) : 'invalid',
          seenAt: k?.seenAt ?? now,                                         // when this plugin first heard of it
          poolTs: k?.poolTs ?? (t.height === 0 ? t.timestamp : null),       // wallet time, kept from the first unmined report
        };
      });
    const same = (a, b) => a && a.amountAtomic === b.amountAtomic && a.doubleSpendSeen === b.doubleSpendSeen && a.unlockTime === b.unlockTime;
    const sameSet = next.length === inv.transfers.length && next.every(t => same(known.get(t.txid), t));
    const sameConfs = sameSet && next.every(t => known.get(t.txid).confirmations === t.confirmations);
    inv.transfers = next; inv.seq = body.seq;             // snapshot overwrites
    const moved = await evaluate(ctx, inv);
    await ctx.storage.invoices.put(inv.id, inv);
    if (!moved && (!sameSet || (!sameConfs && LIVE.has(inv.status)))) {
      const t = totals(inv);
      ctx.note(`${inv.id}: ${xmr(t.received)} XMR counted from ${next.length} tx, ${Math.max(0, t.depth)}/${inv.required} conf${t.ignored ? ` · ${t.ignored} not counted (time-locked or double-spend)` : ''}`);
    }
  }
  if (ignored) ctx.note(`${ignored} snapshot${ignored > 1 ? 's' : ''} ignored: seq not newer than stored`);
  const poolFree = await ctx.storage.pool.count({ status: 'free' });
  return { ok: true, poolFree, poolTarget: POOL_TARGET, watch: await watchList(ctx) };
}

/* ---- route: POST admin (private, plugins:manage) ---- */
async function routeAdmin(req, ctx) {
  const a = req.json ?? {};
  if (a.action === 'saveSettings') {
    const key = String(a.bridgePublicKey ?? '').trim();
    let raw; try { raw = unb64(key); } catch { raw = null; }
    if (!raw || raw.length !== 32) return fail('INVALID_PUBLIC_KEY', { message: 'Paste the 44-character base64 key the bridge printed.' });
    if (!['USD', 'EUR', 'GBP'].includes(a.currency)) return fail('INVALID_REQUEST', { message: 'Unknown currency.' });
    if (!PRESETS[a.speed]) return fail('INVALID_REQUEST', { message: 'Unknown confirmation speed.' });
    await ctx.kv.set('settings', { bridgePublicKey: key, currency: a.currency, speed: a.speed });
    ctx.note('Settings saved');
    return { ok: true };
  }
  if (a.action === 'dismissAlert') {
    const alerts = ((await ctx.kv.get('alerts')) ?? []).filter(x => x.id !== a.id);
    await ctx.kv.set('alerts', alerts);
    return { ok: true };
  }
  const inv = await ctx.storage.invoices.get(String(a.id ?? ''));
  if (!inv) return fail('INVOICE_NOT_FOUND');
  if (a.action === 'raiseRequired') {
    // Tighten one open invoice. Never lowers: the target was locked at checkout.
    const top = PRESETS.strict[2];
    if (!LIVE.has(inv.status) || inv.required >= top) return fail('INVALID_REQUEST', { message: 'Only open invoices below the top tier can be raised.' });
    ctx.note(`${inv.id}: confirmations required raised ${inv.required} → ${top} (admin)`);
    inv.required = top;
    await ctx.storage.invoices.put(inv.id, inv);
    return { ok: true };
  }
  const now = ctx.now(); const before = inv.status;
  if (a.action === 'markSettled') { inv.status = 'settled'; inv.settledAt ??= now; inv.resolution = 'Marked settled by admin'; }
  else if (a.action === 'expire') { inv.status = 'expired'; inv.resolution = 'Expired by admin'; }
  else return fail('INVALID_REQUEST');
  inv.adminFinal = true; inv.finalAt ??= now;
  await ctx.storage.invoices.put(inv.id, inv);
  ctx.note(`${inv.id}: ${before} → ${inv.status} (admin)`);
  return { ok: true };
}

const xmrPay = {
  manifest: MANIFEST,
  routes: {
    checkout: { public: true, method: 'POST', handler: routeCheckout },
    status: { public: true, method: 'GET', handler: routeStatus },
    'bridge/sync': { public: true, method: 'POST', request: { body: 'text', headers: ['x-xmr-ts', 'x-xmr-sig'], maxBytes: 65_536 }, handler: routeBridgeSync },
    admin: { public: false, method: 'POST', handler: routeAdmin },
  },
  hooks: {
    async 'plugin:install'(ctx) {
      await ctx.kv.set('settings', { bridgePublicKey: '', currency: 'USD', speed: 'standard' });
      await ctx.cron.schedule('sweep', '* * * * *');
      ctx.note('Seeded default settings and scheduled the sweep for every minute');
    },
    async cron(ctx) {
      const now = ctx.now();
      for (const inv of await ctx.storage.invoices.query({})) {
        let dirty = false;
        if ((LIVE.has(inv.status) && now >= inv.expiresAt) || inv.reconfirmingSince != null) dirty = await evaluate(ctx, inv);
        if (inv.buyer && inv.finalAt && now >= inv.finalAt + PURGE_MS) { delete inv.buyer; inv.buyerPurged = true; dirty = true; ctx.note(`${inv.id}: buyer contact data purged`); }
        if (dirty) await ctx.storage.invoices.put(inv.id, inv);
      }
      const b = await ctx.kv.get('bridge');
      const silent = !b || now - b.lastSyncAt > SILENT_MS;
      if (silent !== Boolean(await ctx.kv.get('bridgeSilent'))) {
        await ctx.kv.set('bridgeSilent', silent);
        ctx.note(silent ? 'Bridge has been silent for over 5 minutes' : 'Bridge is syncing again');
      }
    },
    async 'plugin:uninstall'(ctx, { deleteData }) { if (deleteData) ctx.note('Storage deleted'); },
  },
};
/* ===================  end of plugin  =================== */

/* ======================================================================
   The EmDash host and sandbox, modelled: capability checks, per-plugin
   storage, the allowedHosts gate, and route dispatch.
   ====================================================================== */
class SandboxError extends Error { constructor(code, message) { super(message); this.code = code; } }
const host = { kv: new Map(), cols: { pool: new Map(), invoices: new Map() }, cron: [], trace: null };
const verifyKeys = new Map();
function hostReset() { host.kv = new Map(); host.cols = { pool: new Map(), invoices: new Map() }; host.cron = []; host.trace = null; verifyKeys.clear(); }

function makeCtx() {
  const m = MANIFEST;
  const has = cap => m.capabilities.includes(cap);
  const coll = name => {
    const decl = m.storage[name]; const map = host.cols[name];
    return {
      async get(id) { return clone(map.get(String(id)) ?? null); },
      async put(id, rec) {
        for (const u of decl.uniqueIndexes ?? []) for (const [k, r] of map) if (k !== String(id) && r[u] === rec[u]) throw new SandboxError('UNIQUE_VIOLATION', `${name}.${u}`);
        map.set(String(id), clone(rec));
      },
      async query(where = {}) { const out = []; for (const r of map.values()) if (Object.entries(where).every(([k, v]) => r[k] === v)) out.push(clone(r)); return out; },
      async findOne(where) { return (await this.query(where))[0] ?? null; },
      async count(where) { let n = 0; for (const r of map.values()) if (Object.entries(where).every(([k, v]) => r[k] === v)) n++; return n; },
    };
  };
  return {
    now: () => sim.now,
    note: s => host.trace?.push(s),
    kv: { get: async k => clone(host.kv.has(k) ? host.kv.get(k) : null), set: async (k, v) => { host.kv.set(k, clone(v)); } },
    storage: { pool: coll('pool'), invoices: coll('invoices') },
    content: {
      async get(collection, idOrSlug) {
        if (!has('content:read')) throw new SandboxError('CAPABILITY_MISSING', 'content:read');
        const e = (CONTENT[collection] ?? []).find(x => x.id === idOrSlug || x.slug === idOrSlug);
        return e ? clone(e) : null;
      },
    },
    http: {
      async fetch(url) {
        if (!has('network:request')) throw new SandboxError('CAPABILITY_MISSING', 'network:request');
        const u = new URL(url);
        if (u.protocol !== 'https:' || !m.allowedHosts.includes(u.hostname)) throw new SandboxError('HOST_NOT_ALLOWED', `${u.host} is not in allowedHosts`);
        return internet.fetch(url);
      },
    },
    cron: { async schedule(name, expr) { host.cron.push({ name, expr }); } },
    async verify(pubB64, sigB64, text) {            // WebCrypto inside the isolate
      let key = verifyKeys.get(pubB64);
      if (!key) {
        key = crypt.mode === 'ed25519'
          ? await crypto.subtle.importKey('raw', unb64(pubB64), { name: 'Ed25519' }, false, ['verify'])
          : await crypto.subtle.importKey('raw', unb64(pubB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        verifyKeys.set(pubB64, key);
      }
      let sigBytes; try { sigBytes = unb64(sigB64); } catch { return false; }
      return crypto.subtle.verify(algo(), key, sigBytes, enc.encode(text));
    },
  };
}

async function runHook(name, args) {
  host.trace = [];
  const ctx = makeCtx();
  try { await xmrPay.hooks[name](ctx, args); } catch (e) { host.trace.push(`Error: ${e.message}`); }
  const tr = host.trace; host.trace = null;
  return tr;
}

async function invokeRoute(name, req) {
  const def = xmrPay.routes[name];
  if (!def) return { body: fail('ROUTE_NOT_FOUND'), trace: [] };
  if (def.method !== req.method) return { body: fail('METHOD_NOT_ALLOWED'), trace: [] };
  if (!def.public && !(req.meta?.perms ?? []).includes('plugins:manage')) return { body: fail('FORBIDDEN'), trace: [] };
  const r = { query: req.query ?? {}, meta: { ip: req.meta?.ip ?? null } };
  if (def.request?.body === 'text') {
    const raw = req.rawBody ?? '';
    if (enc.encode(raw).length > def.request.maxBytes) return { body: fail('BODY_TOO_LARGE'), trace: [] };
    r.text = raw;
    r.headers = Object.fromEntries(def.request.headers.map(h => [h, req.headers?.[h] ?? null]));
  } else if (req.method === 'POST') {
    try { r.json = JSON.parse(req.rawBody ?? JSON.stringify(req.json ?? {})); } catch { return { body: fail('INVALID_JSON'), trace: [] }; }
  }
  host.trace = [];
  let body;
  try { body = await def.handler(r, makeCtx()); }
  catch (e) { body = fail(e.code ?? 'INTERNAL', { message: e.message }); }
  const trace = host.trace; host.trace = null;
  return { body, trace };
}

/* ======================================================================
   Wire log
   ====================================================================== */
const LOG = []; let logSeq = 0; let logVersion = 0;
const LANES = {
  theme: 'Visitor → plugin', bridge: 'Bridge → plugin', price: 'Plugin → price API', sandbox: 'Plugin ✕ sandbox',
  admin: 'Admin → plugin', plugin: 'Plugin hook', chain: 'Monero network', host: 'Wallet host', attack: 'Attacker → plugin',
};
function logEvent(e) {
  e.at = sim.now;
  if (e.coalesce && LOG[0]?.coalesce === e.coalesce) {
    const top = LOG[0]; top.count = (top.count ?? 1) + 1; top.at = e.at; top.req = e.req; top.res = e.res; top.summary = e.summary; top.headers = e.headers;
  } else {
    e.id = ++logSeq; LOG.unshift(e); if (LOG.length > 300) LOG.pop();
  }
  logVersion++;
}
const FLASH_FOR = { theme: 'e-theme', bridge: 'e-bridge', attack: 'e-bridge', price: 'e-price', sandbox: 'e-wallet' };
function flash(id, bad) {
  if (sim.booting) return;
  const el = document.getElementById(id); if (!el) return;
  const cls = bad ? 'pulse-bad' : 'pulse';
  el.classList.add(cls); clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove(cls), 450);
}

/* A request from somewhere into the plugin's routes, with logging. */
async function call(lane, method, route, opts = {}) {
  const { json, rawBody, headers, query, meta, quiet, note } = opts;
  const req = { method, query, headers, rawBody: rawBody ?? (json ? JSON.stringify(json) : undefined), meta };
  const { body, trace } = await invokeRoute(route, req);
  if (FLASH_FOR[lane]) flash(FLASH_FOR[lane], Boolean(body?.error) && lane === 'attack');
  if (lane === 'bridge') flash('e-rpc');
  if (!(quiet && quiet(body)) || trace.length) {
    const isErr = Boolean(body?.error);
    const path = route === 'bridge/sync' ? SYNC_PATH : `/_emdash/api/plugins/xmr-pay/${route}`;
    const summary = [note, ...trace].filter(Boolean).join(' · ') || (isErr ? body.error.message ?? '' : defaultSummary(route, body));
    logEvent({
      lane, title: `${method} ${route}${query?.token ? '?token=' + query.token.slice(0, 6) + '…' : ''}`, path,
      outcome: isErr ? 'err' : 'ok', code: isErr ? body.error.code : '200', summary,
      req: rawBody != null ? rawBody : json ?? (query ? { query } : null), headers, res: body,
      coalesce: lane !== 'bridge' ? null : isErr ? `bridge-${body.error.code}` : trace.length === 0 ? 'heartbeat' : null,
    });
  }
  return body;
}
function defaultSummary(route, body) {
  if (route === 'bridge/sync') return `Heartbeat · watching ${body.watch?.length ?? 0} · pool ${body.poolFree}/${body.poolTarget} free`;
  if (route === 'status') return `${body.status} · ${body.confirmations}/${body.required} conf`;
  return '';
}

/* ======================================================================
   The bridge (wallet host). Stateless apart from its key and a clock.
   ====================================================================== */
const bridge = { running: false, key: null, pub: '', pending: [], watch: null, lastSeq: 0, nextSyncAt: 0, poke: null, lastOkAt: null, lastErr: null, history: [] };
function bridgeReset() { Object.assign(bridge, { running: false, key: null, pub: '', pending: [], watch: null, lastSeq: 0, nextSyncAt: 0, poke: null, lastOkAt: null, lastErr: null, history: [] }); }

async function bridgeKeygen(rotate) {
  const k = await newKeypair();
  bridge.key = k.priv; bridge.pub = k.pub;
  logEvent({ lane: 'host', title: rotate ? 'bridge: new keypair' : 'bridge: first run', outcome: 'info', code: 'key',
    summary: `${rotate ? 'Generated a replacement' : 'Generated an'} ${crypt.mode === 'ed25519' ? 'Ed25519 keypair' : 'HMAC secret'}. Private key saved to /var/lib/xmr-bridge/key (0600). Public key: ${k.pub}` });
}
function bridgeStart() {
  bridge.running = true; bridge.watch = null; bridge.nextSyncAt = sim.now; bridge.poke = 'start';
  logEvent({ lane: 'host', title: 'bridge: started', outcome: 'info', code: 'start', summary: 'The first sync learns the watch list, the next one sends full snapshots for every watched index (reconcile).' });
}
function bridgeStop() {
  bridge.running = false; bridge.poke = null;
  logEvent({ lane: 'host', title: 'bridge: stopped', outcome: 'info', code: 'stop', summary: 'No more syncs. Checkout keeps working from the address pool.' });
}
async function bridgeSync(reason, depth = 0) {
  if (!bridge.running) return;
  const seq = Math.max(sim.now, bridge.lastSeq + 1); bridge.lastSeq = seq;
  const indexes = bridge.watch ?? [];
  // get_transfers (in + pool, filtered by subaddr_indices), passed through with the fields the plugin needs.
  const snapshot = index => ({ index, transfers: wallet.getTransfers(index).map(t => ({
    txid: t.txid, amount: t.amount, confirmations: t.confirmations, height: t.height, timestamp: t.timestamp,
    doubleSpendSeen: t.double_spend_seen, unlockTime: String(t.unlock_time),
  })) });
  const payload = { seq, height: chain.height, addresses: bridge.pending, snapshots: indexes.map(snapshot) };
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(sim.now / 1000));
  const sig = b64(await sign(bridge.key, enc.encode(ts + '\n' + raw)));
  const headers = { 'content-type': 'text/plain', 'x-xmr-ts': ts, 'x-xmr-sig': sig };
  const res = await call('bridge', 'POST', 'bridge/sync', { rawBody: raw, headers, note: reason !== 'interval' ? reasonText(reason) : '' });
  bridge.history.push({ at: sim.now, ts, raw, sig }); if (bridge.history.length > 80) bridge.history.shift();
  bridge.nextSyncAt = sim.now + SYNC_EVERY_MS;
  if (res?.error) { bridge.lastErr = res.error.code; return; }
  bridge.lastErr = null; bridge.lastOkAt = sim.now; bridge.pending = [];
  const firstContact = bridge.watch === null;
  bridge.watch = res.watch;
  let again = null;
  if (res.poolFree < res.poolTarget) {
    const n = res.poolTarget - res.poolFree;
    for (let i = 0; i < n; i++) bridge.pending.push(wallet.createAddress());
    logEvent({ lane: 'host', title: `wallet-rpc create_address ×${n}`, outcome: 'info', code: 'rpc', summary: `Account 0, label "xmr-pay". Indexes ${bridge.pending[0].index}–${bridge.pending[n - 1].index}, sent in the next sync.` });
    again = 'pool top-up';
  }
  if (firstContact && res.watch.length) again = 'reconcile';
  if (again && depth < 2) await bridgeSync(again, depth + 1);
}
function reasonText(r) {
  return { 'tx-notify': 'Sent at once: wallet-rpc --tx-notify fired', reconcile: 'Reconcile: full snapshots for every watched index', 'pool top-up': 'Carries new subaddresses for the pool', start: 'First sync after start', reorg: 'Sent at once: the wallet saw a reorg', 'tx dropped': 'Sent at once: a mempool tx disappeared' }[r] ?? r;
}

/* ======================================================================
   The theme (visitor's browser)
   ====================================================================== */
const VISITOR_IP = '198.51.100.23';
const theme = { tab: 'store', pay: null, msg: null, pollAt: 0 };
const ERR_TEXT = {
  RATE_UNAVAILABLE: 'Couldn\'t get a Monero price from either price service. Try again in a minute.',
  NO_ADDRESS_AVAILABLE: 'No payment addresses are free right now. The site owner\'s bridge needs to add more.',
  TOO_MANY_OPEN: 'Too many unpaid checkouts from this connection. Pay or wait out an open one, then try again.',
  PRODUCT_NOT_FOUND: 'That product isn\'t for sale any more.',
  NOT_CONFIGURED: 'Monero payments aren\'t set up on this site yet.',
  AMOUNT_TOO_SMALL: 'That tip is below the 0.0001 XMR minimum.',
  INVALID_REQUEST: 'Check the optional details and try again.',
};
async function themeCheckout(payload, label, ip = VISITOR_IP) {
  const res = await call('theme', 'POST', 'checkout', { json: payload, meta: { ip } });
  if (res.error) { theme.msg = { kind: 'bad', text: `${ERR_TEXT[res.error.code] ?? res.error.message ?? 'Checkout failed.'} (${res.error.code})` }; return null; }
  theme.msg = null;
  theme.pay = { ...res, label, kind: payload.kind, st: null, contentRef: payload.contentRef };
  theme.tab = 'pay';
  await themePoll(true);                       // the /pay page fetches status server-side first
  theme.pollAt = sim.now + 5_000;
  return res;
}
async function themePoll(force) {
  const p = theme.pay; if (!p) return;
  const prev = p.st;
  const res = await call('theme', 'GET', 'status', {
    query: { token: p.token },
    // Log only what the buyer would notice: a new status, or progress while the invoice is still live.
    quiet: r => !force && prev && !r.error && r.status === prev.status && (!LIVE.has(r.status) || (r.confirmations === prev.confirmations && r.receivedAtomic === prev.receivedAtomic)),
    note: force ? 'Server-side fetch when /pay loads' : '',
  });
  if (!res.error) p.st = res;
}
function buyerSend(kind) {
  const p = theme.pay; if (!p) return null;
  const expected = p.amountAtomic ? BigInt(p.amountAtomic) : null;
  const received = BigInt(p.st?.receivedAtomic ?? '0');
  let amount = null;
  if (kind === 'custom') { try { amount = xmrToAtomic($('#customXmr').value.trim() || '0.02'); } catch { return null; } }
  else if (expected) amount = { full: expected, part: expected * 60n / 100n, rest: expected - received, over: expected * 110n / 100n }[kind];
  if (!amount || amount <= 0n) return null;
  const tx = broadcast(p.address, amount);
  logEvent({ lane: 'chain', title: 'buyer wallet: transfer', outcome: 'info', code: 'mempool', summary: `Sent ${xmr(amount)} XMR to …${p.address.slice(-8)}. tx ${tx.txid.slice(0, 12)}… is in the mempool.` });
  return tx;
}

/* ======================================================================
   Time
   ====================================================================== */
let cronAt = T0 + 60_000;
async function processDue() {
  while (sim.now >= chain.nextBlockAt) mineBlock(chain.nextBlockAt);
  while (sim.now >= market.nextDriftAt) { drift(); market.nextDriftAt += 60_000; }
  if (bridge.running && (bridge.poke || sim.now >= bridge.nextSyncAt)) {
    const r = bridge.poke ?? 'interval'; bridge.poke = null;
    await bridgeSync(r);
  }
  while (sim.now >= cronAt) {
    const tr = await runHook('cron');
    if (tr.length) logEvent({ lane: 'plugin', title: 'cron sweep', outcome: 'info', code: 'cron', summary: tr.join(' · ') });
    cronAt += 60_000;
  }
  if (theme.pay && sim.now >= theme.pollAt) { await themePoll(false); theme.pollAt = sim.now + 5_000; }
}
async function advance(ms, opts = {}) {
  const step = opts.step ?? (ms > 3 * 3_600_000 ? 60_000 : 5_000);
  let left = ms, n = 0;
  while (left > 0) {
    const d = Math.min(step, left);
    sim.now += d; left -= d;
    await processDue();
    if (++n % 120 === 0 && !sim.booting) { render(); await nextFrame(); }
  }
}

/* ======================================================================
   Boot: install, first bridge run, and a little history
   ====================================================================== */
async function boot() {
  sim.booting = true;
  sim.now = T0; cronAt = T0 + 60_000;
  chainReset(); wallet.reset(); marketReset(); hostReset(); bridgeReset();
  LOG.length = 0; logVersion++;
  theme.tab = 'store'; theme.pay = null; theme.msg = null;
  siteTab = 'admin'; freshIds.clear();

  if (!(await detectEd25519())) {
    crypt.mode = 'hmac';
    const n = $('#cryptoNote'); n.hidden = false;
    n.textContent = 'This browser has no WebCrypto Ed25519, which is open question 1 in the spec. The demo is using the spec\'s fallback instead: HMAC with a shared secret. The key field now holds a secret.';
    $('#set-key-help').textContent = 'HMAC fallback: a shared secret. Treat it as sensitive.';
  }

  const tr = await runHook('plugin:install');
  logEvent({ lane: 'plugin', title: 'plugin:install', outcome: 'info', code: 'hook', summary: `Installed xmr-pay from the registry. ${tr.join(' · ')}` });
  await bridgeKeygen(false);
  await call('admin', 'POST', 'admin', { json: { action: 'saveSettings', bridgePublicKey: bridge.pub, currency: 'USD', speed: 'standard' }, meta: { perms: ['plugins:manage'] }, note: 'Operator pasted the bridge public key' });
  bridgeStart();
  await advance(90_000);

  // Example history from other visitors, so the admin page has rows.
  const tip = await call('theme', 'POST', 'checkout', { json: { kind: 'tip', contentRef: { collection: 'posts', id: POST.id }, amount: { fiat: 5 }, note: 'Thanks for the write-up' }, meta: { ip: '192.0.2.14' } });
  if (!tip.error) broadcast(tip.address, BigInt(tip.amountAtomic) + 37_000_000n);
  await advance(9 * 60_000);
  await call('theme', 'POST', 'checkout', { json: { kind: 'product', product: 'membership' }, meta: { ip: '192.0.2.77' } });
  await advance(8 * 60_000);
  const hb = await call('theme', 'POST', 'checkout', { json: { kind: 'product', product: 'handbook' }, meta: { ip: '192.0.2.30' } });
  if (!hb.error) broadcast(hb.address, BigInt(hb.amountAtomic));
  await advance(T0 + 3_600_000 - sim.now);

  sim.booting = false;
  syncSettingsForm();
  render();
}

/* ======================================================================
   Scenarios (scripted walk-throughs)
   ====================================================================== */
const say = (html, el = '#narrator') => { $(el).innerHTML = html; };
const st = () => theme.pay?.st;
const invByToken = t => [...host.cols.invoices.values()].find(i => i.token === t);
async function act(fn) { const r = await serial(fn); render(); return r; }
async function ffUntil(pred, maxMs, step = 5_000, delay = 70) {
  let spent = 0;
  while (!pred() && spent < maxMs) { await serial(() => advance(step)); spent += step; render(); await sleep(delay); }
  return pred();
}
// The buyer's wallet broadcasts, and wallet-rpc's --tx-notify pokes the bridge at once.
const pay = kind => act(async () => { const tx = buyerSend(kind); await processDue(); return tx; });
const ffFor = (ms, step = 30_000) => ffUntil(() => false, ms, step, 60);
async function beat(ms = 1100) { render(); await sleep(ms); }
async function setSpeed(speed, note) {
  const s = settings();
  await call('admin', 'POST', 'admin', { json: { action: 'saveSettings', bridgePublicKey: s.bridgePublicKey, currency: s.currency, speed }, meta: { perms: ['plugins:manage'] }, note });
  syncSettingsForm();
}
function focusVisitor(tab) { theme.tab = tab; }
async function freshCheckout(product, label) {
  const p = PRODUCTS.find(x => x.slug === product);
  return act(() => themeCheckout({ kind: 'product', product }, p?.title ?? label));
}

const SCENARIOS = [
  { key: 'happy', label: 'Pay in full', async run() {
    say('<b>Pay in full.</b> The visitor clicks "Pay with Monero" on the $12 handbook. The plugin reads the price from the entry and locks the rate for 30 minutes.');
    if (!(await freshCheckout('handbook'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1600);
    say('Their wallet sends the exact amount. It lands in the mempool, wallet-rpc fires <code>--tx-notify</code>, and the bridge pushes a signed snapshot at once.');
    await pay('full');
    await ffUntil(() => st()?.status === 'confirming', 60_000);
    say('The full amount is seen at 0 confirmations, so the invoice is <b>confirming</b>. Nothing is fulfilled yet.');
    await beat(1600);
    await ffUntil(() => st()?.status === 'settled', 15 * 60_000);
    say(`<b>Settled</b> at ${st()?.confirmations} confirmations (Standard preset, under 100). The theme checks <code>status</code> on the server and unlocks the download.`);
  } },
  { key: 'split', label: 'Pay in two parts', async run() {
    say('<b>Pay in two parts.</b> A $150 membership. Over 100, so Standard needs 5 confirmations.');
    if (!(await freshCheckout('membership'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1400);
    say('The buyer sends only 60%. The invoice moves to <b>seen</b> and the page shows what\'s missing.');
    await pay('part');
    await ffUntil(() => st()?.status === 'seen', 60_000);
    await beat(1800);
    say('They send the rest to the same address. Transfers are summed, so the invoice moves to <b>confirming</b>.');
    await pay('rest');
    await ffUntil(() => st()?.status === 'confirming', 60_000);
    await beat(1200);
    await ffUntil(() => st()?.status === 'settled', 30 * 60_000);
    say(`<b>Settled</b> once the newer transfer reached ${st()?.confirmations} confirmations. Depth counts from the shallowest transfer needed to reach the amount.`);
  } },
  { key: 'underpaid', label: 'Underpay and leave', async run() {
    say('<b>Underpay and leave.</b> The buyer sends 60% of the handbook price and never comes back.');
    if (!(await freshCheckout('handbook'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1200);
    await pay('part');
    await ffUntil(() => st()?.status === 'seen', 60_000);
    say('Seen, but below 99.5% of the expected amount. Skipping ahead to the end of the 30-minute window…');
    await beat(1200);
    await ffUntil(() => st()?.status !== 'seen', 35 * 60_000, 30_000, 60);
    say(`At expiry the invoice went to <b>${esc(st()?.status)}</b> with reason <b>underpaid</b>. Refunds are manual, from your own wallet, using the refund address if the buyer gave one.`);
    siteTab = 'admin';
  } },
  { key: 'late', label: 'Pay after expiry', async run() {
    say('<b>Pay after expiry.</b> The buyer opens the handbook checkout, then gets distracted.');
    if (!(await freshCheckout('handbook'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1200);
    await ffUntil(() => st()?.status === 'expired', 35 * 60_000, 30_000, 60);
    say('Expired with nothing received. The subaddress stays on the watch list for 24 hours. Now the buyer pays anyway…');
    await beat(1600);
    await pay('full');
    await ffUntil(() => st()?.status === 'review', 120_000);
    say('The late payment moved the invoice to <b>review</b> with reason <b>late</b>. Nothing settles on its own after expiry; the owner decides on the admin page.');
    siteTab = 'admin';
  } },
  { key: 'reorg', label: 'Reorg after settling', async run() {
    say('<b>Reorg after settling.</b> The handbook is paid and settles at 2 confirmations. It stays on the watch list until the payment is 10 blocks deep.');
    if (!(await freshCheckout('handbook'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1000);
    const tx = await pay('full');
    await ffUntil(() => st()?.status === 'settled', 15 * 60_000);
    await beat(1400);
    const depth = Math.max(2, confs(tx));
    say(`A competing chain replaces the last ${depth} blocks. The payment drops back to the mempool, which is what usually happens in a reorg…`);
    await beat(1000);
    await act(() => reorg(depth));
    siteTab = 'admin';
    await ffUntil(() => st()?.reconfirming, 60_000);
    say('The invoice stays <b>settled</b> and the admin page marks it <b>re-confirming</b>. No alert, because the money is still there.');
    await beat(2400);
    await ffUntil(() => st() && !st().reconfirming, 15 * 60_000);
    say(`The payment was mined again and is back to ${st()?.confirmations} confirmations. Nothing for the owner to do. The invoice leaves the watch list once it is 10 deep.`);
  } },
  { key: 'reversed', label: 'Payment reversed', async run() {
    say('<b>Payment reversed.</b> The handbook is paid and settles. Then a reorg brings in a block that spends the same coins elsewhere.');
    if (!(await freshCheckout('handbook'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1000);
    const tx = await pay('full');
    await ffUntil(() => st()?.status === 'settled', 15 * 60_000);
    await beat(1400);
    say('The competing chain carries a conflicting spend, so the buyer\'s payment can never be mined again…');
    await beat(1000);
    await act(() => reorg(Math.max(2, confs(tx)), true));
    await ffUntil(() => st()?.status === 'review', 60_000);
    siteTab = 'admin';
    say('The money is gone from the chain, so the invoice goes straight to <b>review (reversed)</b> with an alert. Fulfillment is not undone automatically; the owner decides.');
  } },
  { key: 'outage', label: 'Outage across expiry', async run() {
    say('<b>Outage across expiry.</b> The bridge stops. Checkout still works, because addresses come from the pre-created pool.');
    await act(() => { if (bridge.running) bridgeStop(); });
    await beat(1000);
    if (!(await freshCheckout('handbook'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1000);
    await ffFor(2 * 60_000);
    await pay('full');
    say('The buyer pays two minutes in. The wallet sees it, but nobody tells the site. Skipping past the end of the 30-minute window…');
    siteTab = 'admin';
    const inv = invByToken(theme.pay.token);
    await ffUntil(() => sim.now >= inv.expiresAt + 3 * 60_000, 45 * 60_000, 30_000, 60);
    say('The window has closed, but the plugin has no sync from after the deadline, so it does <b>not</b> expire the invoice. The pay page says it is checking, and the admin page says it is waiting for the bridge.');
    await beat(3000);
    say('The bridge comes back and reconciles. The payment was mined at a height inside the window, so it counts as on time…');
    await act(() => bridgeStart());
    await ffUntil(() => !LIVE.has(st()?.status ?? 'new'), 10 * 60_000);
    say(`<b>${esc(st()?.status)}</b>. Before this fix, the same payment would have been marked late and sent to review.`);
  } },
  { key: 'midchange', label: 'Change speed mid-invoice', async run() {
    say('<b>Change speed mid-invoice.</b> The handbook is checked out at Standard, so it needs 2 confirmations.');
    if (!(await freshCheckout('handbook'))) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1400);
    say('While the buyer is paying, the owner switches the site to Strict (10 confirmations).');
    siteTab = 'admin';
    await act(() => setSpeed('strict', 'Owner switched to Strict while an invoice was open'));
    await beat(1400);
    await pay('full');
    await ffUntil(() => st()?.status === 'settled', 15 * 60_000);
    say(`Settled at ${st()?.confirmations} of ${st()?.required}: the target was locked when the invoice was created. New checkouts need 10 now. To tighten one open invoice, the admin page has "Raise to 10".`);
    await beat(2600);
    await act(() => setSpeed('standard', 'Demo switched back to Standard'));
  } },
  { key: 'tip', label: 'Tip a post', async run() {
    say('<b>Tip a post.</b> A reader tips $5 on the blog post with a note. Tips settle at the lowest tier of the preset.');
    await act(() => { focusVisitor('store'); $('#tipNote').value = 'This cleared up the bridge design for me'; });
    await beat(900);
    const ok = await act(() => startTip('5'));
    if (!ok) return say(`Checkout failed: ${esc(theme.msg?.text)}`);
    await beat(1200);
    await pay('full');
    await ffUntil(() => st()?.status === 'settled', 15 * 60_000);
    siteTab = 'admin';
    say('<b>Tip received.</b> The admin page totals tips per entry and shows the note. Notes are purged with other buyer data after 30 days.');
  } },
];

async function runScenario(key) {
  if (sim.scenario || sim.booting) return;
  const sc = SCENARIOS.find(s => s.key === key); if (!sc) return;
  sim.scenario = key; render();
  try { await sc.run(); } catch (e) { console.error(e); say(`Scenario stopped: ${esc(e.message)}`); }
  sim.scenario = false; render();
}

/* ======================================================================
   Attacks
   ====================================================================== */
const ATTACK_IP = '203.0.113.66';
const TRICK_IP = '203.0.113.90';
// A new invoice joins the watch list on one sync and is reported on the next.
async function syncTwice() { await processDue(); if (bridge.running) { bridge.poke = 'interval'; await processDue(); } }
const ATTACKS = [
  { key: 'replay', label: 'Replay captured syncs', async run() {
    const newest = bridge.history.at(-1), oldest = bridge.history[0];
    if (!newest) return 'No syncs captured yet. Start the bridge first.';
    const r1 = await call('attack', 'POST', 'bridge/sync', { rawBody: newest.raw, headers: { 'x-xmr-ts': newest.ts, 'x-xmr-sig': newest.sig }, note: `Replayed the newest capture (${Math.round((sim.now - newest.at) / 1000)} s old)` });
    let txt = r1.error ? `Newest capture: rejected (${r1.error.code}).` : 'Newest capture: accepted, because it is valid and fresh, but its snapshots are not newer than what is stored, so nothing changed.';
    if (oldest && oldest !== newest) {
      const r2 = await call('attack', 'POST', 'bridge/sync', { rawBody: oldest.raw, headers: { 'x-xmr-ts': oldest.ts, 'x-xmr-sig': oldest.sig }, note: `Replayed a capture from ${hms(oldest.at)}` });
      txt += r2.error ? ` A ${Math.round((sim.now - oldest.at) / 60000)}-minute-old capture: rejected with ${r2.error.code}.` : ' The oldest capture was still inside 300 s, so it was accepted and ignored the same way.';
    }
    return txt;
  } },
  { key: 'forge', label: 'Forge a payment', async run() {
    const target = [...host.cols.invoices.values()].filter(i => LIVE.has(i.status)).sort((a, b) => b.createdAt - a.createdAt)[0];
    const idx = target?.addrIndex ?? 1;
    const k = await newKeypair();
    const raw = JSON.stringify({ seq: sim.now + 1, height: chain.height, addresses: [], snapshots: [{ index: idx, transfers: [{ txid: hex(randBytes(32)), amount: target?.expectedAtomic ?? '1000000000000', confirmations: 20, height: chain.height - 19 }] }] });
    const ts = String(Math.floor(sim.now / 1000));
    const sig = b64(await sign(k.priv, enc.encode(ts + '\n' + raw)));
    const r = await call('attack', 'POST', 'bridge/sync', { rawBody: raw, headers: { 'x-xmr-ts': ts, 'x-xmr-sig': sig }, note: `Claims subaddress #${idx} was paid in full at 20 confirmations, signed with the attacker's own key` });
    return r.error ? `Rejected with ${r.error.code}. Only the key pasted in settings can sign a sync, and the plugin stores just its public half.` : 'Accepted?! That should not happen.';
  } },
  { key: 'tamper', label: 'Tamper with a sync', async run() {
    const last = bridge.history.at(-1);
    if (!last) return 'No syncs captured yet.';
    let raw = last.raw.replace(/"confirmations":\d+/, '"confirmations":99');
    if (raw === last.raw) raw = last.raw.replace(/"height":(\d+)/, (m, h) => `"height":${Number(h) + 50}`);
    const ts = String(Math.floor(sim.now / 1000));
    const r = await call('attack', 'POST', 'bridge/sync', { rawBody: raw, headers: { 'x-xmr-ts': ts, 'x-xmr-sig': last.sig }, note: 'Took a real signed sync, edited one number and refreshed the timestamp' });
    return r.error ? `Rejected with ${r.error.code}. The signature covers the timestamp and every byte of the raw body.` : 'Accepted?! That should not happen.';
  } },
  { key: 'price', label: 'Send my own price', async run() {
    const r = await call('attack', 'POST', 'checkout', { json: { kind: 'product', product: 'workshop', amount: { fiat: 1 }, price: 0.01 }, meta: { ip: ATTACK_IP }, note: 'Asked for the $1,200 workshop with "amount": 1 and "price": 0.01' });
    if (r.error) return `Checkout returned ${r.error.code}.`;
    return `The plugin ignored both fields and charged ${xmr(r.amountAtomic)} XMR, the full $1,200 at the locked rate.`;
  } },
  { key: 'wallet', label: 'Plugin calls the wallet', async run() {
    host.trace = []; const ctx = makeCtx(); const out = [];
    for (const url of ['http://127.0.0.1:18083/json_rpc', 'https://192.168.1.40:18083/json_rpc']) {
      try { await ctx.http.fetch(url); out.push(`${url}: reached?!`); } catch (e) { out.push(`${new URL(url).host}: ${e.code ?? e.message}`); }
    }
    host.trace = null;
    flash('e-wallet', true);
    logEvent({ lane: 'sandbox', title: 'ctx.http.fetch(wallet-rpc)', outcome: 'block', code: 'BLOCKED', summary: out.join(' · '), req: { tried: ['http://127.0.0.1:18083/json_rpc', 'https://192.168.1.40:18083/json_rpc'] }, res: { allowedHosts: MANIFEST.allowedHosts } });
    return 'A compromised plugin update tries to reach wallet-rpc on localhost and on the LAN. The sandbox only lets it reach the two declared price hosts.';
  } },
  { key: 'spam', label: 'Spam checkouts', async run() {
    let ok = 0, blocked = 0, noAddr = 0;
    for (let i = 0; i < 8; i++) {
      const r = await call('attack', 'POST', 'checkout', { json: { kind: 'product', product: 'handbook' }, meta: { ip: ATTACK_IP }, note: `Spam checkout ${i + 1} of 8` });
      if (!r.error) ok++; else if (r.error.code === 'TOO_MANY_OPEN') blocked++; else if (r.error.code === 'NO_ADDRESS_AVAILABLE') noAddr++;
    }
    const free = [...host.cols.pool.values()].filter(p => p.status === 'free').length;
    return `${ok} went through, ${blocked} hit TOO_MANY_OPEN (5 per hashed IP per 30 min)${noAddr ? `, ${noAddr} hit NO_ADDRESS_AVAILABLE` : ''}. ${free} pool addresses left${bridge.running ? '; the bridge tops the pool up on its next sync' : ', and the bridge is stopped, so nothing refills it'}.`;
  } },
  { key: 'timelock', label: 'Pay with locked funds', async run() {
    const r = await call('attack', 'POST', 'checkout', { json: { kind: 'product', product: 'handbook' }, meta: { ip: TRICK_IP }, note: 'A buyer opens a checkout for the $12 handbook' });
    if (r.error) return `Checkout returned ${r.error.code}.`;
    const lockTo = chain.height + 525_600;            // about two years of 2-minute blocks
    const tx = broadcast(r.address, BigInt(r.amountAtomic), { unlockTime: lockTo });
    logEvent({ lane: 'chain', title: 'buyer wallet: time-locked transfer', outcome: 'info', code: 'mempool', summary: `Sent the full ${xmr(tx.amount)} XMR with unlock_time ${lockTo}. The site could not spend it for about two years.` });
    await syncTwice();
    const inv = invByToken(r.token);
    return `The buyer paid the full amount but locked it until block ${lockTo.toLocaleString('en-US')}, about two years away. The plugin received the transfer and did not count it, so the invoice is still "${inv?.status}". The admin table shows it as not counted.`;
  } },
  { key: 'doublespend', label: 'Double-spend in the mempool', async run() {
    const r = await call('attack', 'POST', 'checkout', { json: { kind: 'product', product: 'handbook' }, meta: { ip: TRICK_IP }, note: 'A buyer opens a checkout for the $12 handbook' });
    if (r.error) return `Checkout returned ${r.error.code}.`;
    broadcast(r.address, BigInt(r.amountAtomic), { doubleSpendSeen: true });
    logEvent({ lane: 'chain', title: 'buyer wallet: conflicting transfer', outcome: 'info', code: 'mempool', summary: 'Paid the invoice with coins that were already spent in another pending transaction. wallet-rpc reports double_spend_seen.' });
    await syncTwice();
    const inv = invByToken(r.token);
    return `The payment reached the mempool, but wallet-rpc flagged double_spend_seen because the same coins were already being spent elsewhere. The plugin does not count it, so the invoice stays "${inv?.status}" instead of showing "confirming". The other spend wins at the next block and the transfer disappears.`;
  } },
  { key: 'leak', label: 'Leak the database', async run() {
    siteTab = 'storage'; leakFlash = sim.now;
    return 'This is everything the plugin stores. No view key, no spend key, no wallet password. The bridge key is the public half. The worst a leak gives away is open invoice tokens and optional buyer contact details.';
  } },
];
async function runAttack(key) {
  const a = ATTACKS.find(x => x.key === key); if (!a || sim.booting) return;
  const txt = await serial(() => a.run());
  say(esc(txt ?? ''), '#attackNarrator');
  render();
}

/* ======================================================================
   Rendering
   ====================================================================== */
let siteTab = 'admin';
let leakFlash = 0;
const freshIds = new Set();
const qrCache = new Map();
function setHTML(el, html) { if (el._html !== html) { el._html = html; el.innerHTML = html; } }

function qrSvg(text) {
  if (qrCache.has(text)) return qrCache.get(text);
  let out;
  if (typeof window.qrcode !== 'function') out = '<div class="qr-missing">QR library didn\'t load. In a real theme it is bundled and rendered locally.</div>';
  else {
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 3} ${r + 3}h1v1h-1z`;
    out = `<svg class="qr" viewBox="0 0 ${n + 6} ${n + 6}" role="img" aria-label="QR code of the monero: payment link" shape-rendering="crispEdges"><rect width="${n + 6}" height="${n + 6}" fill="var(--qr-bg)"/><path d="${d}" fill="var(--qr-fg)"/></svg>`;
  }
  qrCache.set(text, out);
  return out;
}
const pill = (s, extra = '') => `<span class="pill st-${esc(s)}">${esc(s)}${extra ? ' · ' + esc(extra) : ''}</span>`;
const settings = () => host.kv.get('settings') ?? { currency: 'USD', speed: 'standard', bridgePublicKey: '' };

function renderTop() {
  $('#clock').innerHTML = `${hms(sim.now)}<small>UTC · ${new Date(sim.now).toISOString().slice(0, 10)}</small>`;
  $$('#speed button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === sim.speed)));
  const cur = settings().currency;
  const nb = Math.max(0, chain.nextBlockAt - sim.now);
  setHTML($('#clockStats'), `<span>Height <b>${chain.height.toLocaleString('en-US')}</b></span><span>Next block <b data-live="nextblock">${mmss(nb)}</b></span><span>Mempool <b>${chain.mempool.length}</b></span><span>XMR/${cur} <b>${market.rates[cur]?.toFixed(2)}</b></span>${sim.scenario ? '<span><b>Scenario running</b></span>' : ''}`);
  $$('[data-act="ff"], [data-act="reset"]').forEach(b => { b.disabled = Boolean(sim.scenario) || sim.booting; });
  $$('#scenarioButtons button').forEach(b => { b.disabled = Boolean(sim.scenario) || sim.booting; b.setAttribute('aria-pressed', String(sim.scenario === b.dataset.v)); });
  $$('[data-act="api"]').forEach(b => b.setAttribute('aria-pressed', String(market.up[b.dataset.host])));
}

function renderVisitor() {
  const onPay = theme.tab === 'pay';
  $('#vt-store').setAttribute('aria-selected', String(!onPay));
  $('#vt-pay').setAttribute('aria-selected', String(onPay));
  $('#v-store').hidden = onPay; $('#v-pay').hidden = !onPay;
  $('#urlbar').textContent = onPay && theme.pay ? `example.com/pay/${theme.pay.token}` : 'example.com/shop';
  const msg = $('#storeMsg');
  msg.hidden = !theme.msg; if (theme.msg) { msg.className = `msg ${theme.msg.kind}`; msg.textContent = theme.msg.text; }
  const s = settings();
  $$('[data-live="price"]').forEach(el => { el.textContent = fiat(Math.round(Number(el.dataset.p) * 100), s.currency); });
  $$('[data-live="tier"]').forEach(el => { const n = requiredConfs('product', Math.round(Number(el.dataset.p) * 100), s.speed); el.textContent = `Settles at ${n} confirmation${n > 1 ? 's' : ''} (~${n * 2} min)`; });
  $$('#v-store [data-act="tip"]').forEach(b => { if (b.dataset.v) b.textContent = fiat(Number(b.dataset.v) * 100, s.currency).replace(/\.00$/, ''); });

  const p = theme.pay;
  if (!p) { setHTML($('#payView'), '<div class="empty">No checkout yet. Pick something in the store.</div>'); updateWalletButtons(); return; }
  const x = p.st ?? { status: 'new', confirmations: 0, required: 0, receivedAtomic: '0' };
  const inv = invByToken(p.token);
  const cur = inv?.fiat?.currency ?? s.currency;
  const expected = p.amountAtomic ? BigInt(p.amountAtomic) : null;
  const received = BigInt(x.receivedAtomic ?? '0');
  const remainingConfs = Math.max(0, x.required - x.confirmations);
  const msgs = {
    new: expected ? 'Send exactly this amount to the address below. This page updates by itself.' : 'Send any amount of at least 0.0001 XMR to the address below.',
    seen: expected ? `Payment seen. Received ${xmr(received)} of ${xmr(expected)} XMR. Send the rest to the same address.` : 'Payment seen in the mempool.',
    confirming: `Payment received. Waiting for ${remainingConfs} more confirmation${remainingConfs === 1 ? '' : 's'} (about ${remainingConfs * 2} min).`,
    settled: p.kind === 'tip' ? 'Tip received. Thank you.' : 'Paid. Your purchase is unlocked.',
    expired: 'This invoice expired with no payment. Start a new checkout to get a fresh address and rate.',
    review: 'We received a payment that needs a look from the site owner. They will follow up.',
    checking: 'The payment window has closed. Checking with the site\'s wallet for a payment sent in time. This page updates by itself.',
  };
  const msgKey = LIVE.has(x.status) && x.pendingExpiry ? 'checking' : x.status;
  const msgCls = msgKey === 'checking' ? 'seen' : x.status;
  const fiatLine = inv?.fiat ? `${fiat(inv.fiat.amountMinor, cur)} at ${fiat(inv.rate.minor, cur)}/XMR, locked until ${hm(inv.expiresAt)} UTC` : 'Open amount';
  const pips = Array.from({ length: Math.max(1, x.required) }, (_, i) => `<i class="${i < x.confirmations ? 'on' : ''}"></i>`).join('');
  const live = LIVE.has(x.status);
  setHTML($('#payView'), `
    <div class="paybox">
      <div class="row between"><div><p class="eyebrow">${p.kind === 'tip' ? 'Tip' : 'Checkout'}</p><h3>${esc(p.label)}</h3></div>${pill(x.status, msgKey === 'checking' ? 'checking' : x.reconfirming ? 're-confirming' : '')}</div>
      <div class="chips"><span class="chip">noindex</span><span class="chip">Referrer-Policy: no-referrer</span><span class="chip">Cache-Control: private, no-store</span><span class="chip">QR rendered locally</span></div>
      <div><div class="amount-xmr">${expected ? esc(atomicToXmr(expected)) : 'Any amount'} <small>XMR</small></div><p class="small muted">${esc(fiatLine)}</p></div>
      <div class="pay-grid">
        <div>${qrSvg(p.uri)}</div>
        <div class="stack">
          <div class="address" id="payAddr">${esc(p.address)}</div>
          <div class="row"><button type="button" class="btn sm" data-act="copy" data-v="${esc(p.address)}">Copy address</button><button type="button" class="btn sm" data-act="copy" data-v="${esc(p.uri)}">Copy payment link</button></div>
          <dl class="kv">
            <dt>Expires in</dt><dd>${msgKey === 'checking' ? 'closed, checking' : live ? `<span data-live="countdown" data-t="${inv?.expiresAt ?? 0}">${mmss((inv?.expiresAt ?? 0) - sim.now)}</span>` : '—'}</dd>
            <dt>Received</dt><dd>${xmr(received)} XMR</dd>
            <dt>Confirmations</dt><dd><div class="row" style="gap:8px"><span>${x.confirmations} of ${x.required}</span><span class="pips" aria-hidden="true">${pips}</span></div></dd>
          </dl>
        </div>
      </div>
      <p class="statusline s-${esc(msgCls)}">${esc(msgs[msgKey] ?? x.status)}</p>
      ${x.status === 'settled' && p.kind === 'product' ? `<div class="unlock"><b>Download unlocked</b><span class="small muted">The page asked the plugin on the server and got <code>status: "settled"</code>. A client-side flag would not count.</span></div>` : ''}
      <div class="row"><button type="button" class="btn sm" data-act="vtab" data-v="store">Back to the store</button><span class="small muted">Polls <code>status</code> every 5 s</span></div>
    </div>`);
  updateWalletButtons();
}
function updateWalletButtons() {
  const p = theme.pay; const x = p?.st;
  const expected = p?.amountAtomic ? BigInt(p.amountAtomic) : null;
  const received = BigInt(x?.receivedAtomic ?? '0');
  const can = Boolean(p) && !sim.scenario;
  const set = (v, on) => { const b = $(`#walletSim [data-v="${v}"]`); if (b) b.disabled = !on; };
  set('full', can && expected != null); set('part', can && expected != null); set('over', can && expected != null);
  set('rest', can && expected != null && received > 0n && received < expected);
  set('custom', can);
}

function renderAdmin() {
  const s = settings();
  const invs = [...host.cols.invoices.values()].sort((a, b) => b.createdAt - a.createdAt);
  const pool = [...host.cols.pool.values()];
  const free = pool.filter(p => p.status === 'free').length;
  const b = host.kv.get('bridge');
  const silentFor = b ? sim.now - b.lastSyncAt : Infinity;
  const alerts = host.kv.get('alerts') ?? [];
  const open = invs.filter(i => LIVE.has(i.status)).length;
  const review = invs.filter(i => i.status === 'review').length;
  const settled = invs.filter(i => i.status === 'settled').length;
  const tipsTotal = invs.filter(i => i.kind === 'tip' && i.status === 'settled').reduce((sum, i) => sum + totals(i).received, 0n);

  let banners = '';
  for (const a of alerts) banners += `<div class="banner bad"><span><b>${a.kind === 'reversed' ? 'Payment reversed.' : 'Payment not mined again.'}</b> ${esc(a.text)}</span><button type="button" class="btn sm" data-act="admin" data-a="dismissAlert" data-id="${esc(a.id)}">Dismiss</button></div>`;
  if (!s.bridgePublicKey) banners += '<div class="banner warn"><span><b>Not configured.</b> Paste the bridge public key in Settings to start taking payments.</span></div>';
  else if (silentFor > SILENT_MS) banners += `<div class="banner bad"><span><b>Bridge silent for <span data-live="since" data-t="${b?.lastSyncAt ?? 0}">${Math.floor(silentFor / 60000)}</span> min.</b> Checkout keeps working until the ${free} free address${free === 1 ? '' : 'es'} run out. Payments are picked up when it returns.</span></div>`;
  else banners += `<div class="banner ok"><span><b>Bridge connected.</b> Last sync <span data-live="ago" data-t="${b.lastSyncAt}">${ago(b.lastSyncAt)}</span> · wallet height ${b.height.toLocaleString('en-US')}</span></div>`;

  const meterCls = free === 0 ? 'empty' : free < POOL_TARGET / 2 ? 'low' : '';
  const rows = invs.slice(0, 14).map(i => {
    const t = totals(i);
    const cur = i.fiat?.currency ?? s.currency;
    const amt = i.fiat ? fiat(i.fiat.amountMinor, cur) : 'open';
    const xmr6 = v => atomicToXmr(v).slice(0, -6);   // 6 decimals in the table; the pay page shows all 12
    const exp = i.expectedAtomic ? xmr6(i.expectedAtomic) : 'any';
    const item = i.kind === 'tip' ? `Tip${i.contentRef ? ' · ' + esc(POST.title.slice(0, 26)) + '…' : ''}` : esc(i.label);
    const note = i.buyer?.note ? `<span class="sub">“${esc(i.buyer.note)}”</span>` : '';
    const reason = i.status === 'review' ? i.reviewReason : '';
    const subs = [];
    if (i.resolution) subs.push(i.resolution);
    if (i.pendingExpiry) subs.push('window closed, waiting for the bridge');
    if (i.reconfirmingSince != null) subs.push('re-confirming after a reorg');
    if (i.reopened) subs.push('paid in time, reported after expiry');
    if (t.ignored) subs.push(`${t.ignored} tx not counted (time-locked or double-spend)`);
    if (i.overpaidAtomic) subs.push(`+${xmr(i.overpaidAtomic)} over`);
    const extra = subs.map(x => `<span class="sub">${esc(x)}</span>`).join('');
    const acts = [];
    if (LIVE.has(i.status) && i.required < PRESETS.strict[2] && !i.adminFinal) acts.push(`<button type="button" class="btn sm" data-act="admin" data-a="raiseRequired" data-id="${i.id}">Raise to 10</button>`);
    if (i.status === 'review') acts.push(`<button type="button" class="btn sm" data-act="admin" data-a="markSettled" data-id="${i.id}">Mark settled</button>`);
    if (i.status === 'review' || (LIVE.has(i.status) && !i.adminFinal)) acts.push(`<button type="button" class="btn sm" data-act="admin" data-a="expire" data-id="${i.id}">Expire</button>`);
    if (i.transfers.length) acts.push(`<button type="button" class="btn sm" data-act="copy" data-v="${esc(i.transfers.map(x => x.txid).join('\n'))}">Copy txid</button>`);
    return `<tr class="${freshIds.has(i.id) ? 'fresh' : ''}">
      <td class="mono">${esc(i.id)}<span class="sub">#${i.addrIndex} · ${i.kind} · ${hm(i.createdAt)}</span></td>
      <td>${item}${note}</td>
      <td class="mono num">${esc(amt)}<span class="sub">${exp} XMR</span><span class="sub">got ${xmr6(t.received)}</span></td>
      <td>${pill(i.status, reason)}<span class="sub mono num">${Math.max(0, t.depth)} of ${i.required} conf</span>${extra}</td>
      <td class="actions">${acts.join('') || '<span class="small muted">—</span>'}</td></tr>`;
  }).join('');

  const tipsBy = {};
  for (const i of invs) if (i.kind === 'tip' && i.status === 'settled') { const k = i.contentRef?.id ?? 'site'; (tipsBy[k] ??= { n: 0, sum: 0n }); tipsBy[k].n++; tipsBy[k].sum += totals(i).received; }
  const tipRows = Object.entries(tipsBy).map(([k, v]) => `<li><span>${k === POST.id ? esc(POST.title) : 'Whole site'}</span> <span class="mono small">${v.n} tip${v.n > 1 ? 's' : ''} · ${xmr(v.sum)} XMR</span></li>`).join('');

  setHTML($('#s-admin'), `
    ${banners}
    <div class="tiles">
      <div class="tile"><div class="v">${open}</div><div class="k">Open invoices</div></div>
      <div class="tile ${review ? 'alert' : ''}"><div class="v">${review}</div><div class="k">Needs review</div></div>
      <div class="tile"><div class="v">${settled}</div><div class="k">Settled</div></div>
      <div class="tile"><div class="v" title="${atomicToXmr(tipsTotal)} XMR">${atomicToXmr(tipsTotal).slice(0, -8)}</div><div class="k">Tips, XMR</div></div>
    </div>
    <div class="stack" style="gap:6px">
      <div class="row between small"><span><b>Free addresses</b> ${free} of ${POOL_TARGET} target</span><span class="muted">${pool.length} created · never reused</span></div>
      <div class="meter ${meterCls}" role="meter" aria-label="Free pool addresses" aria-valuemin="0" aria-valuemax="${POOL_TARGET}" aria-valuenow="${free}"><i style="width:${Math.min(100, (free / POOL_TARGET) * 100)}%"></i></div>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Invoice</th><th>For</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">No invoices yet.</td></tr>'}</tbody>
    </table></div>
    ${tipRows ? `<div class="stack" style="gap:4px"><h4>Tips by entry</h4><ul class="small" style="margin:0;padding-left:18px">${tipRows}</ul></div>` : ''}
    <p class="small muted">Rendered from the plugin's own storage, the way a Block Kit admin page would be. Showing the ${Math.min(14, invs.length)} newest of ${invs.length}.</p>`);
}

function renderStorage() {
  const kv = Object.fromEntries([...host.kv.entries()].map(([k, v]) => [k, v]));
  const pool = [...host.cols.pool.values()].sort((a, b) => a.addrIndex - b.addrIndex);
  const invs = [...host.cols.invoices.values()].sort((a, b) => b.createdAt - a.createdAt);
  const shortAddr = a => a.slice(0, 10) + '…' + a.slice(-6);
  const poolRows = pool.slice(-12).reverse().map(p => `<tr><td class="mono">${p.addrIndex}</td><td class="mono">${esc(shortAddr(p.address))}</td><td>${esc(p.status)}</td><td class="mono">${esc(p.invoiceId ?? '')}</td></tr>`).join('');
  const invJson = invs.slice(0, 3).map(i => JSON.stringify(i, (k, v) => (k === 'subaddress' ? shortAddr(v) : v), 2)).join('\n\n');
  const flashOn = sim.now - leakFlash < 60_000 && leakFlash;
  setHTML($('#s-storage'), `
    <div class="leakhead ${flashOn ? 'flash' : ''}">
      <b>Everything a database leak would expose</b>
      <span>Wallet keys stored: <b>none</b> · View key: <b>none</b> · Bridge key: <b>public half only</b> · IP addresses: <b>none</b>, only hashed rate-limit buckets</span>
    </div>
    <h4>kv</h4>
    <pre>${esc(JSON.stringify(kv, null, 2))}</pre>
    <h4>storage.pool <span class="muted">(newest 12 of ${pool.length})</span></h4>
    <div class="tbl-wrap"><table><thead><tr><th>addrIndex</th><th>address</th><th>status</th><th>invoiceId</th></tr></thead><tbody>${poolRows}</tbody></table></div>
    <h4>storage.invoices <span class="muted">(newest 3 of ${invs.length})</span></h4>
    <pre>${esc(invJson || '[]')}</pre>`);
}

function renderManifest() {
  if ($('#s-manifest')._html) return;
  const routes = Object.entries(xmrPay.routes).map(([k, d]) => `<tr><td class="mono">${k}</td><td class="mono">${d.method}</td><td>${d.public ? 'public' : 'private · plugins:manage'}</td><td class="mono small">${d.request ? `raw text · ${d.request.headers.join(', ')} · ${d.request.maxBytes / 1024} KiB max` : d.method === 'GET' ? 'query string' : 'JSON'}</td></tr>`).join('');
  setHTML($('#s-manifest'), `
    <div class="consent">
      <h3>Install Monero Payments?</h3>
      <p class="small muted">What the operator sees in the registry consent dialog. Changing any of it needs a new version and a new prompt.</p>
      <ul>
        <li>Expose 3 public routes to the internet: <code>checkout</code>, <code>status</code>, <code>bridge/sync</code></li>
        <li>Make network requests to <code>api.coingecko.com</code> and <code>api.kraken.com</code></li>
        <li>Read your content (<code>content:read</code>)</li>
      </ul>
    </div>
    <h4>Routes</h4>
    <div class="tbl-wrap"><table><thead><tr><th>Route</th><th>Method</th><th>Access</th><th>Body</th></tr></thead><tbody>${routes}</tbody></table></div>
    <h4>emdash-plugin.json</h4>
    <pre>${esc(JSON.stringify(MANIFEST, null, 2))}</pre>`);
}

function renderSite() {
  $$('#zone-site [data-act="stab"]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === siteTab)));
  for (const t of ['admin', 'settings', 'storage', 'manifest']) $(`#s-${t}`).hidden = t !== siteTab;
  if (siteTab === 'admin') renderAdmin();
  if (siteTab === 'storage') renderStorage();
  if (siteTab === 'manifest') renderManifest();
}

function renderHost() {
  const s = settings();
  const matches = s.bridgePublicKey === bridge.pub;
  setHTML($('#h-bridge'), `
    <header><h3>xmr-bridge</h3>${pill(bridge.running ? 'running' : 'stopped')}</header>
    <dl class="kv">
      <dt>Posts to</dt><dd>example.com${SYNC_PATH.replace('/plugins/', '/plugins/<wbr>')}</dd>
      <dt>Last sync</dt><dd>${bridge.lastErr ? `<span style="color:var(--bad)">${esc(bridge.lastErr)}</span>` : bridge.lastOkAt ? `ok, <span data-live="ago" data-t="${bridge.lastOkAt}">${ago(bridge.lastOkAt)}</span>` : 'never'}</dd>
      <dt>Watching</dt><dd>${bridge.watch ? (bridge.watch.length ? bridge.watch.map(i => '#' + i).join(' ') : 'nothing') : 'unknown until first sync'}</dd>
    </dl>
    <div class="stack" style="gap:6px">
      <h4>Public key${matches ? '' : ' · <span style="color:var(--bad)">not the one in plugin settings</span>'}</h4>
      <div class="keybox">${esc(bridge.pub)}</div>
      <div class="row">
        <button type="button" class="btn sm" data-act="copy" data-v="${esc(bridge.pub)}">Copy</button>
        <button type="button" class="btn sm ${matches ? '' : 'primary'}" data-act="pastekey" ${matches ? 'disabled' : ''}>Paste into plugin settings</button>
      </div>
    </div>
    <div class="row">
      <button type="button" class="btn sm ${bridge.running ? 'danger' : 'primary'}" data-act="bridge" data-v="${bridge.running ? 'stop' : 'start'}">${bridge.running ? 'Stop bridge' : 'Start bridge'}</button>
      <button type="button" class="btn sm" data-act="bridge" data-v="rotate">Rotate signing key</button>
    </div>`);

  const txs = [...chain.txs.values()].filter(t => wallet.byAddr.has(t.to)).sort((a, b) => b.at - a.at).slice(0, 6);
  setHTML($('#h-wallet'), `
    <header><h3>monero-wallet-rpc</h3><span class="where">127.0.0.1:18083 · --rpc-login</span></header>
    <dl class="kv">
      <dt>Wallet</dt><dd>view-only, no spend key on this host</dd>
      <dt>Subaddresses</dt><dd>${wallet.sub.size} (account 0, label xmr-pay)</dd>
    </dl>
    <h4>Incoming transfers</h4>
    ${txs.length ? `<ul class="txlist">${txs.map(t => `<li><span>${t.txid.slice(0, 16)}… → #${wallet.byAddr.get(t.to)}</span><span>${xmr(t.amount)}</span><span>${t.doubleSpendSeen ? 'double-spend' : t.unlockTime ? 'time-locked' : confs(t) + ' conf'}</span></li>`).join('')}</ul>` : '<p class="small muted">None yet.</p>'}`);

  setHTML($('#h-chain'), `
    <header><h3>monerod</h3><span class="where">simulated stagenet</span></header>
    <dl class="kv">
      <dt>Height</dt><dd>${chain.height.toLocaleString('en-US')}</dd>
      <dt>Next block</dt><dd><span data-live="nextblock">${mmss(chain.nextBlockAt - sim.now)}</span></dd>
      <dt>Mempool</dt><dd>${chain.mempool.length} tx</dd>
    </dl>
    <div class="row">
      <button type="button" class="btn sm" data-act="chain" data-v="mine">Mine a block now</button>
      <button type="button" class="btn sm" data-act="chain" data-v="reorg">Reorg 2 blocks</button>
      <button type="button" class="btn sm" data-act="chain" data-v="drop" ${chain.mempool.length ? '' : 'disabled'}>Drop mempool txs</button>
    </div>`);
}

const openLog = new Set();
function renderLog() {
  const el = $('#log');
  if (el._v === logVersion) return;
  el._v = logVersion;
  const pretty = v => { if (v == null) return '—'; if (typeof v === 'string') { try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; } } return JSON.stringify(v, null, 2); };
  el.innerHTML = LOG.map(e => {
    const outCls = e.outcome === 'ok' ? 'out-ok' : e.outcome === 'err' ? 'out-err' : e.outcome === 'block' ? 'out-block' : 'out-info';
    const hasBody = e.req != null || e.res != null;
    const reqHead = e.headers ? Object.entries(e.headers).map(([k, v]) => `${k}: ${k === 'x-xmr-sig' ? v.slice(0, 24) + '…' : v}`).join('\n') + '\n\n' : '';
    const path = e.path ? `${e.title.split(' ')[0]} ${e.path}\n` : '';
    return `<li class="lane-${e.lane} ${e.outcome === 'err' || e.outcome === 'block' ? 'is-err' : ''}"><details data-id="${e.id}" ${openLog.has(e.id) ? 'open' : ''}>
      <summary><time>${hms(e.at)}</time><span class="lane">${esc(LANES[e.lane] ?? e.lane)}</span><span class="t">${esc(e.title)}</span><span><span class="out ${outCls}">${esc(e.code ?? e.outcome)}</span>${e.count > 1 ? `<span class="cnt">×${e.count}</span>` : ''}</span><span class="sum">${esc(e.summary ?? '')}</span></summary>
      ${hasBody ? `<div class="ev-body"><div class="stack" style="gap:4px"><h4>Request</h4><pre>${esc(path + reqHead + pretty(e.req))}</pre></div><div class="stack" style="gap:4px"><h4>Response</h4><pre>${esc(pretty(e.res))}</pre></div>${e.lane === 'bridge' || (e.lane === 'attack' && e.headers) ? '<p class="notes muted">The signature covers <code>x-xmr-ts + "\\n" + rawBody</code>, the exact bytes shown above before pretty-printing.</p>' : ''}</div>` : '<div class="ev-body"><p class="notes muted">No payload.</p></div>'}
    </details></li>`;
  }).join('');
}

function updateLive() {
  $$('[data-live="countdown"]').forEach(el => { const t = Number(el.dataset.t) - sim.now; el.textContent = t > 0 ? mmss(t) : 'expired'; });
  $$('[data-live="ago"]').forEach(el => { el.textContent = ago(Number(el.dataset.t)); });
  $$('[data-live="since"]').forEach(el => { el.textContent = String(Math.floor((sim.now - Number(el.dataset.t)) / 60000)); });
  $$('[data-live="nextblock"]').forEach(el => { el.textContent = mmss(chain.nextBlockAt - sim.now); });
}

function render() {
  if (sim.booting) return;
  renderTop(); renderVisitor(); renderSite(); renderHost(); renderLog(); updateLive();
}

function syncSettingsForm() {
  const s = settings();
  $('#set-key').value = s.bridgePublicKey; $('#set-cur').value = s.currency; $('#set-speed').value = s.speed;
}

/* ======================================================================
   Static markup and events
   ====================================================================== */
function buildStatic() {
  $('#productList').innerHTML = PRODUCTS.map(p => `
    <li class="product">
      <div><h3>${esc(p.title)}</h3><p>${esc(p.blurb)}</p></div>
      <div class="price" data-live="price" data-p="${p.price}"></div>
      <div class="meta"><span class="tier" data-live="tier" data-p="${p.price}"></span><button type="button" class="btn primary sm" data-act="buy" data-v="${p.slug}">Pay with Monero</button></div>
    </li>`).join('');
  $('#scenarioButtons').innerHTML = SCENARIOS.map(s => `<button type="button" class="btn sm" data-act="scenario" data-v="${s.key}">${esc(s.label)}</button>`).join('');
  $('#attackButtons').innerHTML = ATTACKS.map(a => `<button type="button" class="btn sm danger" data-act="attack" data-v="${a.key}">${esc(a.label)}</button>`).join('');
}

function checkoutExtras() {
  const out = {};
  const email = $('#buyerEmail').value.trim(); const refund = $('#buyerRefund').value.trim();
  if (email) out.email = email; if (refund) out.refundAddress = refund;
  return out;
}
async function startTip(v) {
  const payload = { kind: 'tip', contentRef: { collection: 'posts', id: POST.id }, ...checkoutExtras() };
  if (v) payload.amount = { fiat: Number(v) };
  const note = $('#tipNote').value.trim(); if (note) payload.note = note;
  return themeCheckout(payload, `Tip on "${POST.title}"`);
}

async function copyText(text, btn) {
  const old = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
  catch { btn.textContent = 'Select and copy'; const a = $('#payAddr'); if (a) { const r = document.createRange(); r.selectNodeContents(a); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
  setTimeout(() => { btn.textContent = old; }, 1400);
}

const ACTIONS = {
  speed: v => { sim.speed = Number(v); },
  vtab: v => { theme.tab = v; },
  stab: v => { siteTab = v; if (v === 'settings') syncSettingsForm(); },
  logf: v => { $('#log').dataset.f = v; $$('#logFilter button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); },
  buy: v => serial(() => themeCheckout({ kind: 'product', product: v, ...checkoutExtras() }, PRODUCTS.find(p => p.slug === v)?.title ?? v)),
  tip: v => serial(() => startTip(v)),
  send: v => serial(async () => { buyerSend(v); await processDue(); }),
  api: (v, el) => { market.up[el.dataset.host] = !market.up[el.dataset.host]; logEvent({ lane: 'price', title: el.dataset.host, outcome: market.up[el.dataset.host] ? 'ok' : 'err', code: market.up[el.dataset.host] ? 'UP' : 'DOWN', summary: market.up[el.dataset.host] ? 'Back up.' : 'Taken down. The plugin falls back to the other host, and returns RATE_UNAVAILABLE if both fail.' }); },
  chain: v => serial(async () => { if (v === 'mine') { mineBlock(sim.now); logEvent({ lane: 'chain', title: `block ${chain.height}`, outcome: 'info', code: 'mined', summary: 'Mined on demand.' }); } else if (v === 'reorg') reorg(2); else if (v === 'drop') dropMempool(); await processDue(); }),
  bridge: v => serial(async () => { if (v === 'stop') bridgeStop(); else if (v === 'start') bridgeStart(); else { await bridgeKeygen(true); bridge.poke = 'interval'; } await processDue(); }),
  pastekey: () => serial(async () => { $('#set-key').value = bridge.pub; await saveSettings('Operator pasted the new bridge public key'); bridge.poke = 'interval'; await processDue(); }),
  admin: (v, el) => serial(async () => { freshIds.clear(); freshIds.add(el.dataset.id); await call('admin', 'POST', 'admin', { json: { action: el.dataset.a, id: el.dataset.id }, meta: { perms: ['plugins:manage'] } }); }),
  copy: (v, el) => copyText(v, el),
  scenario: v => runScenario(v),
  attack: v => runAttack(v),
  ff: v => { if (sim.scenario) return; sim.scenario = 'ff'; render(); serial(() => advance(Number(v))).then(() => { sim.scenario = false; render(); }); },
  reset: () => { if (sim.scenario) return; serial(async () => { say('Reset. Pick a scenario, or use the store on the left yourself.'); say('Forged and replayed syncs, a client-side price, spam, and a plugin that tries to reach the wallet.', '#attackNarrator'); await boot(); }); },
};

async function saveSettings(note) {
  const r = await call('admin', 'POST', 'admin', { json: { action: 'saveSettings', bridgePublicKey: $('#set-key').value, currency: $('#set-cur').value, speed: $('#set-speed').value }, meta: { perms: ['plugins:manage'] }, note });
  const m = $('#setMsg');
  if (r.error) { m.style.color = 'var(--bad)'; m.textContent = r.error.message ?? r.error.code; }
  else { m.style.color = 'var(--ok)'; m.textContent = 'Saved'; setTimeout(() => { m.textContent = ''; }, 1600); }
  return r;
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act]; if (!fn) return;
  const r = fn(el.dataset.v, el);
  render();
  if (r && typeof r.then === 'function') r.then(() => render());
});
$('#log').addEventListener('toggle', e => { const id = Number(e.target.dataset?.id); if (!id) return; if (e.target.open) openLog.add(id); else openLog.delete(id); }, true);
$('#settingsForm').addEventListener('submit', e => { e.preventDefault(); serial(async () => { await saveSettings(''); bridge.poke = bridge.running ? 'interval' : null; }).then(render); });

/* ======================================================================
   Real-time loop
   ====================================================================== */
const TICK_MS = 200;
let ticking = false;
setInterval(() => {
  if (sim.booting || sim.scenario || ticking || sim.speed === 0) { if (!sim.booting) updateLive(); return; }
  ticking = true;
  serial(() => advance(TICK_MS * sim.speed)).then(() => { ticking = false; render(); });
}, TICK_MS);

buildStatic();
serial(boot);

window.__poc = { sim, host, chain, bridge, theme, LOG, runScenario, runAttack, advance: ms => serial(() => advance(ms)), get siteTab() { return siteTab; } };
})();
