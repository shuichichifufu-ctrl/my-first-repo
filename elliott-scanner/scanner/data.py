"""価格データの取得（yfinance）。失敗しても全体を止めず、失敗理由を返す。"""
from __future__ import annotations

import time
from typing import Dict, List, Tuple

import pandas as pd
import yaml


def load_config(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def fetch_one(symbol: str, period: str = "2y", retries: int = 3) -> pd.DataFrame:
    import yfinance as yf

    last: Exception | None = None
    for k in range(retries):
        try:
            df = yf.download(symbol, period=period, interval="1d", auto_adjust=True, progress=False,
                             threads=False)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df.dropna(subset=["High", "Low", "Close"])
            if len(df) < 120:
                raise ValueError(f"データが少なすぎます（{len(df)}本）")
            return df
        except Exception as e:  # noqa: BLE001 - 取得失敗は理由付きで呼び出し側へ
            last = e
            time.sleep(2 * (k + 1))
    raise RuntimeError(str(last))


def fetch_all(instruments: List[dict], period: str = "2y") -> Tuple[Dict[str, pd.DataFrame], Dict[str, str]]:
    data: Dict[str, pd.DataFrame] = {}
    failed: Dict[str, str] = {}
    for ins in instruments:
        sym = ins["symbol"]
        try:
            data[sym] = fetch_one(sym, period)
        except Exception as e:  # noqa: BLE001
            failed[sym] = f"{type(e).__name__}: {e}"
    return data, failed
