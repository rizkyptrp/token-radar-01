# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/{owner}/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/{owner}/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot, ranks the protocols that record no token by the implied value of the token they may one day issue, and writes a dashboard a reader can use — a sortable, filterable board, a detail view per protocol with the model's own arithmetic and a farm plan, the live-token protocols kept apart, and a sandbox that re-runs the model with the reader's own constants.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=67v2e6cq&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

Node 22+, standard library only, no network. Two runs write the same bytes.

## The model (radar-3)

One function scores every row, from the snapshot's own figures only — no
protocol name is ever special-cased. The multiple is calibrated, not guessed:
it is the median market-cap / TVL ratio of the tokened protocols in the row's
own category (five or more comparables earn a category its own multiple), else
the median across all tokened protocols in the snapshot. On this snapshot that
is 128 comparables (16 dead $0 tokens left out), a global median of 0.214x,
and 9 categories with their own multiple — Lending 0.132x, Dexs 0.342x, RWA
0.275x, Canonical Bridge 0.746x, Basis Trading 0.654x, and the rest in the
dashboard's calibration table. Each row also carries the range the middle half
of its comparables would be worth, and a confidence note.

```
implied = round( tvl_usd × multiple(category)
               × (1 + clamp(change_7d, -60, +150) / 100 × 0.60)
               × (0.70 + min(age_days, 1095) / 1095 × 0.30)
               × (1 + min(chains − 1, 6) × 0.02) )
```

Age is days from `listed_at` to the snapshot's `as_of` date, never the wall
clock. The board covers all 40 watchlist slugs, then adds the 160 strongest
pre-token protocols below the $50M floor, ranked by this same implied value.
Protocols whose token already trades are shown apart at their market cap —
and they are the comparables the model is calibrated on.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes `board.json`,
  `data.js`, `dashboard/`, `screenshots/` and `dossier.json`.
- `lib/model.ts` — the model, the farm plans and the board validation.
- `dashboard/` — the static page (`index.html`, `radar.css`, `radar.js`),
  no network, no framework.
- `screenshots/` — the board, a detail view and a filtered view, rendered
  from this dashboard with this snapshot's data.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte
  from the kit.
