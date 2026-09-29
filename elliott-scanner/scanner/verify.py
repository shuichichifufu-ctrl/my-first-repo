"""合成データでの検証: 既知の波形をどれだけ拾えるか／波動の無い相場でどれだけ誤検出するか。

  python -m scanner.verify
"""
from __future__ import annotations

from .synth import planted_third_of_third, random_walk, range_bound
from .waves import find_candidates


def rate(gen, n, pred) -> float:
    return sum(1 for s in range(n) if pred(find_candidates("X", "x", gen(s)))) / n


def main() -> None:
    n = 100
    rows = []
    for d in ("up", "down"):
        for e in ("started", "approaching"):
            r = rate(lambda s: planted_third_of_third(s, d, end=e), n,
                     lambda c: any(x.direction == d and x.status == e for x in c))
            rows.append((f"埋め込み {d}/{e}（検出できた割合）", r))
    rows.append(("ランダムウォーク（誤検出の割合）", rate(random_walk, 300, bool)))
    rows.append(("レンジ相場（誤検出の割合）", rate(range_bound, 200, bool)))
    for name, r in rows:
        print(f"{name:<44}{r * 100:5.1f}%")


if __name__ == "__main__":
    main()
