"use strict";
/* Chess Coach 2 — app state, boot, router, chess.com sync, analysis runner, settings */
const App = {
  settings: { username: "", strength: "standard", months: 3, threads: "auto", autoSync: true, theme: "auto" },
  games: {}, srs: {}, activity: {}, bc: { seen: 0, right: 0 }, meta: { lastSync: 0, oldGames: 0 },
  pending: [], running: false, stop: false, syncing: false, onKey: null, _S: null, _dirty: true
};
const PAGES = {};
const gameList = () => Object.values(App.games).filter(g => g && g.v === ANALYSIS_VERSION);
function stats() {
  if (!App._S || App._dirty) { const S = aggregate(gameList()); S.tips = makeTips(S); App._S = S; App._dirty = false; }
  return App._S;
}
const saveSettings = () => DB.set("settings", App.settings);
const go = h => { if (location.hash === "#/" + h) render(); else location.hash = "#/" + h; };
function applyTheme() {
  const t = App.settings.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

async function boot() {
  await DB.open();
  const [settings, srs, activity, bc, meta, games] = await Promise.all([DB.get("settings"), DB.get("srs"), DB.get("activity"), DB.get("bc"), DB.get("meta"), DB.all("games")]);
  if (settings) Object.assign(App.settings, settings);
  if (srs) App.srs = srs; if (activity) App.activity = activity; if (bc) App.bc = bc; if (meta) Object.assign(App.meta, meta);
  for (const g of games) App.games[g.id] = g;
  if (!settings) migrateV1();
  applyTheme();
  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (App.onKey && App.onKey(e) === true) e.preventDefault();
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-go]"); if (t) { e.preventDefault(); go(t.dataset.go); }
  });
  $("#sync").onclick = () => syncGames();
  $("#pause").onclick = () => { App.stop = true; $("#pause").disabled = true; $("#syncline").textContent = "Pausing…"; };
  render();
  if (!DB.ok) toast("This browser is blocking storage, so nothing will be saved after you close the tab.");
  if (App.settings.autoSync && App.settings.username && Date.now() - (App.meta.lastSync || 0) > 10 * 60000) syncGames({ auto: true });
}
/** One-time carry-over from version 1 (localStorage): keep the username and drill progress. */
function migrateV1() {
  try {
    const s = JSON.parse(localStorage.getItem("cc:settings") || "null");
    if (s && s.username) { App.settings.username = s.username; if (s.months) App.settings.months = s.months; saveSettings(); }
    const d = JSON.parse(localStorage.getItem("cc:drills") || "null");
    if (d && d.d) {
      for (const [k, r] of Object.entries(d.d)) App.srs[k] = { box: r.solved ? 2 : 1, tries: r.tries || 1, right: r.solved ? 1 : 0, last: r.last || Date.now(), due: startOfDay(r.last || Date.now()) + (r.solved ? 3 : 1) * DAY };
      DB.set("srs", App.srs);
    }
    let old = 0;
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("cc:g_")) { old++; localStorage.removeItem(k); } }
    if (old) { App.meta.oldGames = old; DB.set("meta", App.meta); }
  } catch (e) { /* nothing to migrate */ }
}

/* ---------------------------------------------------------------- router */
function route() {
  const h = location.hash.replace(/^#\/?/, "") || "today";
  const [name, ...rest] = h.split("/");
  return { name, rest: rest.map(decodeURIComponent) };
}
let renderTimer = null;
function render() {
  clearTimeout(renderTimer);
  const r = route(), v = $("#view"), gl = gameList();
  App.onKey = null;
  $$("#nav a").forEach(a => { const on = a.dataset.nav === (r.name === "game" ? "games" : r.name === "play" ? "train" : r.name); if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  $("#who").textContent = App.settings.username ? `${App.settings.username}, ${plural(gl.length, "game")}` : "";
  setSync();
  if (r.name === "settings") return PAGES.settings(v);
  if (!gl.length) return renderOnboarding(v);
  const S = stats();
  (PAGES[r.name] || PAGES.today)(v, S, S.tips, r.rest);
}
/** Re-render after new data arrives, but never under someone's hands. */
function softRefresh() {
  const r = route();
  const quiet = ["today", "games", "insights", "openings", "coach"].includes(r.name) || !gameList().length || (r.name === "train" && !r.rest.length);
  if (!quiet) return;
  clearTimeout(renderTimer); renderTimer = setTimeout(render, 150);
}

/* ---------------------------------------------------------------- small render helpers */
const bar = (label, val, max, note, tone = "") => `<div class="bar"><span>${esc(label)}</span><span class="bar-t"><span class="bar-f ${tone}" style="width:${max > 0 ? Math.max(2, Math.min(100, 100 * val / max)).toFixed(1) : 0}%"></span></span><span class="bar-v">${esc(note)}</span></div>`;
const resultPill = g => `<span class="pill ${g.result === "win" ? "good" : g.result === "loss" ? "bad" : ""}">${g.result === "win" ? "Won" : g.result === "loss" ? "Lost" : "Draw"}</span>`;
const glyphCount = (n, cls, g) => n ? `<span class="gcount"><span class="gl ${cls}">${g}</span> ${n}</span>` : "";
const gameMarks = g => [glyphCount(gBlunders(g), "blunder", "??"), glyphCount(gMistakes(g), "mistake", "?")].filter(Boolean).join(" ") || `<span class="muted">clean</span>`;
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.round(m / 60)} h ago`; return `${Math.round(m / 1440)} d ago`;
}
const delta = (now, before, { lowerBetter = false, unit = "", digits = 1 } = {}) => {
  const d = now - before; if (Math.abs(d) < Math.pow(10, -digits) / 2) return `<span class="delta flat">no change</span>`;
  const good = lowerBetter ? d < 0 : d > 0;
  return `<span class="delta ${good ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(digits)}${unit}</span>`;
};
function lineChart(points, { min, max, fmt = v => v, label = "", tone = "" } = {}) {
  if (points.length < 2) return `<p class="muted small">Needs more games to chart.</p>`;
  const W = 520, H = 150, L = 42, R = 12, T = 12, B = 22, ys = points.map(p => p.y);
  let lo = min ?? Math.min(...ys), hi = max ?? Math.max(...ys);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * .12; if (min == null) lo -= pad; if (max == null) hi += pad;
  const X = i => L + i * (W - L - R) / (points.length - 1), Y = v => T + (hi - v) * (H - T - B) / (hi - lo);
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const grid = [lo, (lo + hi) / 2, hi].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="c-grid"/><text x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end" class="c-tick">${esc(fmt(v))}</text>`).join("");
  const dots = points.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="${i === points.length - 1 ? 4.5 : 3}" class="c-dot"><title>${esc(p.x)}: ${esc(fmt(p.y))}</title></circle>`).join("");
  return `<svg class="chart ${tone}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}: ${esc(fmt(ys[0]))} to ${esc(fmt(ys[ys.length - 1]))}">${grid}<path d="${d}" class="c-line"/>${dots}<text x="${L}" y="${H - 5}" class="c-tick">${esc(points[0].x)}</text><text x="${W - R}" y="${H - 5}" text-anchor="end" class="c-tick">${esc(points[points.length - 1].x)}</text></svg>`;
}
const miniBoard = (fen, orient, o) => `<div class="miniboard">${boardSVG(fen, orient, o)}</div>`;

/* ---------------------------------------------------------------- chess.com sync */
function queueGame(pgn, extra = {}, force = false) {
  const h = headersOf(pgn), lu = App.settings.username.toLowerCase();
  if (h.Variant || h.SetUp === "1" || !isRapid(h)) return "skip";
  if (![h.White, h.Black].some(x => (x || "").toLowerCase() === lu)) return "skip";
  const id = gameIdOf(h), have = App.games[id];
  if ((!force && have && have.v === ANALYSIS_VERSION) || App.pending.some(p => p.id === id)) return "have";
  App.pending.push({ id, pgn, url: extra.url || "", ts: extra.ts || gameTs(h) });
  return "new";
}
async function syncGames({ auto = false, force = false } = {}) {
  const u = (App.settings.username || "").trim();
  if (!u) { if (!auto) { go("settings"); toast("Enter your chess.com username first."); } return; }
  if (App.syncing || App.running) return;
  App.syncing = true; setSync("Checking chess.com…");
  let found = 0, added = 0;
  try {
    const arch = (await chessApi(`player/${encodeURIComponent(u.toLowerCase())}/games/archives`)).archives || [];
    const months = arch.slice(-Math.max(1, +App.settings.months)).reverse();
    for (let i = 0; i < months.length; i++) {
      setSync(`Downloading month ${i + 1} of ${months.length}…`);
      const data = await chessApi(months[i].split("/pub/")[1]);
      for (const g of data.games || []) {
        if (g.rules !== "chess" || g.time_class !== "rapid" || !g.pgn) continue;
        const r = queueGame(g.pgn, { url: g.url, ts: (g.end_time || 0) * 1000 }, force);
        if (r !== "skip") found++; if (r === "new") added++;
      }
    }
    App.meta.lastSync = Date.now(); DB.set("meta", App.meta);
    if (!found && !auto) toast(`No rapid games found for ${u} in the last ${plural(+App.settings.months, "month")}.`);
    else if (!added && !auto) toast("You're up to date. No new rapid games.");
    else if (added) toast(`${plural(added, "new game")} found. Analyzing now.`);
  } catch (e) {
    if (!auto) toast(e.message === "not_found" ? `chess.com has no player named "${u}".` : "Couldn't reach chess.com. Try again, or add PGN files in Settings.");
  } finally { App.syncing = false; }
  App.pending.sort((a, b) => b.ts - a.ts);
  setSync();
  if (App.pending.length) runAnalysis(); else softRefresh();
}
function addPgnText(text) {
  const pgns = splitPgns(text);
  if (!pgns.length) { toast("No games found in that file."); return; }
  if (!App.settings.username) {
    const cnt = {}; for (const p of pgns) { const h = headersOf(p); for (const n of [h.White, h.Black]) if (n) cnt[n] = (cnt[n] || 0) + 1; }
    App.settings.username = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0]; saveSettings();
  }
  let added = 0, have = 0;
  for (const p of pgns) { const r = queueGame(p); if (r === "new") added++; else if (r === "have") have++; }
  App.pending.sort((a, b) => b.ts - a.ts);
  toast(added + have ? `${plural(added + have, "rapid game")} found: ${added} new, ${have} already analyzed.` : `No rapid games for ${App.settings.username} in that file.`);
  if (App.pending.length) runAnalysis(); else render();
}

/* ---------------------------------------------------------------- analysis runner */
const progress = { game: 0, total: 0, step: 0, steps: 1, t0: 0, done: 0 };
function setSync(label) {
  const b = $("#sync"), l = $("#syncline"), barEl = $("#syncbar"), p = $("#pause"), f = $("#syncfill");
  if (!b) return;
  if (App.running) {
    const frac = progress.total ? clamp((progress.game - 1 + progress.step / progress.steps) / progress.total, 0, 1) : 0;
    const el = (performance.now() - progress.t0) / 1000, eta = frac > 0.03 ? el / frac - el : null;
    b.hidden = true; barEl.hidden = false; p.hidden = false; f.style.width = (100 * frac).toFixed(1) + "%";
    if (!App.stop) l.textContent = `Analyzing game ${Math.min(progress.game, progress.total)} of ${progress.total}${eta != null ? `, ${eta < 90 ? Math.max(5, Math.round(eta / 5) * 5) + " s" : Math.round(eta / 60) + " min"} left` : ""}`;
  } else {
    b.hidden = false; barEl.hidden = true; p.hidden = true; p.disabled = false;
    b.disabled = !!label || App.syncing;
    b.textContent = label || (App.pending.length ? `Analyze ${plural(App.pending.length, "game")}` : "Get new games");
    b.onclick = App.pending.length ? runAnalysis : () => syncGames();
    l.textContent = App.pending.length ? "Paused." : App.meta.lastSync ? `Checked ${ago(App.meta.lastSync)}` : "";
  }
  const live = $("#liveprog"); if (live) live.textContent = App.running ? l.textContent : "";
}
async function runAnalysis() {
  if (App.running || !App.pending.length) return;
  App.running = true; App.stop = false;
  const ms = STRENGTH[App.settings.strength] || 250, u = App.settings.username;
  Object.assign(progress, { game: 0, total: App.pending.length, step: 0, steps: 1, t0: performance.now(), done: 0 });
  setSync();
  try { await Engine.ensure(Engine.wanted()); }
  catch (e) { App.running = false; setSync(); toast("The chess engine couldn't start in this browser. Try the latest Chrome, Edge, Firefox or Safari."); return; }
  while (App.pending.length && !App.stop) {
    const job = App.pending[0];
    progress.game++; progress.step = 0;
    let res;
    try { res = await analyzeGame(job, u, ms, (s, n) => { progress.step = s; progress.steps = n; setSync(); }, () => App.stop); }
    catch (e) { console.warn("analysis failed", e); res = null; }
    if (res === "stopped") { progress.game--; break; }
    App.pending.shift();
    if (res) { App.games[res.id] = res; await DB.putGame(res); App._dirty = true; progress.done++; softRefresh(); }
  }
  App.running = false;
  toast(App.stop ? "Paused. Your progress is saved." : `Done. ${plural(progress.done, "game")} analyzed with ${Engine.name}.`);
  setSync(); softRefresh();
}

/* ---------------------------------------------------------------- onboarding */
function renderOnboarding(v) {
  const s = App.settings, busy = App.running || App.syncing;
  v.innerHTML = `<section class="onboard">
    <h1>See exactly what is costing you games.</h1>
    <p class="lede">Chess Coach downloads your rapid games from chess.com, checks every move with Stockfish in your browser, and turns your own mistakes into a daily training session.</p>
    ${App.meta.oldGames ? `<p class="notice">This version uses a much stronger engine and keeps more detail per game, so your ${plural(App.meta.oldGames, "earlier game")} will be analyzed again, once. Your username and solved positions carried over.</p>` : ""}
    <div class="panel onboard-form">
      <div class="row">
        <label class="f">Chess.com username<input type="text" id="ob-un" value="${esc(s.username)}" autocomplete="off" spellcheck="false" ${busy ? "disabled" : ""}></label>
        <label class="f">How far back<select id="ob-mo" ${busy ? "disabled" : ""}>${[1, 3, 6, 12].map(n => `<option value="${n}" ${+s.months === n ? "selected" : ""}>Last ${plural(n, "month")}</option>`).join("")}</select></label>
        <button class="btn accent" id="ob-go" ${busy ? "disabled" : ""}>${busy ? "Working…" : "Fetch and analyze my games"}</button>
      </div>
      <p class="small muted" id="liveprog" aria-live="polite"></p>
      <p class="small muted">Analysis runs on your device. Keep this tab open while it works; every finished game is saved, so you can pause and continue later.</p>
    </div>
    <p class="small"><a href="#/settings">Have PGN files instead? Add them in Settings.</a></p>
  </section>`;
  setSync();
  $("#ob-go").onclick = () => { s.username = $("#ob-un").value.trim(); s.months = +$("#ob-mo").value; saveSettings(); syncGames(); render(); };
  $("#ob-un").onkeydown = e => { if (e.key === "Enter") $("#ob-go").click(); };
}

/* ---------------------------------------------------------------- settings */
PAGES.settings = v => {
  const s = App.settings, gl = gameList(), cores = navigator.hardwareConcurrency || 2;
  v.innerHTML = `<h1 class="page-title">Settings</h1>
  <section class="panel"><h2>Your games</h2>
    <div class="row top">
      <label class="f">Chess.com username<input type="text" id="un" value="${esc(s.username)}" autocomplete="off" spellcheck="false"></label>
      <label class="f">How far back<select id="mo">${[1, 3, 6, 12, 24].map(n => `<option value="${n}" ${+s.months === n ? "selected" : ""}>Last ${plural(n, "month")}</option>`).join("")}</select></label>
      <label class="f check"><input type="checkbox" id="auto" ${s.autoSync ? "checked" : ""}> Check for new games when I open the site</label>
    </div>
    <p class="small muted">${gl.length ? `${plural(gl.length, "rapid game")} analyzed.` : "No games analyzed yet."} Only rapid games are used.</p>
  </section>
  <section class="panel"><h2>Analysis</h2>
    <div class="row top">
      <label class="f">Depth per position<select id="str"><option value="quick" ${s.strength === "quick" ? "selected" : ""}>Quick (0.12 s)</option><option value="standard" ${s.strength === "standard" ? "selected" : ""}>Standard (0.25 s)</option><option value="deep" ${s.strength === "deep" ? "selected" : ""}>Deep (0.6 s)</option></select></label>
      <label class="f">Engines running at once<select id="thr"><option value="auto">Automatic</option>${[1, 2, 3, 4, 6, 8].filter(n => n <= Math.max(2, cores)).map(n => `<option value="${n}" ${String(s.threads) === String(n) ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="f">Theme<select id="thm">${[["auto", "Match my device"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<option value="${k}" ${s.theme === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    </div>
    <p class="small muted">Engine: ${Engine.name || "Stockfish 18 (starts when needed)"}. More engines finish faster but use more battery and memory.</p>
    <p><button class="btn ghost small" id="redo" ${gl.length && !App.running ? "" : "disabled"}>Re-analyze all games at this depth</button></p>
  </section>
  <section class="panel"><h2>Add PGN files</h2>
    <p class="small muted">Use this if fetching from chess.com fails, or for games from somewhere else.</p>
    <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose PGN files"><p><strong>Drop .pgn files</strong> or click to choose</p></div>
    <input type="file" id="file" accept=".pgn,text/plain" multiple hidden>
    ${s.username ? `<details><summary class="small">Download links for your monthly archives</summary><div class="months">${monthLinks(s.username, 6).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener" download>${esc(l.label)}</a>`).join("")}</div></details>` : ""}
  </section>
  <section class="panel"><h2>Backup</h2>
    <p class="small muted">Everything is stored in this browser. Save a backup to move your analysis and training progress to another device, or to keep it safe.</p>
    <div class="row"><button class="btn ghost small" id="exp" ${gl.length ? "" : "disabled"}>Save backup file</button><button class="btn ghost small" id="imp">Load backup file</button><input type="file" id="impf" accept=".json,application/json" hidden>
    <button class="btn ghost small danger" id="wipe">Delete everything</button></div>
  </section>
  <div class="credits"><p>Chess Coach ${APP_VERSION}. Engine: Stockfish 18 via stockfish.js (GPLv3; license and source link in /engine). Move logic: chess.js (BSD). Pieces by Colin M.L. Burnett (CC BY-SA 3.0). Games come from the chess.com Published-Data API. Book assignments point to chapters in How to Win at Chess (Levy Rozman), Everyone's First Chess Workbook (Peter Giannatos) and Logical Chess: Move by Move (Irving Chernev). Mistake types are detected with rules, so a few labels will be off; the size of each mistake comes straight from the engine.</p></div>`;
  $("#thr").options[0].text = `Automatic (${(() => { const k = s.threads; s.threads = "auto"; const n = Engine.wanted(); s.threads = k; return n; })()} on this device)`;
  if (s.threads === "auto" || !s.threads) $("#thr").value = "auto";
  $("#un").onchange = e => { s.username = e.target.value.trim(); saveSettings(); render(); };
  $("#mo").onchange = e => { s.months = +e.target.value; saveSettings(); };
  $("#auto").onchange = e => { s.autoSync = e.target.checked; saveSettings(); };
  $("#str").onchange = e => { s.strength = e.target.value; saveSettings(); };
  $("#thr").onchange = e => { s.threads = e.target.value; saveSettings(); };
  $("#thm").onchange = e => { s.theme = e.target.value; saveSettings(); applyTheme(); };
  $("#redo").onclick = () => { if (confirm(`Re-analyze all ${gl.length} games at ${s.strength} depth? Games are downloaded again from chess.com.`)) syncGames({ force: true }); };
  const drop = $("#drop"), file = $("#file");
  const read = async files => { let text = ""; for (const f of files) text += "\n\n" + await f.text(); addPgnText(text); };
  drop.onclick = () => file.click();
  drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); read(e.dataTransfer.files); };
  file.onchange = () => read(file.files);
  $("#exp").onclick = () => {
    const data = { app: "chess-coach", version: 2, saved: new Date().toISOString(), settings: App.settings, srs: App.srs, activity: App.activity, bc: App.bc, games: gameList() };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `chess-coach-backup-${dayKey()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $("#imp").onclick = () => $("#impf").click();
  $("#impf").onchange = async e => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (d.app !== "chess-coach" || !Array.isArray(d.games)) throw new Error("bad");
      let n = 0;
      for (const g of d.games) if (g && g.id && g.v === ANALYSIS_VERSION) { App.games[g.id] = g; await DB.putGame(g); n++; }
      App.srs = { ...(d.srs || {}), ...App.srs }; App.activity = { ...(d.activity || {}), ...App.activity };
      if (d.settings && !App.settings.username) Object.assign(App.settings, d.settings);
      await Promise.all([DB.set("srs", App.srs), DB.set("activity", App.activity), saveSettings()]);
      App._dirty = true; toast(`Backup loaded: ${plural(n, "game")}.`); go("today");
    } catch (err) { toast("That file isn't a Chess Coach backup."); }
  };
  $("#wipe").onclick = async () => {
    if (!confirm("Delete all analyzed games and training progress from this browser? This can't be undone.")) return;
    await DB.clearAll(); App.games = {}; App.srs = {}; App.activity = {}; App.bc = { seen: 0, right: 0 }; App.pending = []; App.meta = { lastSync: 0, oldGames: 0 }; App._dirty = true;
    await saveSettings(); toast("Everything was deleted."); go("today");
  };
};
