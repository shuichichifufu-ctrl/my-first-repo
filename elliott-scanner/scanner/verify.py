"""合成データでの検証。合格基準を満たさなければ終了コード1。

  python -m scanner.verify

埋め込み波形は3種類の形（直線・曲線・第2波がA-B-C）で作る。「検出器の想定どおりの形」だけに
偏らないようにするためだが、合成データである限り、実チャートでの当たりやすさの保証にはならない。
実チャートでの確認は scanner.replay を使う。
"""
from __future__ import annotations

import sys

import numpy as np

from .synth import planted_third_of_third, random_walk, range_bound
from .waves import find_candidates

MIN_RECALL = 0.60   # 埋め込み波形を拾う割合の下限
MAX_FALSE = 0.05    # 波動の無い相場で候補が出る割合の上限


def _hit(c, direction, status) -> bool:
    return any(x.direction == direction and x.status == status for x in c)


def drifting_walk(seed: int, n: int = 320) -> "pd.DataFrame":  # noqa: F821
    """ドリフトとボラティリティ変動のあるランダムウォーク（現実の相場に近い雑音）。"""
    from .synth import _frame
    rng = np.random.default_rng(seed)
    vol = np.where(np.sin(np.arange(n) / rng.uniform(20, 60)) > 0, 0.7, 1.6)
    close = 100 + np.cumsum(rng.normal(rng.uniform(-0.15, 0.15), 1.0, n) * vol)
    return _frame(close, rng, 1.0)


def main() -> int:
    n = 60
    ok = True
    print("【埋め込み波形の検出率（下限 %d%%）】" % (MIN_RECALL * 100))
    for d in ("up", "down"):
        for e in ("started", "approaching"):
            for v in ("linear", "curved", "abc"):
                r = np.mean([_hit(find_candidates("X", "x", planted_third_of_third(s, d, end=e, variant=v)), d, e)
                             for s in range(n)])
                flag = "OK" if r >= MIN_RECALL else "不足"
                ok &= r >= MIN_RECALL
                print(f"  {d:<5}{e:<12}{v:<8}{r * 100:5.1f}%  {flag}")
    print("【波動の無い相場で候補が出た割合（上限 %d%%）】" % (MAX_FALSE * 100))
    for name, gen, m in (("ランダムウォーク", random_walk, 300), ("レンジ", range_bound, 200),
                         ("ドリフト＋ボラ変動", drifting_walk, 300)):
        r = np.mean([bool(find_candidates("X", "x", gen(s))) for s in range(m)])
        ok &= r <= MAX_FALSE
        print(f"  {name:<14}{r * 100:5.1f}%  {'OK' if r <= MAX_FALSE else '超過'}")
    print("合格" if ok else "不合格")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
