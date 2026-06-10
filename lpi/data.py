"""Binance USDT-M futures historical data loader (data.binance.vision archive).

The archive is reachable even where the live API (fapi.binance.com) is
geo-blocked, so backtests use it exclusively. Datasets used:

  - monthly/klines/<SYM>/1h   : OHLCV + taker_buy_volume  (price, CVD)
  - monthly/fundingRate/<SYM> : 8h funding rates          (funding extremity)
  - daily/metrics/<SYM>       : 5-min open interest       (OI impulse)

liquidationSnapshot was discontinued in the archive (404), so the
liquidation-asymmetry component is live-only (see collector.py).
"""

from __future__ import annotations

import io
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import requests

BASE = "https://data.binance.vision/data/futures/um"
CACHE = Path(__file__).resolve().parent / "data_cache"


def _fetch(url: str) -> bytes | None:
    """Download a zip from the archive with on-disk caching. None on 404."""
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / url.rsplit("/", 1)[-1]
    if cached.exists():
        return cached.read_bytes()
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=60)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            cached.write_bytes(r.content)
            return r.content
        except requests.RequestException:
            if attempt == 3:
                raise
    return None


def _read_zip_csv(blob: bytes) -> pd.DataFrame:
    """Read the single CSV inside an archive zip, tolerating the optional
    header row (older files have none, newer ones do)."""
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        raw = zf.read(zf.namelist()[0])
    first = raw.split(b"\n", 1)[0].split(b",")[0]
    has_header = not first.strip().replace(b".", b"").replace(b"-", b"").isdigit()
    return pd.read_csv(io.BytesIO(raw), header=0 if has_header else None)


def _months(start: str, end: str) -> list[str]:
    return [str(p) for p in pd.period_range(start, end, freq="M")]


def _days(start: str, end: str) -> list[date]:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    return [s + timedelta(d) for d in range((e - s).days + 1)]


KLINE_COLS = [
    "open_time", "open", "high", "low", "close", "volume", "close_time",
    "quote_volume", "count", "taker_buy_volume", "taker_buy_quote_volume", "ignore",
]


def load_klines(symbol: str, start: str, end: str, interval: str = "1h") -> pd.DataFrame:
    frames = []
    for m in _months(start, end):
        blob = _fetch(f"{BASE}/monthly/klines/{symbol}/{interval}/{symbol}-{interval}-{m}.zip")
        if blob is None:
            continue
        df = _read_zip_csv(blob)
        df.columns = KLINE_COLS
        frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    out["ts"] = pd.to_datetime(out["open_time"], unit="ms", utc=True)
    out = out.set_index("ts").sort_index()
    return out[["open", "high", "low", "close", "volume", "taker_buy_volume"]].astype(float)


def load_funding(symbol: str, start: str, end: str) -> pd.Series:
    frames = []
    for m in _months(start, end):
        blob = _fetch(f"{BASE}/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{m}.zip")
        if blob is None:
            continue
        df = _read_zip_csv(blob)
        df.columns = ["calc_time", "funding_interval_hours", "last_funding_rate"]
        frames.append(df)
    out = pd.concat(frames, ignore_index=True)
    out["ts"] = pd.to_datetime(out["calc_time"], unit="ms", utc=True)
    return out.set_index("ts").sort_index()["last_funding_rate"].astype(float)


def load_open_interest(symbol: str, start: str, end: str) -> pd.Series:
    """5-min open interest from daily metrics files, downloaded in parallel."""
    urls = [
        f"{BASE}/daily/metrics/{symbol}/{symbol}-metrics-{d.isoformat()}.zip"
        for d in _days(start, end)
    ]
    with ThreadPoolExecutor(max_workers=16) as ex:
        blobs = list(ex.map(_fetch, urls))
    frames = []
    for blob in blobs:
        if blob is None:
            continue
        df = _read_zip_csv(blob)
        df.columns = [
            "create_time", "symbol", "sum_open_interest", "sum_open_interest_value",
            "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio",
            "count_long_short_ratio", "sum_taker_long_short_vol_ratio",
        ]
        frames.append(df[["create_time", "sum_open_interest"]])
    out = pd.concat(frames, ignore_index=True)
    out["ts"] = pd.to_datetime(out["create_time"], utc=True)
    return out.set_index("ts").sort_index()["sum_open_interest"].astype(float)


def load_dataset(symbol: str, start: str, end: str) -> pd.DataFrame:
    """Hourly panel: OHLCV + taker buy volume + funding (ffilled) + OI."""
    px = load_klines(symbol, start, end)
    funding = load_funding(symbol, start, end)
    oi = load_open_interest(
        symbol, f"{start}-01", str(pd.Period(end, "M").end_time.date())
    )
    df = px.copy()
    df["funding_rate"] = funding.reindex(df.index, method="ffill")
    df["open_interest"] = oi.resample("1h").last().reindex(df.index).ffill()
    return df
