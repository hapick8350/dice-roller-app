"""Live LPI collector — Binance USDT-M futures websocket + REST.

Collects the four raw feeds and appends hourly bars to a CSV that
indicator.compute_lpi() consumes directly:

  markPrice stream   -> funding_rate        (1s updates, last per hour)
  forceOrder stream  -> long/short_liq_vol  (liquidations; SELL side = long liq)
  aggTrade stream    -> volume / taker_buy_volume (CVD)
  REST openInterest  -> open_interest       (polled each minute)

Liquidation history is NOT downloadable anywhere for free, which is why
this must run continuously — start it well before you need the liq_z
component (the 30-day z-window needs warm-up; until then compute_lpi
degrades to the other components automatically).

Usage:  python3 collector.py BTCUSDT [out.csv]

Note: requires a network location Binance serves (fapi.binance.com /
fstream.binance.com return HTTP 451 from some regions, including the
container this was developed in — run it on your bot host).
"""

from __future__ import annotations

import asyncio
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
import websockets

WS = "wss://fstream.binance.com/stream"
REST_OI = "https://fapi.binance.com/fapi/v1/openInterest"

FIELDS = [
    "ts", "close", "volume", "taker_buy_volume", "funding_rate",
    "open_interest", "long_liq_vol", "short_liq_vol",
]


class HourBar:
    def __init__(self) -> None:
        self.close = None
        self.volume = 0.0
        self.taker_buy = 0.0
        self.funding = None
        self.oi = None
        self.long_liq = 0.0
        self.short_liq = 0.0


class Collector:
    def __init__(self, symbol: str, out_path: str) -> None:
        self.symbol = symbol.upper()
        self.out = Path(out_path)
        self.bar = HourBar()
        self.hour = self._now_hour()
        if not self.out.exists():
            with self.out.open("w", newline="") as f:
                csv.writer(f).writerow(FIELDS)

    @staticmethod
    def _now_hour() -> datetime:
        return datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    def _roll_if_needed(self) -> None:
        now = self._now_hour()
        if now == self.hour:
            return
        b, self.bar = self.bar, HourBar()
        with self.out.open("a", newline="") as f:
            csv.writer(f).writerow([
                self.hour.isoformat(), b.close, b.volume, b.taker_buy,
                b.funding, b.oi, b.long_liq, b.short_liq,
            ])
        print(f"[{self.hour.isoformat()}] bar written "
              f"close={b.close} liqL={b.long_liq:.0f} liqS={b.short_liq:.0f}")
        self.hour = now

    def on_event(self, stream: str, d: dict) -> None:
        self._roll_if_needed()
        b = self.bar
        if stream.endswith("@markPrice"):
            b.funding = float(d["r"])
        elif stream.endswith("@aggTrade"):
            price, qty = float(d["p"]), float(d["q"])
            b.close = price
            b.volume += qty
            if not d["m"]:  # buyer is taker
                b.taker_buy += qty
        elif stream.endswith("@forceOrder"):
            o = d["o"]
            notional = float(o["q"]) * float(o["ap"])
            # A liquidated long is force-SOLD.
            if o["S"] == "SELL":
                b.long_liq += notional
            else:
                b.short_liq += notional

    async def poll_oi(self) -> None:
        while True:
            try:
                r = requests.get(REST_OI, params={"symbol": self.symbol}, timeout=10)
                r.raise_for_status()
                self.bar.oi = float(r.json()["openInterest"])
            except requests.RequestException as e:
                print(f"OI poll failed: {e}")
            await asyncio.sleep(60)

    async def consume_ws(self) -> None:
        s = self.symbol.lower()
        streams = f"{s}@markPrice/{s}@aggTrade/{s}@forceOrder"
        backoff = 1
        while True:
            try:
                async with websockets.connect(f"{WS}?streams={streams}") as ws:
                    backoff = 1
                    async for raw in ws:
                        msg = json.loads(raw)
                        self.on_event(msg["stream"], msg["data"])
            except Exception as e:
                print(f"ws reconnect in {backoff}s: {e}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    async def run(self) -> None:
        await asyncio.gather(self.consume_ws(), self.poll_oi())


if __name__ == "__main__":
    sym = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    out = sys.argv[2] if len(sys.argv) > 2 else f"live_{sym}.csv"
    asyncio.run(Collector(sym, out).run())
