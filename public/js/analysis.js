"use strict";
/* Chess Coach 2 — per-game analysis, spaced repetition, trends, mindset, opening explorer */

function gameTs(h) {
  const d = (h.UTCDate || h.Date || "").split(".").map(Number), t = (h.UTCTime || "00:00:00").split(":").map(Number);
  if (d.length === 3 && d[0] > 1990) return Date.UTC(d[0], d[1] - 1, d[2], t[0] || 0, t[1] || 0, t[2] || 0);
  return 0;
}

async function analyzeGame(job, username, ms, onStep, shouldStop) {
  const pgn = job.pgn, h = headersOf(pgn);
  const meWhite = (h.White || "").toLowerCase() === username.toLowerCase();
  const me = meWhite ? "w" : "b";
  const c = new Chess();
  try { c.loadPgn(pgn); } catch (e) { return null; }
  const hist = c.history({ verbose: true });
  if (hist.length < 10) return null;
  const fens = [hist[0].before, ...hist.map(m => m.after)];
  const clocks = [...pgn.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)].map(m => +m[1] * 3600 + +m[2] * 60 + +m[3]);
  const haveClock = clocks.length === hist.length;
  const tc = tcInfo(h.TimeControl) || { base: 600, inc: 0 };

  const evals = new Array(fens.length);
  let next = 0, done = 0;
  const lanes = Math.max(1, Engine.all.length);
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (next < fens.length && !shouldStop()) {
      const i = next++;
      evals[i] = await Engine.analyse(fens[i], ms, { cache: i < 16 });
      onStep(++done, fens.length);
    }
  }));
  if (done < fens.length) return "stopped";
  const wp = (i, color) => winPct(color === "w" ? evals[i].cp : -evals[i].cp);

  const moves = [], errors = [];
  let myClock = tc.base, prevOppLoss = 0;
  for (let i = 0; i < hist.length; i++) {
    const m = hist[i], mover = m.color;
    let loss = Math.max(0, wp(i, mover) - wp(i + 1, mover));
    const bestPv = evals[i].pv, best = bestPv[0];
    if (best && best === uciOf(m)) loss = 0;
    if (mover !== me) { prevOppLoss = loss; continue; }
    const clockBefore = myClock;
    let spent = null;
    if (haveClock) { spent = Math.max(0, myClock - clocks[i] + tc.inc); myClock = clocks[i]; }
    const cb = new Chess(m.before);
    const fullmove = cb.moveNumber();
    const cls = loss >= BLUNDER ? "blunder" : loss >= MISTAKE ? "mistake" : loss >= INACC ? "inaccuracy" : "";
    const phase = phaseOf(cb, fullmove);
    moves.push({ l: r1(loss), ph: phase[0], c: Math.round(clockBefore), s: spent == null ? null : r1(spent) });
    if (loss >= MISTAKE) {
      const info = classify(m, bestPv, evals[i + 1].pv, evals[i].cp, evals[i + 1].cp, me);
      const tags = [];
      if (prevOppLoss >= MISTAKE) tags.push("missed_punish");
      if (m.captured && ["hung_moved", "allowed_tactic", "allowed_fork", "ignored_threat"].includes(info.cat)) tags.push("greedy");
      const bestSan = (() => { const t = new Chess(m.before); const r = best ? tryMove(t, best) : null; return r ? r.san : ""; })();
      errors.push({
        ply: i, n: fullmove, san: m.san, uci: uciOf(m), best_san: bestSan, best_uci: best || "",
        line: sanLine(m.before, bestPv, 6), punish: sanLine(m.after, evals[i + 1].pv, 4),
        fen: m.before, wb: r1(wp(i, me)), wa: r1(wp(i + 1, me)),
        loss: r1(loss), cls: cls || "mistake", cat: info.cat, theme: info.theme || "", why: info.why,
        tags, phase, clock: Math.round(clockBefore), spent: spent == null ? null : r1(spent), piece: m.piece
      });
    }
  }

  const myWps = fens.map((_, i) => wp(i, me));
  const exitPly = Math.min(20, fens.length - 1);
  const { result, method } = resultFor(h, meWhite);
  return {
    v: ANALYSIS_VERSION, ms, engine: Engine.name, id: gameIdOf(h), url: job.url || h.Link || "",
    date: h.UTCDate || h.Date || "", end: (h.UTCDate || h.Date || "") + " " + (h.UTCTime || h.EndTime || ""), ts: job.ts || gameTs(h),
    color: meWhite ? "white" : "black", opponent: meWhite ? h.Black : h.White,
    myElo: +(meWhite ? h.WhiteElo : h.BlackElo) || 0, oppElo: +(meWhite ? h.BlackElo : h.WhiteElo) || 0,
    result, method, base: tc.base, inc: tc.inc, opening: openingName(h),
    exitWp: r1(myWps[exitPly]), maxWp: r1(Math.max(...myWps.slice(0, -1))),
    acc: r1(moves.reduce((a, x) => a + accOf(x.l), 0) / Math.max(1, moves.length)),
    finalClock: Math.round(myClock), plies: hist.length,
    oh: openingHabits(hist, me), moves, errors,
    sans: hist.map(m => m.san), clk: haveClock ? clocks.map(Math.round) : null,
    ev: evals.map(e => clamp(Math.round(e.cp), -100100, 100100)), bm: evals.map(e => e.pv[0] || ""),
    pk: fens.slice(0, 31).map(f => hashStr(fen4(f)))
  };
}

/* ---------------------------------------------------------------- replay & review */
function replay(g) {
  if (g._h) return g._h;
  const c = new Chess(), out = [];
  for (const s of g.sans) { try { out.push(c.move(s)); } catch (e) { break; } }
  Object.defineProperty(g, "_h", { value: out, enumerable: false, configurable: true });
  return out;
}
const GLYPH = { blunder: "??", mistake: "?", inaccuracy: "?!", best: "", good: "" };
function reviewData(g) {
  if (g._r) return g._r;
  const h = replay(g), me = g.color === "white" ? "w" : "b";
  const plies = h.map((m, i) => {
    const wpm = k => winPct(m.color === "w" ? g.ev[k] : -g.ev[k]);
    let loss = Math.max(0, wpm(i) - wpm(i + 1));
    const isBest = g.bm[i] && g.bm[i] === uciOf(m);
    if (isBest) loss = 0;
    const cls = loss >= BLUNDER ? "blunder" : loss >= MISTAKE ? "mistake" : loss >= INACC ? "inaccuracy" : isBest ? "best" : "good";
    return { m, loss: r1(loss), cls, mine: m.color === me, isBest };
  });
  const out = { h, plies, wpWhite: g.ev.map(cp => winPct(cp)) };
  Object.defineProperty(g, "_r", { value: out, enumerable: false, configurable: true });
  return out;
}
const fmtEval = cp => Math.abs(cp) >= 90000 ? (cp > 0 ? "#" : "-#") + (100000 - Math.abs(cp)) : (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);
const barLabel = cp => Math.abs(cp) >= 90000 ? "M" + (100000 - Math.abs(cp)) : Math.abs(cp) >= 995 ? String(Math.round(Math.abs(cp) / 100)) : (Math.abs(cp) / 100).toFixed(1);
const fmtClock = s => s == null ? "" : `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/* ---------------------------------------------------------------- spaced repetition */
const SRS_DAYS = [0, 1, 3, 7, 16, 35, 90];
const errKey = e => e.gid + "_" + e.ply;
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
function srsAnswer(key, correct) {
  const r = App.srs[key] || { box: 0, tries: 0, right: 0 };
  r.tries++;
  if (correct) { r.right++; r.box = Math.min(r.box + 1, 6); } else r.box = 1;
  r.due = startOfDay() + SRS_DAYS[r.box] * DAY; r.last = Date.now();
  App.srs[key] = r; DB.set("srs", App.srs);
  logActivity("d", 1); if (correct) logActivity("c", 1);
}
function srsCounts(S) {
  const now = Date.now(); let due = 0, fresh = 0, learning = 0, mastered = 0;
  for (const e of S.errors) {
    const r = App.srs[errKey(e)];
    if (!r) fresh++; else { if (r.due <= now) due++; if (r.box >= 5) mastered++; else learning++; }
  }
  return { due, fresh, learning, mastered, total: S.errors.length };
}
function buildSession(S, tips, { maxDue = 8, maxNew = 5 } = {}) {
  const now = Date.now(), topCats = tips.filter(t => CAT[t.key]).slice(0, 2).map(t => t.key);
  const recentIds = new Set(S.games.slice(-15).map(g => g.id));
  const due = S.errors.filter(e => { const r = App.srs[errKey(e)]; return r && r.due <= now; }).sort((a, b) => App.srs[errKey(a)].due - App.srs[errKey(b)].due);
  const fresh = S.errors.filter(e => !App.srs[errKey(e)])
    .map(e => ({ e, w: e.loss * (topCats.includes(e.cat) ? 1.5 : 1) * (recentIds.has(e.gid) ? 1.3 : 1) * (e.clock != null && e.clock < 20 ? 0.3 : 1) }))
    .sort((a, b) => b.w - a.w).map(x => x.e);
  const d = due.slice(0, maxDue);
  return [...d, ...fresh.slice(0, Math.max(maxNew, 10 - d.length))].slice(0, 13);
}
function logActivity(field, n) {
  const k = dayKey(); const a = App.activity[k] || (App.activity[k] = {});
  a[field] = (a[field] || 0) + n; DB.set("activity", App.activity);
}
function streak() {
  let n = 0, t = Date.now();
  if (!App.activity[dayKey(t)]) t -= DAY;
  while (App.activity[dayKey(t)]) { n++; t -= DAY; }
  return n;
}

/* ---------------------------------------------------------------- trends */
const gBlunders = g => g.moves.filter(m => m.l >= BLUNDER).length;
const gMistakes = g => g.moves.filter(m => m.l >= MISTAKE && m.l < BLUNDER).length;
const gScore = g => ({ win: 1, draw: .5, loss: 0 }[g.result]);
function groupStats(gs) {
  const n = gs.length; if (!n) return { n: 0 };
  const cat = {};
  for (const g of gs) for (const e of g.errors) cat[e.cat] = (cat[e.cat] || 0) + e.loss / n;
  return {
    n, acc: r1(avg(gs.map(g => g.acc))), bpg: +(avg(gs.map(gBlunders))).toFixed(2), mpg: +(avg(gs.map(gMistakes))).toFixed(2),
    score: Math.round(100 * avg(gs.map(gScore))), lpg: r1(avg(gs.map(g => sum(g.moves.map(m => m.l))))), cat,
    from: gs[0].ts, to: gs[n - 1].ts, elo: gs[n - 1].myElo
  };
}
function trendSeries(games) {
  const n = games.length, size = n >= 80 ? 10 : n >= 30 ? 6 : n >= 12 ? 4 : 0;
  if (!size) return [];
  const out = [];
  for (let end = n; end - size >= 0; end -= size) out.unshift(groupStats(games.slice(end - size, end)));
  return out;
}
function recentVsPrev(games) {
  const k = Math.min(10, Math.floor(games.length / 2));
  if (k < 4) return null;
  return { k, recent: groupStats(games.slice(-k)), prev: groupStats(games.slice(-2 * k, -k)) };
}

/* ---------------------------------------------------------------- mindset: sessions, tilt, time of day, opposition */
function mindsetStats(games) {
  const gs = games.filter(g => g.ts).sort((a, b) => a.ts - b.ts);
  const buckets = {};
  const add = (k, g) => { (buckets[k] = buckets[k] || []).push(g); };
  let idx = 0, prev = null, lossRun = 0, sessions = 0;
  for (const g of gs) {
    const same = prev && g.ts - prev.ts < 75 * 60000;
    if (!same) { idx = 0; lossRun = 0; sessions++; }
    idx++;
    add("idx" + Math.min(idx, 4), g);
    if (!same) add("fresh", g);
    else { add(prev.result === "loss" ? "afterLoss" : prev.result === "win" ? "afterWin" : "afterDraw", g); if (lossRun >= 2) add("after2Loss", g); }
    lossRun = g.result === "loss" ? lossRun + 1 : 0;
    const d = new Date(g.ts), hr = d.getHours();
    add(hr >= 5 && hr < 12 ? "morning" : hr < 17 && hr >= 12 ? "afternoon" : hr >= 17 && hr < 22 ? "evening" : "night", g);
    add([0, 6].includes(d.getDay()) ? "weekend" : "weekday", g);
    if (g.myElo && g.oppElo) { const diff = g.oppElo - g.myElo; add(diff >= 40 ? "higher" : diff <= -40 ? "lower" : "similar", g); }
    prev = g;
  }
  const out = { sessions, perSession: sessions ? r1(gs.length / sessions) : 0 };
  for (const [k, list] of Object.entries(buckets)) {
    const s = groupStats(list);
    if (["higher", "lower", "similar"].includes(k)) s.expected = Math.round(100 * avg(list.map(g => 1 / (1 + Math.pow(10, (g.oppElo - g.myElo) / 400)))));
    out[k] = s;
  }
  return out;
}

/* ---------------------------------------------------------------- openings: explorer and recurring leaks */
const myMoveIdx = (g, ply) => Math.floor(ply / 2);
function explorer(games, color, path) {
  const gs = games.filter(g => g.color === color && path.every((s, i) => g.sans[i] === s));
  const ply = path.length, mine = (ply % 2 === 0) === (color === "white");
  const by = new Map();
  for (const g of gs) {
    const san = g.sans[ply]; if (!san) continue;
    const r = by.get(san) || { san, n: 0, score: 0, loss: 0, wp: 0 };
    r.n++; r.score += gScore(g);
    if (mine && g.moves[myMoveIdx(g, ply)]) r.loss += g.moves[myMoveIdx(g, ply)].l;
    const cp = g.ev[ply + 1] ?? 0; r.wp += winPct(color === "white" ? cp : -cp);
    by.set(san, r);
  }
  const rows = [...by.values()].map(r => ({ san: r.san, n: r.n, score: Math.round(100 * r.score / r.n), loss: r1(r.loss / r.n), wp: Math.round(r.wp / r.n) })).sort((a, b) => b.n - a.n);
  return { games: gs, rows, mine, score: gs.length ? Math.round(100 * avg(gs.map(gScore))) : 0 };
}
function fenAfter(path) { const c = new Chess(); for (const s of path) { try { c.move(s); } catch (e) { break; } } return c.fen(); }
function recurringLeaks(games) {
  const pos = new Map();
  for (const g of games) {
    if (!g.pk) continue;
    const first = g.color === "white" ? 0 : 1;
    for (let i = first; i < Math.min(30, g.sans.length, g.pk.length); i += 2) {
      const mv = g.moves[myMoveIdx(g, i)]; if (!mv) continue;
      const key = g.color + g.pk[i];
      (pos.get(key) || pos.set(key, []).get(key)).push({ g, i, san: g.sans[i], loss: mv.l });
    }
  }
  const out = [];
  for (const visits of pos.values()) {
    if (visits.length < 2) continue;
    const by = {};
    for (const v of visits) { const r = by[v.san] || (by[v.san] = { san: v.san, n: 0, loss: 0, ex: v }); r.n++; r.loss += v.loss; r.ex = v; }
    const bad = Object.values(by).filter(r => r.n >= 2 && r.loss / r.n >= 5).sort((a, b) => b.loss - a.loss)[0];
    if (!bad) continue;
    const { g, i } = bad.ex, path = g.sans.slice(0, i), fen = fenAfter(path);
    const t = new Chess(fen), bmv = g.bm[i] ? tryMove(t, g.bm[i]) : null;
    const pm = (() => { const c = new Chess(fen); try { return c.move(bad.san); } catch (e) { return null; } })();
    out.push({
      color: g.color, fen, path, visits: visits.length, san: bad.san, times: bad.n, avgLoss: r1(bad.loss / bad.n), total: bad.loss,
      best: bmv ? bmv.san : "", bestUci: g.bm[i] || "", uci: pm ? uciOf(pm) : "", move: Math.floor(i / 2) + 1, opening: g.opening, gid: g.id, ply: i,
      score: Math.round(100 * avg(visits.filter(v => v.san === bad.san).map(v => gScore(v.g))))
    });
  }
  // keep the earliest leak of each line: later ones are usually consequences of it
  out.sort((a, b) => b.total - a.total);
  const kept = [];
  for (const l of out) if (!kept.some(k => k.color === l.color && k.path.length < l.path.length && k.path.every((s, i) => l.path[i] === s) && l.path[k.path.length] === k.san)) kept.push(l);
  return kept.slice(0, 8);
}

/* ---------------------------------------------------------------- training item generators */
const SAFETY_CATS = ["hung_moved", "allowed_tactic", "allowed_fork", "ignored_threat", "allowed_mate"];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
function blunderCheckItems(S, count = 12) {
  const bad = shuffle(S.errors.filter(e => SAFETY_CATS.includes(e.cat) && e.loss >= 12)).slice(0, Math.ceil(count / 2))
    .map(e => ({ safe: false, fen: e.fen, uci: e.uci, san: e.san, color: e.color, why: e.why, punish: e.punish, best: e.best_san, cat: e.cat, gid: e.gid, ply: e.ply, n: e.n }));
  const safe = [], want = Math.max(count - bad.length, bad.length);
  let guard = 0;
  while (safe.length < want && guard++ < 400 && S.games.length) {
    const g = S.games[Math.floor(Math.random() * S.games.length)];
    const k = 6 + Math.floor(Math.random() * Math.max(1, g.moves.length - 8));
    const mv = g.moves[k]; if (!mv || mv.l > 1.5) continue;
    const ply = 2 * k + (g.color === "white" ? 0 : 1), m = replay(g)[ply];
    if (!m || m.flags.includes("k") || m.flags.includes("q")) continue;
    if (safe.some(s => s.gid === g.id && s.ply === ply)) continue;
    safe.push({ safe: true, fen: m.before, uci: uciOf(m), san: m.san, color: g.color, gid: g.id, ply, n: Math.floor(ply / 2) + 1 });
  }
  return shuffle([...bad, ...safe]).slice(0, count);
}
function convertItems(S) {
  const out = [];
  for (const g of S.games) {
    if (g.maxWp < 85) continue;
    const me = g.color === "white" ? "w" : "b", first = g.color === "white" ? 0 : 1;
    const thrownErr = g.result !== "win" ? g.errors.find(e => e.wb >= 80 && e.wa < 70) : null;
    let ply = thrownErr ? thrownErr.ply : -1;
    if (ply < 0) for (let i = first + 16; i < g.ev.length - 1; i += 2) { if (winPct(me === "w" ? g.ev[i] : -g.ev[i]) >= 85 && Math.abs(g.ev[i]) < 90000) { ply = i; break; } }
    if (ply < 0) continue;
    const m = replay(g)[ply]; if (!m) continue;
    out.push({ gid: g.id, ply, fen: m.before, color: g.color, opp: g.opponent, date: g.date, thrown: !!thrownErr, result: g.result, wp: Math.round(winPct(me === "w" ? g.ev[ply] : -g.ev[ply])), n: Math.floor(ply / 2) + 1, ts: g.ts });
  }
  return out.sort((a, b) => (b.thrown - a.thrown) || (b.ts - a.ts));
}
