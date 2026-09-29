"""検証用の合成データ。既知の波形を埋め込んだ系列と、波動の無い系列を作る。"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _frame(close: np.ndarray, rng: np.random.Generator, sigma: float) -> pd.DataFrame:
    spread = np.abs(rng.normal(0, sigma * 0.6, len(close))) + sigma * 0.3
    high = close + spread
    low = close - spread
    open_ = np.concatenate([[close[0]], close[:-1]])
    idx = pd.bdate_range(end="2026-09-25", periods=len(close))
    return pd.DataFrame({"Open": open_, "High": np.maximum(high, open_), "Low": np.minimum(low, open_),
                         "Close": close}, index=idx)


def _ease(t: np.ndarray) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(np.pi * t)


def planted_third_of_third(seed: int, direction: str = "up", sigma: float = 0.8, end: str = "started",
                           variant: str = "linear", w1=None, r2=None, wi=None, rii=None) -> pd.DataFrame:
    """L0→H1→L2→小1→小2→小3の入口、という既知の波形を埋め込む。

    end: "started"（小3波が小1波の端を少し超えた所で終わる）/ "approaching"（超える手前）
    variant: "linear"（直線の脚）/ "curved"（脚をなだらかな曲線に）/ "abc"（第2波をA-B-Cの3波で下げる）
    w1, r2, wi, rii: 指定すると乱数の代わりにその値を使う（範囲外の波形での否定テスト用）
    """
    rng = np.random.default_rng(seed)
    base = 100.0
    w1 = rng.uniform(26, 36) if w1 is None else w1
    r2 = rng.uniform(0.42, 0.68) if r2 is None else r2
    wi = w1 * rng.uniform(0.35, 0.6) if wi is None else wi  # 小1波は大1波の35〜60%
    rii = rng.uniform(0.40, 0.65) if rii is None else rii
    l0 = base
    h1 = l0 + w1
    l2 = h1 - r2 * w1
    hi = l2 + wi
    lii = hi - rii * wi
    if end == "started":
        last = hi + rng.uniform(0.25, 0.5) * wi
    else:
        last = lii + rng.uniform(0.65, 0.85) * (hi - lii)
    # 各脚のバー数
    pre_n = 80
    legs = [(l0 + 16, l0, pre_n // 2)]  # 直前の下落（L0を確かな安値にする）
    way = [(0, l0 + 16), (pre_n, l0)]
    t = pre_n
    legs = [(h1, rng.integers(22, 34)), (l2, rng.integers(12, 20)), (hi, rng.integers(8, 13)),
            (lii, rng.integers(5, 9)), (last, rng.integers(4, 8))]
    if variant == "abc":  # 第2波をA(急落)→B(半戻し)→C(再下落)に分解
        d = h1 - l2
        legs[1:2] = [(h1 - 0.7 * d, rng.integers(4, 7)), (h1 - 0.35 * d, rng.integers(3, 6)), (l2, rng.integers(4, 8))]
    for price, n in legs:
        t += int(n)
        way.append((t, price))
    xs = np.array([w[0] for w in way])
    ys = np.array([w[1] for w in way])
    close = np.interp(np.arange(t + 1), xs, ys)
    if variant == "curved":
        close = np.empty(t + 1)
        for (x0, y0), (x1, y1) in zip(way[:-1], way[1:]):
            k = np.arange(x0, x1 + 1)
            close[k] = y0 + (y1 - y0) * _ease((k - x0) / max(1, x1 - x0))
    # 事前の助走（長い横ばい〜緩い下落）
    lead = 120
    lead_close = np.linspace(l0 + 22, l0 + 16, lead) + rng.normal(0, sigma, lead)
    close = np.concatenate([lead_close, close]) + rng.normal(0, sigma, len(close) + lead)
    if direction == "down":
        close = 2 * base - (close - base) + 0  # 上下反転
    return _frame(close, rng, sigma)


def random_walk(seed: int, n: int = 320, sigma: float = 1.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, sigma, n))
    return _frame(close, rng, sigma)


def range_bound(seed: int, n: int = 320, sigma: float = 0.8) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    x = np.arange(n)
    period = rng.uniform(25, 45)
    close = 100 + 4 * np.sin(2 * np.pi * x / period) + rng.normal(0, sigma, n)
    return _frame(close, rng, sigma)
