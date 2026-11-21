# Token Radar: run report

Snapshot `2026-11-14` · floor $50.0M · model `radar-4/velocity-concentration` · 197 ranked rows · 40 on the watchlist.

Source: DefiLlama https://api.llama.fi/protocols, fetched 2026-11-14T01:18:33.201Z

Backtest: 93 held-out rows across 22 categories, seed `20261114`, 2000 bootstrap resamples at 95%.

## Executive summary

The strongest row is **Sentora Curator** (Risk Curators), ranked #1 with an implied value of $427.9M on $2.76B of TVL.

Of the 197 ranked rows, 40 are on the snapshot watchlist, 138 are early finds below the floor, and 19 sit at or above the floor without appearing on the list.

Held out, the leak-free ranking scores a rank IC of **-0.083** with a 95% interval of [-0.270, +0.122]; its top quartile catches 6 of 24 realized top-quartile rows (25.0%) against a 25.8% blind rate.

The interval spans zero, so on this snapshot the ranking is not distinguishable from noise out of sample. See **Caveats**; the harness reaches the same conclusion independently.

Implied value is this radar’s estimate of what a launch would be worth, not a price, a promise of a token, or investment advice. A record with no token is not proof that none exists.

## The top of the board

| # | Protocol | Category | TVL | 7d growth | Cap/TVL | Implied value | Origin |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| #1 | Sentora Curator | Risk Curators | $2.76B | +2.37% | 0.16x | $427.9M | off-list |
| #2 | Steakhouse Financial | Risk Curators | $2.75B | -2.19% | 0.15x | $423.0M | watchlist |
| #3 | Gauntlet | Risk Curators | $1.58B | +5.64% | 0.19x | $297.7M | watchlist |
| #4 | Polymarket International | Prediction Market | $320.2M | -1.08% | 0.59x | $190.0M | off-list |
| #5 | USDD | CDP | $1.06B | -2.81% | 0.11x | $115.1M | watchlist |
| #6 | Nonce Capital | Risk Curators | $513.8M | -9.74% | 0.18x | $94.9M | watchlist |
| #7 | Veda | Onchain Capital Allocator | $1.56B | -8.29% | 0.05x | $80.8M | watchlist |
| #8 | Symbiotic | Collateral Markets | $253.9M | -12.03% | 0.28x | $71.0M | watchlist |
| #9 | RockawayX | Risk Curators | $292.5M | -2.55% | 0.24x | $69.9M | watchlist |
| #10 | Defi Saver Asset Management | CDP Manager | $276.4M | -19.58% | 0.23x | $64.2M | off-list |
| #11 | Hyperithm | Risk Curators | $221.6M | -4.38% | 0.27x | $60.6M | watchlist |
| #12 | K3 Capital | Risk Curators | $207.7M | -8.90% | 0.27x | $55.3M | watchlist |

The full ranking is in `board.json`; every row carries the components this table abbreviates.

## Consensus across the tilts

Each stored tilt ranks the board on its own; Borda counts those six orderings and a row’s score is the sum of its positions (a first place in a 197-row board is worth 196). A pick near the top of the consensus does not depend on one arbitrary weighting.

Across all 197 rows, the consensus ordering and the board’s ordering agree at Kendall’s tau-b = +0.3328; the head of the table is where they differ, which is the point of the exercise.

| Consensus | Protocol | Board | base | flow | stale | velocity | chain | maturity | Borda |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| #1 | CIAN Yield Layer | #26 | #28 | #21 | #34 | #2 | #18 | #36 | 1043 |
| #2 | Gauntlet | #3 | #3 | #17 | #60 | #5 | #31 | #65 | 1001 |
| #3 | Apex Omni | #52 | #58 | #72 | #12 | #76 | #6 | #22 | 936 |
| #4 | Aegis YUSD | #51 | #52 | #48 | #5 | #89 | #2 | #59 | 927 |
| #5 | Predict Fun | #49 | #60 | #10 | #112 | #6 | #55 | #28 | 911 |
| #6 | Gami Labs | #34 | #40 | #11 | #59 | #4 | #30 | #154 | 884 |
| #7 | Armitage by Wintermute | #27 | #26 | #16 | #14 | #1 | #94 | #150 | 881 |
| #8 | Upshift | #20 | #25 | #12 | #158 | #7 | #76 | #38 | 866 |
| #9 | Goose | #91 | #108 | #54 | #63 | #28 | #32 | #35 | 862 |
| #10 | AZverse Perps | #40 | #42 | #44 | #19 | #53 | #9 | #167 | 848 |

A rank of #1 under a tilt means that tilt alone would have put the row first; the base column is the comparables regression before any tilt, so a row that ranks low on base but high on consensus is being carried entirely by its adjustments.

## Per-category leaders

### Risk Curators (34 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #1 | Sentora Curator | $2.76B | +2.37% | $427.9M | off-list |
| #2 | Steakhouse Financial | $2.75B | -2.19% | $423.0M | watchlist |
| #3 | Gauntlet | $1.58B | +5.64% | $297.7M | watchlist |
| #6 | Nonce Capital | $513.8M | -9.74% | $94.9M | watchlist |

### Dexs (21 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #16 | Bittensor dTAO | $376.0M | -6.56% | $48.3M | watchlist |
| #62 | Nado Spot | $51.1M | -4.83% | $11.6M | off-list |
| #72 | Project X | $34.4M | -2.44% | $9.2M | below-floor |
| #81 | XRPL DEX | $27.7M | -12.46% | $8.1M | below-floor |

### Onchain Capital Allocator (18 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #7 | Veda | $1.56B | -8.29% | $80.8M | watchlist |
| #20 | Upshift | $499.1M | +8.31% | $40.0M | watchlist |
| #46 | Mellow Core | $232.6M | -8.53% | $17.2M | off-list |
| #53 | Lagoon | $151.3M | -3.30% | $14.4M | watchlist |

### Lending (16 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #44 | Figure Markets Prime | $190.5M | +18.03% | $17.7M | off-list |
| #47 | Curvance | $136.3M | +0.68% | $16.0M | watchlist |
| #56 | Tydro | $111.3M | -4.89% | $13.0M | watchlist |
| #75 | Loopscale Lending | $71.0M | -14.11% | $8.9M | off-list |

### RWA (16 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #13 | OnRe | $308.9M | +0.11% | $54.5M | watchlist |
| #15 | OpenTrade | $241.5M | -1.64% | $51.7M | watchlist |
| #18 | Plume Vaults | $211.5M | -3.08% | $47.0M | watchlist |
| #21 | R25 | $198.2M | +0.30% | $39.1M | watchlist |

### Yield (15 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #59 | infiniFi | $70.7M | -3.28% | $12.1M | watchlist |
| #67 | Yuzu Money | $57.3M | -9.05% | $9.6M | watchlist |
| #77 | Exponent Yield Exchange | $45.2M | -1.32% | $8.4M | below-floor |
| #80 | Noon | $38.3M | +1.14% | $8.2M | below-floor |

### Derivatives (13 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #25 | Extended Perps | $96.4M | -4.87% | $34.6M | off-list |
| #40 | AZverse Perps | $52.0M | +0.14% | $19.6M | off-list |
| #42 | Arcus Perps | $60.2M | -5.82% | $19.3M | off-list |
| #52 | Apex Omni | $26.8M | -1.26% | $14.4M | below-floor |

### CDP (9 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #5 | USDD | $1.06B | -2.81% | $115.1M | watchlist |
| #123 | Felix CDP | $18.9M | -10.39% | $4.4M | below-floor |
| #132 | Bucket CDP | $12.7M | -8.78% | $3.8M | below-floor |
| #155 | BIMA CDP | $9.7M | -6.41% | $3.0M | below-floor |

### Yield Aggregator (9 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #26 | CIAN Yield Layer | $280.3M | +4.67% | $33.2M | off-list |
| #106 | vfat.io | $28.1M | -11.10% | $5.2M | below-floor |
| #121 | Lulo | $24.5M | -4.79% | $4.5M | below-floor |
| #147 | Hyperbeat Earn | $17.6M | -4.97% | $3.3M | below-floor |

### Basis Trading (8 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #17 | BitFi Basis | $214.9M | -10.26% | $47.8M | off-list |
| #35 | Tori Finance | $77.4M | +4.64% | $22.0M | watchlist |
| #36 | Axis | $70.1M | +2.33% | $21.7M | watchlist |
| #51 | Aegis YUSD | $34.5M | +0.05% | $14.7M | below-floor |

### Chain (4 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #14 | Hive Protocol | $198.8M | -10.18% | $53.1M | watchlist |
| #31 | Noble | $83.0M | -5.23% | $25.8M | watchlist |
| #69 | XION Finance | $22.0M | -3.57% | $9.5M | below-floor |
| #117 | Abstract | $9.4M | -16.09% | $4.6M | below-floor |

### Liquidity Manager (3 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #96 | Arrakis Modular | $48.5M | -9.91% | $5.7M | below-floor |
| #171 | Steer Protocol | $13.7M | -7.72% | $2.4M | below-floor |
| #189 | Snuggle | $10.7M | -2.76% | $1.7M | below-floor |

### Staking Pool (3 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #134 | Reti Pooling | $65.3M | -10.69% | $3.7M | watchlist |
| #192 | Adrastea Validator | $22.1M | -16.71% | $1.5M | below-floor |
| #197 | Qearn | $11.0M | -8.52% | $961K | below-floor |

### Anchor BTC (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #54 | Vishwa | $45.3M | -10.64% | $13.4M | below-floor |
| #65 | Bitlayer YBTC Family | $27.2M | -10.49% | $9.8M | below-floor |

### CeDeFi (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #32 | Doppler Finance | $93.3M | -14.49% | $24.4M | watchlist |
| #91 | Goose | $12.8M | +0.01% | $6.1M | below-floor |

### Decentralized BTC (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #89 | Chain Fusion | $20.1M | -9.42% | $6.4M | below-floor |
| #170 | SUBFROST | $7.8M | -9.39% | $2.4M | below-floor |

### Dual-Token Stablecoin (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #114 | Hylo Protocol | $29.2M | -15.31% | $4.7M | below-floor |
| #136 | RIF ON CHAIN | $16.7M | -9.72% | $3.6M | below-floor |

### Farm (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #43 | Stellar DeFi Hub | $83.2M | +0.60% | $17.8M | off-list |
| #94 | Katana Pre-Launch | $17.6M | -3.13% | $6.0M | below-floor |

### Leveraged Farming (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #71 | 3F | $40.4M | -0.04% | $9.3M | below-floor |
| #78 | Origami Finance | $28.8M | -27.59% | $8.3M | below-floor |

### Prediction Market (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #4 | Polymarket International | $320.2M | -1.08% | $190.0M | off-list |
| #49 | Predict Fun | $10.7M | +9.40% | $15.4M | below-floor |

### Restaking (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #33 | b14g | $173.9M | -28.53% | $23.8M | watchlist |
| #180 | Valantis stHYPE Restaking | $8.2M | -1.31% | $2.0M | below-floor |

### Stablecoin Wrapper (2 ranked rows)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #22 | Saturn | $154.3M | -0.75% | $39.1M | watchlist |
| #48 | USDCx | $56.6M | -3.75% | $15.9M | off-list |

### CDP Manager (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #10 | Defi Saver Asset Management | $276.4M | -19.58% | $64.2M | off-list |

### Collateral Markets (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #8 | Symbiotic | $253.9M | -12.03% | $71.0M | watchlist |

### Crypto Card Issuer (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #57 | Plasma One | $31.9M | +0.20% | $12.6M | below-floor |

### Governance Incentives (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #64 | Mezo Earn | $53.6M | -12.22% | $11.0M | watchlist |

### Indexes (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #174 | Set Protocol | $10.1M | -12.70% | $2.3M | below-floor |

### Insurance (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #55 | Firelight | $51.3M | -14.41% | $13.0M | watchlist |

### Interest Rate Derivatives (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #187 | Boros | $6.8M | -10.38% | $1.7M | below-floor |

### OTC Marketplace (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #23 | Figure Markets Exchange | $131.3M | +2.28% | $37.2M | off-list |

### Payments (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #38 | Lightning Network | $217.9M | -10.14% | $21.7M | watchlist |

### Uncollateralized Lending (1 ranked row)

| # | Protocol | TVL | 7d growth | Implied value | Origin |
| ---: | --- | ---: | ---: | ---: | --- |
| #144 | 3Jane Lending | $14.0M | +26.30% | $3.3M | below-floor |

## Implied-value spread, by category

The p10, median and p90 of each category’s implied values, and the ratio between the ends: a wide ratio means the category spans very different protocols, so its single leader is less representative of the rest. A bucket marked **sparse** holds fewer than two rows per decile, so its quantiles are descriptive only.

| Category | Rows | p10 | Median | p90 | p90/p10 | Bottom / top decile | Shape |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Risk Curators | 34 | $3.5M | $9.2M | $87.4M | 24.8x | 4 / 4 | ok |
| Dexs | 21 | $2.2M | $3.6M | $9.2M | 4.2x | 3 / 2 | ok |
| Onchain Capital Allocator | 18 | $2.3M | $4.1M | $24.0M | 10.5x | 2 / 2 | sparse |
| Lending | 16 | $1.9M | $5.3M | $14.5M | 7.5x | 2 / 2 | sparse |
| RWA | 16 | $2.9M | $13.5M | $49.3M | 16.8x | 2 / 2 | sparse |
| Yield | 15 | $1.7M | $3.5M | $9.1M | 5.2x | 2 / 2 | sparse |
| Derivatives | 13 | $4.2M | $9.5M | $19.6M | 4.6x | 2 / 2 | sparse |
| CDP | 9 | $1.4M | $2.9M | $26.5M | 18.3x | 1 / 1 | sparse |
| Yield Aggregator | 9 | $1.4M | $3.2M | $10.8M | 7.9x | 1 / 1 | sparse |
| Basis Trading | 8 | $5.8M | $13.3M | $29.7M | 5.2x | 1 / 1 | sparse |

32 categories in all; the 10 largest are shown. The counts in each row sum to that category’s row count, so the buckets are exhaustive rather than sampled.

## Out-of-sample check

Design: category-stratified holdout over independently seeded splits (the sealed snapshot carries no future TVL, so this is the walk-forward shape the data supports). Label: `change_7d`. 93 scored rows from 22 categories; 8 of those categories had no live peer in the train half and took the global fallback fit.

### Headline metrics

| Configuration | Rank IC | 95% interval | Top-quartile hits | Blind rate | Lift |
| --- | ---: | ---: | ---: | ---: | ---: |
| Leak-free (headline) | -0.083 | [-0.270, +0.122] | 6 / 24 | 25.8% | -0.0081 |
| Shipped fit (control) | -0.095 | [-0.287, +0.115] | 6 / 24 | 25.8% | -0.0081 |

The **leak-free** row is the headline: growth, the stale-week penalty and velocity all read `change_7d`, the field used as the label, so they are switched off before the comparison. The shipped fit runs beside it as a control; its measured leakage gap is **-0.011**, so the gap is reported rather than assumed.

### Across independently seeded splits

| Splits | Mean IC | Median IC | Min | Max | Share positive |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | -0.004 | -0.056 | -0.083 | +0.104 | 40% |

5 splits at seeds `20261114`, `20269033`, `20276952`, `20284871`, `20292790`. The bootstrap interval covers noise inside one split; this spread covers the choice of split, which one holdout cannot show.

### Rank IC by category

10 of 22 categories held at least three rows (a rank correlation needs three); the rest are listed as `n/a` rather than dropped, because an absent number is information too.

| Category | Rows | Rank IC |
| --- | ---: | ---: |
| Risk Curators | 17 | +0.348 |
| Onchain Capital Allocator | 10 | -0.636 |
| Derivatives | 9 | -0.467 |
| Yield | 9 | -0.400 |
| Dexs | 8 | -0.429 |
| Basis Trading | 6 | -0.200 |
| Lending | 6 | -0.143 |
| RWA | 5 | -0.300 |
| Yield Aggregator | 5 | -0.700 |
| CDP | 4 | -0.400 |
| Chain | 2 | n/a |
| Staking Pool | 2 | n/a |
| CeDeFi | 1 | n/a |
| Crypto Card Issuer | 1 | n/a |
| Decentralized BTC | 1 | n/a |
| Dual-Token Stablecoin | 1 | n/a |
| Farm | 1 | n/a |
| Governance Incentives | 1 | n/a |
| Leveraged Farming | 1 | n/a |
| Liquidity Manager | 1 | n/a |
| Restaking | 1 | n/a |
| Stablecoin Wrapper | 1 | n/a |

### What the harness itself flags

- the 95% interval spans zero: this split shows no reliable out-of-sample signal
- the leaked and leak-free ICs agree to within 0.02: the label-reading tilts barely move this ranking
- 8 scored categories had no live peer in the train half and took the global fallback fit

## Caveats

- **The label is a proxy.** The snapshot carries one dynamic field, a seven-day TVL change, and a launch outcome is not that. A near-zero IC against TVL momentum is evidence about momentum, not a verdict on the implied-value claim.
- **The snapshot is one cross-section.** There is no second point in time, so the harness runs a category-stratified holdout across protocols rather than a temporal walk-forward. A second snapshot would make the real test possible.
- **The base dominates the tilts.** `base_value_usd` spans orders of magnitude while every tilt is a narrow band (growth ×0.85–×1.30, velocity at most ×1.10, concentration ×0.92), so the ranking is close to the comparables base.
- **Thin buckets.** With 53 categories and many singletons, per-category fits and per-category correlations are noisy by construction; read a row count before a rho.
- **Implied value is an estimate.** It is not a price, a promise of a token, or advice. A record with no token is not proof that none exists.
- **The harness’s own warnings apply to this run verbatim** (see the section above); this report does not soften them.

## Reproducing this report

```sh
node main.ts --board     # board.json, data.js, backtest.json, dashboard/, screenshots/, dossier.json
node main.ts --backtest  # backtest.json and nothing else (BACKTEST=1 still works)
node main.ts --report    # this file, from the two documents above
```

All three runs are deterministic — no clock, no randomness, no network — so two runs write identical bytes, and this report is a pure function of the two JSON documents.

Board: `makefun/token-radar/board/v1`. Rows are ranked by `implied_value_usd`, descending, with ranks 1..n contiguous.
