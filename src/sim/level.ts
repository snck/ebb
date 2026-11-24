import { Vec } from './math';

/**
 * The whole area ("the Drowned Abbey of Vesper") is built here from carved rooms.
 * 1 tile = 1 metre. Walls are generated around every carved cell automatically.
 *
 * Tiles: '#' wall, ' ' void, '~' deep water (blocks movement, not sight), '+' pillar/pew,
 *        '.' stone, ',' shallows, ':' sand, '=' boards.
 */
export const MAP_W = 98;
export const MAP_H = 70;

export type MarkerType = 'player' | 'cairn' | 'enemy' | 'boss' | 'item' | 'note' | 'lever' | 'ending';
export interface Marker { type: MarkerType; x: number; y: number; id: string; kind?: string; text?: string; name?: string; sleeper?: boolean }
export interface GateDef { id: string; cells: [number, number][]; kind: 'arena' | 'exit' | 'shortcut'; boss?: string; openFrom?: 'lever' }
export interface ArenaDef { boss: string; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; gate: string; exit: string; cairn: string }

export interface LevelData {
  grid: string[][];
  markers: Marker[];
  gates: GateDef[];
  arenas: ArenaDef[];
}

export function buildLevel(): LevelData {
  const g: string[][] = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(' '));
  const carve = (x0: number, y0: number, x1: number, y1: number, ch = '.') => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = ch;
  };
  const disc = (cx: number, cy: number, r: number, ch = '.') => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (Math.hypot(x - cx, y - cy) <= r + 0.3) g[y][x] = ch;
  };
  const put = (x: number, y: number, ch: string) => { g[y][x] = ch; };
  const markers: Marker[] = [];
  const m = (type: MarkerType, x: number, y: number, id: string, extra: Partial<Marker> = {}) => markers.push({ type, x: x + 0.5, y: y + 0.5, id, ...extra });
  const e = (kind: string, x: number, y: number, extra: Partial<Marker> = {}) => m('enemy', x, y, `e${markers.length}`, { kind, ...extra });

  // ---------------- A. The Strand (start)
  carve(0, 50, 40, 69, '~');
  carve(4, 52, 31, 61, ':');
  carve(3, 62, 33, 63, ',');
  carve(21, 46, 25, 51, '.');
  for (const [x, y] of [[13, 54], [22, 60], [29, 58], [7, 53]]) put(x, y, '+');
  m('player', 9, 58, 'start');
  m('cairn', 17, 56, 'c0', { name: 'The Strand' });
  e('novice', 27, 54, { sleeper: true });
  m('note', 12, 60, 'n0', { text: 'The bell rang for the drowned, and the drowned came. The tide came after them and never left.' });

  // ---------------- B. The Cloister Yard
  carve(6, 31, 38, 45, '.');
  for (const x of [11, 17, 27, 33]) for (const y of [35, 41]) put(x, y, '+');
  e('novice', 14, 38);
  e('novice', 30, 33);
  e('hook', 32, 43);
  e('novice', 9, 43);
  m('note', 8, 33, 'n1', { text: 'Novices of Vesper kneel at low water. There has been no low water for a hundred years.' });
  // east branch to the cistern (optional, cowrie)
  carve(39, 36, 47, 38, '.');
  carve(48, 32, 58, 42, ',');
  put(53, 35, '+'); put(53, 39, '+');
  m('item', 56, 37, 'cowrie1', { kind: 'cowrie' });
  e('hook', 51, 34);
  e('novice', 55, 40);
  e('novice', 50, 41);

  // ---------------- C. Gaol Steps (cairn before boss 1)
  carve(20, 27, 24, 30, '.');
  carve(16, 21, 28, 26, '.');
  m('cairn', 22, 24, 'c1', { name: 'Gaol Steps' });
  m('note', 17, 25, 'n2', { text: 'He kept the nets so no one would leave. No one asked to.' });
  carve(21, 20, 23, 20, '.'); // gate to arena 1
  // shortcut corridor (opened from the Nave side)
  carve(29, 23, 39, 25, '=');
  carve(37, 20, 39, 22, '=');
  m('lever', 36, 24, 'lever1');

  // ---------------- D. Arena 1: the Gaol Pit
  carve(10, 5, 31, 19, '.');
  m('boss', 21, 10, 'boss1', { kind: 'netwarden' });
  carve(32, 10, 36, 12, '.'); // exit to nave

  // ---------------- E. The Flooded Nave
  carve(37, 4, 69, 19, ',');
  carve(37, 10, 69, 12, '.'); // dry aisle
  for (let x = 42; x <= 64; x += 4) { put(x, 7, '+'); put(x + 1, 7, '+'); put(x, 16, '+'); put(x + 1, 16, '+'); }
  e('hound', 46, 9);
  e('hound', 47, 14);
  e('wick', 57, 6);
  e('shell', 63, 11);
  e('hook', 54, 15);
  e('wick', 66, 17);
  m('note', 39, 6, 'n3', { text: 'The choir sang the hours so the tide would know when to turn. It did not listen.' });
  // side chapel with second cowrie
  carve(51, 20, 53, 20, ',');
  carve(48, 21, 57, 27, ',');
  m('item', 52, 26, 'cowrie2', { kind: 'cowrie' });
  e('wick', 49, 22);
  e('wick', 56, 25);
  m('note', 56, 22, 'n4', { text: 'A cowrie for each child the water kept. The gourd remembers them.' });
  // antechamber, cairn before boss 2
  carve(70, 11, 70, 13, '.');
  carve(71, 9, 77, 15, '.');
  m('cairn', 74, 12, 'c2', { name: 'Nave Crossing' });
  carve(78, 11, 78, 13, '.');

  // ---------------- F. Arena 2: the Choir
  disc(87, 12, 8.3, '.');
  m('boss', 89, 12, 'boss2', { kind: 'cantor' });
  carve(86, 21, 88, 25, '.');

  // ---------------- G. The Undercroft Stair
  carve(84, 26, 92, 42, '=');
  for (const y of [30, 36]) { put(84, y, '+'); put(92, y, '+'); }
  e('shell', 88, 30);
  e('hook', 86, 35);
  e('hook', 91, 37);
  e('hound', 88, 40);
  e('wick', 90, 27);
  m('note', 85, 41, 'n5', { text: 'Mother Ebb held the tide in her arms so the drowned could stay. She is still holding it.' });
  carve(82, 43, 94, 49, '.');
  m('cairn', 88, 46, 'c3', { name: 'Low Stair' });
  carve(81, 45, 81, 47, '.');

  // ---------------- H. Arena 3: the Tide Hall
  disc(70, 46, 10, ',');
  m('boss', 68, 46, 'boss3', { kind: 'abbess' });
  carve(52, 45, 59, 47, '.');
  carve(44, 45, 51, 53, ':');
  m('ending', 47, 49, 'end');

  // ---------------- walls around everything walkable
  const walk = (ch: string) => ch === '.' || ch === ',' || ch === ':' || ch === '=';
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (g[y][x] !== ' ') continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < MAP_H && xx >= 0 && xx < MAP_W && (walk(g[yy][xx]) || g[yy][xx] === '+')) { near = true; break; }
    }
    if (near) g[y][x] = '#';
  }

  const gates: GateDef[] = [
    { id: 'g1', kind: 'arena', boss: 'boss1', cells: [[21, 20], [22, 20], [23, 20]] },
    { id: 'x1', kind: 'exit', boss: 'boss1', cells: [[32, 10], [32, 11], [32, 12]] },
    { id: 's1', kind: 'shortcut', openFrom: 'lever', cells: [[31, 23], [31, 24], [31, 25]] },
    { id: 'g2', kind: 'arena', boss: 'boss2', cells: [[78, 11], [78, 12], [78, 13]] },
    { id: 'x2', kind: 'exit', boss: 'boss2', cells: [[86, 21], [87, 21], [88, 21]] },
    { id: 'g3', kind: 'arena', boss: 'boss3', cells: [[81, 45], [81, 46], [81, 47]] },
    { id: 'x3', kind: 'exit', boss: 'boss3', cells: [[59, 45], [59, 46], [59, 47]] },
  ];
  const arenas: ArenaDef[] = [
    { boss: 'boss1', x0: 10, y0: 5, x1: 32, y1: 18.6, cx: 21, cy: 12, gate: 'g1', exit: 'x1', cairn: 'c1' },
    { boss: 'boss2', x0: 79.5, y0: 4, x1: 95.5, y1: 20.5, cx: 87, cy: 12.5, gate: 'g2', exit: 'x2', cairn: 'c2' },
    { boss: 'boss3', x0: 60.5, y0: 36, x1: 80.4, y1: 56.5, cx: 70.5, cy: 46.5, gate: 'g3', exit: 'x3', cairn: 'c3' },
  ];
  return { grid: g, markers, gates, arenas };
}

export class Level {
  readonly w = MAP_W;
  readonly h = MAP_H;
  readonly data: LevelData;
  /** cells currently blocked by closed gates */
  private gateBlock = new Set<number>();
  constructor(data: LevelData = buildLevel()) { this.data = data; }

  tile(x: number, y: number): string {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return ' ';
    return this.data.grid[y][x];
  }
  isGateClosed(x: number, y: number) { return this.gateBlock.has(y * this.w + x); }
  setGate(cells: [number, number][], closed: boolean) {
    for (const [x, y] of cells) {
      const k = y * this.w + x;
      if (closed) this.gateBlock.add(k); else this.gateBlock.delete(k);
    }
  }
  blocksMove(x: number, y: number, floating = false): boolean {
    const t = this.tile(x, y);
    if (t === '#' || t === ' ' || t === '+') return true;
    if (t === '~' && !floating) return true;
    return this.gateBlock.has(y * this.w + x);
  }
  blocksSight(x: number, y: number): boolean {
    const t = this.tile(x, y);
    return t === '#' || t === ' ' || this.gateBlock.has(y * this.w + x);
  }

  /** Push a circle out of blocking tiles. Returns true if it collided. */
  collide(p: Vec, r: number, floating = false): boolean {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      const x0 = Math.floor(p.x - r), x1 = Math.floor(p.x + r);
      const y0 = Math.floor(p.y - r), y1 = Math.floor(p.y + r);
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!this.blocksMove(tx, ty, floating)) continue;
        const qx = Math.max(tx, Math.min(tx + 1, p.x));
        const qy = Math.max(ty, Math.min(ty + 1, p.y));
        let dx = p.x - qx, dy = p.y - qy;
        const d = Math.hypot(dx, dy);
        if (d >= r) continue;
        hit = true;
        if (d < 1e-6) {
          // centre inside the tile: push out along the shortest axis
          const l = p.x - tx, rr = tx + 1 - p.x, u = p.y - ty, dd = ty + 1 - p.y;
          const mn = Math.min(l, rr, u, dd);
          if (mn === l) p.x = tx - r; else if (mn === rr) p.x = tx + 1 + r; else if (mn === u) p.y = ty - r; else p.y = ty + 1 + r;
        } else {
          dx /= d; dy /= d;
          p.x = qx + dx * r; p.y = qy + dy * r;
        }
      }
    }
    return hit;
  }

  /** Grid ray march; true if nothing blocks sight between a and b. */
  lineOfSight(a: Vec, b: Vec): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(d / 0.25);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksSight(Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t))) return false;
    }
    return true;
  }

  /** Is the straight segment free for a body of radius r (used for blink/dive placement and pathing). */
  segmentClear(a: Vec, b: Vec, r: number): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 0.2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.circleFree({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) return false;
    }
    return true;
  }
  circleFree(p: Vec, r: number): boolean {
    for (let ty = Math.floor(p.y - r); ty <= Math.floor(p.y + r); ty++)
      for (let tx = Math.floor(p.x - r); tx <= Math.floor(p.x + r); tx++) {
        if (!this.blocksMove(tx, ty)) continue;
        const qx = Math.max(tx, Math.min(tx + 1, p.x)), qy = Math.max(ty, Math.min(ty + 1, p.y));
        if (Math.hypot(p.x - qx, p.y - qy) < r) return false;
      }
    return true;
  }

  /** BFS over tiles (4-neighbour) from a to b; returns tile-centre waypoints or null. Used by enemies stuck behind pillars and by tools. */
  path(a: Vec, b: Vec, maxNodes = 4000): Vec[] | null {
    const sx = Math.floor(a.x), sy = Math.floor(a.y), gx = Math.floor(b.x), gy = Math.floor(b.y);
    if (this.blocksMove(gx, gy)) return null;
    const prev = new Map<number, number>();
    const key = (x: number, y: number) => y * this.w + x;
    const q: number[] = [key(sx, sy)];
    prev.set(q[0], -1);
    let found = false, n = 0;
    while (q.length && n++ < maxNodes) {
      const k = q.shift()!;
      const x = k % this.w, y = (k / this.w) | 0;
      if (x === gx && y === gy) { found = true; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const nk = key(nx, ny);
        if (prev.has(nk) || this.blocksMove(nx, ny)) continue;
        prev.set(nk, k);
        q.push(nk);
      }
    }
    if (!found) return null;
    const out: Vec[] = [];
    let k = key(gx, gy);
    while (k !== -1) { out.push({ x: (k % this.w) + 0.5, y: ((k / this.w) | 0) + 0.5 }); k = prev.get(k)!; }
    return out.reverse();
  }
}
