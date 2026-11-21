# sokoban-solver-01

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/khsaleh0810-rgb/sokoban-solver-01/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/khsaleh0810-rgb/sokoban-solver-01/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver for make.fun's "Build the best Sokoban solver" bounty. One program, `main.ts` at the root, answers a whole set of 5 levels in a single run: it reads each `level.txt` under `/input/<id>/` and writes the player's moves as `/output/<id>/solution.txt`.

## How it works

Each level is a hallway with independent rooms off it (3–4 boxes each), so the solver works room by room: every room is searched on its own while the other rooms' boxes stand as walls, and the rooms' push counts add up to the level's optimum. Inside one room the search is A* over pushes — a state is the boxes' squares plus the player's reachable region (named by its lowest square), the cost so far is the pushes made, and the estimate is the cheapest assignment of boxes to goals by shortest-path distance. Two deadlocks are pruned, both sound: dead squares (no push, ignoring the other boxes, ever brings a box from one onto a goal) and frozen 2×2 blocks of walls and boxes holding a box off its goal. The search is bounded by a count of expanded states, never by the clock, and every tie is broken in a fixed order, so two runs write the same bytes.

## Results

On the kit's practice set the solver scores **1,000,000 / 1,000,000** — every level solved in exactly its push-optimal count (13, 16, 29, 47 and 60 pushes), the whole set in under 1 second of the 60-second budget. On 11 further sets drawn fresh from the kit's own generator (55 levels), it also solved every level push-optimally, worst set time under 1 second.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22 or later. No dependencies, nothing to install.

---

<sub>Entered on [make.fun](https://make.fun/?ref=nnqh4m6a&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
