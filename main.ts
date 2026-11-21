// A push-optimal Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
//
// The levels are built as a hallway with independent rooms off it (3-4 boxes
// each), so a level is solved room by room: every room is searched on its own
// while the other rooms' boxes stand as walls, and the rooms' push counts add
// up to the level's optimum. Inside one room the search is A* over pushes:
// a state is the boxes' squares plus the player's reachable region (named by
// its lowest square), the cost so far is the pushes made, and the estimate is
// the cheapest assignment of boxes to goals by shortest-path distance. Two
// deadlocks are pruned, both sound: a dead square (no push, ignoring the other
// boxes, ever brings a box from it onto a goal) and a frozen 2 x 2 block of
// walls and boxes holding a box off its goal. The search is bounded by a count
// of expanded states, never by the clock, and every tie is broken in a fixed
// order, so two runs write the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const DIRS: [number, number, string, string][] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];
const MAX_EXPANSIONS_ROOM = 400_000;
const MAX_EXPANSIONS_WHOLE = 200_000;

type Level = { w: number; h: number; wall: Uint8Array; goals: number[]; boxes: number[]; player: number };

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

// The squares from which a box alone can be pushed onto some goal: pulled
// back from the goals over open floor. A box at y can be pushed to a live
// square x when the player can stand at y - d, the square behind it.
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = goals.slice();
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (y < 0 || y >= wall.length) continue;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

// The squares the player reaches from `from` with `occupied` in the way,
// marked in `seen` with `stamp`; returns the lowest square reached.
function reachLow(level: Level, occupied: Uint8Array, from: number, seen: Int32Array, stamp: number, stack: Int32Array): number {
  const { w, wall } = level;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    const q0 = p - w;
    const q1 = p + w;
    const q2 = p - 1;
    const q3 = p + 1;
    if (wall[q0] === 0 && occupied[q0] === 0 && seen[q0] !== stamp) { seen[q0] = stamp; stack[n++] = q0; }
    if (wall[q1] === 0 && occupied[q1] === 0 && seen[q1] !== stamp) { seen[q1] = stamp; stack[n++] = q1; }
    if (wall[q2] === 0 && occupied[q2] === 0 && seen[q2] !== stamp) { seen[q2] = stamp; stack[n++] = q2; }
    if (wall[q3] === 0 && occupied[q3] === 0 && seen[q3] !== stamp) { seen[q3] = stamp; stack[n++] = q3; }
  }
  return low;
}

// Whether the box just pushed to `t` sits in a frozen 2 x 2 block of walls
// and boxes with a box off its goal: no push can ever move a box out of it.
function frozenBlock(level: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (a < 0 || d >= wall.length) continue;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) || !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

// Walking distances from each goal over open floor (walls only), for the estimate.
function goalDistances(level: Level): Int32Array[] {
  const { w, wall, goals } = level;
  const dists: Int32Array[] = [];
  for (const g of goals) {
    const dist = new Int32Array(wall.length).fill(-1);
    const queue = [g];
    dist[g] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi]!;
      for (const [dx, dy] of DIRS) {
        const q = p + dy * w + dx;
        if (!wall[q] && dist[q] < 0) {
          dist[q] = dist[p]! + 1;
          queue.push(q);
        }
      }
    }
    dists.push(dist);
  }
  return dists;
}

// The cheapest assignment of boxes to goals by walking distance: a lower
// bound on the pushes still needed, since one push moves one box one square.
// Small sets are matched exactly by trying every pairing; larger ones fall
// back to each box's nearest goal, still a lower bound.
function assignCost(boxes: number[], dists: Int32Array[]): number {
  const n = boxes.length;
  if (n === 0) return 0;
  if (n > 5) {
    let total = 0;
    for (const b of boxes) {
      let best = Infinity;
      for (let j = 0; j < dists.length; j++) {
        const d = dists[j]![b]!;
        if (d >= 0 && d < best) best = d;
      }
      if (!Number.isFinite(best)) return Infinity;
      total += best;
    }
    return total;
  }
  let best = Infinity;
  const used = new Uint8Array(n);
  const rec = (i: number, cost: number): void => {
    if (cost >= best) return;
    if (i === n) {
      best = cost;
      return;
    }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const d = dists[j]![boxes[i]!]!;
      if (d < 0) continue;
      used[j] = 1;
      rec(i + 1, cost + d);
      used[j] = 0;
    }
  };
  rec(0, 0);
  return best;
}

// The shortest walk from `from` to `to` around walls and boxes, in lower
// LURD letters, the first direction first on ties.
function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

// The square the player stands on after `moves` (LURD, either case) from `from`.
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

// A* over pushes: {pushes, moves} with the fewest pushes, or null when the
// expansion budget runs out or the level has no solution. A state's key is
// its boxes plus the lowest square the player reaches; the heap orders by
// pushes made plus the assignment estimate, then by more pushes made, then
// by the order found, so the search is deterministic.
function pushSearch(level: Level, maxExpansions: number): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const n = level.boxes.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  const dists = goalDistances(level);
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  if (level.boxes.some((b) => !live[b])) return null;
  if (solved(level.boxes)) return { pushes: 0, moves: '' };

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  const useNumeric = n <= 4;
  const keyOf = (boxes: number[], low: number): number | string => {
    if (!useNumeric) return `${low}|${boxes.join(',')}`;
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };
  const decode = (k: number | string): { boxes: number[]; low: number } => {
    if (!useNumeric) {
      const parts = (k as string).split('|');
      return { low: Number(parts[0]), boxes: (parts[1] ?? '').split(',').filter((s) => s !== '').map(Number) };
    }
    let v = k as number;
    const boxes = new Array<number>(n);
    for (let i = n - 1; i >= 0; i--) {
      boxes[i] = v % size;
      v = Math.floor(v / size);
    }
    return { boxes, low: v };
  };

  const keys: (number | string)[] = [];
  const gScore: number[] = [];
  const parent: number[] = [];
  const pushFrom: number[] = [];
  const pushTo: number[] = [];
  const players: number[] = [];
  const best = new Map<number | string, number>();
  const heap: [number, number, number, number][] = [];
  let seq = 0;
  const less = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1]!, heap[c]!)) c++;
        if (!less(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };

  const initBoxes = level.boxes.slice();
  for (const b of initBoxes) occupied[b] = 1;
  const initLow = reachLow(level, occupied, level.player, seen, ++stamp, stack);
  for (const b of initBoxes) occupied[b] = 0;
  const h0 = assignCost(initBoxes, dists);
  if (!Number.isFinite(h0)) return null;
  keys.push(keyOf(initBoxes, initLow));
  gScore.push(0);
  parent.push(-1);
  pushFrom.push(-1);
  pushTo.push(-1);
  players.push(level.player);
  best.set(keys[0]!, 0);
  heapPush([h0, 0, seq++, 0]);

  let expanded = 0;
  let found = -1;
  while (heap.length > 0) {
    const [, , , s] = heapPop();
    if (best.get(keys[s]!) !== s) continue;
    const g = gScore[s]!;
    const { boxes, low: _low } = decode(keys[s]!);
    if (solved(boxes)) {
      found = s;
      break;
    }
    if (++expanded > maxExpansions) return null;
    for (const b of boxes) occupied[b] = 1;
    const here = ++stamp;
    reachLow(level, occupied, players[s]!, seen, here, stack);
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen = frozenBlock(level, occupied, goal, t);
        let key: number | string | null = null;
        let next: number[] | null = null;
        let h = Infinity;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          const nlow = reachLow(level, occupied, b, mark, ++stamp, stack);
          key = keyOf(next, nlow);
          h = assignCost(next, dists);
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || !Number.isFinite(h) || key === null) continue;
        const prev = best.get(key);
        if (prev !== undefined && gScore[prev]! <= g + 1) continue;
        const idx = keys.length;
        keys.push(key);
        gScore.push(g + 1);
        parent.push(s);
        pushFrom.push(b);
        pushTo.push(t);
        players.push(b);
        best.set(key, idx);
        heapPush([g + 1 + h, -(g + 1), seq++, idx]);
      }
    }
    for (const b of boxes) occupied[b] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes.slice();
  for (const s of path) {
    const from = pushFrom[s]!;
    const to = pushTo[s]!;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d)!;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += dir[3];
    player = from;
    const at = boxes.indexOf(from);
    boxes[at] = to;
    boxes.sort((a, b) => a - b);
  }
  return { pushes: path.length, moves };
}

// The level's rooms: cut the dead squares of the player's row (the hallway:
// a box there reaches no goal) out of the floor, and each part left that
// holds a box is a room. Null when the level is no set of rooms.
function roomsOf(level: Level): { squares: number[]; boxes: number[]; goals: number[]; done?: boolean }[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: { squares: number[]; boxes: number[]; goals: number[]; done?: boolean }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) || rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// The level solved room by room: each room's push-optimal solution in turn,
// the other rooms' boxes standing as walls (on their goals once their room is
// done), the player walking on from where the last room left it. A box never
// leaves its room, so the rooms' optima add up to the level's.
function solveLevel(level: Level): { pushes: number; moves: string } {
  const rooms = roomsOf(level);
  if (rooms !== null) {
    let player = level.player;
    let pushes = 0;
    let moves = '';
    for (const room of rooms) {
      const wall = level.wall.slice();
      for (const other of rooms) {
        if (other === room) continue;
        for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
      }
      const sub: Level = {
        w: level.w,
        h: level.h,
        wall,
        goals: room.goals.slice().sort((a, b) => a - b),
        boxes: room.boxes.slice().sort((a, b) => a - b),
        player,
      };
      const res = pushSearch(sub, MAX_EXPANSIONS_ROOM);
      if (res === null) return pushSearch(level, MAX_EXPANSIONS_WHOLE) ?? { pushes: 0, moves: '' };
      pushes += res.pushes;
      moves += res.moves;
      player = endOf(level.w, player, res.moves);
      room.done = true;
    }
    return { pushes, moves };
  }
  return pushSearch(level, MAX_EXPANSIONS_WHOLE) ?? { pushes: 0, moves: '' };
}

for (const id of readdirSync(I).sort()) {
  const moves = solveLevel(parseLevel(readFileSync(join(I, id, 'level.txt'), 'utf8'))).moves;
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
