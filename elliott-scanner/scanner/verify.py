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

MIN_RECALL = 0.75   # 埋め込み波形を拾う割合の下限
MAX_FALSE = 0.03    # 波動の無い相場で候補が出る割合の上限
MAX_YEARLY_ALARMS = 1.0  # 毎日スキャンしたとき、1銘柄・1年あたりの誤候補の上限（件）


def _hit(c, direction, status) -> bool:
    return any(x.direction == direction and x.status == status for x in c)


def drifting_walk(seed: int, n: int = 320) -> "pd.DataFrame":  # noqa: F821
    """ドリフトとボラティリティ変動のあるランダムウォーク（現実の相場に近い雑音）。"""
    from .synth import _frame
    rng = np.random.default_rng(seed)
    vol = np.where(np.sin(np.arange(n) / rng.uniform(20, 60)) > 0, 0.7, 1.6)
    close = 100 + np.cumsum(rng.normal(rng.uniform(-0.15, 0.15), 1.0, n) * vol)
    return _frame(close, rng, 1.0)


def yearly_false_alarms(n_series: int = 12, days: int = 250) -> float:
    """ランダムウォークを毎日スキャンした場合の、1銘柄・1年あたりの誤候補（重複を除く）の件数。"""
    total = 0
    for sd in range(n_series):
        df = random_walk(1000 + sd, n=days + 200)
        seen = set()
        for t in range(200, len(df)):
            for c in find_candidates("X", "x", df.iloc[: t + 1]):
                seen.add(c.key())
        total += len(seen)
    return total / n_series


def sweep() -> None:
    """条件を振った再現率の一覧（合否には使わない。検出器の得意・不得意を見るため）。"""
    print("【再現率マップ: 大1波の大きさ（価格）×日々のブレ(sigma)】 ※検出は大1波が約7ATR以上を前提にしている")
    sigmas = (0.5, 0.8, 1.5, 3.0)
    print("  w1\\sigma " + "".join(f"{sg:>7}" for sg in sigmas))
    for w1 in (12, 16, 20, 30, 40):
        row = []
        for sg in sigmas:
            r = np.mean([_hit(find_candidates("X", "x", planted_third_of_third(s, "up", sigma=sg, w1=w1)), "up", "started")
                         for s in range(30)])
            row.append(f"{r * 100:6.0f}%")
        print(f"  {w1:>7}   " + "".join(row))
    print("【再現率: 大2波の戻り率（w1=30）】")
    for r2 in (0.40, 0.50, 0.618, 0.70, 0.75):
        r = np.mean([_hit(find_candidates("X", "x", planted_third_of_third(s, "up", r2=r2, w1=30)), "up", "started")
                     for s in range(30)])
        print(f"  戻り率{r2:<6}{r * 100:5.0f}%")


def main() -> int:
    if "--sweep" in sys.argv:
        sweep()
        return 0
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
    ya = yearly_false_alarms()
    ok &= ya <= MAX_YEARLY_ALARMS
    print(f"【毎日スキャンした場合の誤候補】1銘柄・1年あたり {ya:.2f} 件（上限 {MAX_YEARLY_ALARMS}）  "
          f"{'OK' if ya <= MAX_YEARLY_ALARMS else '超過'}  ※26銘柄なら年に約 {ya * 26:.0f} 件")
    print("【弱気相場の底での反発（下落幅が大1波の3倍超）で候補が出た割合（上限 %d%%）】" % (MAX_FALSE * 100))
    for d in ("up", "down"):
        r = np.mean([any(x.direction == d for x in find_candidates("X", "x", planted_third_of_third(s, d, lead_drop=300)))
                     for s in range(60)])
        ok &= r <= MAX_FALSE
        print(f"  {d:<5}{r * 100:5.1f}%  {'OK' if r <= MAX_FALSE else '超過'}")
    print("合格" if ok else "不合格")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
