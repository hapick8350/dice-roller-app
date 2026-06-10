"""Run the LPI backtest on real Binance USDT-M archive data.

Usage:  python3 run_backtest.py [SYMBOL ...]   (default: BTCUSDT ETHUSDT)

Downloads ~13 months of 1h klines, funding and 5-min OI (cached under
data_cache/), computes the LPI and prints/saves the event study.
"""

from __future__ import annotations

import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from backtest import run_backtest
from data import load_dataset
from indicator import compute_lpi

START, END = "2025-05", "2026-05"  # first month burns in the 30d z-window
THRESHOLD = 2.0

pd.set_option("display.width", 160)
pd.set_option("display.float_format", lambda v: f"{v:,.3f}")


def plot(symbol: str, df: pd.DataFrame, comps: pd.DataFrame, path: str) -> None:
    fig, axes = plt.subplots(2, 1, figsize=(14, 8), sharex=True, height_ratios=[2, 1])
    axes[0].plot(df.index, df["close"], lw=0.8, color="black")
    lpi = comps["lpi"]
    for sign, color in [(1, "red"), (-1, "green")]:
        m = sign * lpi >= THRESHOLD
        axes[0].scatter(df.index[m], df["close"][m], s=12, color=color, zorder=3,
                        label="long-crowded" if sign > 0 else "short-crowded")
    axes[0].set_title(f"{symbol} close — LPI extremes (±{THRESHOLD})")
    axes[0].legend()
    axes[1].plot(lpi.index, lpi, lw=0.7)
    axes[1].axhline(THRESHOLD, color="red", ls="--", lw=0.7)
    axes[1].axhline(-THRESHOLD, color="green", ls="--", lw=0.7)
    axes[1].set_title("LPI")
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)


def main() -> None:
    symbols = sys.argv[1:] or ["BTCUSDT", "ETHUSDT"]
    for symbol in symbols:
        print(f"\n{'=' * 70}\n{symbol}  {START} → {END}\n{'=' * 70}")
        df = load_dataset(symbol, START, END)
        comps = compute_lpi(df)
        res = run_backtest(df, comps, THRESHOLD)

        print(f"\nbars: {len(df)}   long-crowded events: {res['n_long_events']}"
              f"   short-crowded events: {res['n_short_events']}")
        print(f"\n-- LPI >= +{THRESHOLD} (long-crowded → fade short). "
              "fade_mean > baseline & hit>50% supports the signal --")
        print(res["long_crowded"].to_string(index=False))
        print(f"\n-- LPI <= -{THRESHOLD} (short-crowded → fade long) --")
        print(res["short_crowded"].to_string(index=False))
        print("\n-- component IC vs forward 24h return (negative = expected sign) --")
        print(res["component_ic"].to_string(index=False))
        print("\n-- grid-bot risk filter: conditions ahead of the next 24h --")
        print(res["risk_filter"].to_string(index=False))
        print("\n-- out-of-sample split (long-crowded side) --")
        for name, tbl in res["oos_split"].items():
            print(f"[{name}]")
            print(tbl.to_string(index=False))

        out = f"lpi_{symbol}.png"
        plot(symbol, df, comps, out)
        print(f"\nchart saved: {out}")


if __name__ == "__main__":
    main()
