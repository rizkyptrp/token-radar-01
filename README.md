# Token Radar — token-radar-01

A token launch radar for the make.fun bounty. It reads the sealed DefiLlama
snapshot, ranks the protocols that record no token by the implied value of the
token they may one day issue, and writes a dashboard a reader can use: a
sortable, filterable board, a detail view per protocol with the model's own
arithmetic and a farm plan, the live-token protocols kept apart, and a sandbox
that re-runs the model with the reader's own constants.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only, no network. Two runs write the same bytes.

## The model (radar-2)

One function scores every row, from the snapshot's own figures only — no
protocol name is ever special-cased:

```
implied = round( tvl_usd × 0.30
               × (1 + clamp(change_7d, -60, +150) / 100 × 0.60)
               × (0.70 + min(age_days, 1095) / 1095 × 0.30)
               × (1 + min(chains − 1, 6) × 0.02) )
```

Age is days from `listed_at` to the snapshot's `as_of` date, never the wall
clock. The board covers all 40 watchlist slugs, then adds the 160 strongest
pre-token protocols below the $50M floor, ranked by this same implied value.
Protocols whose token already trades are shown apart at their market cap.

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
