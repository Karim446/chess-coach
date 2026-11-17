"use strict";
/* Chess Coach 2 — training: spaced-repetition session, blunder check, play it out against Stockfish */
let Drill = null, BC = null, Play = null;
const sideName = c => (c === "white" || c === "w" ? "White" : "Black");

PAGES.train = (v, S, tips, rest) => {
  const mode = rest[0];
  if (mode === "session") return startDrill(v, S, buildSession(S, tips), { title: "Today's session", session: true });
  if (mode === "browse") return renderBrowse(v, S, rest[1] || "all");
  if (mode === "drill" && Drill) return renderDrill(v);
  if (mode === "check") return startCheck(v, S);
  if (mode === "convert") return renderConvert(v, S);
  const c = srsCounts(S), conv = convertItems(S), thrown = conv.filter(x => x.thrown).length;
  const seg = (n, cls) => n ? `<span class="${cls}" style="flex:${n}"></span>` : "";
  const bcAcc = App.bc.seen ? Math.round(100 * App.bc.right / App.bc.seen) : null;
  v.innerHTML = `<h1 class="page-title">Train</h1>
  <p class="lede muted">Every position here comes from your own games.</p>
  <div class="modes">
    <article class="mode primary">
      <h2>Fix your mistakes</h2>
      <p>Replay the positions where you went wrong and find the move you should have played. Positions you solve come back after 1, 3, 7, 16 and 35 days until they stick.</p>
      <div class="srsbar" role="img" aria-label="${c.due} due, ${c.fresh} new, ${c.learning} learning, ${c.mastered} mastered">${seg(c.due, "due")}${seg(c.fresh, "new")}${seg(Math.max(0, c.learning - c.due), "learning")}${seg(c.mastered, "mastered")}</div>
      <p class="legend"><span><i class="due"></i>${c.due} due today</span><span><i class="new"></i>${c.fresh} new</span><span><i class="learning"></i>${Math.max(0, c.learning - c.due)} scheduled</span><span><i class="mastered"></i>${c.mastered} mastered</span></p>
      <div class="row"><button class="btn accent" data-go="train/session" ${c.due + c.fresh ? "" : "disabled"}>${c.due + c.fresh ? "Start today's session" : "Nothing due today"}</button><button class="btn ghost" data-go="train/browse">Browse all ${c.total}</button></div>
    </article>
    <article class="mode">
      <h2>Blunder check</h2>
      <p>You see a position and the move you were about to play. Decide in a few seconds: is it safe, or does it lose something? This trains the last look before you let go of a piece.</p>
      <p class="small muted">${bcAcc == null ? "Twelve quick positions, about two minutes." : `Your record: ${bcAcc}% right over ${App.bc.seen} positions.`}</p>
      <button class="btn" data-go="train/check">Start a round</button>
    </article>
    <article class="mode">
      <h2>Convert the win</h2>
      <p>Take a position you were winning and play it out against Stockfish. It punishes every loose move, and you can take back and try again.</p>
      <p class="small muted">${conv.length ? `${plural(conv.length, "winning position")} from your games${thrown ? `, ${thrown} of them thrown away` : ""}.` : "No winning positions found yet."}</p>
      <button class="btn" data-go="train/convert" ${conv.length ? "" : "disabled"}>Choose a position</button>
    </article>
  </div>`;
};

/* ---------------------------------------------------------------- browse */
function renderBrowse(v, S, cat) {
  const cats = [...new Set(S.errors.map(e => e.cat))];
  const list = S.errors.filter(e => cat === "all" || e.cat === cat).sort((a, b) => b.loss - a.loss);
  v.innerHTML = `<p class="crumb"><a href="#/train">Train</a></p><h1 class="page-title">All your mistakes</h1>
  <div class="chips" role="group" aria-label="Filter by type"><button class="chip" aria-pressed="${cat === "all"}" data-go="train/browse/all">All ${S.errors.length}</button>${cats.map(c => `<button class="chip" aria-pressed="${cat === c}" data-go="train/browse/${c}">${CAT_SHORT[c]} ${S.catCount[c]}</button>`).join("")}</div>
  <p><button class="btn accent" id="drillAll" ${list.length ? "" : "disabled"}>Practice these ${list.length}, worst first</button></p>
  <div class="grid-cards">${list.slice(0, 60).map((e, i) => {
    const r = App.srs[errKey(e)];
    return `<button class="poscard" data-i="${i}">${miniBoard(e.fen, e.color)}<span class="poscard-t"><b class="${e.cls}">${CAT_SHORT[e.cat]}</b><span class="muted small">Move ${e.n} vs ${esc(e.opp)}</span><span class="small ${r ? (r.box >= 5 ? "good-t" : "muted") : "warn-t"}">${r ? (r.box >= 5 ? "Mastered" : r.due <= Date.now() ? "Due" : "Scheduled") : "New"}</span></span></button>`;
  }).join("")}</div>${list.length > 60 ? `<p class="muted small">Showing the 60 most costly. Practice mode goes through all of them.</p>` : ""}`;
  $("#drillAll").onclick = () => startDrill(v, S, list, { title: cat === "all" ? "All mistakes" : CAT_SHORT[cat] });
  $$(".poscard", v).forEach(b => { b.onclick = () => startDrill(v, S, list.slice(+b.dataset.i), { title: cat === "all" ? "All mistakes" : CAT_SHORT[cat] }); });
}

/* ---------------------------------------------------------------- drill (find the better move) */
function startDrill(v, S, list, opts = {}) {
  if (!list.length) { v.innerHTML = `<div class="empty"><h2>You're caught up</h2><p class="muted">Nothing is due today and there are no new positions. Play some games, or try a blunder-check round.</p><div class="row center"><button class="btn" data-go="train/check">Blunder check</button><button class="btn ghost" data-go="train">Back to training</button></div></div>`; return; }
  Drill = { list: [...list], i: 0, title: opts.title || "Practice", session: !!opts.session, right: 0, graded: 0, redo: new Set(), st: null, total: list.length };
  if (route().rest[0] !== "drill") history.replaceState(null, "", "#/train/drill");
  renderDrill(v);
}
function renderDrill(v) {
  const D = Drill;
  if (D.i >= D.list.length) return renderDrillEnd(v);
  const e = D.list[D.i], key = errKey(e);
  if (!D.st || D.st.key !== key) D.st = { key, status: "ask", msg: "", hint: 0, graded: false, fen: e.fen, tryUci: null };
  v.innerHTML = `<div class="drillhead"><a href="#/train" class="back">Train</a><span class="drilltitle">${esc(D.title)}</span><div class="ptrack" aria-hidden="true"><div class="pfill" style="width:${(100 * D.i / D.list.length).toFixed(1)}%"></div></div><span class="muted small">${D.i + 1} of ${D.list.length}</span></div>
  <div class="stage"><div class="stage-board"><div id="dboard" class="boardhost"></div></div><div class="stage-side" id="dside"></div></div>`;
  const board = new IBoard($("#dboard"));
  const r0 = App.srs[key], kicker = r0 ? (r0.box >= 5 ? "Mastered position" : r0.due <= Date.now() ? `Review ${r0.tries + 1}` : "Scheduled position") : "New position";
  const paint = () => {
    const st = D.st, done = st.status === "right" || st.status === "answer";
    let arrows = [];
    if (st.status === "answer") arrows = arrowsFor(e.uci, e.best_uci);
    else if (st.tryUci) arrows = [arrow(st.tryUci, st.status === "right" ? ARROW_GOOD : st.status === "wrong" ? ARROW_BAD : ARROW_ASK)];
    else if (st.hint >= 2 && e.best_uci) arrows = [];
    board.set({
      fen: st.fen, orient: e.color, arrows, movable: st.status === "ask" || st.status === "wrong" ? (e.color === "white" ? "w" : "b") : false,
      last: st.hint >= 2 && !done ? [e.best_uci.slice(0, 2)] : [], label: `${sideName(e.color)} to move`,
      onMove: (m, c) => tryAnswer(m, c)
    });
    const meta = [e.clock != null ? `${fmtClock(e.clock)} on your clock` : "", e.spent != null ? `you spent ${Math.round(e.spent)} s` : ""].filter(Boolean).join(", ");
    const verdict = st.status === "right" ? `<div class="verdict ok" role="status"><h3>${esc(st.msg)}</h3><p>${esc(e.why)}</p><p>In the game you played <b class="bad-t">${esc(e.san)}</b>.</p>${e.line ? `<p class="line">Best line: ${esc(e.line)}</p>` : ""}</div>`
      : st.status === "wrong" ? `<div class="verdict no" role="status"><h3>${esc(st.msg)}</h3><p class="muted">Take another look, or show the answer.</p></div>`
        : st.status === "checking" ? `<div class="verdict" role="status"><p>Checking your move with Stockfish…</p></div>`
          : st.status === "answer" ? `<div class="verdict" role="status"><p>You played <b class="bad-t">${esc(e.san)}</b> (red). Stronger was <b class="good-t">${esc(e.best_san)}</b> (green).</p><p>${esc(e.why)}</p>${e.punish ? `<p class="line">After your move: ${esc(e.punish)}</p>` : ""}${e.line ? `<p class="line">Best line: ${esc(e.line)}</p>` : ""}<p class="small muted">Your win chance went from ${Math.round(e.wb)}% to ${Math.round(e.wa)}%.</p></div>` : "";
    const hint = st.hint && !done ? `<p class="hint">${st.hint >= 1 ? `Hint: this is a <b>${CAT_SHORT[e.cat].toLowerCase()}</b> position. ${esc(CAT[e.cat][2])}` : ""}${st.hint >= 2 ? ` The piece to move is highlighted.` : ""}</p>` : "";
    $("#dside").innerHTML = `<p class="kicker">${kicker} from your game vs ${esc(e.opp)}${e.date ? ", " + esc(e.date.replace(/\./g, "-")) : ""}</p>
      <h2>Move ${e.n}. You're ${sideName(e.color)}. ${done ? esc(CAT_SHORT[e.cat]) + "." : "What should you have played?"}</h2>
      <p class="muted">${esc(meta)}${meta ? "." : ""} ${done ? "" : "Run your routine: what does the last move threaten, then checks, captures and attacks."}</p>
      ${hint}${verdict}
      <div class="actions">
        ${done ? `<button class="btn accent" id="next">${D.i + 1 < D.list.length ? "Next position" : "Finish"}</button><button class="btn ghost" id="playit">Play it out vs Stockfish</button><a class="btn ghost" href="#/game/${e.gid}/${e.ply + 1}">See it in the game</a>`
        : `<button class="btn ghost" id="hintb" ${st.hint >= 2 ? "disabled" : ""}>${st.hint ? "Another hint" : "Hint"}</button><button class="btn ghost" id="reveal">Show answer</button><button class="btn ghost" id="skip">Skip</button>`}
      </div>
      <p class="keys small muted">${done ? "Enter: next" : "H: hint, A: answer"}</p>`;
    if ($("#next")) $("#next").onclick = next;
    if ($("#playit")) $("#playit").onclick = () => startPlay({ fen: e.fen, color: e.color, title: `Move ${e.n} vs ${e.opp}`, goal: e.wb >= 75 ? "convert" : "free", back: "train/drill" });
    if ($("#hintb")) $("#hintb").onclick = () => { st.hint++; paint(); };
    if ($("#reveal")) $("#reveal").onclick = () => { grade(false); st.status = "answer"; st.fen = e.fen; st.tryUci = null; paint(); };
    if ($("#skip")) $("#skip").onclick = () => { D.i++; D.st = null; renderDrill(v); };
  };
  const grade = ok => {
    const st = D.st; if (st.graded) return; st.graded = true;
    srsAnswer(key, ok && st.hint === 0); D.graded++; if (ok) D.right++;
    if (!ok && D.session && !D.redo.has(key)) { D.redo.add(key); D.list.push(e); }
  };
  const next = () => { D.i++; D.st = null; renderDrill(v); };
  const tryAnswer = async (m, c) => {
    const st = D.st, u = uciOf(m);
    st.fen = c.fen(); st.tryUci = u;
    if (u === e.best_uci) { st.status = "right"; st.msg = `${m.san} is the best move.`; grade(true); return paint(); }
    if (u === e.uci) { st.status = "wrong"; st.msg = `${m.san} is what you played in the game.`; grade(false); revert(); return paint(); }
    st.status = "checking"; paint();
    let r; try { r = await Engine.analyse(c.fen(), 500, { priority: true }); } catch (err) { r = null; }
    if (!Drill || Drill.st !== st) return;
    if (!r) { st.status = "wrong"; st.msg = "The engine couldn't check that move."; return paint(); }
    const loss = e.wb - winPct(e.color === "white" ? r.cp : -r.cp);
    if (loss <= 6) { st.status = "right"; st.msg = `${m.san} works too. The engine's first choice was ${e.best_san}.`; grade(true); }
    else { st.status = "wrong"; st.msg = `${m.san} costs about ${Math.round(loss)} points of win chance.`; grade(false); revert(); }
    paint();
  };
  // after a wrong try, show it briefly, then put the position back so the next try can start
  const revert = () => setTimeout(() => { const st = D.st; if (Drill === D && st && st.key === key && st.status === "wrong" && st.fen !== e.fen) { st.fen = e.fen; st.tryUci = null; paint(); } }, 1300);
  App.onKey = ev => {
    const st = D.st, done = st.status === "right" || st.status === "answer";
    if ((ev.key === "Enter" || ev.key === " " || ev.key === "ArrowRight") && done) { next(); return true; }
    if (ev.key.toLowerCase() === "h" && !done && st.hint < 2) { st.hint++; paint(); return true; }
    if (ev.key.toLowerCase() === "a" && !done) { $("#reveal").click(); return true; }
  };
  paint();
}
function renderDrillEnd(v) {
  const D = Drill, c = srsCounts(stats()), st = streak();
  v.innerHTML = `<div class="empty"><h1>${D.graded ? `${D.right} of ${D.graded} right` : "Session skipped"}</h1>
    <p class="lede">${D.graded - D.right > 0 ? `${plural(D.graded - D.right, "position")} will come back tomorrow. ` : D.graded ? "Clean round. " : ""}${c.due ? `${c.due} more due today.` : "Nothing else is due today."}</p>
    ${st ? `<p class="muted">${plural(st, "day")} in a row with training.</p>` : ""}
    <div class="row center">${c.due + c.fresh ? `<button class="btn accent" data-go="train/session">Another round</button>` : ""}<button class="btn" data-go="train/check">Blunder check</button><button class="btn ghost" data-go="today">Done for now</button></div></div>`;
  Drill = null;
}

/* ---------------------------------------------------------------- blunder check */
function startCheck(v, S) {
  const items = blunderCheckItems(S, 12);
  if (items.length < 4) { v.innerHTML = `<div class="empty"><h2>Not enough positions yet</h2><p class="muted">Blunder check needs a few more analyzed games.</p><button class="btn ghost" data-go="train">Back to training</button></div>`; return; }
  BC = { items, i: 0, right: 0, answered: null, t0: 0 };
  renderCheck(v);
}
function renderCheck(v) {
  const B = BC;
  if (B.i >= B.items.length) {
    v.innerHTML = `<div class="empty"><h1>${B.right} of ${B.items.length} right</h1><p class="lede">${B.right >= B.items.length - 1 ? "Sharp. Bring the same look to every move in your next game." : "Each miss is a move you would have played. Slow down on captures and on moves into enemy territory."}</p>
      <p class="muted">Lifetime: ${Math.round(100 * App.bc.right / Math.max(1, App.bc.seen))}% over ${App.bc.seen} positions.</p>
      <div class="row center"><button class="btn accent" data-go="train/check">Another round</button><button class="btn ghost" data-go="train">Back to training</button></div></div>`;
    BC = null; return;
  }
  const it = B.items[B.i], done = B.answered != null, correct = done && B.answered === it.safe;
  const c = new Chess(it.fen);
  let fen = it.fen, arrows = [arrow(it.uci, ARROW_ASK)], last = [];
  if (done && !it.safe) arrows = [arrow(it.uci, ARROW_BAD)];
  if (done && it.safe) arrows = [arrow(it.uci, ARROW_GOOD)];
  v.innerHTML = `<div class="drillhead"><a href="#/train" class="back">Train</a><span class="drilltitle">Blunder check</span><div class="ptrack" aria-hidden="true"><div class="pfill" style="width:${(100 * B.i / B.items.length).toFixed(1)}%"></div></div><span class="muted small">${B.i + 1} of ${B.items.length}, ${B.right} right</span></div>
  <div class="stage"><div class="stage-board"><div class="boardhost">${boardSVG(fen, it.color, { arrows, last, label: "Candidate move " + it.san })}</div></div>
  <div class="stage-side">
    <p class="kicker">Move ${it.n}, you're ${sideName(it.color)}</p>
    <h2>You're about to play ${esc(it.san)}. Is it safe?</h2>
    <p class="muted">Look at what your opponent can do right after it: every check, every capture, every attack.</p>
    ${done ? `<div class="verdict ${correct ? "ok" : "no"}" role="status"><h3>${correct ? "Right." : "Not this time."} ${it.safe ? `${esc(it.san)} was safe.` : `${esc(it.san)} was a blunder.`}</h3>
      ${it.safe ? `<p>Stockfish has no objection to it. ${correct ? "" : "Seeing ghosts costs time; trust the check once you've done it."}</p>` : `<p>${esc(it.why)}</p>${it.punish ? `<p class="line">Punished by: ${esc(it.punish)}</p>` : ""}<p>Better was <b class="good-t">${esc(it.best)}</b>.</p>`}</div>
      <div class="actions"><button class="btn accent" id="bcnext">${B.i + 1 < B.items.length ? "Next" : "See result"}</button><a class="btn ghost" href="#/game/${it.gid}/${it.ply + 1}">See it in the game</a></div><p class="keys small muted">Enter: next</p>`
      : `<div class="actions big"><button class="btn safe" id="bcsafe">Safe</button><button class="btn danger" id="bcbad">Blunder</button></div><p class="keys small muted">S: safe, B: blunder</p>`}
  </div></div>`;
  void c;
  const answer = safe => { B.answered = safe; if (safe === it.safe) { B.right++; App.bc.right++; } App.bc.seen++; DB.set("bc", App.bc); logActivity("b", 1); renderCheck(v); };
  const next = () => { B.i++; B.answered = null; renderCheck(v); };
  if (done) $("#bcnext").onclick = next; else { $("#bcsafe").onclick = () => answer(true); $("#bcbad").onclick = () => answer(false); }
  App.onKey = ev => {
    const k = ev.key.toLowerCase();
    if (!done && k === "s") { answer(true); return true; }
    if (!done && k === "b") { answer(false); return true; }
    if (done && (ev.key === "Enter" || ev.key === " " || ev.key === "ArrowRight")) { next(); return true; }
  };
}

/* ---------------------------------------------------------------- convert the win: position list */
function renderConvert(v, S) {
  const items = convertItems(S);
  v.innerHTML = `<p class="crumb"><a href="#/train">Train</a></p><h1 class="page-title">Convert the win</h1>
  <p class="lede muted">You were clearly winning in each of these. Play it out against Stockfish and keep control for 15 moves, or deliver mate.</p>
  <div class="grid-cards">${items.slice(0, 40).map((it, i) => `<button class="poscard" data-i="${i}">${miniBoard(it.fen, it.color)}<span class="poscard-t"><b class="${it.thrown ? "bad-t" : ""}">${it.thrown ? (it.result === "draw" ? "Drawn from here" : "Lost from here") : "Won in the game"}</b><span class="muted small">Move ${it.n} vs ${esc(it.opp)}</span><span class="small muted">${it.wp}% win chance</span></span></button>`).join("")}</div>`;
  $$(".poscard", v).forEach(b => { b.onclick = () => { const it = items[+b.dataset.i]; startPlay({ fen: it.fen, color: it.color, title: `Move ${it.n} vs ${it.opp}`, goal: "convert", back: "train/convert" }); }; });
}

/* ---------------------------------------------------------------- play it out against Stockfish */
function startPlay(o) {
  Play = { start: o.fen, color: o.color === "white" || o.color === "w" ? "w" : "b", title: o.title || "Practice position", goal: o.goal || "free", back: o.back || "train",
    hist: [], fen: o.fen, pre: null, cp: null, busy: false, feedback: null, slips: 0, over: null, id: Math.random() };
  go("play");
}
PAGES.play = v => {
  const P = Play;
  if (!P) { go("train"); return; }
  const orient = P.color === "w" ? "white" : "black";
  v.innerHTML = `<div class="drillhead"><a href="#/${P.back}" class="back">Back</a><span class="drilltitle">${esc(P.title)}</span><span class="muted small">${P.goal === "convert" ? "Goal: mate, or stay winning for 15 moves" : "Free play against Stockfish"}</span></div>
  <div class="stage"><div class="stage-board"><div class="withbar"><div id="pbar"></div><div id="pboard" class="boardhost"></div></div></div><div class="stage-side" id="pside"></div></div>`;
  const board = new IBoard($("#pboard"));
  const myWp = cp => winPct(P.color === "w" ? cp : -cp);
  const myMoves = () => P.hist.filter(h => h.mine).length;
  const paint = () => {
    const c = new Chess(P.fen), myTurn = c.turn() === P.color && !P.over && !P.busy;
    const lastM = P.hist[P.hist.length - 1];
    board.set({ fen: P.fen, orient, movable: myTurn ? P.color : false, last: lastM ? [lastM.from, lastM.to] : [], onMove: (m, c2) => onMove(m, c2), label: "Practice position" });
    $("#pbar").innerHTML = P.cp == null ? evalBar(50, orient, "") : evalBar(winPct(P.cp), orient, barLabel(P.cp));
    const fb = P.feedback;
    const fbHtml = !fb ? "" : fb.loss >= MISTAKE ? `<div class="verdict no" role="status"><h3>${esc(fb.san)} let it slip.</h3><p>It costs about ${Math.round(fb.loss)} points of win chance. ${fb.best ? `Stronger was <b class="good-t">${esc(fb.best)}</b>.` : ""}</p><button class="btn small" id="tb2">Take it back and try again</button></div>`
      : `<div class="verdict ${fb.loss < INACC ? "ok" : ""}" role="status"><p><b>${esc(fb.san)}</b> ${fb.loss < 1 ? "is the engine's choice." : fb.loss < INACC ? "is fine." : `is a little loose (${Math.round(fb.loss)} points). ${fb.best ? `${esc(fb.best)} was cleaner.` : ""}`}</p></div>`;
    const moves = []; { const t = new Chess(P.start); let line = ""; P.hist.forEach((h, i) => { const num = t.moveNumber(), w = t.turn() === "w"; line += (w ? `${num}. ` : i === 0 ? `${num}... ` : "") + h.san + " "; t.move(h.san); }); moves.push(line.trim()); }
    const overHtml = P.over ? `<div class="verdict ${P.over.ok ? "ok" : "no"}" role="status"><h3>${esc(P.over.title)}</h3><p>${esc(P.over.text)}</p></div>` : "";
    $("#pside").innerHTML = `<p class="kicker">You're ${sideName(P.color)} against Stockfish</p>
      <h2>${P.over ? "Finished" : P.busy ? "Stockfish is thinking…" : "Your move"}</h2>
      ${P.goal === "convert" && !P.over ? `<p class="muted">Moves held: ${Math.min(15, myMoves())} of 15${P.slips ? `, ${plural(P.slips, "slip")}` : ""}. Win chance now: ${P.cp == null ? "…" : Math.round(myWp(P.cp)) + "%"}.</p>` : `<p class="muted">Win chance: ${P.cp == null ? "…" : Math.round(myWp(P.cp)) + "%"}.</p>`}
      ${overHtml}${P.over ? "" : fbHtml}
      <p class="line movelist">${esc(moves[0] || "")}</p>
      <div class="actions"><button class="btn ghost" id="tb" ${P.hist.length && !P.busy ? "" : "disabled"}>Take back</button><button class="btn ghost" id="rs" ${P.hist.length && !P.busy ? "" : "disabled"}>Restart</button><a class="btn ghost" href="https://lichess.org/analysis/standard/${esc(P.fen.replace(/ /g, "_"))}" target="_blank" rel="noopener">Analyze on Lichess</a></div>`;
    $("#tb").onclick = takeBack; $("#rs").onclick = restart; if ($("#tb2")) $("#tb2").onclick = takeBack;
  };
  const alive = id => Play && Play.id === id && route().name === "play";
  const prep = async () => {
    const id = P.id, fen = P.fen;
    P.pre = Engine.analyse(fen, 500, { priority: true }).catch(() => null);
    const r = await P.pre;
    if (alive(id) && r && P.fen === fen) { P.cp = r.cp; if (!P.busy) paint(); }
  };
  const takeBack = () => {
    if (P.busy || !P.hist.length) return;
    while (P.hist.length && !P.hist[P.hist.length - 1].mine) P.hist.pop();
    P.hist.pop();
    const t = new Chess(P.start); for (const h of P.hist) t.move(h.san);
    P.fen = t.fen(); P.over = null; P.feedback = null; paint(); prep();
  };
  const restart = () => { P.hist = []; P.fen = P.start; P.over = null; P.feedback = null; P.slips = 0; P.cp = null; paint(); prep(); };
  const finish = c => {
    if (c.isCheckmate()) return { ok: c.turn() !== P.color, title: c.turn() !== P.color ? "Checkmate. Converted." : "You got mated.", text: c.turn() !== P.color ? "That is how to finish it." : "Take back a few moves and find where the king got exposed." };
    if (c.isDraw() || c.isStalemate()) return { ok: false, title: "Drawn.", text: c.isStalemate() ? "Stalemate. When you are far ahead, always leave the enemy king a move." : "The win slipped into a draw. Take back and look for a more direct plan." };
    return null;
  };
  const onMove = async (m, c) => {
    const id = P.id;
    P.busy = true; P.hist.push({ san: m.san, from: m.from, to: m.to, mine: true }); P.fen = c.fen(); P.feedback = null; paint();
    const pre = await P.pre;
    let end = finish(c), post = null;
    if (!end) { try { post = await Engine.analyse(c.fen(), 600, { priority: true }); } catch (e) { post = null; } }
    if (!alive(id)) return;
    if (pre && (post || end)) {
      const after = end ? (end.ok ? 100 : 50) : myWp(post.cp);
      let loss = Math.max(0, myWp(pre.cp) - after);
      if (pre.pv[0] === uciOf(m)) loss = 0;
      const t = new Chess(m.before), b = pre.pv[0] ? tryMove(t, pre.pv[0]) : null;
      P.feedback = { san: m.san, loss, best: b && b.san !== m.san ? b.san : "" };
      if (loss >= MISTAKE) P.slips++;
    }
    if (post) P.cp = post.cp;
    if (!end && post && post.pv[0]) {
      await sleep(250);
      if (!alive(id)) return;
      const reply = tryMove(c, post.pv[0]);
      if (reply) { P.hist.push({ san: reply.san, from: reply.from, to: reply.to, mine: false }); P.fen = c.fen(); end = finish(c); }
    }
    if (!end && P.goal === "convert" && myMoves() >= 15 && P.cp != null && myWp(P.cp) >= 80) end = { ok: true, title: "Converted.", text: `You kept control for 15 moves${P.slips ? ` with ${plural(P.slips, "slip")}` : " without a single slip"}. Keep playing if you want to finish the mate.`, soft: true };
    if (end) { P.over = end; logActivity("p", 1); if (end.soft) { P.goal = "free"; } }
    P.busy = false;
    if (P.over && P.over.soft) { const o = P.over; P.over = null; paint(); const side = $("#pside"); side.insertAdjacentHTML("afterbegin", `<div class="verdict ok" role="status"><h3>${esc(o.title)}</h3><p>${esc(o.text)}</p></div>`); prep(); return; }
    paint(); if (!P.over) prep();
  };
  paint(); prep();
};
