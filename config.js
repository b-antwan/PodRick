/* ============================================================================
 * config.js — everything you'd want to tweak or extend lives here.
 *
 * To add a new player count or pod layout: add to LAYOUTS.
 * To add a new counter type:               add to COUNTER_TYPES.
 * To add a new central-menu tool:          add to MENU_ACTIONS.
 * Nothing in app.js needs to change for any of those.
 * ==========================================================================*/

/* One distinct colour per seat (index = player index). Extend for >6 players. */
const PALETTE = [
  '#e3504f', // red
  '#4f86e3', // blue
  '#3fb15e', // green
  '#b066d8', // purple
  '#e8923b', // orange
  '#37b6c4', // teal
];

/* ----------------------------------------------------------------------------
 * LAYOUTS: playerCount -> [ layout, ... ]
 *
 * Designed for a LANDSCAPE screen with all text horizontal, so players sit on
 * the top/bottom edges and read upright. Cards are wide, which puts the −/+ tap
 * zones on the far left/right edges.
 *
 * A layout places each seat on a CSS grid. Seat fields:
 *   c   : grid column (1-based)        cs : column span (default 1)
 *   r   : grid row    (1-based)        rs : row span    (default 1)
 *   rot : rotation in degrees. Use 0 (faces the near/bottom player) or 180
 *         (faces the far/top player) to keep text horizontal. 90/270 are also
 *         supported but make the text vertical, so avoid them here.
 *
 * Seat order in the array == player order (P1, P2, ...).
 * The number of seats must equal the player count key.
 * --------------------------------------------------------------------------*/
const LAYOUTS = {
  2: [
    { id: 'duel', label: 'Duel', cols: 1, rows: 2, seats: [
      { c: 1, r: 1, rot: 180 },          // far player, facing down
      { c: 1, r: 2, rot: 0 },            // near player, facing up
    ]},
    { id: 'side', label: 'Side by side', cols: 2, rows: 1, seats: [
      { c: 1, r: 1, rot: 0 },
      { c: 2, r: 1, rot: 0 },
    ]},
  ],

  3: [
    { id: '1v2', label: '1 vs 2', cols: 2, rows: 2, seats: [
      { c: 1, r: 1, cs: 2, rot: 180 },   // far player across the top
      { c: 1, r: 2, rot: 0 },            // near-left
      { c: 2, r: 2, rot: 0 },            // near-right
    ]},
    { id: '2v1', label: '2 vs 1', cols: 2, rows: 2, seats: [
      { c: 1, r: 1, rot: 180 },          // far-left
      { c: 2, r: 1, rot: 180 },          // far-right
      { c: 1, r: 2, cs: 2, rot: 0 },     // near player across the bottom
    ]},
    { id: 'stack', label: 'Stacked', cols: 1, rows: 3, seats: [
      { c: 1, r: 1, rot: 0 },
      { c: 1, r: 2, rot: 0 },
      { c: 1, r: 3, rot: 0 },
    ]},
  ],

  4: [
    { id: 'grid', label: '2×2 Grid', cols: 2, rows: 2, seats: [
      { c: 1, r: 1, rot: 180 },          // top edge faces down
      { c: 2, r: 1, rot: 180 },
      { c: 1, r: 2, rot: 0 },            // bottom edge faces up
      { c: 2, r: 2, rot: 0 },
    ]},
    { id: 'same', label: 'All upright', cols: 2, rows: 2, seats: [
      { c: 1, r: 1, rot: 0 },            // everyone faces the same way
      { c: 2, r: 1, rot: 0 },
      { c: 1, r: 2, rot: 0 },
      { c: 2, r: 2, rot: 0 },
    ]},
  ],
};

/* ----------------------------------------------------------------------------
 * COUNTER_TYPES: the sub-counters a player can add inside their card.
 *   id    : unique key            icon : short glyph shown on the chip
 *   label : shown when expanded   color: chip accent
 *   start : initial value (default 0)
 * --------------------------------------------------------------------------*/
const COUNTER_TYPES = [
  { id: 'poison', label: 'Poison',  icon: '☠', color: '#84cc16' },   // fixed colour, one only
  { id: 'storm',  label: 'Storm',   icon: '⚡', color: '#f59e0b' },   // fixed colour, one only
  { id: 'mana',   label: 'Mana',    icon: '✦', palette: 'mana' },    // pick a mana colour
  { id: 'counter',label: 'Counter', icon: '■', palette: 'counter' }, // square icon — clearly different from mana's ✦
];

/* Colours offered when adding a generic "counter". Deliberately NOT mana
 * colours (no white/blue/black/red/green/grey) so they can't be mistaken for
 * mana. A player may hold one counter of each colour. */
const COUNTER_COLORS = [
  { id: 'pink',   label: 'Pink',   hex: '#ec4899' },
  { id: 'orange', label: 'Orange', hex: '#f97316' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'teal',   label: 'Teal',   hex: '#14b8a6' },
  { id: 'cyan',   label: 'Cyan',   hex: '#22d3ee' },
  { id: 'purple', label: 'Purple', hex: '#a855f7' },
  { id: 'brown',  label: 'Brown',  hex: '#a16207' },
];

/* The five mana colours plus colorless (for "mana" counters). */
const MANA_COLORS = [
  { id: 'w', label: 'White',     hex: '#f4eccf' },
  { id: 'u', label: 'Blue',      hex: '#2563eb' },
  { id: 'b', label: 'Black',     hex: '#3b4252' },
  { id: 'r', label: 'Red',       hex: '#dc2626' },
  { id: 'g', label: 'Green',     hex: '#16a34a' },
  { id: 'c', label: 'Colorless', hex: '#c7ccd1' },
];

/* ----------------------------------------------------------------------------
 * MENU_ACTIONS: buttons in the central pod menu.
 * Each `run` is called with the public `API` object (see app.js bottom).
 * Add planechase, spin-the-wheel, etc. here.
 * --------------------------------------------------------------------------*/
const MENU_ACTIONS = [
  { id: 'first',   label: 'Who goes first?', icon: '⚡', run: (api) => api.pickFirstPlayer() },
  { id: 'dice',    label: 'Roll dice',       icon: '🎲', run: (api) => api.openDice() },
  { id: 'addp',    label: 'Add player',      icon: '＋', run: (api) => api.addPlayer() },
  { id: 'monarch', label: 'Monarch',         icon: '♛', run: (api) => api.toggleMonarch() },
  { id: 'timer',   label: 'Match timer',     icon: '⏱', run: (api) => api.toggleTimer() },
  { id: 'restart', label: 'Restart game',    icon: '↺', run: (api) => api.confirmRestart() },
  { id: 'plane',   label: 'Planechase',      icon: '🌀', run: (api) => api.togglePlanechase() },
];

/* Starting-life presets offered in the menu. */
const LIFE_PRESETS = [20, 30, 40];

/* ----------------------------------------------------------------------------
 * PLANECHASE
 *
 * PLANES is the planar deck. It is shuffled on activation, so this is already a
 * "random deck" — to load a different/larger deck later, just add objects here
 * (or replace the array). Each plane has:
 *   name   : card title
 *   type   : type line, e.g. "Plane — Dominaria"
 *   static : the always-on ability (verbatim-ish Oracle text)
 *   chaos  : the ability that triggers when you roll the CHAOS face
 *   colors : [from, to] gradient used for the card's art band
 * --------------------------------------------------------------------------*/
const PLANES = [
  { name: 'Academy at Tolaria West', type: 'Plane — Dominaria',
    static: 'At the beginning of your end step, if you have no cards in hand, draw seven cards.',
    chaos: 'Discard your hand.', colors: ['#1d6fb8', '#0a2540'] },
  { name: 'Stairs to Infinity', type: 'Plane — Xerex',
    static: 'Players have no maximum hand size. Whenever you roll the planar die, draw a card.',
    chaos: 'Reveal the top card of your planar deck. You may put it on the bottom.', colors: ['#5a4fc4', '#1a1740'] },
  { name: 'Naar Isle', type: 'Plane — Wildfire',
    static: 'At the beginning of your upkeep, put a flame counter on Naar Isle, then it deals damage to you equal to the number of flame counters on it.',
    chaos: 'Naar Isle deals 3 damage to target player or planeswalker.', colors: ['#d4502a', '#3a0f08'] },
  { name: 'Mount Keralia', type: 'Plane — Regatha',
    static: 'At the beginning of your end step, put a pressure counter on Mount Keralia. When you planeswalk away, it deals that much damage to each creature and planeswalker.',
    chaos: 'Prevent all damage planes named Mount Keralia would deal this game to permanents you control.', colors: ['#c2451f', '#2a0d06'] },
  { name: 'Glimmervoid Basin', type: 'Plane — Mirrodin',
    static: 'Whenever a player casts an instant or sorcery with a single target, they copy it for each other legal target. Each copy targets a different one.',
    chaos: 'Choose target creature. Each player except its controller creates a token copy of it.', colors: ['#3aa6a0', '#0c2a2c'] },
  { name: 'Krosa', type: 'Plane — Dominaria',
    static: 'All creatures get +2/+2.',
    chaos: 'You may add {W}{U}{B}{R}{G}.', colors: ['#3f9b46', '#0e2a12'] },
  { name: 'The Eon Fog', type: 'Plane — Equilor',
    static: 'Players skip their untap steps.',
    chaos: 'Untap all permanents you control.', colors: ['#7fa9c9', '#1b2b3a'] },
  { name: 'Trail of the Mage-Rings', type: 'Plane — Vryn',
    static: 'Instant and sorcery spells have rebound.',
    chaos: 'You may search your library for an instant or sorcery card, reveal it, put it into your hand, then shuffle.', colors: ['#4f86e3', '#10203f'] },
  { name: 'Tazeem', type: 'Plane — Zendikar',
    static: "Creatures can't block.",
    chaos: 'Draw a card for each land you control.', colors: ['#2f8fb0', '#0a2330'] },
  { name: 'The Maelstrom', type: 'Plane — Alara',
    static: 'When you planeswalk here and at the beginning of your upkeep, you may reveal the top card of your library. If it’s a permanent card you may put it onto the battlefield; otherwise bottom it.',
    chaos: 'Return target permanent card from your graveyard to the battlefield.', colors: ['#9b5fc4', '#2a123f'] },
  { name: 'Pools of Becoming', type: "Plane — Bolas's Meditation Realm",
    static: 'At the beginning of your end step, put your hand on the bottom of your library, then draw that many cards.',
    chaos: 'Reveal the top three cards of your planar deck. Each of their chaos abilities triggers. Then bottom them in any order.', colors: ['#6a4bb0', '#170a2a'] },
  { name: 'Llanowar', type: 'Plane — Dominaria',
    static: 'All creatures have "{T}: Add {G}{G}."',
    chaos: 'Untap all creatures you control.', colors: ['#4a8f2e', '#10240b'] },
  { name: 'Murasa', type: 'Plane — Zendikar',
    static: 'Whenever a nontoken creature enters, its controller may search their library for a basic land, put it onto the battlefield tapped, then shuffle.',
    chaos: 'Target land becomes a 4/4 creature that’s still a land.', colors: ['#3f9b46', '#0e2a12'] },
  { name: 'Kilnspire District', type: 'Plane — Ravnica',
    static: 'When you planeswalk here and at the beginning of your first main phase, put a charge counter on Kilnspire District, then add {R} for each charge counter on it.',
    chaos: 'You may pay {X}. If you do, it deals X damage to any target.', colors: ['#c44a2a', '#2a0d06'] },
  { name: 'Lethe Lake', type: 'Plane — Arkhos',
    static: 'At the beginning of your upkeep, mill ten cards.',
    chaos: 'Target player mills ten cards.', colors: ['#3a6ea8', '#0a1c2e'] },
];

/* The six-sided planar die: 1 chaos, 1 planeswalk, 4 blank faces. */
const PLANAR_DIE_FACES = ['nothing', 'nothing', 'nothing', 'nothing', 'chaos', 'planeswalk'];

/* How each rolled face is presented in the result popup. */
const DIE_FACES = {
  chaos:      { symbol: '💥', label: 'Chaos ensues!', color: '#ff7a45' },
  planeswalk: { symbol: '🧭', label: 'Planeswalk',    color: '#4fa3ff' },
  nothing:    { symbol: '◦',  label: 'No effect',     color: '#9aa0ac' },
};
