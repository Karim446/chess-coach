"use strict";
/* Chess Coach 2 — core: utilities, storage (IndexedDB), engine pool */
const { Chess } = window.ChessJS;
const APP_VERSION = "2.0.0";
const ANALYSIS_VERSION = 4;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sum = a => a.reduce((x, y) => x + y, 0);
const r1 = x => Math.round(x * 10) / 10;
const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const INACC = 5, MISTAKE = 10, BLUNDER = 15;
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PNAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const STRENGTH = { quick: 120, standard: 250, deep: 600 };
const DAY = 86400000;
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function hashStr(str) { // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const fen4 = fen => fen.split(" ").slice(0, 4).join(" ");

function toast(msg, ms = 4200) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------------------------------------------------------------- storage */
const DB = {
  db: null, mem: { games: new Map(), kv: new Map() }, ok: false,
  open() {
    return new Promise(res => {
      let req;
      try { req = indexedDB.open("chess-coach", 1); } catch (e) { return res(false); }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("games")) d.createObjectStore("games", { keyPath: "id" });
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      };
      req.onsuccess = () => { this.db = req.result; this.ok = true; res(true); };
      req.onerror = () => res(false);
      req.onblocked = () => res(false);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode), s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => res(r && "result" in r ? r.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  async all(store) { if (!this.ok) return [...this.mem[store].values()]; return (await this.tx(store, "readonly", s => s.getAll())) || []; },
  async get(key) { if (!this.ok) return this.mem.kv.get(key); return await this.tx("kv", "readonly", s => s.get(key)); },
  async set(key, val) {
    if (!this.ok) { this.mem.kv.set(key, val); return; }
    try { await this.tx("kv", "readwrite", s => s.put(val, key)); } catch (e) { console.warn("save failed", e); }
  },
  async putGame(g) {
    if (!this.ok) { this.mem.games.set(g.id, g); return; }
    try { await this.tx("games", "readwrite", s => s.put(g)); } catch (e) { console.warn("save failed", e); toast("Couldn't save that game. Your browser storage may be full."); }
  },
  async clearAll() {
    this.mem.games.clear(); this.mem.kv.clear();
    if (!this.ok) return;
    await this.tx("games", "readwrite", s => s.clear()); await this.tx("kv", "readwrite", s => s.clear());
  }
};

/* ---------------------------------------------------------------- engine pool */
const ENGINES = [
  { url: "engine/stockfish-18-lite-single.js", name: "Stockfish 18" },
  { url: "engine/stockfish-10.js", name: "Stockfish 10" }
];
const Engine = {
  all: [], idle: [], waiters: [], name: "", starting: null, cache: new Map(),
  wanted() {
    const s = App.settings.threads;
    if (s && s !== "auto") return clamp(+s || 1, 1, 8);
    const cores = navigator.hardwareConcurrency || 2;
    const small = Math.min(screen.width, screen.height) < 600;
    return clamp(cores - 1, 1, small ? 3 : 6);
  },
  spawn(url) {
    return new Promise(res => {
      let w, done = false;
      const fail = () => { if (done) return; done = true; try { w && w.terminate(); } catch (e) { } res(null); };
      try { w = new Worker(url); } catch (e) { return res(null); }
      const t = setTimeout(fail, 20000);
      w.onerror = () => { clearTimeout(t); fail(); };
      w.onmessage = e => {
        if (!done && String(e.data).includes("uciok")) {
          done = true; clearTimeout(t);
          const eng = { w, h: () => { }, post: s => w.postMessage(s) };
          w.onmessage = ev => { for (const l of String(ev.data).split("\n")) eng.h(l); };
          res(eng);
        }
      };
      w.postMessage("uci");
    });
  },
  /** Make sure at least n engines exist (1 for interactive use, more for batch analysis). */
  ensure(n = 1) {
    n = Math.max(1, n);
    if (this.all.length >= n) return Promise.resolve(true);
    const run = async () => {
      if (!this.all.length) {
        for (const k of ENGINES) {
          const e = await this.spawn(k.url);
          if (e) { this.kind = k; this.name = k.name; this.all.push(e); this.release(e); break; }
        }
        if (!this.all.length) throw new Error("engine_failed");
      }
      const more = await Promise.all(Array.from({ length: Math.max(0, n - this.all.length) }, () => this.spawn(this.kind.url)));
      for (const e of more) if (e) { this.all.push(e); this.release(e); }
      return true;
    };
    this.starting = (this.starting || Promise.resolve()).then(run, run);
    return this.starting;
  },
  acquire(priority) {
    if (this.idle.length) return Promise.resolve(this.idle.pop());
    return new Promise(res => { priority ? this.waiters.unshift(res) : this.waiters.push(res); });
  },
  release(e) { const w = this.waiters.shift(); if (w) w(e); else this.idle.push(e); },
  /** Returns { cp (White's point of view; mates as +-100000∓n), pv: [uci...], depth }. */
  async analyse(fen, ms, opts = {}) {
    const c = new Chess(fen);
    if (c.isCheckmate()) return { cp: c.turn() === "w" ? -100000 : 100000, pv: [], depth: 0 };
    if (c.isStalemate() || c.isInsufficientMaterial()) return { cp: 0, pv: [], depth: 0 };
    const key = opts.cache ? fen4(fen) + "|" + ms : null;
    if (key && this.cache.has(key)) return this.cache.get(key);
    await this.ensure(1);
    const e = await this.acquire(opts.priority);
    try {
      const white = c.turn() === "w";
      const out = await new Promise(res => {
        let best = null;
        e.h = l => {
          if (l.startsWith("info") && l.includes(" pv ") && l.includes(" score ") && !l.includes("bound")) best = l;
          else if (l.startsWith("bestmove")) {
            let cp = 0, pv = [], depth = 0;
            if (best) {
              const m = best.match(/score (cp|mate) (-?\d+)/);
              if (m) cp = m[1] === "cp" ? +m[2] : (+m[2] > 0 ? 100000 - +m[2] : -100000 - +m[2]);
              pv = best.split(" pv ")[1].trim().split(/\s+/);
              depth = +(best.match(/depth (\d+)/) || [0, 0])[1];
            } else { const bm = l.split(/\s+/)[1]; if (bm && bm !== "(none)") pv = [bm]; }
            res({ cp: white ? cp : -cp, pv, depth });
          }
        };
        e.post("position fen " + fen);
        e.post("go depth 24 movetime " + ms);
      });
      if (key) { if (this.cache.size > 6000) this.cache.clear(); this.cache.set(key, out); }
      return out;
    } finally { e.h = () => { }; this.release(e); }
  }
};
