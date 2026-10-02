"""ジグザグ（転換点）抽出。しきい値は価格単位（ATRの倍数などで呼び出し側が決める）。"""
from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

Pivot = Tuple[str, int, float]  # ("H" or "L", バー番号, 価格)


def zigzag(high: Sequence[float], low: Sequence[float], thr: float) -> Tuple[List[Pivot], Optional[Pivot]]:
    """確定した転換点のリストと、まだ確定していない現在の極値（暫定）を返す。

    確定 = 極値から thr 以上逆行した時点。暫定 = 現在進行中の脚の端。
    """
    n = len(high)
    if n == 0:
        return [], None
    pivots: List[Pivot] = []
    direction = 0
    hi, hi_i, lo, lo_i = high[0], 0, low[0], 0
    for i in range(1, n):
        if direction == 0:
            if high[i] > hi:
                hi, hi_i = high[i], i
            if low[i] < lo:
                lo, lo_i = low[i], i
            if hi - lo >= thr:
                # 先に付いた極値の側を起点とみなす
                if lo_i < hi_i:
                    pivots.append(("L", lo_i, lo))
                    direction = 1
                    lo, lo_i = low[i], i  # 未使用だが状態を初期化
                else:
                    pivots.append(("H", hi_i, hi))
                    direction = -1
                    hi, hi_i = high[i], i
        elif direction == 1:
            if high[i] > hi:
                hi, hi_i = high[i], i
            elif hi - low[i] >= thr:
                pivots.append(("H", hi_i, hi))
                direction = -1
                lo, lo_i = low[i], i
        else:
            if low[i] < lo:
                lo, lo_i = low[i], i
            elif high[i] - lo >= thr:
                pivots.append(("L", lo_i, lo))
                direction = 1
                hi, hi_i = high[i], i
    if direction == 1:
        prov: Optional[Pivot] = ("H", hi_i, hi)
    elif direction == -1:
        prov = ("L", lo_i, lo)
    else:
        prov = None
    return pivots, prov
