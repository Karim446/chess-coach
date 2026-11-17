"use strict";
/* Chess Coach 2 — board rendering and the interactive board */
const PIECE_SVG = {};
for (const [k, v] of Object.entries(window.PIECES)) PIECE_SVG[k] = v.replace(/\sid="[^"]*"/g, "").replace(/\sclass="[^"]*"/g, "");
const FILES = "abcdefgh";
const SQ_L = "#e6ece7", SQ_D = "#6c8f86", SQ_LS = "#f3df8e", SQ_DS = "#cdb04f", SQ_LL = "#d3dfb0", SQ_DL = "#8fa672";
const ARROW_BAD = "#c8452f", ARROW_GOOD = "#23805a", ARROW_ASK = "#2b5fa8";
const arrow = (uci, color) => uci ? { from: uci.slice(0, 2), to: uci.slice(2, 4), color } : null;
const arrowsFor = (played, best) => [arrow(played, ARROW_BAD), arrow(best, ARROW_GOOD)].filter(Boolean);

function boardSVG(fen, orient, o = {}) {
  const c = new Chess(fen), S = 45, flip = orient === "black";
  const xy = sq => { const f = FILES.indexOf(sq[0]), r = +sq[1] - 1; return flip ? [(7 - f) * S, r * S] : [f * S, (7 - r) * S]; };
  const isLight = sq => (FILES.indexOf(sq[0]) + +sq[1] - 1) % 2 === 1;
  const last = o.last || [];
  let out = `<svg class="board" viewBox="0 0 360 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(o.label || "Chess position")}">`;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = FILES[f] + (r + 1), [x, y] = xy(sq), light = isLight(sq);
    let fill = light ? SQ_L : SQ_D;
    if (o.selected === sq) fill = light ? SQ_LS : SQ_DS;
    else if (last.includes(sq)) fill = light ? SQ_LL : SQ_DL;
    out += `<rect data-sq="${sq}" x="${x}" y="${y}" width="${S}" height="${S}" fill="${fill}"/>`;
  }
  for (let i = 0; i < 8; i++) {
    const fileLbl = flip ? FILES[7 - i] : FILES[i], rankLbl = flip ? i + 1 : 8 - i;
    const bottomSq = fileLbl + (flip ? 8 : 1), leftSq = (flip ? "h" : "a") + rankLbl;
    out += `<text x="${i * S + 42}" y="357" font-size="8" font-weight="700" text-anchor="end" fill="${isLight(bottomSq) ? "#557168" : "#edf2ee"}" pointer-events="none">${fileLbl}</text>`;
    out += `<text x="2.5" y="${i * S + 10}" font-size="8" font-weight="700" fill="${isLight(leftSq) ? "#557168" : "#edf2ee"}" pointer-events="none">${rankLbl}</text>`;
  }
  if (c.inCheck()) {
    for (const row of c.board()) for (const p of row) if (p && p.type === "k" && p.color === c.turn()) {
      const [x, y] = xy(p.square); out += `<circle cx="${x + 22.5}" cy="${y + 22.5}" r="21" fill="rgba(200,69,47,.55)" pointer-events="none"/>`;
    }
  }
  for (const row of c.board()) for (const p of row) {
    if (!p) continue; const [x, y] = xy(p.square);
    out += `<g data-p="${p.square}" transform="translate(${x},${y})" pointer-events="none">${PIECE_SVG[p.color === "w" ? p.type.toUpperCase() : p.type]}</g>`;
  }
  for (const sq of (o.targets || [])) {
    const [x, y] = xy(sq);
    out += c.get(sq) ? `<circle class="tgt" cx="${x + 22.5}" cy="${y + 22.5}" r="20" fill="none" stroke="rgba(20,32,42,.4)" stroke-width="4" pointer-events="none"/>`
      : `<circle class="tgt" cx="${x + 22.5}" cy="${y + 22.5}" r="7" fill="rgba(20,32,42,.32)" pointer-events="none"/>`;
  }
  for (const a of (o.arrows || [])) {
    const [x1, y1] = xy(a.from), [x2, y2] = xy(a.to);
    const ax = x1 + 22.5, ay = y1 + 22.5, bx = x2 + 22.5, by = y2 + 22.5;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const ex = bx - ux * 14, ey = by - uy * 14, px = -uy, py = ux;
    out += `<g pointer-events="none" opacity=".88"><line x1="${ax + ux * 8}" y1="${ay + uy * 8}" x2="${ex}" y2="${ey}" stroke="${a.color}" stroke-width="7.5" stroke-linecap="round"/>` +
      `<polygon points="${bx},${by} ${ex + px * 10.5},${ey + py * 10.5} ${ex - px * 10.5},${ey - py * 10.5}" fill="${a.color}"/></g>`;
  }
  if (o.glyph && o.glyph.text) {
    const [x, y] = xy(o.glyph.sq), col = { blunder: "#c8452f", mistake: "#d07a1c", inaccuracy: "#b89412", best: "#23805a" }[o.glyph.cls] || "#55636c";
    const gx = Math.min(x + 39, 349), gy = Math.max(y + 6, 11);
    out += `<g pointer-events="none"><circle cx="${gx}" cy="${gy}" r="10" fill="${col}" stroke="#fff" stroke-width="1.5"/><text x="${gx}" y="${gy + 3.6}" font-size="10" font-weight="800" text-anchor="middle" fill="#fff">${esc(o.glyph.text)}</text></g>`;
  }
  return out + "</svg>";
}

/** Vertical evaluation bar. wpWhite is White's win chance (0-100). */
function evalBar(wpWhite, orient, label) {
  const w = clamp(wpWhite, 2, 98);
  return `<div class="evalbar ${orient === "black" ? "flip" : ""}" title="White's win chance: ${Math.round(wpWhite)}%" aria-hidden="true"><div class="evalbar-w" style="height:${w}%"></div><span class="evalbar-l ${wpWhite >= 50 ? "onw" : "onb"}">${esc(label || "")}</span></div>`;
}

/** Interactive board: click a piece then a square, or drag with a mouse. */
class IBoard {
  constructor(host) {
    this.host = host; this.s = { fen: new Chess().fen(), orient: "white" }; this.sel = null; this.targets = [];
    host.addEventListener("pointerdown", e => this.down(e));
  }
  set(state) { this.s = state; this.sel = null; this.targets = []; this.draw(); }
  update(patch) { Object.assign(this.s, patch); if ("fen" in patch) { this.sel = null; this.targets = []; } this.draw(); }
  draw() {
    this.host.innerHTML = boardSVG(this.s.fen, this.s.orient, { ...this.s, selected: this.sel, targets: this.targets });
    this.host.classList.toggle("live", !!this.s.movable);
  }
  squareAt(x, y) { const el = document.elementFromPoint(x, y), sq = el && el.closest ? el.closest("[data-sq]") : null; return sq && this.host.contains(sq) ? sq.dataset.sq : null; }
  down(e) {
    if (!this.s.movable || (e.button && e.button !== 0)) return;
    const sq = this.squareAt(e.clientX, e.clientY); if (!sq) return;
    const c = new Chess(this.s.fen);
    if (this.sel && this.targets.includes(sq)) return this.commit(this.sel, sq);
    const p = c.get(sq);
    if (p && p.color === c.turn() && (this.s.movable === true || this.s.movable === p.color)) {
      this.sel = sq; this.targets = c.moves({ square: sq, verbose: true }).map(m => m.to); this.draw();
      if (e.pointerType === "mouse") this.drag(e, sq, p);
    } else if (this.sel) { this.sel = null; this.targets = []; this.draw(); }
  }
  drag(e, sq, p) {
    const size = this.host.getBoundingClientRect().width / 8, sx = e.clientX, sy = e.clientY;
    let ghost = null;
    const move = ev => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) {
        ghost = document.createElement("div"); ghost.className = "dragpiece"; ghost.style.width = ghost.style.height = size + "px";
        ghost.innerHTML = `<svg viewBox="0 0 45 45">${PIECE_SVG[p.color === "w" ? p.type.toUpperCase() : p.type]}</svg>`;
        document.body.appendChild(ghost);
        const orig = this.host.querySelector(`[data-p="${sq}"]`); if (orig) orig.setAttribute("opacity", ".25");
      }
      if (ghost) { ghost.style.left = ev.clientX - size / 2 + "px"; ghost.style.top = ev.clientY - size / 2 + "px"; }
    };
    const up = ev => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      if (!ghost) return;
      ghost.remove();
      const to = this.squareAt(ev.clientX, ev.clientY);
      if (to && this.targets.includes(to)) this.commit(sq, to); else this.draw();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  commit(from, to) {
    this.sel = null; this.targets = [];
    const c = new Chess(this.s.fen); let m;
    try { m = c.move({ from, to, promotion: "q" }); } catch (e) { return this.draw(); }
    if (this.s.onMove) this.s.onMove(m, c);
  }
}
