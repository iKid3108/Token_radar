# Validation: does the ranking hold up out of sample?

This is the honest record of what the token radar's value model was checked against, what the
checks found, and what they cannot tell us. The harness lives in `lib/backtest.ts` with its rank
statistics in `lib/metrics.ts`.

Run it with:

```sh
BACKTEST=1 node main.ts --output out
```

It writes `out/backtest.json` and nothing else, so the validation path can never overwrite or be
mistaken for the shipped board. A plain `node main.ts` also embeds the same report into `out/data.js`
as `window.BACKTEST`, which is what the dashboard's **Validation** tab renders.

## The label, and the one real constraint

The sealed snapshot is **one cross-section**: a single `as_of`, and no future TVL. That rules out a
temporal walk-forward — there is no second point in time to measure a launch against. So the harness
runs the walk-forward shape the data *does* support: a **category-stratified holdout**.

The only forward-looking field the snapshot carries is `change_7d`, the protocol's own 7-day TVL
growth. That is the label. It is a proxy for "what a launch would be worth" and a weak one — more on
that below.

## The design

1. Every category's protocols are split into two halves, deterministically, by a hash of `(seed, slug)`.
   The split depends on neither the snapshot's order nor the engine's sort stability.
2. The comparables regression (`comparablesBaseline`) and the robust flow spread (`flowAdjust`) are
   **rebuilt on the train half alone**. Neither the slope, the category anchors, nor the flow centre and
   scale has seen a row it will later be scored against.
3. The test half's pre-token protocols are scored with that train-only fit.
4. Each score is compared to its own `change_7d` with Spearman rank IC, a top-quartile hit rate, and a
   seeded percentile bootstrap.

**The split is itself random.** One holdout at ~93 rows cannot separate "no signal" from "an unlucky
split," so the whole design is replayed over 5 independently seeded splits and their ICs summarised.
The bootstrap CI covers sampling noise *within* a split; the repeat block covers the *choice* of split.
They answer different questions and are reported side by side.

## The leakage, and how it is handled

Three of the model's tilts read `change_7d` — the same field used as the label:

- the **growth** tilt (its input is the winsorized flow),
- the **stale-week outlier** penalty (its input is the flow's z),
- the **velocity** boost (its input is the flow's z).

Scoring the shipped model against a label it already contains would be circular, and would report a
flattering, meaningless IC. So the **headline result is a leak-free configuration**: `growth_weight`,
`flow_penalty_step`, and `velocity_weight` are all set to zero, leaving base × concentration × maturity
— none of which touch the label. The shipped configuration is reported *beside* it, not as a result but
as a control, and the difference between the two is measured (`leakage_gap`) rather than assumed.

## What the numbers actually are

From `out/backtest.json` (seed `20261114`, 2000 bootstrap resamples, 95% level):

**Split:** 395 train protocols, 363 test protocols, 80 live train peers. Of the test half, **93 rows**
carried a usable label across **22 categories**; 8 of those categories had no live peer in the train
half and took the global fallback fit.

**Leak-free configuration (the headline):**

| metric | value |
|---|---|
| rank IC | **−0.083** |
| 95% bootstrap CI | **[−0.270, +0.122]** |
| top-quartile picks | 24 |
| top-quartile hits | 6 (25.0%) |
| blind-pick base rate | 25.8% |
| lift over blind | **−0.81 pp** |

**Shipped configuration (leakage control only):** rank IC −0.095 (−0.0945 stored), CI
[−0.287, +0.115]. The `leakage_gap` is **−0.011** — the leaked and leak-free ICs are indistinguishable.

**Across 5 independently seeded splits:** mean −0.004, median −0.056, range −0.083 to +0.104, with
**40%** of splits above zero. Individual splits: −0.083, +0.104, +0.091, −0.077, −0.056.

**By category** (leak-free, held out): only **Risk Curators** is positive (+0.35, 17 rows). The largest
bucket that isn't is Onchain Capital Allocator (−0.64, 10 rows); Yield Aggregator is −0.70 on 5 rows and
Dexs −0.43 on 8 rows. Twelve of the 22 categories (14 rows) hold too few rows to compute a rho at all.

## The honest read: these numbers are weak

**The model shows no reliable out-of-sample rank signal against 7-day TVL growth on this snapshot.**
The leak-free IC point estimate is slightly negative, its 95% interval spans zero, and the hit rate for
top-quartile picks is *below* the blind-pick base rate. The repeat block agrees: the mean IC across
five splits is essentially zero and only two of five splits are positive. This is not one unlucky
split; it is what the harness consistently finds.

The `leakage_gap` of −0.011 is worth dwelling on, because it says something structural rather than
just "the score is noisy." The tilts that read the label barely move the ranking. The reason is that
`base_value_usd` spans orders of magnitude across categories while each tilt is a *narrow*
multiplicative band (growth ×0.85–1.30, velocity ×1.00–1.10, concentration ×0.92–1.00). The base
dominates, and the ranking is very nearly the base ranking. So the leak that exists in principle turns
out to be too small to move this particular board — which is reassuring for the leak question and
unflattering for the tilts' claim to matter.

Two further caveats that bound how much any of this can mean:

- **The label is a proxy, not the target.** `change_7d` is TVL momentum over one week. The board claims
  to rank *what a launch would be worth*. A protocol with flat TVL and a strong launch outcome would be
  scored as a miss by this label and a hit by the real one, and vice versa. A near-zero IC against TVL
  momentum is evidence about TVL momentum, not a verdict on the launch-value claim.
- **The scored set is thin and shallow.** 93 rows, 22 categories, 8 scoring categories on a global
  fallback fit. Per-category ICs on 1–5 rows are noise by construction; the by-category table is
  reported for transparency, not as evidence.

## What would actually improve it

In rough order of how much they would help:

1. **A second snapshot in time.** Fitting at *t* and measuring against outcomes realised at *t+1* is the
   only version of this that tests the actual claim. The current design is a holdout across protocols,
   not across time, because the sealed input permits nothing else. Given ≥2 snapshots, this harness's
   `evaluateSplit` becomes the per-window step of a real walk-forward.
2. **A better label.** Ideally a launch outcome —- whether a token was subsequently recorded, and its
   FDV at launch —- crossed against a historical snapshot. Failing that, a category-relative multiple
   (cap/TVL versus the category median) is a closer proxy for "is this mispriced for its size" than raw
   TVL momentum.
3. **Let the tilts act over a wider range**, or normalise the base within category before tilting, so
   that growth and velocity can change an order rather than nudging it. As it stands the model is close
   to a pure comparables ranking with decoration.
4. **Pool or shrink the per-category estimates.** With 53 categories and many singletons,
   within-category fitting is thin; the 8 fallback categories already show the strain. A hierarchical
   prior over categories (the `multiple_prior_weight` shrinkage is a start) would steady the small
   buckets.
5. **Report a within-category IC only where n is large enough**, and treat the rest as descriptive.
   Mixing 17-row and 1-row categories in one table invites overreading.

## Reproducing

Determinism is by construction: the split hashes `(seed, slug)` with FNV-1a, and the bootstrap uses a
seeded `mulberry32`. There is no clock and no ambient randomness, so two runs write identical bytes.

```sh
BACKTEST=1 node main.ts --output /tmp/a
BACKTEST=1 node main.ts --output /tmp/b
cmp /tmp/a/backtest.json /tmp/b/backtest.json   # identical

# a different split, to see the spread for yourself:
node -e "import('./lib/backtest.ts').then(async b => {
  const fs = await import('node:fs');
  const { parseSnapshot } = await import('./lib/model.ts');
  const s = parseSnapshot(fs.readFileSync('input/snapshot.json','utf8'));
  for (const seed of [20261114, 999]) console.log(seed, b.runBacktest(s, { seed }).leak_free.rank_ic.point);
})"
```

The harness's own `warnings` array in `out/backtest.json` states the conclusions above in machine-readable
form, and the dashboard's Validation tab renders them beside the numbers rather than burying them.
