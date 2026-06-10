"""LPI (Leverage Pressure Index) — futures-only positioning fragility index.

Sign convention: positive LPI = long-crowded (fragile to downside flush),
negative LPI = short-crowded (squeeze/bounce risk). It measures structural
fragility, not direction.

Four components, each normalised to a rolling z-score so they are
comparable, then combined with equal weights (weights deliberately NOT
fitted — see design notes in README):

  funding_z : z-score of the funding rate. Persistently high funding =
              longs paying through the nose to stay in.
  oi_z      : z-score of 24h ΔOI/OI, signed by 24h price direction.
              Price up + OI surging = fresh leveraged longs piling in.
              Price down + OI surging = fresh shorts piling in (negative).
  cvd_div_z : price z minus CVD z over 24h. Price making strength that
              taker flow doesn't confirm = leverage pump without demand.
  liq_z     : z of log(short-liq / long-liq) rolling 24h sums. Shorts
              getting torched = squeeze burning its own fuel (long-side
              crowding building). Live-only — archive data unavailable.

Missing components are skipped and the remaining weights renormalised,
so the same code serves the 3-component backtest and the 4-component
live indicator.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Rolling normalisation window: 30 days of hourly bars.
Z_WINDOW = 30 * 24
# Horizon for "impulse" measures (OI change, price/CVD divergence).
IMPULSE_H = 24
# Component z-scores are clipped here so one wild print can't dominate.
CLIP = 4.0

WEIGHTS = {"funding_z": 0.25, "oi_z": 0.25, "cvd_div_z": 0.25, "liq_z": 0.25}


def rolling_z(s: pd.Series, window: int = Z_WINDOW, min_periods: int | None = None) -> pd.Series:
    mp = min_periods or window // 2
    mu = s.rolling(window, min_periods=mp).mean()
    sd = s.rolling(window, min_periods=mp).std()
    return ((s - mu) / sd).clip(-CLIP, CLIP)


def compute_components(df: pd.DataFrame) -> pd.DataFrame:
    """df: hourly bars with close, volume, taker_buy_volume, funding_rate,
    open_interest and optionally long_liq_vol / short_liq_vol."""
    out = pd.DataFrame(index=df.index)
    ret = df["close"].pct_change(IMPULSE_H)

    out["funding_z"] = rolling_z(df["funding_rate"])

    oi_chg = df["open_interest"].pct_change(IMPULSE_H)
    out["oi_z"] = rolling_z(oi_chg) * np.sign(ret)

    # CVD from taker flow: buy volume minus sell volume, cumulated.
    delta = 2.0 * df["taker_buy_volume"] - df["volume"]
    cvd = delta.cumsum()
    # Scale CVD change by traded volume so the divergence is regime-free.
    cvd_chg = cvd.diff(IMPULSE_H) / df["volume"].rolling(IMPULSE_H).sum()
    div = rolling_z(ret) - rolling_z(cvd_chg)
    out["cvd_div_z"] = (div / np.sqrt(2)).clip(-CLIP, CLIP)

    if {"long_liq_vol", "short_liq_vol"}.issubset(df.columns):
        eps = 1.0
        long_l = df["long_liq_vol"].rolling(IMPULSE_H).sum()
        short_l = df["short_liq_vol"].rolling(IMPULSE_H).sum()
        out["liq_z"] = rolling_z(np.log((short_l + eps) / (long_l + eps)))

    return out


def compute_lpi(df: pd.DataFrame, weights: dict[str, float] | None = None) -> pd.DataFrame:
    """Returns component columns plus the composite `lpi`.

    Weighted mean over the components present at each bar; weights are
    renormalised over non-NaN components so a missing feed degrades the
    index gracefully instead of biasing it toward zero.
    """
    w = weights or WEIGHTS
    comps = compute_components(df)
    cols = [c for c in comps.columns if c in w]
    wvec = np.array([w[c] for c in cols])
    vals = comps[cols].to_numpy()
    mask = ~np.isnan(vals)
    wsum = (mask * wvec).sum(axis=1)
    num = np.nansum(vals * wvec, axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        raw = np.where(wsum > 0, num / wsum, np.nan)
    raw = pd.Series(raw, index=comps.index)
    # Require at least half the total weight to be live before printing a value.
    raw[wsum < 0.5 * wvec.sum()] = np.nan
    # A mean of imperfectly correlated z-scores has stdev well below 1, which
    # would make a ±2 threshold near-unreachable. Re-standardise the composite
    # against its own rolling distribution so ±2 means "2σ vs the last 30d".
    comps["lpi"] = rolling_z(raw)
    return comps
