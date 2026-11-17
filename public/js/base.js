"use strict";
/* Chess Coach 2 — base: chess helpers, PGN helpers, mistake classifier, book map, statistics, tips */
/* ---------------------------------------------------------------- chess helpers */
const winPct = cp => { cp = Math.max(-2000, Math.min(2000, cp)); return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1); };
const accOf = loss => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
const uciOf = m => m.from + m.to + (m.promotion || "");
const opp = c => (c === "w" ? "b" : "w");
function material(c, color) { let s = 0; for (const row of c.board()) for (const p of row) if (p && p.color === color) s += VAL[p.type]; return s; }
const balance = (c, color) => material(c, color) - material(c, opp(color));
function nonpawn(c) { let s = 0; for (const row of c.board()) for (const p of row) if (p && p.type !== "p" && p.type !== "k") s += VAL[p.type]; return s; }
function tryMove(c, uci) {
  try { return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" }); } catch (e) { return null; }
}
function runLine(fen, pv, k) { const c = new Chess(fen); for (const u of pv.slice(0, k)) if (!tryMove(c, u)) break; return c; }
function sanLine(fen, pv, k) {
  const c = new Chess(fen), out = [];
  for (const u of pv.slice(0, k)) {
    const turn = c.turn(), num = c.moveNumber();
    const m = tryMove(c, u); if (!m) break;
    out.push((turn === "w" ? num + ". " : out.length === 0 ? num + "... " : "") + m.san);
  }
  return out.join(" ");
}
function firstCaptureOf(fen, pv, victim, plies = 4) {
  const c = new Chess(fen);
  for (let i = 0; i < Math.min(plies, pv.length); i++) {
    const before = c.fen();
    const m = tryMove(c, pv[i]); if (!m) break;
    if (m.captured && m.color !== victim) {
      let sq = m.to;
      if (m.flags.includes("e")) sq = m.to[0] + m.from[1];
      return { sq, type: m.captured, move: m, index: i, before };
    }
  }
  return null;
}
function forkTargets(c, fromSq, victim) {
  let n = 0;
  for (const row of c.board()) for (const p of row) {
    if (!p || p.color !== victim) continue;
    if (p.type !== "k" && VAL[p.type] < 3) continue;
    if (c.attackers(p.square, opp(victim)).includes(fromSq)) n++;
  }
  return n;
}
function phaseOf(c, fullmove) { if (fullmove <= 10) return "opening"; return nonpawn(c) <= 26 ? "endgame" : "middlegame"; }

/* ---------------------------------------------------------------- PGN import */
function splitPgns(text) {
  return text.replace(/\r/g, "").split(/\n\s*\n(?=\[Event )/).map(s => s.trim()).filter(s => s.startsWith("["));
}
function headersOf(pgn) { const h = {}; for (const m of pgn.matchAll(/^\[(\w+)\s+"([^"]*)"\]/gm)) h[m[1]] = m[2]; return h; }
function tcInfo(tc) { if (!tc || tc.includes("/")) return null; const [b, i] = tc.split("+"); return { base: +b || 0, inc: +i || 0 }; }
function isRapid(h) { const t = tcInfo(h.TimeControl); if (!t) return false; const est = t.base + 40 * t.inc; return est >= 600; }
function gameIdOf(h) {
  const m = (h.Link || h.Site || "").match(/(\d{6,})/);
  if (m) return m[1];
  const s = [h.White, h.Black, h.UTCDate || h.Date, h.UTCTime || h.EndTime || "", h.Result].join("|");
  let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return "h" + x.toString(36);
}
function resultFor(h, meWhite) {
  const r = h.Result, term = (h.Termination || "").toLowerCase();
  if (r === "1/2-1/2") {
    const method = term.includes("repetition") ? "repetition" : term.includes("stalemate") ? "stalemate" : term.includes("insufficient") ? "insufficient material" : term.includes("50") ? "50-move rule" : "agreement";
    return { result: "draw", method };
  }
  const meWon = (r === "1-0") === meWhite;
  const method = term.includes("checkmate") ? "checkmate" : term.includes("time") ? "time" : term.includes("abandon") ? "abandonment" : "resignation";
  return { result: meWon ? "win" : "loss", method };
}
function openingName(h) {
  const url = h.ECOUrl || "";
  if (!url) return h.Opening || "Unknown opening";
  const slug = decodeURIComponent(url.replace(/\/$/, "").split("/").pop());
  const words = [];
  for (const w of slug.split("-")) { if (/\d/.test(w)) break; words.push(w); }
  return words.slice(0, 4).join(" ") || "Unknown opening";
}

function classify(m, bestPv, punishPv, cpBefore, cpAfter, me) {
  const sign = me === "w" ? 1 : -1;
  const pFirst = punishPv[0] ? sanLine(m.after, punishPv, 1).replace(/^\d+\.+\s*/, "") : "";
  if (sign * cpAfter <= -90000) return { cat: "allowed_mate", why: `This lets your opponent force checkmate, starting with ${pFirst}.` };
  if (sign * cpBefore >= 90000 && sign * cpAfter < 90000) return { cat: "missed_mate", why: "You had a forced checkmate here." };

  const cb = new Chess(m.before);
  const start = balance(cb, me);
  const lost = start - balance(runLine(m.after, punishPv, 5), me);
  if (lost >= 2) {
    const cap = firstCaptureOf(m.after, punishPv, me);
    if (cap) {
      const pn = PNAME[cap.type];
      if (cap.sq === m.to) return { cat: "hung_moved", why: `Your ${pn} on ${cap.sq} can be taken: ${pFirst} wins material.` };
      const first = new Chess(m.after);
      const f = punishPv[0] ? tryMove(first, punishPv[0]) : null;
      if (f && forkTargets(first, f.to, me) >= 2) return { cat: "allowed_fork", theme: "fork", why: `${pFirst} forks two of your pieces.` };
      if (cap.index === 2 && f) {
        const pre = new Chess(cap.before);
        const capFrom = cap.move.from;
        const wasAttacking = new Chess(m.after).attackers(cap.sq, opp(me)).includes(capFrom);
        if (!wasAttacking && capFrom !== f.to && pre) return { cat: "allowed_tactic", theme: "discovered", why: `${pFirst} uncovers an attack on your ${pn} on ${cap.sq}.` };
      }
      const victimBefore = cb.get(cap.sq);
      if (victimBefore && victimBefore.color === me && cb.attackers(cap.sq, opp(me)).length) {
        const att = cb.attackers(cap.sq, opp(me)).map(s => VAL[cb.get(s).type]);
        const defended = cb.attackers(cap.sq, me).length > 0;
        if (!defended || Math.min(...att) < VAL[cap.type])
          return { cat: "ignored_threat", why: `Your ${pn} on ${cap.sq} was already under attack, and this move didn't deal with it.` };
      }
      return { cat: "allowed_tactic", why: `After this, ${pFirst} starts a sequence that wins your ${pn}.` };
    }
    return { cat: "allowed_tactic", why: `After this, ${pFirst} wins material.` };
  }
  const gain = balance(runLine(m.before, bestPv, 6), me) - start;
  if (gain >= 2) {
    const t = new Chess(m.before); const b = bestPv[0] ? tryMove(t, bestPv[0]) : null;
    const theme = b && forkTargets(t, b.to, opp(me)) >= 2 ? "fork" : b && b.san.includes("+") ? "check" : "";
    const bs = b ? b.san : "";
    return { cat: "missed_tactic", theme, why: theme === "fork" ? `${bs} was a fork that wins material.` : `${bs} wins material${theme === "check" ? ", starting with a check" : ""}.` };
  }
  return { cat: "positional", why: "Nothing is lost right away, but the engine rates your position much worse after this move." };
}

function openingHabits(hist, me) {
  const mine = hist.filter(m => m.color === me);
  if (mine.length < 10) return null;
  const first10 = mine.slice(0, 10);
  const castle = first10.some(m => m.flags.includes("k") || m.flags.includes("q"));
  const earlyQ = mine.slice(0, 4).some(m => m.piece === "q");
  const after10 = new Chess(first10[9].after);
  const home = me === "w" ? { b1: "n", g1: "n", c1: "b", f1: "b" } : { b8: "n", g8: "n", c8: "b", f8: "b" };
  let developed = 0;
  for (const [sq, t] of Object.entries(home)) { const p = after10.get(sq); if (!(p && p.color === me && p.type === t)) developed++; }
  let repeats = 0; const landed = new Set();
  for (const m of first10.slice(0, 8)) {
    if (m.piece !== "p" && !m.captured && landed.has(m.from)) {
      const pre = new Chess(m.before);
      if (!pre.attackers(m.from, opp(me)).length && !pre.inCheck()) repeats++;
    }
    landed.add(m.to);
  }
  return { castle, earlyQ, developed, repeats };
}

/* ---------------------------------------------------------------- books */
const BOOK = {
  levy: "How to Win at Chess (Rozman)",
  wb: "Everyone's First Chess Workbook (Giannatos)",
  chernev: "Logical Chess: Move by Move (Chernev)"
};
const ASSIGN = {
  hung_moved: [["wb", "Ch. 1, Capturing Free Pieces, then Ch. 2, Counting Attackers and Defenders"], ["levy", "Ch. 7, Attacking, Defending, and Capturing"]],
  ignored_threat: [["wb", "Ch. 3, Intro to Defense, and Ch. 17, Defense/Recognizing Threats"], ["levy", "Ch. 15, the Checklist section (start every move with what your opponent wants)"]],
  allowed_fork: [["wb", "Ch. 5, Forks"], ["wb", "Ch. 2, Counting Attackers and Defenders (keep pieces protected)"]],
  allowed_tactic: [["wb", "Ch. 6 Pins, Ch. 7 Skewer, Ch. 8 Discovered Attack, Ch. 10 Removing the Guard"], ["levy", "Ch. 14, Intermediate Tactics"]],
  discovered: [["wb", "Ch. 8, Discovered Attack, and Ch. 9, Discovered Check and Double Check"]],
  missed_tactic: [["levy", "Ch. 14, Intermediate Tactics (the CCA method)"], ["wb", "Ch. 5 to 16, one theme per week"]],
  missed_mate: [["wb", "Ch. 4, Checkmates in One; Ch. 18, Checkmates in Two; Ch. 19, Themed Checkmate Patterns"], ["levy", "Ch. 14, CCA: Checkmate in Three"]],
  allowed_mate: [["wb", "Ch. 19, Themed Checkmate Patterns (learn them to see them coming)"], ["levy", "Ch. 5, Endgames II (back rank and other solo-piece mates)"]],
  positional: [["chernev", "Play through one game a week and guess each move before reading the note"], ["levy", "Ch. 8, Beginner Strategy, and Ch. 15, Intermediate Strategy"]],
  conversion: [["levy", "Ch. 15, Trading Pieces"], ["levy", "Ch. 13, Intermediate Endgames"]],
  endgame: [["levy", "Ch. 13, Intermediate Endgames (start with King and Pawn, then Rook)"], ["levy", "Ch. 4 and 5 for the basic mates"]],
  habits: [["levy", "Ch. 2, Three Principles of the Opening: Center, Develop, Castle"], ["chernev", "Games 1 to 16; every developing and castling move is explained"]],
  punish: [["levy", "Ch. 15, the Checklist section"], ["wb", "Ch. 1, Capturing Free Pieces"]],
  fast: [["levy", "Ch. 14, CCA: use it as your blunder check before every capture or check"]],
  trouble: [],
  opening: []
};
const OPENING_REFS = [
  [/london/i, [["levy", "Ch. 10, London System"]]],
  [/vienna/i, [["levy", "Ch. 10, Vienna"]]],
  [/alapin/i, [["levy", "Ch. 10, Alapin Sicilian Variation"]]],
  [/scandinavian/i, [["levy", "Ch. 11, Scandinavian Defense"], ["chernev", "Game 28, Tarrasch vs Mieses"]]],
  [/caro/i, [["levy", "Ch. 11, Caro-Kann Defense"]]],
  [/queens? gambit declined/i, [["levy", "Ch. 11, Queen's Gambit Declined"], ["chernev", "Games 17 to 20, 22, 25, 27, 29, 30, 33"]]],
  [/queens? gambit accepted/i, [["chernev", "Game 16, Tarrasch vs Kurschner"]]],
  [/colle/i, [["chernev", "Games 3, 8, 11, 21"]]],
  [/french/i, [["chernev", "Games 7, 10, 13, 14"]]],
  [/italian|giuoco/i, [["chernev", "Games 1, 2, 5"]]],
  [/ruy|spanish/i, [["chernev", "Games 6, 9, 15"]]],
  [/sicilian/i, [["chernev", "Game 26, Bernstein vs Mieses"]]],
  [/nimzo/i, [["chernev", "Games 24 and 31 (Capablanca)"]]],
  [/queens? indian/i, [["chernev", "Game 32, Canal vs Capablanca"]]],
  [/english/i, [["chernev", "Game 12, Pitschak vs Flohr"]]],
  [/kings? gambit/i, [["chernev", "Game 4, Blackburne vs Blanchard"], ["levy", "Ch. 12, Gambits"]]],
  [/stonewall/i, [["chernev", "Game 23, Van Vliet vs Znosko-Borovsky"]]],
  [/gambit/i, [["levy", "Ch. 12, Gambits"]]],
  [/queens? pawn/i, [["chernev", "The Queen's Pawn Opening section, games 17 to 23"]]],
];
function openingRefs(name) {
  const out = [], seen = new Set();
  for (const [re, refs] of OPENING_REFS) if (re.test(name)) for (const r of refs) { const k = r.join("|"); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}
const booksHTML = refs => refs && refs.length ? `<ul class="books">${refs.map(([b, t]) => `<li><b>${esc(BOOK[b])}</b>: ${esc(t)}</li>`).join("")}</ul>` : "";

/* ---------------------------------------------------------------- stats & tips */
const CAT = {
  hung_moved: ["Moving pieces onto unsafe squares", "You put a piece on a square where it simply gets taken.", "Before you let go of a piece, count attackers and defenders on its new square. If it can be taken for free, pick another square."],
  ignored_threat: ["Missing your opponent's threats", "Your opponent attacked something and you played your own idea instead of dealing with it.", "After every opponent move, ask what that move attacks and what it wants next. Answer that before you look for your own plan."],
  allowed_fork: ["Allowing forks", "Your move let one enemy piece attack two of yours at once.", "Watch knight jumps and queen checks that hit two loose pieces. Keep pieces defended, and be wary when your king and an unprotected piece are a knight's jump or a queen move apart."],
  allowed_tactic: ["Allowing tactics", "Your move allowed a combination (pin, skewer, discovered attack, removed defender) that won material.", "Blunder check: before moving, list every check, capture and attack your opponent will have after your move. If one of them works, choose another move."],
  missed_tactic: ["Missing your own tactics", "You had a move that won material and played something else.", "On every move, scan your own checks, captures and attacks first, most forcing first. Daily puzzles build exactly this recognition."],
  missed_mate: ["Missing checkmates", "You had a forced mate and didn't find it.", "When the enemy king is exposed, look at every check before anything else, starting with the checks that leave the fewest replies."],
  allowed_mate: ["Allowing checkmate", "Your move let your opponent force mate.", "Watch your back rank and your king's pawn cover. When enemy pieces aim at your king, check every check they'll have before you make a non-defensive move."],
  positional: ["Positional and planning errors", "Moves that lose nothing right away but give up a big part of the position: bad trades, a weakened king, passive pieces, pawn moves at the wrong time.", "Review these slowly. When nothing is forcing, improve your worst-placed piece instead of making a random pawn move."]
};
const CAT_SHORT = { hung_moved: "Unsafe square", ignored_threat: "Missed threat", allowed_fork: "Allowed fork", allowed_tactic: "Allowed tactic", missed_tactic: "Missed tactic", missed_mate: "Missed mate", allowed_mate: "Allowed mate", positional: "Positional" };
const PH = { o: "opening", m: "middlegame", e: "endgame" };

function aggregate(games) {
  games = [...games].sort((a, b) => (a.ts - b.ts) || a.end.localeCompare(b.end));
  const n = games.length, S = { n, games };
  S.wdl = { win: 0, draw: 0, loss: 0 }; games.forEach(g => S.wdl[g.result]++);
  S.lossMethods = {}; games.filter(g => g.result === "loss").forEach(g => S.lossMethods[g.method] = (S.lossMethods[g.method] || 0) + 1);
  S.acc = +(games.reduce((a, g) => a + g.acc, 0) / n).toFixed(1);
  const moves = games.flatMap(g => g.moves);
  S.errors = games.flatMap(g => g.errors.map(e => ({ ...e, gid: g.id, url: g.url, color: g.color, opp: g.opponent, date: g.date, result: g.result })));
  S.bpg = +(moves.filter(m => m.l >= BLUNDER).length / n).toFixed(2);
  S.mpg = +(moves.filter(m => m.l >= MISTAKE && m.l < BLUNDER).length / n).toFixed(2);
  S.catLoss = {}; S.catCount = {};
  for (const e of S.errors) { S.catLoss[e.cat] = (S.catLoss[e.cat] || 0) + e.loss; S.catCount[e.cat] = (S.catCount[e.cat] || 0) + 1; }
  S.discovered = S.errors.filter(e => e.theme === "discovered").length;
  S.phase = {};
  for (const k of ["o", "m", "e"]) {
    const ms = moves.filter(m => m.ph === k); if (!ms.length) continue;
    S.phase[PH[k]] = { moves: ms.length, acc: +(ms.reduce((a, m) => a + accOf(m.l), 0) / ms.length).toFixed(1), lpg: +(ms.reduce((a, m) => a + m.l, 0) / n).toFixed(1) };
  }
  const timed = moves.filter(m => m.s != null);
  if (timed.length) {
    const errs = timed.filter(m => m.l >= MISTAKE);
    const low = timed.filter(m => m.c < 60), norm = timed.filter(m => m.c >= 60);
    const sp = {}; for (const k of ["o", "m", "e"]) { const t = timed.filter(m => m.ph === k); sp[PH[k]] = t.length ? +(t.reduce((a, m) => a + m.s, 0) / t.length).toFixed(1) : 0; }
    S.time = {
      fastErrPct: errs.length ? +(100 * errs.filter(m => m.s < 5).length / errs.length).toFixed(0) : 0,
      fastErrs: errs.filter(m => m.s < 5).length,
      fastMovePct: +(100 * timed.filter(m => m.s < 5).length / timed.length).toFixed(0),
      troubleGamesPct: +(100 * games.filter(g => g.moves.some(m => m.c < 60)).length / n).toFixed(0),
      errLow: low.length ? +(100 * low.filter(m => m.l >= MISTAKE).length / low.length).toFixed(1) : 0,
      errNorm: norm.length ? +(100 * norm.filter(m => m.l >= MISTAKE).length / norm.length).toFixed(1) : 0,
      finalPct: +(100 * games.reduce((a, g) => a + g.finalClock / Math.max(1, g.base), 0) / n).toFixed(0),
      timeouts: S.lossMethods.time || 0, spent: sp
    };
  }
  const op = {};
  for (const g of games) {
    const k = g.color + "|" + g.opening;
    op[k] = op[k] || { color: g.color, name: g.opening, games: 0, score: 0, exit: 0 };
    op[k].games++; op[k].score += { win: 1, draw: .5, loss: 0 }[g.result]; op[k].exit += g.exitWp;
  }
  S.openings = Object.values(op).map(o => ({ ...o, score: Math.round(100 * o.score / o.games), exit: +(o.exit / o.games).toFixed(1) })).sort((a, b) => b.games - a.games);
  const winning = games.filter(g => g.maxWp >= 85);
  S.conv = { winning: winning.length, converted: winning.filter(g => g.result === "win").length, thrown: winning.filter(g => g.result !== "win") };
  S.missedPunish = S.errors.filter(e => e.tags.includes("missed_punish")).length;
  const oh = games.map(g => g.oh).filter(Boolean);
  S.habits = oh.length ? {
    n: oh.length,
    castle: Math.round(100 * oh.filter(x => x.castle).length / oh.length),
    earlyQ: Math.round(100 * oh.filter(x => x.earlyQ).length / oh.length),
    developed: +(oh.reduce((a, x) => a + x.developed, 0) / oh.length).toFixed(1),
    repeats: +(oh.reduce((a, x) => a + x.repeats, 0) / oh.length).toFixed(2)
  } : null;
  S.blunderPieces = {}; S.errors.filter(e => e.cls === "blunder").forEach(e => { const p = PNAME[e.piece] || "?"; S.blunderPieces[p] = (S.blunderPieces[p] || 0) + 1; });
  S.byColor = {};
  for (const c of ["white", "black"]) { const cg = games.filter(g => g.color === c); if (cg.length) S.byColor[c] = { games: cg.length, score: Math.round(100 * cg.reduce((a, g) => a + { win: 1, draw: .5, loss: 0 }[g.result], 0) / cg.length) }; }
  S.ratings = games.filter(g => g.myElo).map(g => g.myElo);
  return S;
}

function makeTips(S) {
  const n = S.n, tips = [];
  const plural = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  for (const [cat, total] of Object.entries(S.catLoss)) {
    const [title, what, how] = CAT[cat], count = S.catCount[cat];
    let refs = ASSIGN[cat];
    if (cat === "allowed_tactic" && S.discovered >= 2) refs = [...ASSIGN.discovered, ...refs];
    tips.push({ key: cat, impact: total / n, title, what, how, refs, evidence: `${plural(count, "time")} in ${n} games, costing ${(total / n).toFixed(1)} win-chance points per game.` });
  }
  const t = S.time;
  if (t && t.fastErrs >= 3 && t.fastErrPct >= 30) tips.push({
    key: "fast", impact: t.fastErrPct / 100 * Object.values(S.catLoss).reduce((a, b) => a + b, 0) / n * .6, refs: ASSIGN.fast,
    title: "Moving too fast at critical moments", evidence: `${t.fastErrPct}% of your mistakes and blunders were played in under 5 seconds.`,
    what: "In rapid you have time to check, but many of your worst moves were near-instant.",
    how: "Rule: before any capture, any check, and any move into enemy territory, spend 10 seconds on your pre-move routine. Premove only when the move is truly forced."
  });
  if (t && t.troubleGamesPct >= 25 && t.errLow > t.errNorm * 1.5) tips.push({
    key: "trouble", impact: (t.errLow - t.errNorm) / 100 * 8 + t.timeouts * 30 / n, refs: [],
    title: "Getting into time trouble", evidence: `You fell under 1 minute in ${t.troubleGamesPct}% of games; your error rate there is ${t.errLow}% vs ${t.errNorm}% otherwise. Lost on time ${plural(t.timeouts, "time")}.`,
    what: "You spend too long earlier and then make rushed decisions when it matters.",
    how: "Budget the clock: in a 10-minute game aim to have about 5 minutes left at move 20. Play known opening moves quickly and save long thinks for captures, tension and plan changes."
  });
  if (S.conv.winning >= 3 && S.conv.thrown.length >= 2) tips.push({
    key: "conversion", impact: S.conv.thrown.length * 40 / n, refs: ASSIGN.conversion,
    title: "Not converting winning positions", evidence: `You reached a clearly winning position (85%+ win chance) in ${S.conv.winning} games and won ${S.conv.converted}.`,
    what: "Once ahead, you let the opponent back in with counterplay or loose moves.",
    how: "When ahead: trade pieces, keep pawns, shut down their most active piece, and keep checking their checks and captures. Simple beats brilliant."
  });
  const ph = S.phase;
  if (ph.endgame && ph.endgame.moves >= 40) {
    const others = ["opening", "middlegame"].filter(p => ph[p]).map(p => ph[p].acc);
    if (others.length && ph.endgame.acc < Math.min(...others) - 3) tips.push({
      key: "endgame", impact: ph.endgame.lpg * .5, refs: ASSIGN.endgame,
      title: "Endgame technique", evidence: `Your endgame accuracy is ${ph.endgame.acc}% vs ${Math.min(...others)}% in other phases.`,
      what: "You lose points once most pieces are off the board.",
      how: "Activate your king early in endgames, create passed pawns, and learn the core king-and-pawn and rook endgames."
    });
  }
  const H = S.habits;
  if (H && H.n >= 5) {
    const probs = [];
    if (H.castle < 60) probs.push(`you castle by move 10 in only ${H.castle}% of games`);
    if (H.earlyQ > 25) probs.push(`your queen moves in the first 4 moves in ${H.earlyQ}% of games`);
    if (H.developed < 3) probs.push(`you average ${H.developed} of 4 minor pieces developed by move 10`);
    if (H.repeats > 0.6) probs.push(`you move the same piece twice without being forced ${H.repeats} times per game`);
    const openLoss = ph.opening ? ph.opening.lpg : 0;
    if (probs.length) tips.push({
      key: "habits", impact: Math.max(1, openLoss) * .15 * probs.length, refs: ASSIGN.habits,
      title: "Opening fundamentals", evidence: probs.join("; ").replace(/^./, c => c.toUpperCase()) + ".",
      what: "Your openings break the basic principles, so you start middlegames behind in development or with an unsafe king.",
      how: "Center, develop, castle. Get both knights and bishops out before moving any piece twice, keep the queen home early, and castle before starting an attack."
    });
  }
  const bad = S.openings.filter(o => o.games >= 3 && o.exit < 40);
  if (bad.length) {
    const w = bad.reduce((a, b) => a.exit < b.exit ? a : b);
    tips.push({
      key: "opening", impact: (50 - w.exit) * w.games / n, refs: openingRefs(w.name),
      title: `Your ${w.name} as ${w.color === "white" ? "White" : "Black"}`,
      evidence: `After move 10 your average win chance in this line is ${Math.round(w.exit)}% (${w.games} games, ${w.score}% score).`,
      what: "You come out of this opening already worse.",
      how: "Learn the ideas and typical plans of this line rather than long move orders, or switch to a simpler setup you understand well."
    });
  }
  if (S.missedPunish >= 3) tips.push({
    key: "punish", impact: S.missedPunish * 12 / n, refs: ASSIGN.punish,
    title: "Not punishing your opponent's mistakes", evidence: `${plural(S.missedPunish, "time")} your opponent erred and you answered with a mistake of your own.`,
    what: "When an opponent's move looks odd, you continue on autopilot instead of looking for the refutation.",
    how: "Treat every surprising move as a question: did they leave something loose or allow a tactic? Look at captures and checks first."
  });
  return tips.sort((a, b) => b.impact - a.impact);
}

function coachSummary(S, tips) {
  const L = [`Rapid games analyzed: ${S.n}. W/D/L ${S.wdl.win}/${S.wdl.draw}/${S.wdl.loss}. Average accuracy ${S.acc}%. Blunders per game ${S.bpg}, mistakes per game ${S.mpg}.`];
  if (S.ratings.length) L.push(`Rating: ${S.ratings[0]} -> ${S.ratings[S.ratings.length - 1]}.`);
  L.push("Ranked weaknesses (by win-chance points lost per game):");
  tips.forEach((t, i) => L.push(`${i + 1}. ${t.title}: ${t.evidence}`));
  L.push("Phase accuracy: " + Object.entries(S.phase).map(([k, x]) => `${k} ${x.acc}%`).join(", "));
  if (S.time) L.push(`Clock: ${S.time.fastErrPct}% of errors played in under 5s; under 1 minute in ${S.time.troubleGamesPct}% of games; error rate ${S.time.errLow}% at low clock vs ${S.time.errNorm}% otherwise; ${S.time.timeouts} losses on time.`);
  if (S.habits) L.push(`Opening habits: castled by move 10 in ${S.habits.castle}% of games; early queen ${S.habits.earlyQ}%; ${S.habits.developed}/4 minors developed by move 10; ${S.habits.repeats} unforced repeat moves per game.`);
  L.push("Openings (color, games, score, avg win% after move 10): " + S.openings.slice(0, 8).map(o => `${o.name} as ${o.color} ${o.games}g ${o.score}% ${Math.round(o.exit)}%`).join("; "));
  L.push(`Converted ${S.conv.converted} of ${S.conv.winning} clearly winning games.`);
  L.push("Five worst moves: " + [...S.errors].sort((a, b) => b.loss - a.loss).slice(0, 5).map(e => `move ${e.n} ${e.san} (best ${e.best_san}, ${e.cat}, ${e.phase}, ${e.spent ?? "?"}s spent)`).join("; "));
  return L.join("\n");
}
function bookCatalog(S) {
  const lines = [];
  for (const [k, refs] of Object.entries(ASSIGN)) for (const [b, t] of refs) lines.push(`${k}: ${BOOK[b]}: ${t}`);
  for (const o of S.openings.slice(0, 8)) for (const [b, t] of openingRefs(o.name)) lines.push(`opening ${o.name}: ${BOOK[b]}: ${t}`);
  return [...new Set(lines)].join("\n");
}
function coachPrompt(S, tips) {
  return `You are an experienced chess coach. Write a personal improvement plan for a rapid (10+ minute) player based ONLY on the data below.

PLAYER DATA
${coachSummary(S, tips)}

BOOKS THE PLAYER OWNS (assign only from this list; cite them exactly as written):
${bookCatalog(S)}

Write in Markdown with these sections:
## Diagnosis (3-4 sentences: what is really costing games, with numbers from the data)
## Three habits to build (each: the habit, a concrete trigger for when to use it during a game, why it fixes their specific numbers)
## Two-week plan (day-by-day, 30-45 minutes per day: puzzles, book chapters from the list, reviewing their own games, playing rapid games with a specific focus)
## How to check progress (2-3 measurable targets based on their current numbers)
Be concrete and direct. No generic filler. Keep it under 550 words.`;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { } ta.remove(); return ok;
  }
}
async function chessApi(path) {
  let notFound = false;
  for (const url of ["/api/chess/" + path, "https://api.chess.com/pub/" + path]) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (r.ok) return await r.json();
      if (r.status === 404) notFound = true;
      if (r.status === 429) { await sleep(3000); const r2 = await fetch(url); if (r2.ok) return await r2.json(); }
    } catch (e) { /* try next */ }
  }
  throw new Error(notFound ? "not_found" : "unreachable");
}
function monthLinks(u, n) {
  const now = new Date(), out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0");
    out.push({ label: d.toLocaleString("en", { month: "short", year: "numeric" }), url: `https://api.chess.com/pub/player/${encodeURIComponent(u.toLowerCase())}/games/${y}/${m}/pgn` });
  }
  return out;
}
