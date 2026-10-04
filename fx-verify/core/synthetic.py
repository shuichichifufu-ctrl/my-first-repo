"""テスト専用の合成OHLC生成。

【重要】ここで作るデータは実際の為替データではない。乱数で作った「トレンド+ノイズ」であり、
パイプライン(先読み防止・約定・集計)の動作確認とユニットテストにだけ使う。
このデータで出した成績は『手法の優位性の証拠』にならない。レポートに載せる場合は必ず合成データと明記すること。

構造(価格は対数で生成):
  1) レジーム型ドリフト: 数営業日ごとにランダムな向き・強さのトレンドが入れ替わる
  2) 数時間周期の平均回帰成分(OU): 押し・戻りの波を作る
  3) 日ごと・時間帯ごとに変わるボラティリティ(ロンドン・NY時間が大きい)
  4) 週末(サーバー時間の土日)は足を作らない
1分足を先に作り、15分足は1分足から集計する(両者が整合する)。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Sequence

import numpy as np
import pandas as pd

from .config import DayBoundaryConfig
from .data import BASE_COLS, resample_to_base, server_offset, to_naive_utc

SYNTHETIC_WARNING = "【合成データ】乱数で作ったテスト専用データです。実際の為替データではありません。"

DEFAULT_PAIRS = ("USDJPY", "EURUSD", "GBPUSD", "EURJPY")
_START_PRICE = {"USDJPY": 110.0, "EURUSD": 1.10, "GBPUSD": 1.30, "EURJPY": 130.0, "AUDUSD": 0.72}
_DAILY_VOL_PCT = {"USDJPY": 0.50, "EURUSD": 0.50, "GBPUSD": 0.60, "EURJPY": 0.60, "AUDUSD": 0.60}

# UTC時間帯ごとの相対ボラ(二乗平均が1になるよう後で正規化)
_HOUR_PROFILE = np.array(
    [0.5, 0.5, 0.5, 0.6, 0.6, 0.7, 0.8, 1.2, 1.4, 1.3, 1.1, 1.0,
     1.0, 1.4, 1.5, 1.4, 1.2, 1.0, 0.8, 0.7, 0.6, 0.5, 0.4, 0.4]
)


@dataclass
class SyntheticPair:
    pair: str
    m15: pd.DataFrame
    m1: Optional[pd.DataFrame] = None


def _ar1_smooth(x: np.ndarray, phi: float) -> np.ndarray:
    """y_t = phi*y_{t-1} + (1-phi)*x_t (指数平滑)。"""
    return pd.Series(x).ewm(alpha=1.0 - phi, adjust=False).mean().to_numpy()


def _simulate_m1(
    pair: str,
    start: str,
    years: float,
    seed: int,
    start_price: Optional[float],
    daily_vol_pct: Optional[float],
    trend_strength: float,
    swing_amp: float,
    day: DayBoundaryConfig,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    p0 = start_price if start_price is not None else _START_PRICE.get(pair, 1.0)
    dvol = (daily_vol_pct if daily_vol_pct is not None else _DAILY_VOL_PCT.get(pair, 0.5)) / 100.0

    n_total = int(round(years * 365.25 * 1440))
    idx_all = pd.date_range(pd.Timestamp(start), periods=n_total, freq="1min").as_unit("ns")
    off = server_offset(idx_all, day)
    dow = pd.DatetimeIndex(idx_all.to_numpy() + off).dayofweek.to_numpy()
    idx = idx_all[dow < 5]  # サーバー時間の土日は休場
    n = len(idx)

    hours = idx.hour.to_numpy()
    prof = _HOUR_PROFILE / np.sqrt((_HOUR_PROFILE**2).mean())
    sig_min = dvol / np.sqrt(1440.0)

    # 日ごとのボラ倍率(ゆっくり変わる)
    day_no = (idx.to_numpy().astype("int64") // (86400 * 10**9))
    day_no = day_no - day_no.min()
    n_days = int(day_no.max()) + 1
    vol_day = np.exp(_ar1_smooth(rng.normal(0, 0.6, n_days), 0.9))
    vol_day = vol_day / np.sqrt((vol_day**2).mean())
    sigma = sig_min * prof[hours] * vol_day[day_no]

    # レジーム型ドリフト(1日あたり trend_strength × 日次σ 程度)
    drift = np.empty(n)
    pos = 0
    while pos < n:
        length = max(1440, int(rng.exponential(6 * 1440)))
        drift[pos : pos + length] = rng.normal(0.0, trend_strength) * dvol / 1440.0
        pos += length

    # 数時間周期の平均回帰(押し・戻りの波)
    phi = np.exp(-1.0 / 480.0)
    sd_eps = swing_amp * dvol * np.sqrt((1 + phi) / (1 - phi))
    swing = _ar1_smooth(rng.normal(0.0, sd_eps, n), phi)

    logp = np.log(p0) + np.cumsum(drift + sigma * rng.normal(0.0, 1.0, n)) + swing
    close = np.exp(logp)
    open_ = np.r_[close[0], close[:-1]]
    wick = np.abs(rng.normal(0.0, 0.3, n)) * sigma * close
    high = np.maximum(open_, close) + wick
    low = np.minimum(open_, close) - np.abs(rng.normal(0.0, 0.3, n)) * sigma * close
    df = pd.DataFrame(
        {"time": to_naive_utc(idx), "open": open_, "high": high, "low": low, "close": close,
         "volume": np.ones(n)}
    )
    return df[BASE_COLS]


def generate_synthetic(
    pair: str = "USDJPY",
    *,
    start: str = "2018-01-01",
    years: float = 3.0,
    seed: int = 0,
    start_price: Optional[float] = None,
    daily_vol_pct: Optional[float] = None,
    trend_strength: float = 0.5,
    swing_amp: float = 0.5,
    with_m1: bool = False,
    day: Optional[DayBoundaryConfig] = None,
) -> SyntheticPair:
    """1通貨ペア分の合成データ(15分足、任意で1分足)。seed が同じなら同じ結果。

    trend_strength : レジームごとのドリフトの標準偏差(日次σ倍)。大きいほどトレンドが強い。
    swing_amp      : 押し戻しの波の大きさ(日次σ倍)。
    """
    d = day or DayBoundaryConfig(gmt_shift_hours=0.0)
    m1 = _simulate_m1(pair, start, years, seed, start_price, daily_vol_pct, trend_strength, swing_amp, d)
    m15 = resample_to_base(m1, 15)
    for df in (m15, m1):
        df.attrs["synthetic"] = True
        df.attrs["pair"] = pair
        df.attrs["warning"] = SYNTHETIC_WARNING
    return SyntheticPair(pair=pair, m15=m15, m1=m1 if with_m1 else None)


def generate_universe(
    pairs: Sequence[str] = DEFAULT_PAIRS,
    *,
    start: str = "2018-01-01",
    years: float = 3.0,
    seed: int = 0,
    with_m1: bool = False,
    **kwargs,
) -> Dict[str, SyntheticPair]:
    """複数ペアの合成データ。ペアごとに別の乱数(seed+i)で独立に作る(ペア間の相関は作らない)。"""
    return {
        p: generate_synthetic(p, start=start, years=years, seed=seed + i, with_m1=with_m1, **kwargs)
        for i, p in enumerate(pairs)
    }


def write_synthetic_csv(df: pd.DataFrame, path: str, pair: str = "") -> None:
    """合成データをCSVに保存する。先頭に '#' の注意書きを入れる(load_ohlc_csv は '#' 行を無視する)。"""
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(f"# {SYNTHETIC_WARNING} pair={pair}\n")
        df.to_csv(f, index=False, date_format="%Y-%m-%d %H:%M:%S", float_format="%.6f")
