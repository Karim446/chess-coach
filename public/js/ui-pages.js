"use strict";
/* Chess Coach 2 — pages: today, games, game review, insights, openings, coach */
const ROUTINE = [
  ["What do they want?", "Look at your opponent's last move. What does it attack, and what is it preparing?"],
  ["Checks, captures, attacks", "List them for your opponent, then for yourself. Most forcing first."],
  ["Nothing forcing?", "Improve your worst piece, take space, or put a rook on an open file."],
  ["Blunder check", "Before letting go: can the moved piece be taken, and what is newly undefended?"]
];
const routineHTML = () => `<ol class="routine">${ROUTINE.map(([t, d]) => `<li><h3>${t}</h3><p class="small">${d}</p></li>`).join("")}</ol>`;
const tipExample = (S, tip) => { const errs = [...S.errors].sort((a, b) => b.loss - a.loss); return (tip && errs.find(e => e.cat === tip.key)) || errs[0]; };

/* ---------------------------------------------------------------- today */
PAGES.today = (v, S, tips) => {
  const c = srsCounts(S), session = buildSession(S, tips), top = tips[0], cmp = recentVsPrev(S.games), st = streak();
  const ex = tipExample(S, tips.find(t => CAT[t.key] && t === top) || tips.find(t => CAT[t.key]));
  const doneToday = (App.activity[dayKey()] || {}).d || 0;
  const mins = Math.max(3, Math.round(session.length * 0.8));
  const sessionCard = session.length
    ? `<h1>${c.due ? `${plural(c.due, "position")} due for review` : `${session.length} new positions from your games`}</h1>
       <p>${c.due ? `Plus ${Math.max(0, session.length - Math.min(c.due, 8))} new ones. ` : ""}About ${mins} minutes. ${doneToday ? `You've done ${doneToday} today.` : "Solve them before you play."}</p>
       <div class="row"><button class="btn dark" data-go="train/session">Start today's session</button><button class="btn ghost-dark" data-go="train/check">Blunder check</button></div>`
    : `<h1>You're caught up</h1><p>No positions are due and there are no new mistakes to learn. Play some rapid, then come back.</p><div class="row"><button class="btn dark" data-go="train/check">Blunder check</button><button class="btn ghost-dark" data-go="train/convert">Convert a win</button></div>`;
  const recent = [...S.games].slice(-6).reverse();
  const tiles = cmp ? [
    ["Accuracy", cmp.recent.acc + "%", delta(cmp.recent.acc, cmp.prev.acc, { unit: " pts" })],
    ["Blunders per game", cmp.recent.bpg.toFixed(2), delta(cmp.recent.bpg, cmp.prev.bpg, { lowerBetter: true, digits: 2 })],
    ["Score", cmp.recent.score + "%", delta(cmp.recent.score, cmp.prev.score, { unit: " pts", digits: 0 })],
    ["Rating", cmp.recent.elo || "–", cmp.recent.elo && cmp.prev.elo ? delta(cmp.recent.elo, cmp.prev.elo, { digits: 0 }) : ""]
  ] : null;
  v.innerHTML = `
  <section class="today-top">
    <div class="sessioncard">${sessionCard}<p class="streak">${st ? `${plural(st, "day")} in a row` : "Train today to start a streak"}, ${c.mastered} of ${c.total} mistakes mastered</p></div>
    ${top ? `<div class="focuscard"><p class="kicker">Your biggest leak right now</p><h2>${esc(top.title)}</h2><p class="ev">${esc(top.evidence)}</p><p class="how"><b>The habit:</b> ${esc(top.how)}</p>
      ${ex ? `<a class="focus-ex" href="#/game/${ex.gid}/${ex.ply + 1}">${miniBoard(ex.fen, ex.color, { arrows: arrowsFor(ex.uci, ex.best_uci) })}<span class="small">vs ${esc(ex.opp)}: you played <b class="bad-t">${esc(ex.san)}</b>, <b class="good-t">${esc(ex.best_san)}</b> was stronger. ${esc(ex.why)}</span></a>` : ""}
      <p><a href="#/insights">See every leak, ranked</a></p></div>` : ""}
  </section>
  ${tiles ? `<section><h2>Your last ${cmp.k} games against the ${cmp.k} before</h2><div class="tiles">${tiles.map(([l, val, d]) => `<div class="tile"><span class="tile-l">${l}</span><b>${val}</b>${d}</div>`).join("")}</div></section>` : ""}
  <section><div class="sechead"><h2>Recent games</h2><a href="#/games">All ${S.n} games</a></div>
    <div class="gamelist">${recent.map(g => `<a class="gamerow" href="#/game/${g.id}"><span class="dot ${g.color}" title="You played ${sideName(g.color)}"></span><span class="gr-opp"><b>${esc(g.opponent)}</b> <span class="muted small">${g.oppElo || ""}</span></span>${resultPill(g)}<span class="gr-acc">${g.acc}%</span><span class="gr-marks">${gameMarks(g)}</span><span class="muted small gr-date">${fmtDate(g.ts)}</span></a>`).join("")}</div></section>
  <section><h2>Before every move</h2>${routineHTML()}</section>`;
};

/* ---------------------------------------------------------------- games list */
App.gf = { res: "all", color: "all", q: "" };
PAGES.games = (v, S) => {
  const f = App.gf, q = f.q.toLowerCase();
  const list = [...S.games].reverse().filter(g => (f.res === "all" || g.result === f.res) && (f.color === "all" || g.color === f.color) && (!q || g.opponent.toLowerCase().includes(q) || g.opening.toLowerCase().includes(q)));
  const chip = (group, val, label) => `<button class="chip" data-f="${group}:${val}" aria-pressed="${f[group] === val}">${label}</button>`;
  v.innerHTML = `<h1 class="page-title">Games</h1>
  <div class="filters"><div class="chips">${chip("res", "all", "All")}${chip("res", "win", "Won")}${chip("res", "loss", "Lost")}${chip("res", "draw", "Drawn")}</div>
    <div class="chips">${chip("color", "all", "Both colors")}${chip("color", "white", "White")}${chip("color", "black", "Black")}</div>
    <input type="text" id="gq" placeholder="Search opponent or opening" value="${esc(f.q)}" aria-label="Search games"></div>
  <p class="muted small">${plural(list.length, "game")}. Click one to review it move by move.</p>
  <div class="tbl"><table class="games"><thead><tr><th>Date</th><th>Opponent</th><th>Result</th><th class="num">Accuracy</th><th>Mistakes</th><th>Opening</th></tr></thead><tbody>
  ${list.slice(0, 300).map(g => `<tr data-go="game/${g.id}" tabindex="0"><td>${fmtDate(g.ts) || esc(g.date)}</td><td><span class="dot ${g.color}"></span> ${esc(g.opponent)} <span class="muted small">${g.oppElo || ""}</span></td><td>${resultPill(g)} <span class="small muted">${esc(g.method)}</span></td><td class="num">${g.acc}%</td><td>${gameMarks(g)}</td><td>${esc(g.opening)}</td></tr>`).join("")}
  </tbody></table></div>`;
  $$("[data-f]", v).forEach(b => { b.onclick = () => { const [k, val] = b.dataset.f.split(":"); f[k] = val; render(); }; });
  const gq = $("#gq"); gq.oninput = () => { f.q = gq.value; clearTimeout(gq._t); gq._t = setTimeout(() => { render(); const n = $("#gq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $$("tr[data-go]", v).forEach(tr => { tr.onkeydown = e => { if (e.key === "Enter") go(tr.dataset.go); }; });
};

/* ---------------------------------------------------------------- game review */
PAGES.game = (v, S, tips, rest) => {
  const g = App.games[rest[0]];
  if (!g) { v.innerHTML = `<div class="empty"><h2>That game isn't here</h2><button class="btn ghost" data-go="games">All games</button></div>`; return; }
  const R = reviewData(g), n = R.plies.length, me = g.color === "white" ? "w" : "b";
  let p = clamp(+rest[1] || 0, 0, n), orient = g.color;
  const myWp = i => (me === "w" ? R.wpWhite[i] : 100 - R.wpWhite[i]);
  const errAt = Object.fromEntries(g.errors.map(e => [e.ply, e]));
  const myErrPlies = R.plies.map((x, i) => (x.mine && x.loss >= MISTAKE ? i : -1)).filter(i => i >= 0);
  // eval graph, from my point of view
  const W = 600, H = 120, X = i => 2 + i * (W - 4) / Math.max(1, n), Y = w => 4 + (100 - w) * (H - 8) / 100;
  const pts = R.wpWhite.map((_, i) => `${X(i).toFixed(1)},${Y(myWp(i)).toFixed(1)}`);
  const graph = `<svg class="evalgraph" id="graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Your win chance through the game">
    <rect x="0" y="0" width="${W}" height="${H}" class="eg-bg"/><polygon points="2,${H - 4} ${pts.join(" ")} ${X(n).toFixed(1)},${H - 4}" class="eg-area"/>
    <line x1="0" x2="${W}" y1="${Y(50)}" y2="${Y(50)}" class="eg-mid"/><polyline points="${pts.join(" ")}" class="eg-line"/>
    ${R.plies.map((x, i) => x.mine && x.loss >= MISTAKE ? `<circle cx="${X(i + 1)}" cy="${Y(myWp(i + 1))}" r="4" class="eg-dot ${x.cls}"/>` : "").join("")}
    <line id="cursor" x1="0" x2="0" y1="0" y2="${H}" class="eg-cur"/></svg>`;
  let rows = "";
  for (let i = 0; i < n; i += 2) {
    const cell = k => { const x = R.plies[k]; return x ? `<button class="mv ${x.loss >= INACC ? x.cls : ""} ${x.mine ? "mine" : ""}" data-p="${k + 1}">${esc(x.m.san)}<span class="gl">${GLYPH[x.cls] || ""}</span></button>` : "<span></span>"; };
    rows += `<span class="mvn">${i / 2 + 1}.</span>${cell(i)}${cell(i + 1)}`;
  }
  const counts = cls => R.plies.filter(x => x.mine && x.cls === cls).length;
  v.innerHTML = `<p class="crumb"><a href="#/games">Games</a></p>
  <div class="reviewhead"><h1><span class="dot ${g.color}"></span> vs ${esc(g.opponent)} <span class="muted">${g.oppElo || ""}</span></h1>
    <p class="muted">${resultPill(g)} by ${esc(g.method)}, ${fmtDate(g.ts) || esc(g.date)}. ${esc(g.opening)}. Accuracy ${g.acc}%. <span class="gcount"><span class="gl blunder">??</span> ${counts("blunder")}</span><span class="gcount"><span class="gl mistake">?</span> ${counts("mistake")}</span><span class="gcount"><span class="gl inaccuracy">?!</span> ${counts("inaccuracy")}</span></p></div>
  <div class="stage review"><div class="stage-board"><div class="withbar"><div id="rbar"></div><div id="rboard" class="boardhost"></div></div>
      <div class="navrow"><button class="btn ghost small" id="first" aria-label="First move">|&lt;</button><button class="btn ghost small" id="prev" aria-label="Previous move">&lt;</button><button class="btn ghost small" id="nextm" aria-label="Next move">&gt;</button><button class="btn ghost small" id="lastm" aria-label="Last move">&gt;|</button><button class="btn small" id="nexterr" ${myErrPlies.length ? "" : "disabled"}>Next mistake</button><button class="btn ghost small" id="flip">Flip</button></div></div>
    <div class="stage-side"><div class="graphwrap">${graph}<p class="small muted graphcap">Your win chance. Click the graph to jump.</p></div>
      <div id="mpanel" class="mpanel"></div>
      <div class="movegrid" id="moves">${rows}</div>
      <div class="actions"><button class="btn ghost small" id="copyg">Copy game for Claude</button>${g.url ? `<a class="btn ghost small" href="${esc(g.url)}" target="_blank" rel="noopener">Open on chess.com</a>` : ""}</div><p class="small muted" id="copied" role="status"></p></div></div>`;
  const show = np => {
    p = clamp(np, 0, n);
    const x = p ? R.plies[p - 1] : null, fen = p ? x.m.after : (R.h[0] ? R.h[0].before : new Chess().fen());
    const flawed = x && x.loss >= INACC, best = x && flawed && g.bm[p - 1] !== uciOf(x.m) ? g.bm[p - 1] : "";
    $("#rboard").innerHTML = boardSVG(fen, orient, { last: x ? [x.m.from, x.m.to] : [], arrows: best ? [arrow(best, ARROW_GOOD)] : [], glyph: x && GLYPH[x.cls] ? { sq: x.m.to, text: GLYPH[x.cls], cls: x.cls } : null });
    $("#rbar").innerHTML = evalBar(R.wpWhite[p], orient, barLabel(g.ev[p]));
    $("#cursor").setAttribute("x1", X(p)); $("#cursor").setAttribute("x2", X(p));
    $$(".mv", v).forEach(b => b.classList.toggle("cur", +b.dataset.p === p));
    const cur = $(".mv.cur", v); if (cur) { const box = $("#moves"); const top = cur.offsetTop; if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = top - box.clientHeight / 2; }
    const panel = $("#mpanel");
    if (!x) { panel.innerHTML = `<p class="muted">Starting position. Use the arrow keys or the buttons to step through. "Next mistake" jumps to your next error.</p>`; }
    else {
      const num = Math.floor((p - 1) / 2) + 1, dots = x.m.color === "w" ? "." : "...", e = x.mine ? errAt[p - 1] : null;
      const label = { blunder: "Blunder", mistake: "Mistake", inaccuracy: "Inaccuracy", best: "Best move", good: "Good move" }[x.cls];
      const clk = g.clk ? `, ${fmtClock(g.clk[p - 1])} left` : "";
      const bestSan = (() => { if (!best) return ""; const t = new Chess(x.m.before), r = tryMove(t, best); return r ? r.san : ""; })();
      panel.innerHTML = `<h3><span class="mvbig ${x.loss >= INACC ? x.cls : ""}">${num}${dots} ${esc(x.m.san)}${GLYPH[x.cls] || ""}</span> <span class="muted">${x.mine ? "You" : esc(g.opponent)}: ${label}${x.loss >= INACC ? `, ${Math.round(x.loss)} points lost` : ""}${clk}</span></h3>
        ${e ? `<p><b>${esc(CAT[e.cat][0])}.</b> ${esc(e.why)}</p>${e.line ? `<p class="line">Best: ${esc(e.line)}</p>` : ""}${e.punish ? `<p class="line">Punished by: ${esc(e.punish)}</p>` : ""}${e.spent != null ? `<p class="small muted">You spent ${Math.round(e.spent)} s on this move.</p>` : ""}` : bestSan ? `<p>Stronger was <b class="good-t">${esc(bestSan)}</b> (green arrow).</p>` : ""}
        <div class="actions">${e ? `<button class="btn small accent" id="prac">Practice this position</button>` : ""}<button class="btn ghost small" id="playhere">Play from here vs Stockfish</button></div>`;
      if ($("#prac")) $("#prac").onclick = () => { const full = S.errors.find(k => k.gid === g.id && k.ply === e.ply); if (full) startDrill(v, S, [full], { title: "Practice" }); };
      $("#playhere").onclick = () => startPlay({ fen: x.mine ? x.m.before : x.m.after, color: g.color, title: `Move ${num} vs ${g.opponent}`, goal: "free", back: `game/${g.id}/${p}` });
    }
    history.replaceState(null, "", `#/game/${g.id}/${p}`);
  };
  $("#first").onclick = () => show(0); $("#prev").onclick = () => show(p - 1); $("#nextm").onclick = () => show(p + 1); $("#lastm").onclick = () => show(n);
  const nextErr = () => { const k = myErrPlies.find(i => i + 1 > p); show(k != null ? k + 1 : myErrPlies[0] + 1); };
  $("#nexterr").onclick = nextErr;
  $("#flip").onclick = () => { orient = orient === "white" ? "black" : "white"; show(p); };
  $("#moves").onclick = e => { const b = e.target.closest(".mv"); if (b) show(+b.dataset.p); };
  $("#graph").onclick = e => { const r = e.currentTarget.getBoundingClientRect(); show(Math.round((e.clientX - r.left) / r.width * n)); };
  $("#copyg").onclick = async () => { $("#copied").textContent = (await copyText(gameForClaude(g, R))) ? "Copied. Paste it into a Claude chat for a written review." : "Couldn't copy."; };
  App.onKey = e => {
    if (e.key === "ArrowLeft") { show(p - 1); return true; } if (e.key === "ArrowRight") { show(p + 1); return true; }
    if (e.key === "Home") { show(0); return true; } if (e.key === "End") { show(n); return true; }
    if (e.key.toLowerCase() === "n" && myErrPlies.length) { nextErr(); return true; }
    if (e.key.toLowerCase() === "f") { $("#flip").click(); return true; }
  };
  show(p);
};
function gameForClaude(g, R) {
  let moves = "";
  R.plies.forEach((x, i) => {
    if (x.m.color === "w") moves += `${i / 2 + 1}. `;
    moves += x.m.san + (GLYPH[x.cls] || "");
    const e = x.mine ? g.errors.find(k => k.ply === i) : null;
    if (e) moves += ` {${e.cls}: ${e.why} Best was ${e.best_san}. Win chance ${Math.round(e.wb)}% to ${Math.round(e.wa)}%${e.spent != null ? `, ${Math.round(e.spent)}s spent` : ""}} `;
    moves += " ";
  });
  return `Review this rapid game of mine as a chess coach. I played ${sideName(g.color)} (${g.myElo || "?"}) against ${g.opponent} (${g.oppElo || "?"}) and ${g.result === "win" ? "won" : g.result === "loss" ? "lost" : "drew"} by ${g.method}. Opening: ${g.opening}. Engine accuracy ${g.acc}%.\nMy errors are annotated in braces with Stockfish's verdict.\n\n${moves.trim()}\n\nTell me: (1) the turning points in plain language, (2) what I misunderstood about the position each time, (3) one habit to take into my next game. Be concrete and brief.`;
}

/* ---------------------------------------------------------------- insights */
PAGES.insights = (v, S, tips, rest) => {
  const sub = rest[0] || "leaks";
  const tabs = [["leaks", "Leaks"], ["trends", "Trends"], ["clock", "Clock and phases"], ["mindset", "Mindset"]];
  const head = `<h1 class="page-title">Insights</h1><div class="chips subnav" role="tablist">${tabs.map(([k, l]) => `<button class="chip" role="tab" aria-selected="${sub === k}" aria-pressed="${sub === k}" data-go="insights/${k}">${l}</button>`).join("")}</div>`;
  v.innerHTML = head + ({ leaks: insLeaks, trends: insTrends, clock: insClock, mindset: insMindset }[sub] || insLeaks)(S, tips);
};
function insLeaks(S, tips) {
  const cm = Math.max(...Object.values(S.catLoss), 1);
  const stat = [[S.n, "games"], [`${S.wdl.win}/${S.wdl.draw}/${S.wdl.loss}`, "won / drawn / lost"], [S.acc + "%", "accuracy"], [S.bpg, "blunders per game"], [S.mpg, "mistakes per game"]];
  return `<div class="stats">${stat.map(([a, b]) => `<div class="stat"><b>${a}</b><span>${b}</span></div>`).join("")}</div>
  <section><h2>What to work on, in order</h2><p class="muted">Ranked by how many points of win chance each habit costs you per game. Book assignments point to chapters in the books you own.</p>
  <ol class="focus">${tips.slice(0, 7).map(t => `<li><div><h3>${esc(t.title)}</h3><p class="ev">${esc(t.evidence)}</p><p>${esc(t.what)}</p><p class="how"><b>What to do:</b> ${esc(t.how)}</p>${booksHTML(t.refs)}${CAT[t.key] ? `<p><button class="btn ghost small" data-go="train/browse/${t.key}">Practice these ${S.catCount[t.key]} positions</button></p>` : ""}</div></li>`).join("")}</ol></section>
  <section><h2>Where the points go</h2>${Object.entries(S.catLoss).sort((a, b) => b[1] - a[1]).map(([c, x]) => bar(CAT_SHORT[c], x, cm, `${S.catCount[c]}x, ${(x / S.n).toFixed(1)} per game`, "bad")).join("")}</section>`;
}
function insTrends(S) {
  const series = trendSeries(S.games), cmp = recentVsPrev(S.games);
  if (!series.length || !cmp) return `<div class="empty"><h2>Trends need about a dozen games</h2><p class="muted">Keep playing and syncing. This page shows whether the training is working.</p></div>`;
  const size = series[0].n, lab = s => fmtDate(s.to);
  const chart = (title, key, o) => `<div><h3>${title}</h3>${lineChart(series.map(s => ({ x: lab(s), y: s[key] })), { label: title, ...o })}</div>`;
  const cats = Object.keys(CAT).map(c => ({ c, now: cmp.recent.cat[c] || 0, was: cmp.prev.cat[c] || 0 })).filter(r => r.now + r.was > 0).sort((a, b) => (b.now + b.was) - (a.now + a.was));
  const elo = S.games.filter(g => g.myElo).map(g => ({ x: fmtDate(g.ts), y: g.myElo }));
  return `<section><p class="muted">Each point is the average of ${size} games, oldest on the left.</p>
  <div class="grid2">${chart("Accuracy", "acc", { fmt: x => Math.round(x) + "%", tone: "good" })}${chart("Blunders per game", "bpg", { fmt: x => x.toFixed(1), tone: "bad", min: 0 })}${chart("Win chance thrown away per game", "lpg", { fmt: x => Math.round(x) + "", tone: "warn", min: 0 })}${chart("Score", "score", { fmt: x => Math.round(x) + "%", min: 0, max: 100 })}</div></section>
  <section><h2>Leak by leak: last ${cmp.k} games against the ${cmp.k} before</h2><p class="muted">Points of win chance lost per game. Down is good.</p>
  <div class="tbl"><table><thead><tr><th>Leak</th><th class="num">Before</th><th class="num">Now</th><th class="num">Change</th></tr></thead><tbody>${cats.map(r => `<tr><td>${CAT[r.c][0]}</td><td class="num">${r.was.toFixed(1)}</td><td class="num">${r.now.toFixed(1)}</td><td class="num">${delta(r.now, r.was, { lowerBetter: true })}</td></tr>`).join("")}</tbody></table></div></section>
  ${elo.length > 2 ? `<section><h2>Rating</h2>${lineChart(elo, { label: "Rating", fmt: x => Math.round(x) + "" })}</section>` : ""}`;
}
function insClock(S) {
  const ph = S.phase, t = S.time, order = ["opening", "middlegame", "endgame"].filter(k => ph[k]);
  const pm = Math.max(...Object.values(ph).map(x => x.lpg), 1);
  let time = `<p class="muted">These games have no clock data.</p>`;
  if (t) {
    const sm = Math.max(...Object.values(t.spent), 1), em = Math.max(t.errLow, t.errNorm, 1);
    time = `<div class="grid2"><div>
      ${bar("Errors in under 5 s", t.fastErrPct, 100, t.fastErrPct + "% of errors", "bad")}${bar("All moves under 5 s", t.fastMovePct, 100, t.fastMovePct + "% of moves")}
      ${bar("Games under 1 min", t.troubleGamesPct, 100, t.troubleGamesPct + "% of games", "warn")}${bar("Error rate, low clock", t.errLow, em, t.errLow + "%", "bad")}${bar("Error rate, normal", t.errNorm, em, t.errNorm + "%")}
    </div><div>${order.map(k => bar(cap(k), t.spent[k], sm, t.spent[k] + " s per move")).join("")}
      <p class="muted">You end games with ${t.finalPct}% of your time unused on average. Lost on time: ${t.timeouts}.</p></div></div>`;
  }
  const lm = Object.entries(S.lossMethods).sort((a, b) => b[1] - a[1]), lmMax = Math.max(1, ...lm.map(x => x[1]));
  const bp = Object.entries(S.blunderPieces).sort((a, b) => b[1] - a[1]), bpMax = Math.max(1, ...bp.map(x => x[1]));
  return `<section><h2>Your clock</h2>${time}</section>
  <section><h2>Phases of the game</h2><div class="grid2"><div><h3>Accuracy</h3>${order.map(k => bar(cap(k), ph[k].acc, 100, ph[k].acc + "%", "good")).join("")}</div>
    <div><h3>Win chance lost per game</h3>${order.map(k => bar(cap(k), ph[k].lpg, pm, ph[k].lpg + " pts", "warn")).join("")}</div></div></section>
  <section><h2>Winning positions</h2><p>You reached a clearly winning position (85% or better) in <b>${S.conv.winning}</b> games and won <b>${S.conv.converted}</b> of them.</p>
    ${S.conv.thrown.length ? `<div class="gamelist">${S.conv.thrown.slice(-8).reverse().map(g => `<a class="gamerow" href="#/game/${g.id}"><span class="dot ${g.color}"></span><span class="gr-opp"><b>${esc(g.opponent)}</b></span>${resultPill(g)}<span class="gr-acc">peak ${Math.round(g.maxWp)}%</span><span class="muted small gr-date">${fmtDate(g.ts)}</span></a>`).join("")}</div><p><button class="btn small" data-go="train/convert">Practice converting them</button></p>` : ""}</section>
  <section class="grid2"><div><h2>How you lose</h2>${lm.map(([k, x]) => bar(cap(k), x, lmMax, String(x))).join("") || `<p class="muted">No losses.</p>`}
    <h3 class="gap">Score by color</h3>${Object.entries(S.byColor).map(([c, x]) => bar(sideName(c), x.score, 100, `${x.score}% in ${x.games}`)).join("")}</div>
    <div><h2>Piece you blundered with</h2>${bp.map(([k, x]) => bar(cap(k), x, bpMax, String(x))).join("") || `<p class="muted">No blunders.</p>`}</div></section>`;
}
function insMindset(S) {
  const M = mindsetStats(S.games), overall = Math.round(100 * (S.wdl.win + S.wdl.draw / 2) / S.n);
  const row = (label, s) => s && s.n ? bar(label, s.score, 100, `${s.score}% score, ${s.acc}% acc, ${s.n} g`, s.n >= 5 && s.score <= overall - 10 ? "bad" : s.n >= 5 && s.score >= overall + 10 ? "good" : "") : "";
  const rules = [];
  const ok = s => s && s.n >= 6;
  if (ok(M.afterLoss) && overall - M.afterLoss.score >= 10) rules.push(`Right after a loss you score ${M.afterLoss.score}%, against ${overall}% overall. Rule: after a loss, take ten minutes away from the board before the next game.`);
  if (ok(M.after2Loss) && overall - M.after2Loss.score >= 12) rules.push(`After two losses in a row you score ${M.after2Loss.score}%. Rule: two losses ends the session.`);
  if (ok(M.idx4) && ok(M.idx1) && M.idx1.score - M.idx4.score >= 10) rules.push(`From your fourth game of a session on, you score ${M.idx4.score}%, against ${M.idx1.score}% in the first. Rule: stop after three games.`);
  const tod = [["morning", "the morning"], ["afternoon", "the afternoon"], ["evening", "the evening"], ["night", "late at night"]].filter(([k]) => ok(M[k])).sort((a, b) => M[b[0]].score - M[a[0]].score);
  if (tod.length >= 2 && M[tod[0][0]].score - M[tod[tod.length - 1][0]].score >= 12) rules.push(`You score ${M[tod[0][0]].score}% in ${tod[0][1]} and ${M[tod[tod.length - 1][0]].score}% ${tod[tod.length - 1][1]}. Play your rated games in ${tod[0][1]}.`);
  if (ok(M.higher) && M.higher.score - M.higher.expected >= 8) rules.push(`Against higher-rated players you score ${M.higher.score}%, when your rating predicts ${M.higher.expected}%. You are stronger than your rating says; don't play scared.`);
  if (ok(M.lower) && M.lower.expected - M.lower.score >= 8) rules.push(`Against lower-rated players you score ${M.lower.score}%, when your rating predicts ${M.lower.expected}%. These are points to collect: play them as carefully as anyone else.`);
  return `<section><p class="muted">How your results change with fatigue, tilt and timing. A session is a run of games less than 75 minutes apart; you average ${M.perSession} games per session. Your overall score is ${overall}%.</p>
  ${rules.length ? `<div class="rules"><h2>Rules worth adopting</h2><ul>${rules.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>` : `<p class="notice">No strong patterns yet. Rules appear here once a pattern shows up in at least six games.</p>`}</section>
  <section class="grid2"><div><h2>Within a session</h2>${row("First game", M.idx1)}${row("Second game", M.idx2)}${row("Third game", M.idx3)}${row("Fourth and later", M.idx4)}
    <h3 class="gap">The game before</h3>${row("Fresh start", M.fresh)}${row("After a win", M.afterWin)}${row("After a loss", M.afterLoss)}${row("After two losses", M.after2Loss)}</div>
  <div><h2>Time of day</h2>${row("Morning", M.morning)}${row("Afternoon", M.afternoon)}${row("Evening", M.evening)}${row("Late night", M.night)}
    <h3 class="gap">Day of week</h3>${row("Weekdays", M.weekday)}${row("Weekend", M.weekend)}</div></section>
  <section><h2>Who you play</h2>${["lower", "similar", "higher"].map(k => M[k] && M[k].n ? bar({ lower: "Lower rated", similar: "Similar", higher: "Higher rated" }[k], M[k].score, 100, `${M[k].score}% (rating predicts ${M[k].expected}%), ${M[k].n} g`, M[k].n >= 5 && M[k].score < M[k].expected - 8 ? "bad" : M[k].n >= 5 && M[k].score > M[k].expected + 8 ? "good" : "") : "").join("")}</section>`;
}

/* ---------------------------------------------------------------- openings */
App.ex = { color: "white", path: [] };
PAGES.openings = (v, S) => {
  const leaks = recurringLeaks(S.games), E = App.ex, X = explorer(S.games, E.color, E.path), H = S.habits;
  const fen = fenAfter(E.path);
  const crumbs = E.path.map((s, i) => `<button class="crumbmv" data-len="${i + 1}">${i % 2 === 0 ? (i / 2 + 1) + ". " : ""}${esc(s)}</button>`).join(" ");
  v.innerHTML = `<h1 class="page-title">Openings</h1>
  <section><h2>Mistakes you keep repeating</h2>
    ${leaks.length ? `<p class="muted">The same position, the same weak move, more than once. Fixing one of these fixes every future game that reaches it.</p><div class="leaks">${leaks.map((l, i) => `<article class="leak">${miniBoard(l.fen, l.color, { arrows: arrowsFor(l.uci, l.bestUci) })}<div><h3>Move ${l.move} as ${sideName(l.color)}, ${esc(l.opening)}</h3>
      <p>You've reached this position <b>${l.visits} times</b> and played <b class="bad-t">${esc(l.san)}</b> ${l.times} times. It costs about ${Math.round(l.avgLoss)} points of win chance each time${l.best ? `; <b class="good-t">${esc(l.best)}</b> is stronger` : ""}.</p>
      <div class="row"><button class="btn ghost small" data-leak="${i}">Open in explorer</button><a class="btn ghost small" href="#/game/${l.gid}/${l.ply + 1}">See the last game</a></div></div></article>`).join("")}</div>`
      : `<p class="muted">None found yet. This fills in once the same opening position shows up in several of your games.</p>`}</section>
  <section><h2>Your repertoire, move by move</h2><p class="muted">Every opening line from your own games. Click a move to follow it.</p>
    <div class="explorer"><div>${miniBoard(fen, E.color)}</div><div>
      <div class="chips"><button class="chip" aria-pressed="${E.color === "white"}" data-excolor="white">As White</button><button class="chip" aria-pressed="${E.color === "black"}" data-excolor="black">As Black</button></div>
      <p class="expath"><button class="crumbmv" data-len="0">Start</button> ${crumbs}</p>
      <p class="small muted">${plural(X.games.length, "game")} reached this position, ${X.score}% score. ${X.mine ? "Your move:" : "Your opponents play:"}</p>
      <div class="tbl"><table class="extable"><thead><tr><th>Move</th><th class="num">Games</th><th class="num">Your score</th><th class="num">${X.mine ? "Engine verdict" : "Your win chance after"}</th></tr></thead><tbody>
      ${X.rows.slice(0, 12).map(r => `<tr data-san="${esc(r.san)}" tabindex="0"><td><b>${esc(r.san)}</b></td><td class="num">${r.n}</td><td class="num">${r.score}%</td><td class="num">${X.mine ? `<span class="pill ${r.loss >= 8 ? "bad" : r.loss >= 4 ? "warn" : "good"}">${r.loss >= 4 ? "loses " + Math.round(r.loss) : "fine"}</span>` : `<span class="pill ${r.wp < 40 ? "bad" : r.wp > 60 ? "good" : ""}">${r.wp}%</span>`}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No games go further down this line.</td></tr>`}
      </tbody></table></div></div></div></section>
  <section><h2>Results by opening</h2><p class="muted">"After move 10" is your average win chance when the opening ends. Under 40% means you start the middlegame worse.</p>
    <div class="tbl"><table><thead><tr><th>Opening</th><th>Color</th><th class="num">Games</th><th class="num">Score</th><th class="num">After move 10</th></tr></thead><tbody>
    ${S.openings.slice(0, 20).map(o => { const refs = openingRefs(o.name); return `<tr><td>${esc(o.name)}${refs.length ? `<div class="small muted">${refs.map(([b, t]) => esc(BOOK[b].split(" (")[0] + ": " + t)).join("<br>")}</div>` : ""}</td><td>${sideName(o.color)}</td><td class="num">${o.games}</td><td class="num">${o.score}%</td><td class="num"><span class="pill ${o.exit < 40 ? "bad" : o.exit > 60 ? "good" : ""}">${Math.round(o.exit)}%</span></td></tr>`; }).join("")}</tbody></table></div></section>
  ${H ? `<section><h2>Opening habits</h2><p class="muted">Checked against the principles in How to Win at Chess (center, develop, castle), across ${H.n} games.</p><div class="grid2"><div>
    ${bar("Castled by move 10", H.castle, 100, H.castle + "% of games", H.castle < 60 ? "bad" : "good")}${bar("Queen out in moves 1-4", H.earlyQ, 100, H.earlyQ + "% of games", H.earlyQ > 25 ? "bad" : "good")}
    ${bar("Minor pieces out by 10", H.developed, 4, H.developed + " of 4", H.developed < 3 ? "bad" : "good")}${bar("Unforced repeat moves", H.repeats, 2, H.repeats + " per game", H.repeats > .6 ? "bad" : "good")}</div><div>${booksHTML(ASSIGN.habits)}</div></div></section>` : ""}`;
  $$("[data-excolor]", v).forEach(b => { b.onclick = () => { App.ex = { color: b.dataset.excolor, path: [] }; render(); }; });
  $$(".crumbmv", v).forEach(b => { b.onclick = () => { E.path = E.path.slice(0, +b.dataset.len); render(); }; });
  $$(".extable tr[data-san]", v).forEach(tr => { const f = () => { E.path = [...E.path, tr.dataset.san]; render(); }; tr.onclick = f; tr.onkeydown = e => { if (e.key === "Enter") f(); }; });
  $$("[data-leak]", v).forEach(b => { b.onclick = () => { const l = leaks[+b.dataset.leak]; App.ex = { color: l.color, path: [...l.path] }; render(); $(".explorer").scrollIntoView({ block: "center" }); }; });
};

/* ---------------------------------------------------------------- coach */
function weekPlan(S, tips) {
  const cats = tips.slice(0, 3), ref = t => (t && t.refs && t.refs[0] ? `${BOOK[t.refs[0][0]].split(" (")[0]}, ${t.refs[0][1]}` : null);
  const ref2 = t => (t && t.refs && t.refs[1] ? `${BOOK[t.refs[1][0]].split(" (")[0]}, ${t.refs[1][1]}` : null);
  const leaks = recurringLeaks(S.games), conv = S.conv.thrown.length >= 2, M = mindsetStats(S.games);
  const h = i => (cats[i] ? cats[i].title.toLowerCase() : "your pre-move routine");
  const stop = M.afterLoss && M.afterLoss.n >= 6 && M.afterLoss.score < 40 ? "Stop after one loss." : "Stop after three games or two losses.";
  return [
    ["Day 1", [`Today's session in Train.`, ref(cats[0]) ? `Read: ${ref(cats[0])}.` : `Blunder check, two rounds.`, `No games today; this day is for learning the top leak: ${h(0)}.`]],
    ["Day 2", [`Today's session.`, `Blunder check, two rounds.`, `Play 2 rapid games with one job: ${cats[0] ? cats[0].how.split(". ")[0] + "." : "run the four-step routine on every move."}`]],
    ["Day 3", [`Today's session.`, ref(cats[1]) ? `Read: ${ref(cats[1])}.` : `Review yesterday's games in Games.`, leaks[0] ? `Opening fix: open "Mistakes you keep repeating" and learn the better move in your ${leaks[0].opening} line (${leaks[0].best} instead of ${leaks[0].san}).` : `Review yesterday's two games move by move with "Next mistake".`]],
    ["Day 4", [`Today's session.`, conv ? `Convert the win: play out two positions against Stockfish until you hold them without a slip.` : `Blunder check, two rounds.`, `Play 2 rapid games. Focus: ${h(1)}.`]],
    ["Day 5", [`Today's session.`, ref(cats[2]) || ref2(cats[0]) ? `Read: ${ref(cats[2]) || ref2(cats[0])}.` : `Practice your worst leak in Train, Browse.`, (ref(cats[2]) || ref2(cats[0]) || "").startsWith("Logical Chess") ? `Blunder check, one round.` : `Logical Chess: play through one game, guessing each move before reading the note.`]],
    ["Day 6", [`Today's session before you play.`, `Play 3 rapid games. ${stop}`, `After each loss, open it in Games and find the one move you'd take back.`]],
    ["Day 7", [`Today's session.`, `Press "Get new games", then check Insights, Trends: are blunders per game going down?`, `Pick next week's top leak from Insights, Leaks.`]]
  ];
}
PAGES.coach = (v, S, tips) => {
  const plan = weekPlan(S, tips), M = mindsetStats(S.games), leaks = recurringLeaks(S.games);
  const extra = [
    `Trend (last games vs before): ${(() => { const c = recentVsPrev(S.games); return c ? `accuracy ${c.prev.acc}% -> ${c.recent.acc}%, blunders/game ${c.prev.bpg} -> ${c.recent.bpg}` : "not enough games"; })()}.`,
    M.afterLoss && M.afterLoss.n ? `Tilt: scores ${M.afterLoss.score}% right after a loss (${M.afterLoss.n} games); first game of a session ${M.idx1 ? M.idx1.score : "?"}%, fourth and later ${M.idx4 && M.idx4.n ? M.idx4.score + "%" : "n/a"}.` : "",
    leaks.length ? "Repeated opening mistakes: " + leaks.slice(0, 4).map(l => `move ${l.move} as ${l.color} in the ${l.opening}: played ${l.san} ${l.times}x, best ${l.best}`).join("; ") + "." : "",
    `Training tools available in the player's app: a daily spaced-repetition session of their own mistakes, "Blunder check" (safe-or-blunder quiz on their own moves), "Convert the win" (playing won positions against Stockfish), and move-by-move game review. Use these by name in the plan.`
  ].filter(Boolean).join("\n");
  const text = coachPrompt(S, tips).replace("\n\nBOOKS THE PLAYER OWNS", "\n" + extra + "\n\nBOOKS THE PLAYER OWNS");
  v.innerHTML = `<h1 class="page-title">Coach</h1>
  <section><h2>This week's plan</h2><p class="muted">Built from your three biggest leaks: ${tips.slice(0, 3).map(t => esc(t.title.toLowerCase())).join(", ")}. About 30 to 40 minutes a day. It updates as your numbers change.</p>
    <div class="plan">${plan.map(([d, items]) => `<div class="planday"><h3>${d}</h3><ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</div></section>
  <section><h2>Ask Claude for a deeper plan</h2><p class="muted">This copies your current numbers, trends, repeated opening mistakes and book list as a ready-made request. Paste it into a Claude chat to get a written two-week plan and to ask follow-up questions.</p>
    <div class="row"><button class="btn accent" id="copyCoach">Copy request</button><a class="btn ghost" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a><span class="muted small" id="copied" role="status"></span></div>
    <details><summary class="small">See what gets copied</summary><textarea readonly rows="14">${esc(text)}</textarea></details></section>
  <section><h2>Before every move</h2>${routineHTML()}</section>`;
  $("#copyCoach").onclick = async () => { $("#copied").textContent = (await copyText(text)) ? "Copied. Paste it into a new Claude chat." : "Couldn't copy. Open the box below and copy the text by hand."; };
};

boot();
