'use strict';
/* ============================================================================
 * app.js — state, rendering and interaction for the pod tracker.
 * Reads everything configurable from config.js.
 * ==========================================================================*/

const STORAGE_KEY = 'pod-tracker-v1';
const LONG_PRESS_MS = 500;     // hold this long to change by 10
const LONG_PRESS_STEP = 10;
const MOVE_TOLERANCE = 12;     // px of finger drift still counts as a tap
const CARD_MARGIN = 12;        // gap between a card and its grid cell

/* ---- small DOM helpers --------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}
const counterType = (id) => COUNTER_TYPES.find(t => t.id === id);
const paletteFor = (type) => {
  const t = counterType(type);
  return t && t.palette === 'mana' ? MANA_COLORS : t && t.palette === 'counter' ? COUNTER_COLORS : null;
};
/* pick black or white text for legibility on a given background colour */
function textOn(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111' : '#fff';
}
/* display label for a counter, e.g. "Red mana", "Pink counter", "Poison" */
function counterLabel(ct) {
  const t = counterType(ct.type);
  if (ct.label && t.palette === 'mana') return ct.label + ' mana';
  if (ct.label && t.palette === 'counter') return ct.label + ' counter';
  return t.label;
}

/* ---- state --------------------------------------------------------------- */
let state = loadState() || freshState(4);
let cards = [];                // per-seat DOM refs, rebuilt on layout change

function freshState(count) {
  const life = 40;
  return {
    playerCount: count,
    layoutId: LAYOUTS[count][0].id,
    startingLife: life,
    monarchOn: false,          // whether the monarch is in the game at all
    monarch: null,             // player index that holds the crown, or null
    players: Array.from({ length: count }, (_, i) => newPlayer(i, life)),
    planechase: { active: false, order: [], pos: 0, rot: 0 },
    timer: { on: false, matchStart: Date.now(), edge: 'bottom', along: 0.5, sec: null },
    menu: { x: 0.5, y: 0.5 },   // pod-fraction position of the centre button
  };
}
function newPlayer(i, life) {
  return {
    name: 'P' + (i + 1),
    life,
    counters: [],              // [{ type, value }]
    overlay: null,             // null | {kind:'menu'} | {kind:'counter', idx}
    commander: null,           // null | { name, art }
  };
}
function currentLayout() {
  const list = LAYOUTS[state.playerCount] || [];
  return list.find(l => l.id === state.layoutId) || list[0];
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!s || !LAYOUTS[s.playerCount]) return null;
    if (!LAYOUTS[s.playerCount].some(l => l.id === s.layoutId))
      s.layoutId = LAYOUTS[s.playerCount][0].id;
    s.players.forEach(p => {
      p.overlay = null;
      if (!('commander' in p)) p.commander = null;
      // migrate old counters ({type,value}) to the colour-aware model
      p.counters = (p.counters || []).reduce((out, ct) => {
        if (ct.type === 'any') ct.type = 'counter';
        const t = counterType(ct.type);
        if (!t) return out;                              // unknown type → drop
        if (t.palette && !ct.color) return out;          // colour types need a colour → drop
        if (!ct.color) ct.color = t.color;
        out.push(ct);
        return out;
      }, []);
    });
    if (!s.planechase) s.planechase = { active: false, order: [], pos: 0, rot: 0 };
    if (s.planechase.rot == null) s.planechase.rot = 0;
    if (!s.timer) s.timer = { on: false, matchStart: Date.now(), edge: 'bottom', along: 0.5, sec: null };
    if (!s.menu) s.menu = { x: 0.5, y: 0.5 };
    if (s.monarchOn === undefined) s.monarchOn = (s.monarch != null);   // keep an in-progress monarch
    return s;
  } catch (e) { return null; }
}

/* ---- references ---------------------------------------------------------- */
const podEl = $('#pod');
const centerBtn = $('#pod-center');
const monarchEl = $('#monarch');
const pcEl = $('#planechase');
const planeCardEl = $('#plane-card');
const planeImgEl = $('#plane-img');
const diePopupEl = $('#die-popup');
const timerEl = $('#match-timer');
const tMainEl = $('.t-main', timerEl);
const tSecEl = $('.t-sec', timerEl);

/* ============================================================================
 * Build the pod (called on first load and whenever count/layout changes)
 * ==========================================================================*/
function rebuild() {
  podEl.querySelectorAll('.seat').forEach(s => s.remove());
  cards = [];

  const layout = currentLayout();
  podEl.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
  podEl.style.gridTemplateRows = `repeat(${layout.rows}, 1fr)`;

  layout.seats.forEach((seat, i) => {
    const wrap = el('div', 'seat');
    wrap.style.gridColumn = `${seat.c} / span ${seat.cs || 1}`;
    wrap.style.gridRow = `${seat.r} / span ${seat.rs || 1}`;

    const card = el('div', 'card');
    card.style.setProperty('--c', PALETTE[i % PALETTE.length]);

    // tap zones (behind everything). left = minus, right = plus.
    const left = el('div', 'zone left');
    left.appendChild(el('span', 'glyph', '−'));
    const right = el('div', 'zone right');
    right.appendChild(el('span', 'glyph', '+'));

    const name = el('div', 'name', state.players[i].name);
    const life = el('div', 'life');

    const opts = el('button', 'opts', '⋯');
    opts.addEventListener('click', (e) => { e.stopPropagation(); openCardMenu(i); });

    const counters = el('div', 'counters');
    const overlay = el('div', 'overlay');

    card.append(left, right, life, name, opts, counters, overlay);
    wrap.appendChild(card);
    podEl.appendChild(wrap);

    const ref = { seat, wrap, card, life, name, counters, overlay };
    cards.push(ref);

    // life adjusters: closures capture player index i
    attachAdjuster(left, -1, (amt) => changeLife(i, amt));
    attachAdjuster(right, +1, (amt) => changeLife(i, amt));
  });

  sizeCards();
  renderAll();
  reSnapMenuForLayout();   // re-snap the menu to a seam of the new layout (also places monarch + timer)
}

/* size each card to its cell, swapping width/height for 90°/270° rotation */
function sizeCards() {
  cards.forEach(c => {
    const w = c.wrap.clientWidth - CARD_MARGIN;
    const h = c.wrap.clientHeight - CARD_MARGIN;
    const rot = ((c.seat.rot % 360) + 360) % 360;
    const swap = (rot === 90 || rot === 270);
    c.card.style.width = (swap ? h : w) + 'px';
    c.card.style.height = (swap ? w : h) + 'px';
    c.card.style.transform = `translate(-50%, -50%) rotate(${c.seat.rot}deg)`;
  });
}

/* ============================================================================
 * Rendering (targeted — never rebuilds nodes mid-gesture)
 * ==========================================================================*/
function renderAll() {
  state.players.forEach((_, i) => { renderLife(i); renderName(i); renderCounters(i); renderCommander(i); renderOverlay(i); });
}
function renderLife(i) {
  const c = cards[i]; if (!c) return;
  c.life.textContent = state.players[i].life;
  c.life.classList.toggle('low', state.players[i].life <= 5);
}
function renderName(i) {
  if (cards[i]) cards[i].name.textContent = state.players[i].name;
}
/* commander artwork as the card background (with a dim overlay via CSS) */
function renderCommander(i) {
  const c = cards[i]; if (!c) return;
  const cmd = state.players[i].commander;
  if (cmd && cmd.art) {
    c.card.classList.add('has-art');
    c.card.style.backgroundImage = `url("${cmd.art}")`;
  } else {
    c.card.classList.remove('has-art');
    c.card.style.backgroundImage = '';
  }
}
function renderCounters(i) {
  const c = cards[i]; if (!c) return;
  const box = c.counters;
  box.textContent = '';
  state.players[i].counters.forEach((ct, idx) => {
    const color = counterColor(ct);
    const dot = el('div', 'counter-dot');
    dot.style.background = color;
    dot.style.color = textOn(color);
    dot.title = counterLabel(ct);
    dot.append(
      Object.assign(el('span', 'cd-icon'), { textContent: counterType(ct.type).icon }),
      Object.assign(el('span', 'cd-count'), { textContent: ct.value })
    );
    dot.addEventListener('click', (e) => { e.stopPropagation(); openCounter(i, idx); });
    box.appendChild(dot);
  });
}
const counterColor = (ct) => ct.color || counterType(ct.type).color;

/* The in-card overlay shows either the options menu or an expanded counter. */
function renderOverlay(i) {
  const c = cards[i]; if (!c) return;
  const p = state.players[i];
  const ov = c.overlay;
  ov.textContent = '';

  if (!p.overlay) { ov.classList.remove('show'); return; }
  ov.classList.add('show');

  const close = el('button', 'ov-close', '✕');
  close.addEventListener('click', (e) => { e.stopPropagation(); p.overlay = null; renderOverlay(i); });

  if (p.overlay.kind === 'counter') {
    const ct = p.counters[p.overlay.idx];
    if (!ct) { p.overlay = null; ov.classList.remove('show'); return; }
    const color = counterColor(ct);
    ov.style.setProperty('--cc', color);

    const left = el('div', 'zone left');  left.appendChild(el('span', 'glyph', '−'));
    const right = el('div', 'zone right'); right.appendChild(el('span', 'glyph', '+'));
    const title = el('div', 'ov-title', counterType(ct.type).icon + '  ' + counterLabel(ct));
    const value = el('div', 'ov-value', ct.value);

    ov.append(left, right, title, value, close);

    // adjusters update the value node directly (no re-render during the gesture)
    const apply = (amt) => {
      ct.value = Math.max(0, ct.value + amt);
      value.textContent = ct.value;
      renderCounters(i);
      saveState();
    };
    attachAdjuster(left, -1, apply);
    attachAdjuster(right, +1, apply);

  } else if (p.overlay.kind === 'picker') {
    // radial colour picker for a "mana" or "counter" type
    const type = p.overlay.type;
    const t = counterType(type);
    const palette = paletteFor(type) || [];
    const used = new Set(p.counters.filter(x => x.type === type).map(counterColor));

    const wrap = el('div', 'color-picker');
    const center = el('div', 'picker-center');
    center.append(Object.assign(el('div', 'pc-icon'), { textContent: t.icon }),
                  Object.assign(el('div', 'pc-label'), { textContent: t.label }));
    wrap.appendChild(center);

    const N = palette.length;
    palette.forEach((col, k) => {
      const ang = (k / N) * 2 * Math.PI - Math.PI / 2;   // start at top, go clockwise
      const R = 37;                                       // % radius from centre
      const sw = el('button', 'swatch');
      sw.style.left = (50 + R * Math.cos(ang)) + '%';
      sw.style.top = (50 + R * Math.sin(ang)) + '%';
      sw.style.background = col.hex;
      sw.title = col.label;
      if (used.has(col.hex)) sw.classList.add('used');   // already held — tapping just opens it
      sw.addEventListener('click', (e) => { e.stopPropagation(); addCounter(i, type, col.hex, col.label); });
      wrap.appendChild(sw);
    });

    const back = el('button', 'ov-back', '‹');
    back.addEventListener('click', (e) => { e.stopPropagation(); p.overlay = { kind: 'menu' }; renderOverlay(i); });
    ov.append(wrap, back, close);

  } else { // kind === 'menu'
    const list = el('div', 'menu-list');
    list.append(el('div', 'mhead', 'Add counter'));
    COUNTER_TYPES.forEach(t => {
      // fixed single counters (poison/storm) disappear once added; colour types stay
      if (!t.palette && p.counters.some(x => x.type === t.id)) return;
      const b = el('button');
      b.append(Object.assign(el('span', 'mi'), { textContent: t.icon }), el('span', null, t.label));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.palette) openColorPicker(i, t.id);   // choose a colour first
        else addCounter(i, t.id);                   // poison / storm add directly
      });
      list.appendChild(b);
    });

    list.append(el('div', 'mhead', 'Player'));
    const ren = el('button');
    ren.append(Object.assign(el('span', 'mi'), { textContent: '✎' }), el('span', null, 'Rename'));
    ren.addEventListener('click', (e) => { e.stopPropagation(); renamePlayer(i); });
    list.appendChild(ren);

    const cmdBtn = el('button');
    cmdBtn.append(Object.assign(el('span', 'mi'), { textContent: '🜲' }),
                  el('span', null, p.commander ? 'Change commander' : 'Set commander'));
    cmdBtn.addEventListener('click', (e) => { e.stopPropagation(); openCommanderSearch(i); });
    list.appendChild(cmdBtn);

    if (state.monarchOn) {
      const crown = el('button');
      crown.append(Object.assign(el('span', 'mi'), { textContent: '♛' }), el('span', null, state.monarch === i ? 'Remove monarch' : 'Make monarch'));
      crown.addEventListener('click', (e) => { e.stopPropagation(); setMonarch(state.monarch === i ? null : i); p.overlay = null; renderOverlay(i); });
      list.appendChild(crown);
    }

    if (state.playerCount > minCount()) {
      const rem = el('button', 'danger');
      rem.append(Object.assign(el('span', 'mi'), { textContent: '✕' }), el('span', null, 'Remove player'));
      rem.addEventListener('click', (e) => { e.stopPropagation(); removePlayer(i); });
      list.appendChild(rem);
    }

    ov.append(list, close);
  }
}

/* ============================================================================
 * Mutations
 * ==========================================================================*/
function changeLife(i, amt) {
  state.players[i].life += amt;
  renderLife(i);
  saveState();
}
function openCardMenu(i) {
  closeAllOverlays(i);
  state.players[i].overlay = { kind: 'menu' };
  renderOverlay(i);
}
function openCounter(i, idx) {
  closeAllOverlays(i);
  state.players[i].overlay = { kind: 'counter', idx };
  renderOverlay(i);
}
function closeAllOverlays(except) {
  state.players.forEach((p, i) => {
    if (i !== except && p.overlay) { p.overlay = null; renderOverlay(i); }
  });
}
function openColorPicker(i, type) {
  state.players[i].overlay = { kind: 'picker', type };
  renderOverlay(i);
}
function addCounter(i, type, color, label) {
  const p = state.players[i];
  const t = counterType(type);
  const useColor = t.palette ? color : t.color;   // poison/storm use their fixed colour
  const useLabel = t.palette ? (label || '') : '';
  // one counter per (type, colour) — tapping an existing one just opens it
  let idx = p.counters.findIndex(c => c.type === type && counterColor(c) === useColor);
  if (idx === -1) {
    p.counters.push({ type, color: useColor, label: useLabel, value: t.start || 0 });
    idx = p.counters.length - 1;
  }
  p.overlay = { kind: 'counter', idx };
  renderCounters(i);
  renderOverlay(i);
  saveState();
}
function renamePlayer(i) {
  const name = window.prompt('Player name', state.players[i].name);
  if (name != null) {
    state.players[i].name = name.trim() || state.players[i].name;
    state.players[i].overlay = null;
    renderName(i);
    renderOverlay(i);
    saveState();
  }
}

/* ---- Commander picker (Scryfall search) --------------------------------- */
let searchTarget = null, searchTimer = null, searchSeq = 0;

function openCommanderSearch(i) {
  searchTarget = i;
  state.players[i].overlay = null; renderOverlay(i);
  $('#search-title').textContent = 'Commander for ' + state.players[i].name;
  const input = $('#search-input');
  input.value = '';
  $('#search-results').innerHTML = '<div class="hint">Type at least 2 letters…</div>';
  $('#search-remove').style.display = state.players[i].commander ? '' : 'none';
  show('search-backdrop');
  setTimeout(() => input.focus(), 60);
}
function onSearchInput() {
  clearTimeout(searchTimer);
  const q = $('#search-input').value.trim();
  if (q.length < 2) { $('#search-results').innerHTML = '<div class="hint">Type at least 2 letters…</div>'; return; }
  searchTimer = setTimeout(() => runCardSearch(q), 250);
}
async function runCardSearch(q) {
  const seq = ++searchSeq;
  const box = $('#search-results');
  box.innerHTML = '<div class="hint">Searching…</div>';
  try {
    const url = 'https://api.scryfall.com/cards/search?q=' +
      encodeURIComponent(q + ' is:commander') + '&unique=cards&order=name';
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (seq !== searchSeq) return;                 // a newer search superseded this one
    const cards = res.ok ? ((await res.json()).data || []) : [];
    if (seq !== searchSeq) return;
    if (!cards.length) { box.innerHTML = '<div class="hint">No commanders found.</div>'; return; }
    box.textContent = '';
    cards.slice(0, 14).forEach(c => {
      const iu = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris) || {};
      const art = iu.art_crop || null;
      const b = el('button');
      if (art) { const im = el('img', 'thumb'); im.src = art; im.alt = ''; b.appendChild(im); }
      b.appendChild(el('span', null, c.name));
      b.addEventListener('click', () => assignCommander(searchTarget, c.name, art));
      box.appendChild(b);
    });
  } catch (e) {
    if (seq === searchSeq) box.innerHTML = '<div class="hint">Search failed — check your connection.</div>';
  }
}
function assignCommander(i, name, art) {
  if (i == null) return;
  const p = state.players[i];
  p.commander = { name, art: art || null };
  if (/^P\d+$/.test(p.name)) p.name = name;     // adopt the name if still the default
  renderCommander(i);
  renderName(i);
  hide('search-backdrop');
  saveState();
}
function removeCommander() {
  if (searchTarget == null) return;
  state.players[searchTarget].commander = null;
  renderCommander(searchTarget);
  hide('search-backdrop');
  saveState();
}

function minCount() { return Math.min(...Object.keys(LAYOUTS).map(Number)); }
function maxCount() { return Math.max(...Object.keys(LAYOUTS).map(Number)); }

function setPlayerCount(count) {
  if (!LAYOUTS[count]) return;
  const cur = state.players;
  if (count > cur.length) {
    for (let i = cur.length; i < count; i++) cur.push(newPlayer(i, state.startingLife));
  } else {
    cur.length = count;
    if (state.monarch != null && state.monarch >= count) state.monarch = null;
  }
  state.playerCount = count;
  state.layoutId = LAYOUTS[count][0].id;
  rebuild();
  saveState();
  renderMenu();
}
function addPlayer() {
  if (state.playerCount >= maxCount()) return toast('No layout for ' + (state.playerCount + 1) + ' players');
  setPlayerCount(state.playerCount + 1);
}
function removePlayer(i) {
  if (state.playerCount <= minCount()) return;
  state.players.splice(i, 1);
  state.playerCount = state.players.length;
  state.layoutId = LAYOUTS[state.playerCount][0].id;
  if (state.monarch === i) state.monarch = null;
  else if (state.monarch != null && state.monarch > i) state.monarch--;
  rebuild();
  saveState();
}
function setLayout(id) {
  state.layoutId = id;
  rebuild();
  saveState();
  renderMenu();
}
function setStartingLife(v) {
  state.startingLife = v;
  saveState();
  renderMenu();
  toast('Starting life ' + v + ' — applied on restart');
}
function restart() {
  state.players.forEach(p => { p.life = state.startingLife; p.counters = []; p.overlay = null; });
  state.monarch = null;
  state.planechase.active = false;
  shufflePlanarDeck();
  applyPlanechaseLayout();
  state.timer.matchStart = Date.now();   // new game → match clock restarts
  state.timer.sec = null;
  renderTimer();
  renderAll();
  positionMonarch();
  saveState();
}

/* ============================================================================
 * Planechase
 *
 * The deck is fetched live from Scryfall (all planes, with card images) and
 * cached in localStorage. The hardcoded PLANES in config.js is the offline
 * fallback. `planeDeck` is whichever is currently in use.
 * ==========================================================================*/
const PLANES_CACHE_KEY = 'pod-planes-v1';
const SCRYFALL_PLANES_URL =
  'https://api.scryfall.com/cards/search?q=' +
  encodeURIComponent('type:plane -type:phenomenon') + '&unique=cards&order=name';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let planeDeck = loadCachedPlanes() || PLANES;

function loadCachedPlanes() {
  try { const a = JSON.parse(localStorage.getItem(PLANES_CACHE_KEY)); return (Array.isArray(a) && a.length) ? a : null; }
  catch (e) { return null; }
}
/* split a plane's Oracle text into its static ability and its chaos ability */
function splitOracle(o) {
  for (const re of [/\n?Whenever chaos ensues,\s*/i, /\n?Whenever you roll \{CHAOS\},\s*/i]) {
    const parts = o.split(re);
    if (parts.length > 1) return { static: parts[0].trim(), chaos: parts.slice(1).join(' ').trim() };
  }
  return { static: o.trim(), chaos: '' };
}
async function fetchAllPlanes() {
  let url = SCRYFALL_PLANES_URL, guard = 0;
  const out = [];
  while (url && guard++ < 12) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('scryfall ' + res.status);
    const j = await res.json();
    for (const c of (j.data || [])) {
      const iu = c.image_uris || (c.card_faces && c.card_faces[0] && c.card_faces[0].image_uris);
      const img = iu && (iu.normal || iu.large || iu.border_crop || iu.png);
      if (!img) continue;
      const s = splitOracle(c.oracle_text || '');
      out.push({ name: c.name, type: c.type_line, static: s.static, chaos: s.chaos, img });
    }
    url = j.has_more ? j.next_page : null;
    if (url) await sleep(120);   // be polite to the API
  }
  return out;
}
async function refreshPlanesFromScryfall() {
  try {
    const planes = await fetchAllPlanes();
    if (!planes.length) return;
    planeDeck = planes;
    try { localStorage.setItem(PLANES_CACHE_KEY, JSON.stringify(planes)); } catch (e) {}
    ensureDeckValid();
    if (state.planechase.active) renderPlane(false);
  } catch (e) { /* keep the cached / fallback deck */ }
}

function shufflePlanarDeck() {
  const order = planeDeck.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {       // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  state.planechase.order = order;
  state.planechase.pos = 0;
}
/* reshuffle if the saved order doesn't match the current deck (e.g. it grew) */
function ensureDeckValid() {
  const pc = state.planechase;
  if (!pc.order.length || pc.order.length !== planeDeck.length || pc.order.some(i => i >= planeDeck.length))
    shufflePlanarDeck();
}
function currentPlane() {
  const pc = state.planechase;
  if (!pc.order.length) return null;
  return planeDeck[pc.order[pc.pos % pc.order.length]];
}
function togglePlanechase(force) {
  const pc = state.planechase;
  pc.active = (force === undefined) ? !pc.active : force;
  if (pc.active) ensureDeckValid();
  else cancelSpeech();
  applyPlanechaseLayout();
  saveState();
  closeMenu();
}
/* Shrink the pod to the left half, slide the panel in, resize everything. */
function applyPlanechaseLayout() {
  document.body.classList.toggle('planechase-on', state.planechase.active);
  if (state.planechase.active) renderPlane(false);
  requestAnimationFrame(() => { sizeCards(); fitPlane(); positionMenuButton(); });
}
function renderPlane(animate) {
  ensureDeckValid();
  const plane = currentPlane();
  if (!plane) return;
  const rot = $('#plane-rot');

  // always populate the text fallback (also used if the image fails to load)
  $('.plane-art', planeCardEl).style.setProperty('--p1', (plane.colors && plane.colors[0]) || '#3a3a44');
  $('.plane-art', planeCardEl).style.setProperty('--p2', (plane.colors && plane.colors[1]) || '#15151c');
  $('.plane-name', planeCardEl).textContent = plane.name;
  $('.plane-type', planeCardEl).textContent = plane.type;
  $('.plane-static', planeCardEl).textContent = plane.static || '';
  const chaos = $('.plane-chaos', planeCardEl);
  chaos.textContent = '';
  if (plane.chaos)
    chaos.append(Object.assign(el('span', 'chaos-mark'), { textContent: 'CHAOS —' }),
                 document.createTextNode(' ' + plane.chaos));

  if (plane.img) {
    rot.classList.add('has-img');
    if (planeImgEl.getAttribute('src') !== plane.img) planeImgEl.setAttribute('src', plane.img); // fitPlane on load
    else fitPlane();
  } else {
    rot.classList.remove('has-img');
    fitPlane();
  }

  const pc = state.planechase;
  $('#plane-caption').textContent = `${plane.name}  ·  Plane ${pc.pos + 1} / ${pc.order.length}`;
  if (animate) rot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease' });
}
/* Fit the (possibly rotated) plane content inside the stage. */
function fitPlane() {
  const stage = $('#plane-stage'), rotWrap = $('#plane-rot');
  if (!stage || !rotWrap) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const usingImg = rotWrap.classList.contains('has-img') && planeImgEl.naturalWidth;
  // Scryfall serves plane cards as portrait images (the landscape card rotated),
  // so the image needs a +90° base to read upright at the logical rotation.
  const base = usingImg ? 90 : 0;
  const r = ((((state.planechase.rot || 0) + base) % 360) + 360) % 360;
  const a = usingImg ? (planeImgEl.naturalWidth / planeImgEl.naturalHeight) : (5 / 7);
  const swap = (r === 90 || r === 270);
  const bw = swap ? H : W, bh = swap ? W : H;
  let cw = bw, ch = bw / a;
  if (ch > bh) { ch = bh; cw = bh * a; }
  cw *= 0.97; ch *= 0.97;
  rotWrap.style.width = cw + 'px';
  rotWrap.style.height = ch + 'px';
  rotWrap.style.transform = `rotate(${r}deg)`;
}
function rotatePlane() {
  const pc = state.planechase;
  pc.rot = (((pc.rot || 0) + 90) % 360);
  fitPlane();
  saveState();
}
/* Rotate so the card faces the side that was tapped.
   rot mapping: 0 faces bottom, 90 faces left, 180 faces top, 270 faces right. */
function rotatePlaneToward(e) {
  const r = $('#plane-stage').getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  state.planechase.rot = Math.abs(dx) >= Math.abs(dy)
    ? (dx > 0 ? 270 : 90)     // tapped right → face right, left → face left
    : (dy > 0 ? 0 : 180);     // tapped bottom → face bottom, top → face top
  fitPlane();
  saveState();
}
function planeswalk() {
  const pc = state.planechase;
  ensureDeckValid();
  cancelSpeech();
  pc.pos = (pc.pos + 1) % pc.order.length;   // current plane goes to bottom, reveal next
  renderPlane(true);
  saveState();
}
function previousPlane() {
  const pc = state.planechase;
  ensureDeckValid();
  cancelSpeech();
  pc.pos = (pc.pos - 1 + pc.order.length) % pc.order.length;   // step back to the previous plane
  renderPlane(true);
  saveState();
}

/* ---- Text-to-speech: read the current plane aloud ----------------------- */
function setReadBtn(on) { const b = $('#pc-read'); if (b) b.textContent = on ? '⏹ Stop' : '🔊 Read aloud'; }
function cancelSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); setReadBtn(false); }
function speechClean(s) {
  return (s || '')
    .replace(/\{CHAOS\}/gi, 'chaos').replace(/\{T\}/gi, 'tap').replace(/\{Q\}/gi, 'untap')
    .replace(/\{W\}/gi, ' white').replace(/\{U\}/gi, ' blue').replace(/\{B\}/gi, ' black')
    .replace(/\{R\}/gi, ' red').replace(/\{G\}/gi, ' green').replace(/\{C\}/gi, ' colorless')
    .replace(/\{X\}/gi, ' X ').replace(/\{(\d+)\}/g, ' $1 ').replace(/\{[^}]+\}/g, '')
    .replace(/\s+/g, ' ').trim();
}
function speakPlane() {
  if (!('speechSynthesis' in window)) { toast('Speech not supported here'); return; }
  if (speechSynthesis.speaking || speechSynthesis.pending) { cancelSpeech(); return; } // toggle off
  const plane = currentPlane();
  if (!plane) return;
  const text = [plane.name, plane.type, plane.static, plane.chaos && ('Chaos ability. ' + plane.chaos)]
    .filter(Boolean).map(speechClean).join('. ');
  const u = new SpeechSynthesisUtterance(text);
  u.onend = () => setReadBtn(false);
  u.onerror = () => setReadBtn(false);
  setReadBtn(true);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
function rollPlanarDie() {
  const face = PLANAR_DIE_FACES[Math.floor(Math.random() * PLANAR_DIE_FACES.length)];
  const info = DIE_FACES[face];
  const plane = currentPlane();
  // chaos shows the active plane's chaos ability; planeswalk advances the deck
  const sub = face === 'chaos' && plane ? plane.chaos
            : face === 'planeswalk' ? 'Moving to the next plane…' : '';
  showDiePopup(info, sub);
  if (face === 'planeswalk') setTimeout(planeswalk, 450);
}
let diePopupTimer = null;
function showDiePopup(info, sub) {
  $('.die-symbol', diePopupEl).textContent = info.symbol;
  const label = $('.die-label', diePopupEl);
  label.textContent = info.label;
  label.style.color = info.color;
  $('.die-sub', diePopupEl).textContent = sub || '';
  diePopupEl.classList.add('show');
  clearTimeout(diePopupTimer);
  diePopupTimer = setTimeout(hideDiePopup, 2600);
}
function hideDiePopup() { diePopupEl.classList.remove('show'); }

/* ============================================================================
 * Match timer — a draggable, edge-snapping clock that counts from game start.
 *   state.timer = { on, matchStart, edge, along, sec }
 *   sec = null | { start, stoppedAt }   (the tap-to-spawn turn timer)
 * Removing it (toggle off) only hides it; matchStart keeps running, so the
 * elapsed time is always now - matchStart. Restart resets matchStart.
 * ==========================================================================*/
let timerTick = null;

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function renderTimer() {
  const t = state.timer;
  timerEl.classList.toggle('show', !!t.on);
  if (!t.on) return;
  tMainEl.textContent = fmtTime(Date.now() - t.matchStart);
  if (t.sec) {
    const stopped = t.sec.stoppedAt != null;
    tSecEl.textContent = fmtTime((stopped ? t.sec.stoppedAt : Date.now()) - t.sec.start);
    tSecEl.classList.add('show');
    tSecEl.classList.toggle('stopped', stopped);
  } else {
    tSecEl.classList.remove('show', 'stopped');
  }
}
function startTick() { if (!timerTick) timerTick = setInterval(renderTimer, 500); }
function stopTick() { if (timerTick) { clearInterval(timerTick); timerTick = null; } }

function toggleTimer() {
  state.timer.on = !state.timer.on;
  renderTimer();
  if (state.timer.on) { positionTimer(); startTick(); } else stopTick();
  saveState();
  closeMenu();
}

/* place it on its snapped edge, rotated to face that edge like a seated player */
function positionTimer() {
  const t = state.timer;
  if (!t.on) return;
  const pod = podEl.getBoundingClientRect();
  const w = timerEl.offsetWidth || 90, h = timerEl.offsetHeight || 40;
  const perp = h / 2 + 7;   // distance from the wall = pill thickness only (not its length)
  const half = w / 2;       // pill length runs along the wall
  let x, y, rot;
  if (t.edge === 'top')         { rot = 180; y = pod.top + perp;    x = pod.left + t.along * pod.width; }
  else if (t.edge === 'bottom') { rot = 0;   y = pod.bottom - perp; x = pod.left + t.along * pod.width; }
  else if (t.edge === 'left')   { rot = 90;  x = pod.left + perp;   y = pod.top + t.along * pod.height; }
  else                          { rot = 270; x = pod.right - perp;  y = pod.top + t.along * pod.height; }
  // clamp the along-the-wall position so the pill stays inside the pod
  if (t.edge === 'top' || t.edge === 'bottom') x = Math.min(Math.max(x, pod.left + half), pod.right - half);
  else                                         y = Math.min(Math.max(y, pod.top + half), pod.bottom - half);
  timerEl.style.left = x + 'px';
  timerEl.style.top = y + 'px';
  timerEl.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
  resolveTimerMenuOverlap();
}
/* choose the nearest pod edge to a screen point and snap there */
function snapTimerToPoint(cx, cy) {
  const pod = podEl.getBoundingClientRect();
  const dL = cx - pod.left, dR = pod.right - cx, dT = cy - pod.top, dB = pod.bottom - cy;
  const min = Math.min(dL, dR, dT, dB);
  const t = state.timer;
  let along;
  if (min === dT)      { t.edge = 'top';    along = (cx - pod.left) / pod.width; }
  else if (min === dB) { t.edge = 'bottom'; along = (cx - pod.left) / pod.width; }
  else if (min === dL) { t.edge = 'left';   along = (cy - pod.top) / pod.height; }
  else                 { t.edge = 'right';  along = (cy - pod.top) / pod.height; }
  // snap along the wall to the nearest seam between cards, off the ± zones
  const layout = currentLayout();
  const divisions = (t.edge === 'top' || t.edge === 'bottom') ? layout.cols : layout.rows;
  t.along = seamNear(along, divisions);
  timerEl.classList.add('snapping');
  positionTimer();
  setTimeout(() => timerEl.classList.remove('snapping'), 260);
  saveState();
}
/* nearest internal grid seam (between cards); the corners are skipped because the
   ± glyphs sit there. Falls back to centre when the edge holds a single card. */
function seamNear(along, divisions) {
  if (divisions <= 1) return 0.5;
  let best = 0.5, bestD = Infinity;
  for (let k = 1; k < divisions; k++) {
    const s = k / divisions, d = Math.abs(s - along);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
/* main tap spawns/restarts the turn timer; sec tap stops it, then clears it */
function tapMainTimer() {
  state.timer.sec = { start: Date.now(), stoppedAt: null };
  renderTimer();
  saveState();
}
function tapSecTimer() {
  const sec = state.timer.sec;
  if (!sec) return;
  if (sec.stoppedAt == null) sec.stoppedAt = Date.now();   // running → stop
  else state.timer.sec = null;                              // stopped → remove
  renderTimer();
  saveState();
}

/* drag (snap) vs tap, same pointer flow as the monarch */
let tDragging = false, tDragId = null, tMoved = false, tsx = 0, tsy = 0;
timerEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  tDragging = true; tDragId = e.pointerId; tMoved = false; tsx = e.clientX; tsy = e.clientY;
  timerEl.classList.remove('snapping');
  try { timerEl.setPointerCapture(e.pointerId); } catch (_) {}
});
timerEl.addEventListener('pointermove', (e) => {
  if (!tDragging || e.pointerId !== tDragId) return;
  if (Math.hypot(e.clientX - tsx, e.clientY - tsy) > 8) tMoved = true;
  if (tMoved) { timerEl.style.left = e.clientX + 'px'; timerEl.style.top = e.clientY + 'px'; }
});
timerEl.addEventListener('pointerup', (e) => {
  if (!tDragging || e.pointerId !== tDragId) return;
  tDragging = false;
  if (tMoved) { snapTimerToPoint(e.clientX, e.clientY); return; }
  const tgt = document.elementFromPoint(e.clientX, e.clientY);
  if (tgt && tgt.closest('.t-sec')) tapSecTimer(); else tapMainTimer();
});
timerEl.addEventListener('pointercancel', () => { tDragging = false; positionTimer(); });

/* If the timer ends up over the centre button, nudge it along its wall to clear. */
function resolveTimerMenuOverlap() {
  if (!state.timer.on) return;
  const pod = podEl.getBoundingClientRect();
  const t = timerEl.getBoundingClientRect();
  const m = centerBtn.getBoundingClientRect();
  if (t.right <= m.left || t.left >= m.right || t.bottom <= m.top || t.top >= m.bottom) return;
  if (state.timer.edge === 'top' || state.timer.edge === 'bottom') {
    const dir = (t.left + t.width / 2) <= (m.left + m.width / 2) ? -1 : 1;
    let nx = parseFloat(timerEl.style.left) + dir * (m.width / 2 + t.width / 2 + 10);
    nx = Math.min(Math.max(nx, pod.left + t.width / 2), pod.right - t.width / 2);
    timerEl.style.left = nx + 'px';
  } else {
    const dir = (t.top + t.height / 2) <= (m.top + m.height / 2) ? -1 : 1;
    let ny = parseFloat(timerEl.style.top) + dir * (m.height / 2 + t.height / 2 + 10);
    ny = Math.min(Math.max(ny, pod.top + t.height / 2), pod.bottom - t.height / 2);
    timerEl.style.top = ny + 'px';
  }
}

/* ============================================================================
 * Movable centre menu button — snaps to the nearest grid seam *line* (and
 * slides along it), so it stays in the gaps between cards rather than over a
 * player's card (e.g. 3-player "stacked").
 * ==========================================================================*/
function snapMenuToFraction(px, py, animate) {
  const L = currentLayout();
  const xs = L.cols > 1 ? Array.from({ length: L.cols - 1 }, (_, k) => (k + 1) / L.cols) : [];
  const ys = L.rows > 1 ? Array.from({ length: L.rows - 1 }, (_, k) => (k + 1) / L.rows) : [];
  const clamp = (v) => Math.min(0.88, Math.max(0.12, v));
  let bx = null, bxd = Infinity; xs.forEach(s => { const d = Math.abs(s - px); if (d < bxd) { bxd = d; bx = s; } });
  let by = null, byd = Infinity; ys.forEach(s => { const d = Math.abs(s - py); if (d < byd) { byd = d; by = s; } });
  if (bx != null && (by == null || bxd <= byd)) { state.menu.x = bx; state.menu.y = clamp(py); }   // snap to a vertical seam
  else if (by != null) { state.menu.y = by; state.menu.x = clamp(px); }                            // snap to a horizontal seam
  else { state.menu.x = 0.5; state.menu.y = 0.5; }                                                  // single card → centre
  if (animate) {
    centerBtn.classList.add('snapping');
    setTimeout(() => centerBtn.classList.remove('snapping'), 260);
  }
  positionMenuButton();
  saveState();
}
function snapMenuToPoint(cx, cy) {
  const pod = podEl.getBoundingClientRect();
  snapMenuToFraction((cx - pod.left) / pod.width, (cy - pod.top) / pod.height, true);
}
function reSnapMenuForLayout() { snapMenuToFraction(state.menu.x, state.menu.y, true); }
function positionMenuButton() {
  const pod = podEl.getBoundingClientRect();
  centerBtn.style.left = (state.menu.x * pod.width) + 'px';
  centerBtn.style.top = (state.menu.y * pod.height) + 'px';
  centerBtn.style.transform = 'translate(-50%, -50%)';
  positionMonarch();
  positionTimer();   // keep the timer clear of the menu's new spot
}

let cDragging = false, cDragId = null, cMoved = false, csx = 0, csy = 0;
centerBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  cDragging = true; cDragId = e.pointerId; cMoved = false; csx = e.clientX; csy = e.clientY;
  centerBtn.classList.remove('snapping');
  try { centerBtn.setPointerCapture(e.pointerId); } catch (_) {}
});
centerBtn.addEventListener('pointermove', (e) => {
  if (!cDragging || e.pointerId !== cDragId) return;
  if (Math.hypot(e.clientX - csx, e.clientY - csy) > 8) { cMoved = true; centerBtn.classList.add('dragging'); }
  if (cMoved) {
    const pod = podEl.getBoundingClientRect();
    centerBtn.style.left = (e.clientX - pod.left) + 'px';
    centerBtn.style.top = (e.clientY - pod.top) + 'px';
  }
});
centerBtn.addEventListener('pointerup', (e) => {
  if (!cDragging || e.pointerId !== cDragId) return;
  cDragging = false; centerBtn.classList.remove('dragging');
  if (cMoved) snapMenuToPoint(e.clientX, e.clientY);
  else openMenu();
});
centerBtn.addEventListener('pointercancel', () => { cDragging = false; centerBtn.classList.remove('dragging'); positionMenuButton(); });

/* ============================================================================
 * Tap / long-press handling (shared by life and counters)
 *   dir = -1 (left) or +1 (right). apply(amount) does the mutation.
 * ==========================================================================*/
function attachAdjuster(node, dir, apply) {
  let timer = null, longFired = false, moved = false, sx = 0, sy = 0;

  node.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    longFired = false; moved = false; sx = e.clientX; sy = e.clientY;
    try { node.setPointerCapture(e.pointerId); } catch (_) {}
    timer = setTimeout(() => { longFired = true; apply(dir * LONG_PRESS_STEP); }, LONG_PRESS_MS);
  });
  node.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > MOVE_TOLERANCE) moved = true;
  });
  node.addEventListener('pointerup', () => {
    clearTimeout(timer);
    if (!longFired && !moved) apply(dir);   // a tap = ±1
  });
  node.addEventListener('pointercancel', () => clearTimeout(timer));
}

/* ============================================================================
 * Monarch crown — drag & snap
 * ==========================================================================*/
let dragging = false, dragId = null;

function toggleMonarch() {
  state.monarchOn = !state.monarchOn;
  if (!state.monarchOn) state.monarch = null;   // take the crown out of the game
  positionMonarch();
  saveState();
  closeMenu();
}
function positionMonarch() {
  if (!state.monarchOn) { monarchEl.style.display = 'none'; return; }
  monarchEl.style.display = '';
  monarchEl.classList.toggle('parked', state.monarch == null);
  const pod = podEl.getBoundingClientRect();
  let x, y;
  if (state.monarch == null || !cards[state.monarch]) {
    const s = monarchEl.offsetWidth || 38;                  // park in the top-left corner,
    x = s / 2 + 8;                                          // clear of the movable menu button
    y = s / 2 + 8;
  } else {
    const r = cards[state.monarch].wrap.getBoundingClientRect();
    x = (r.left - pod.left) + r.width / 2;
    y = (r.top - pod.top) + 22;
  }
  monarchEl.style.left = x + 'px';
  monarchEl.style.top = y + 'px';
}
function setMonarch(i) {
  state.monarch = i;
  monarchEl.classList.add('snapping');
  positionMonarch();
  setTimeout(() => monarchEl.classList.remove('snapping'), 300);
  saveState();
}

monarchEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  dragging = true; dragId = e.pointerId;
  monarchEl.classList.add('dragging');
  monarchEl.classList.remove('snapping');
  try { monarchEl.setPointerCapture(e.pointerId); } catch (_) {}
});
monarchEl.addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragId) return;
  const pod = podEl.getBoundingClientRect();
  monarchEl.style.left = (e.clientX - pod.left) + 'px';
  monarchEl.style.top = (e.clientY - pod.top) + 'px';
});
function endDrag(e) {
  if (!dragging || e.pointerId !== dragId) return;
  dragging = false;
  monarchEl.classList.remove('dragging');
  monarchEl.style.pointerEvents = 'none';                    // so we can see what's underneath
  const under = document.elementFromPoint(e.clientX, e.clientY);
  monarchEl.style.pointerEvents = '';
  const seat = under && under.closest('.seat');
  const idx = seat ? cards.findIndex(c => c.wrap === seat) : -1;
  setMonarch(idx >= 0 ? idx : null);                         // dropped off a player → remove
}
monarchEl.addEventListener('pointerup', endDrag);
monarchEl.addEventListener('pointercancel', () => { dragging = false; monarchEl.classList.remove('dragging'); positionMonarch(); });

/* ============================================================================
 * "Who goes first" — glow that cycles and eases to a stop on a winner
 * ==========================================================================*/
let spinning = false;
function pickFirstPlayer() {
  if (spinning) return;
  closeMenu();
  spinning = true;
  cards.forEach(c => c.card.classList.remove('lit'));

  const n = state.playerCount;
  const winner = Math.floor(Math.random() * n);
  const loops = 2 + Math.floor(Math.random() * 2);
  const steps = loops * n + ((winner - 0 + n) % n) + n;       // land on winner
  let step = 0, prev = -1;

  const tick = () => {
    if (prev >= 0) cards[prev % n].card.classList.remove('lit');
    const cur = step % n;
    cards[cur].card.classList.add('lit');
    prev = cur;
    step++;
    if (step <= steps) {
      const t = step / steps;                                 // ease-out: slow down near the end
      const delay = 60 + 360 * t * t;
      setTimeout(tick, delay);
    } else {
      spinning = false;
      toast(state.players[winner].name + ' goes first!', 2600);
      setTimeout(() => cards[winner].card.classList.remove('lit'), 2600);
    }
  };
  tick();
}

/* ============================================================================
 * Modals: central menu, dice, confirm, toast
 * ==========================================================================*/
function show(id) { $('#' + id).classList.add('show'); }
function hide(id) { $('#' + id).classList.remove('show'); }

/* central menu ------------------------------------------------------------- */
function openMenu() { renderMenu(); show('menu-backdrop'); }
function closeMenu() { hide('menu-backdrop'); }

function renderMenu() {
  // players
  const segP = $('#seg-players');
  segP.querySelectorAll('button').forEach(b => b.remove());
  Object.keys(LAYOUTS).map(Number).sort((a, b) => a - b).forEach(n => {
    const b = el('button', state.playerCount === n ? 'active' : '', String(n));
    b.addEventListener('click', () => setPlayerCount(n));
    segP.appendChild(b);
  });
  // layouts for current count
  const segL = $('#seg-layout');
  segL.querySelectorAll('button').forEach(b => b.remove());
  (LAYOUTS[state.playerCount] || []).forEach(l => {
    const b = el('button', state.layoutId === l.id ? 'active' : '', l.label);
    b.addEventListener('click', () => setLayout(l.id));
    segL.appendChild(b);
  });
  // starting life
  const segLife = $('#seg-life');
  segLife.querySelectorAll('button').forEach(b => b.remove());
  LIFE_PRESETS.forEach(v => {
    const b = el('button', state.startingLife === v ? 'active' : '', String(v));
    b.addEventListener('click', () => setStartingLife(v));
    segLife.appendChild(b);
  });
  // actions
  const acts = $('#menu-actions');
  acts.textContent = '';
  MENU_ACTIONS.forEach(a => {
    const b = el('button');
    b.append(Object.assign(el('span', 'mi'), { textContent: a.icon }), el('span', null, a.label));
    b.addEventListener('click', () => a.run(API));
    acts.appendChild(b);
  });
}

/* dice --------------------------------------------------------------------- */
const DICE = [4, 6, 8, 10, 12, 20, 100];
function openDice() {
  closeMenu();
  const grid = $('#dice-grid');
  grid.textContent = '';
  DICE.forEach(s => {
    const b = el('button', null, 'd' + s);
    b.addEventListener('click', () => rollDie(s));
    grid.appendChild(b);
  });
  const coin = el('button', null, 'Coin');
  coin.addEventListener('click', () => {
    $('#dice-result').innerHTML = (Math.random() < 0.5 ? 'Heads' : 'Tails') + '<small>coin flip</small>';
  });
  grid.appendChild(coin);
  $('#dice-result').textContent = '';
  show('dice-backdrop');
}
function rollDie(sides) {
  const r = 1 + Math.floor(Math.random() * sides);
  $('#dice-result').innerHTML = r + '<small>d' + sides + '</small>';
}

/* confirm ------------------------------------------------------------------ */
let confirmCb = null;
function confirmDialog(title, msg, onOk) {
  $('#confirm-title').textContent = title;
  $('#confirm-msg').textContent = msg;
  confirmCb = onOk;
  show('confirm-backdrop');
}
function confirmRestart() {
  closeMenu();
  confirmDialog('Restart game?', 'Reset every life total to ' + state.startingLife +
    ' and clear all counters and the monarch.', () => restart());
}

/* toast -------------------------------------------------------------------- */
let toastTimer = null;
function toast(msg, ms = 1700) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ============================================================================
 * Wiring
 * ==========================================================================*/
/* centre button: tap = open menu, drag = move it (handlers defined above) */
$('#menu-close').addEventListener('click', closeMenu);
$('#dice-close').addEventListener('click', () => hide('dice-backdrop'));
$('#confirm-cancel').addEventListener('click', () => hide('confirm-backdrop'));
$('#confirm-ok').addEventListener('click', () => { hide('confirm-backdrop'); if (confirmCb) confirmCb(); });

// click a backdrop (outside the modal) to dismiss
['menu-backdrop', 'dice-backdrop', 'confirm-backdrop', 'search-backdrop'].forEach(id => {
  $('#' + id).addEventListener('pointerdown', (e) => { if (e.target.id === id) hide(id); });
});

// planechase controls
$('#pc-close').addEventListener('click', () => togglePlanechase(false));
$('#pc-back').addEventListener('click', previousPlane);
$('#pc-roll').addEventListener('click', rollPlanarDie);
$('#pc-walk').addEventListener('click', planeswalk);
$('#pc-read').addEventListener('click', speakPlane);
$('#pc-rotate').addEventListener('click', rotatePlane);     // ⟳ button cycles 90°
$('#plane-stage').addEventListener('click', rotatePlaneToward);  // tap a side → face that side
planeImgEl.addEventListener('load', fitPlane);
planeImgEl.addEventListener('error', () => { $('#plane-rot').classList.remove('has-img'); fitPlane(); });
diePopupEl.addEventListener('pointerdown', hideDiePopup);   // tap result to dismiss

// commander search
$('#search-input').addEventListener('input', onSearchInput);
$('#search-close').addEventListener('click', () => hide('search-backdrop'));
$('#search-remove').addEventListener('click', removeCommander);

// no long-press context menu / no pinch-zoom interference
document.addEventListener('contextmenu', (e) => e.preventDefault());

// keep cards sized, monarch placed and the plane fitted on resize / rotate
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { sizeCards(); fitPlane(); positionMenuButton(); }, 60);
});

/* Public API handed to MENU_ACTIONS so config stays declarative. */
const API = {
  pickFirstPlayer, openDice, addPlayer, confirmRestart, restart,
  setPlayerCount, setLayout, toast, togglePlanechase, toggleTimer, toggleMonarch,
};

const planesWereCached = !!loadCachedPlanes();
rebuild();
applyPlanechaseLayout();   // restore the panel if a saved game had it active
renderTimer(); positionTimer(); if (state.timer.on) startTick();   // restore the match timer
if (!planesWereCached) refreshPlanesFromScryfall();   // first run: fetch the full deck
