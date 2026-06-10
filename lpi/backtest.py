"""Event-study backtest for the LPI.

Two questions, matching the two intended uses:

1. Contrarian timing — after LPI crosses an extreme, are forward returns
   skewed against the crowd? (LPI > +2 → negative drift; < -2 → positive)
2. Grid-bot risk filter — is realized volatility / max adverse excursion
   materially higher when |LPI| is extreme?

Deliberately simple: no position sizing, no fees, no fitted parameters.
Events are deduplicated (first threshold cross, then a cooldown) so
overlapping bars don't inflate the sample size.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

HORIZONS = [4, 12, 24, 48]
COOLDOWN = 24  # hours between counted events


def forward_returns(close: pd.Series) -> pd.DataFrame:
    return pd.DataFrame(
        {f"fwd_{h}h": close.shift(-h) / close - 1.0 for h in HORIZONS},
        index=close.index,
    )


def dedup_events(signal: pd.Series, cooldown: int = COOLDOWN) -> pd.Series:
    """True only on the first bar of a signal episode, with a cooldown."""
    out = pd.Series(False, index=signal.index)
    last = -10**9
    sig = signal.to_numpy()
    for i in range(len(sig)):
        if sig[i] and i - last >= cooldown:
            out.iloc[i] = True
            last = i
    return out


def event_stats(fwd: pd.DataFrame, events: pd.Series, side: int) -> pd.DataFrame:
    """side=+1: LPI long-crowded, profit = price falling (we'd fade short).
    Reported returns are crowd-fading returns: side * -fwd_ret."""
    rows = []
    sel = fwd[events]
    for h in HORIZONS:
        r = -side * sel[f"fwd_{h}h"].dropna()
        base = -side * fwd[f"fwd_{h}h"].dropna()
        t, p = (np.nan, np.nan)
        if len(r) > 2:
            t, p = stats.ttest_1samp(r, base.mean())
        rows.append(
            {
                "horizon": f"{h}h",
                "n_events": len(r),
                "fade_mean_%": 100 * r.mean(),
                "fade_median_%": 100 * r.median(),
                "hit_rate_%": 100 * (r > 0).mean(),
                "baseline_mean_%": 100 * base.mean(),
                "t_vs_base": t,
                "p_value": p,
            }
        )
    return pd.DataFrame(rows)


def component_ic(comps: pd.DataFrame, fwd: pd.DataFrame, h: int = 24) -> pd.DataFrame:
    """Spearman IC of each component vs forward return. Negative IC is the
    expected sign (high pressure → lower forward return)."""
    rows = []
    y = fwd[f"fwd_{h}h"]
    for c in comps.columns:
        pair = pd.concat([comps[c], y], axis=1).dropna()
        ic, p = stats.spearmanr(pair.iloc[:, 0], pair.iloc[:, 1])
        rows.append({"component": c, f"spearman_ic_{h}h": ic, "p_value": p, "n": len(pair)})
    return pd.DataFrame(rows)


def risk_filter_stats(df: pd.DataFrame, lpi: pd.Series, thr: float = 2.0) -> pd.DataFrame:
    """Realized vol and max adverse excursion over the next 24h,
    conditional on |LPI| extreme vs normal."""
    ret1h = df["close"].pct_change()
    fwd_vol = ret1h.rolling(24).std().shift(-24) * np.sqrt(24)
    fwd_min = df["low"].rolling(24).min().shift(-24) / df["close"] - 1.0
    fwd_max = df["high"].rolling(24).max().shift(-24) / df["close"] - 1.0
    extreme = lpi.abs() >= thr
    rows = []
    for label, m in [("|LPI| >= 2", extreme), ("|LPI| < 2", ~extreme & lpi.notna())]:
        rows.append(
            {
                "regime": label,
                "n_bars": int(m.sum()),
                "fwd_24h_vol_%": 100 * fwd_vol[m].mean(),
                "mean_max_drawdown_24h_%": 100 * fwd_min[m].mean(),
                "mean_max_runup_24h_%": 100 * fwd_max[m].mean(),
            }
        )
    return pd.DataFrame(rows)


def run_backtest(df: pd.DataFrame, comps: pd.DataFrame, thr: float = 2.0) -> dict:
    lpi = comps["lpi"]
    fwd = forward_returns(df["close"])
    long_events = dedup_events(lpi >= thr)
    short_events = dedup_events(lpi <= -thr)
    half = lpi.dropna().index[len(lpi.dropna()) // 2]
    return {
        "long_crowded": event_stats(fwd, long_events, +1),
        "short_crowded": event_stats(fwd, short_events, -1),
        "component_ic": component_ic(
            comps[[c for c in comps.columns if c != "lpi"] + ["lpi"]], fwd
        ),
        "risk_filter": risk_filter_stats(df, lpi, thr),
        "oos_split": {
            "first_half": event_stats(
                fwd[fwd.index < half], dedup_events((lpi >= thr)[lpi.index < half]), +1
            ),
            "second_half": event_stats(
                fwd[fwd.index >= half], dedup_events((lpi >= thr)[lpi.index >= half]), +1
            ),
        },
        "n_long_events": int(long_events.sum()),
        "n_short_events": int(short_events.sum()),
    }
