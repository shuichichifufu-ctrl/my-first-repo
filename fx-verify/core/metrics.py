"""成績指標の集計(R単位)。gates.py の metric キーはここの戻り値のキーと一致させる。

勝ち = pnl_r > 0。PF = 勝ちR合計 / 負けR合計(負けが0で勝ちがあれば inf、取引0なら None)。
最大ドローダウンは取引を exit_time 順に並べた累積 pnl_r のピークからの最大下落(R、正の値)。
"""
from __future__ import annotations

import math
from typing import Dict, Optional

import numpy as np
import pandas as pd

METRIC_KEYS = [
    "n_trades", "n_long", "n_short", "win_rate", "pf", "avg_r", "expectancy_r", "total_r",
    "avg_win_r", "avg_loss_r", "max_dd_r", "max_consec_losses", "partial_rate",
    "avg_cost_r", "gross_avg_r",
]


def profit_factor(pnl: np.ndarray) -> Optional[float]:
    if len(pnl) == 0:
        return None
    wins = float(pnl[pnl > 0].sum())
    losses = float(-pnl[pnl < 0].sum())
    if losses == 0.0:
        return math.inf if wins > 0 else None
    return wins / losses


def max_drawdown(pnl_in_order: np.ndarray) -> float:
    if len(pnl_in_order) == 0:
        return 0.0
    cum = np.cumsum(pnl_in_order)
    peak = np.maximum.accumulate(np.r_[0.0, cum])[1:]
    return float((peak - cum).max())


def _max_consec_losses(pnl: np.ndarray) -> int:
    best = cur = 0
    for v in pnl:
        cur = cur + 1 if v < 0 else 0
        best = max(best, cur)
    return best


def compute_metrics(trades: pd.DataFrame) -> Dict[str, Optional[float]]:
    """trades(schema.TRADE_COLUMNS)から指標を計算。取引0件でも同じキーを返す(算出不能は None)。"""
    n = len(trades)
    if n == 0:
        out: Dict[str, Optional[float]] = {k: None for k in METRIC_KEYS}
        out.update(n_trades=0, n_long=0, n_short=0, total_r=0.0, max_dd_r=0.0, max_consec_losses=0)
        return out
    t = trades.sort_values("exit_time", kind="stable")
    pnl = t["pnl_r"].to_numpy(dtype=float)
    wins = pnl[pnl > 0]
    losses = pnl[pnl < 0]
    return {
        "n_trades": n,
        "n_long": int((t["side"] == "long").sum()),
        "n_short": int((t["side"] == "short").sum()),
        "win_rate": float((pnl > 0).mean()),
        "pf": profit_factor(pnl),
        "avg_r": float(pnl.mean()),
        "expectancy_r": float(pnl.mean()),
        "total_r": float(pnl.sum()),
        "avg_win_r": float(wins.mean()) if len(wins) else None,
        "avg_loss_r": float(losses.mean()) if len(losses) else None,
        "max_dd_r": max_drawdown(pnl),
        "max_consec_losses": _max_consec_losses(pnl),
        "partial_rate": float(t["partial"].astype(bool).mean()),
        "avg_cost_r": float(t["cost_r"].mean()),
        "gross_avg_r": float(t["r_multiple"].mean()),
    }


def breakdown_by_year(trades: pd.DataFrame) -> Dict[int, Dict[str, Optional[float]]]:
    """entry_time の年ごとの指標。"""
    if len(trades) == 0:
        return {}
    years = pd.DatetimeIndex(trades["entry_time"]).year
    return {int(y): compute_metrics(trades[years == y]) for y in sorted(set(years))}


def breakdown_by_side(trades: pd.DataFrame) -> Dict[str, Dict[str, Optional[float]]]:
    return {s: compute_metrics(trades[trades["side"] == s]) for s in ("long", "short")}


def breakdown_by_pair(trades: pd.DataFrame) -> Dict[str, Dict[str, Optional[float]]]:
    if len(trades) == 0:
        return {}
    return {p: compute_metrics(trades[trades["pair"] == p]) for p in sorted(set(trades["pair"]))}
