"""エリオット波動の判定。

サードオブサード = 大きな次数の第3波の入口で、その内側の小さな次数でも
「小1波・小2波が完了し、小3波が始まる（または始まりかけ）」局面。
下降は価格を符号反転して上昇と同じ処理にかけ、結果を元に戻す。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .pivots import Pivot, zigzag

# 鉄則ルール ---------------------------------------------------------------

def check_impulse_rules(p: Sequence[float], up: bool = True) -> Dict[str, bool]:
    """完成した推進波 p=[p0,p1,p2,p3,p4,p5] が鉄則を満たすか。

    up=False の場合は価格を反転して判定する。
    """
    q = list(p) if up else [-x for x in p]
    w1, w3, w5 = q[1] - q[0], q[3] - q[2], q[5] - q[4]
    return {
        "wave2_not_below_origin": q[2] > q[0],
        "wave3_not_shortest": not (w3 < w1 and w3 < w5),
        "wave4_not_in_wave1": q[4] > q[1],
        "wave1_3_5_up": w1 > 0 and w3 > 0 and w5 > 0,
    }


def check_partial_rules(l0: float, h1: float, l2: float, hi: float, lii: float) -> Dict[str, bool]:
    """途中経過（大1・大2・小1・小2まで）で判定できる鉄則。上昇向き前提。"""
    return {
        "wave1_up": h1 > l0,
        "wave2_not_below_origin": l2 > l0,
        "sub1_up": hi > l2,
        "sub2_not_below_sub_origin": lii > l2,
    }


def check_projected_rules(l0: float, h1: float, l2: float, lii: float, wi: float) -> Dict[str, bool]:
    """(iii)がこれから伸びる場合に、大3波として不自然でないか。上昇向き前提。

    ・(iii)が1.618倍まで伸びれば大1波の頂点を超える（超えられない波は第3波として不自然）
    ・(iii)が2.618倍まで伸びれば、大3波が大1波の長さに届く（届かないほど小1波が小さいと最短の第3波になりやすい）
    第4波の重なり・第5波との比較は入口ではまだ存在しないので判定できない。
    """
    return {
        "wave3_can_pass_wave1_top": lii + 1.618 * wi > h1,
        "wave3_can_reach_wave1_length": (lii + 2.618 * wi - l2) >= (h1 - l0),
    }


# 検出結果 -----------------------------------------------------------------

@dataclass
class Candidate:
    symbol: str
    name: str
    direction: str  # "up" or "down"
    status: str  # "approaching"(小3波の準備) or "started"(小3波が始まった)
    score: float
    points: Dict[str, Tuple[int, float]]  # L0,H1,L2,i,ii のバー番号と価格（元の向き）
    close: float
    entry: float  # 小1波の端（これを超えると小3波が始まる）
    invalidation_minor: float  # 割ると小2波の数え方が失敗
    invalidation_major: float  # 割ると大2波の数え方が失敗
    target: float  # 小3波が小1波の1.618倍まで伸びた場合の目安
    r2: float
    rii: float
    wave1_top: float = 0.0  # 大1波の頂点（これを超えると大3波が本格化）
    checks: Dict[str, bool] = field(default_factory=dict)
    dates: Dict[str, str] = field(default_factory=dict)

    def key(self) -> str:
        return f"{self.symbol}|{self.direction}|{self.dates.get('L2', '')}"


@dataclass
class Params:
    major_atr: float = 7.0  # 大きな次数の転換とみなす値幅（ATR倍数）
    minor_atr: float = 2.5  # 小さな次数の転換とみなす値幅（ATR倍数）
    atr_window: int = 60
    min_score: float = 65.0
    r2_lo: float = 0.382 - 0.02  # 戻り率の関門（38.2〜78.6%、丸め誤差ぶんの許容0.02）
    r2_hi: float = 0.786 + 0.02
    max_ext: float = 0.618  # 小3波が小1波の端からこの倍率（小1波比）までを「入口」とする
    max_wave3_ext: float = 1.618  # 大3波がこの倍率を超えていたら遅い


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, window: int) -> float:
    prev = np.concatenate([[close[0]], close[:-1]])
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))
    return float(np.mean(tr[-window:]))


def _fit(x: float, center: float, width: float) -> float:
    return max(0.0, 1.0 - abs(x - center) / width)


def _detect_up(high: np.ndarray, low: np.ndarray, close: np.ndarray, p: Params) -> Optional[dict]:
    a = atr(high, low, close, p.atr_window)
    if not np.isfinite(a) or a <= 0:
        return None
    n = len(close)
    piv, prov = zigzag(high, low, p.major_atr * a)
    if prov is None:
        return None
    # 大きな次数: L0 -> H1 -> L2
    # 暫定が安値なら大2波の底を探している最中（暫定安値をL2とみなす）。
    # 暫定が高値なら大2波の底は確定済みで、暫定高値は構造に含めない。
    pts = piv + [prov] if prov[0] == "L" else list(piv)
    if len(pts) < 3:
        return None
    l0, h1, l2 = pts[-3], pts[-2], pts[-1]
    if not (l0[0] == "L" and h1[0] == "H" and l2[0] == "L"):
        return None
    if not (l2[2] > l0[2]):
        return None
    w1 = h1[2] - l0[2]
    r2 = (h1[2] - l2[2]) / w1
    if not (p.r2_lo <= r2 <= p.r2_hi):
        return None
    # 小さな次数: L2以降
    s = l2[1]
    hs, ls, cs = high[s:], low[s:], close[s:]
    if len(cs) < 5:
        return None
    mpiv, mprov = zigzag(hs, ls, p.minor_atr * a)
    mpts = list(mpiv) + ([mprov] if mprov else [])
    mpts = [(k, i + s, pr) for k, i, pr in mpts]
    if len(mpts) < 3:
        return None
    # 先頭は L2 付近の安値のはず
    if mpts[0][0] != "L":
        return None
    sub_l2 = mpts[0]
    if abs(sub_l2[2] - l2[2]) > 1e-9 and sub_l2[2] < l2[2]:
        return None
    hi, lii = mpts[1], mpts[2]
    if not (hi[0] == "H" and lii[0] == "L"):
        return None
    if len(mpts) > 4:
        return None  # 小4波以降まで進んでいる = 入口ではない
    checks = check_partial_rules(l0[2], h1[2], l2[2], hi[2], lii[2])
    if not all(checks.values()):
        return None
    wi = hi[2] - l2[2]
    rii = (hi[2] - lii[2]) / wi
    proj = check_projected_rules(l0[2], h1[2], l2[2], lii[2], wi)
    if not all(proj.values()):
        return None  # (iii)が伸びても大1波の頂点に届かない = 大3波として不自然
    if not (p.r2_lo <= rii <= p.r2_hi):
        return None
    c = float(close[-1])
    if len(mpts) == 3:
        return None  # 小2波がまだ下げ止まっていない（確定していない）
    # 4点: 小2波が確定し、暫定高値が上昇中
    if c <= lii[2]:
        return None
    if c > hi[2]:
        ext = (c - hi[2]) / wi
        if ext > p.max_ext:
            return None
        status = "started"
    else:
        if c < lii[2] + 0.5 * (hi[2] - lii[2]):
            return None
        status = "approaching"
    if c > l2[2] + p.max_wave3_ext * w1:
        return None
    return dict(l0=l0, h1=h1, l2=l2, hi=hi, lii=lii, r2=r2, rii=rii, close=c, status=status,
                w1=w1, wi=wi, atr=a, proj=proj)


def _score(d: dict, close: np.ndarray) -> float:
    s = 40.0
    s += 20.0 * _fit(d["r2"], 0.55, 0.23)
    s += 15.0 * _fit(d["rii"], 0.55, 0.23)
    sma = float(np.mean(close[-50:])) if len(close) >= 50 else float(np.mean(close))
    if d["close"] > sma:
        s += 5.0
    if len(close) >= 60 and float(np.mean(close[-10:])) > float(np.mean(close[-60:-50])):
        s += 5.0
    s += 15.0 if d["status"] == "started" else 8.0
    return min(100.0, s)


def clean_frame(df):
    """欠損行を除いた DataFrame。検出とチャート描画で同じ位置番号を使うために共通化する。"""
    d = df.dropna(subset=["High", "Low", "Close"])
    return d[np.isfinite(d["High"]) & np.isfinite(d["Low"]) & np.isfinite(d["Close"])]


def find_candidates(symbol: str, name: str, df, params: Optional[Params] = None) -> List[Candidate]:
    """df は High/Low/Close 列を持つ DataFrame（日付昇順）。位置番号は clean_frame(df) 基準。"""
    p = params or Params()
    df = clean_frame(df)
    h = df["High"].to_numpy(dtype=float)
    l = df["Low"].to_numpy(dtype=float)
    c = df["Close"].to_numpy(dtype=float)
    idx = df.index
    if len(c) < 120:
        return []
    out: List[Candidate] = []
    for direction, sign in (("up", 1.0), ("down", -1.0)):
        if direction == "up":
            d = _detect_up(h, l, c, p)
        else:
            d = _detect_up(-l, -h, -c, p)  # 高値/安値を入れ替えて反転
        if not d:
            continue
        score = _score(d, sign * c)
        if score < p.min_score:
            continue

        def pt(t):
            return (int(t[1]), float(sign * t[2]))

        pts = {"L0": pt(d["l0"]), "H1": pt(d["h1"]), "L2": pt(d["l2"]), "i": pt(d["hi"]), "ii": pt(d["lii"])}
        entry = sign * d["hi"][2]
        target = sign * (d["lii"][2] + 1.618 * d["wi"])
        out.append(Candidate(
            symbol=symbol, name=name, direction=direction, status=d["status"], score=round(score, 1),
            points=pts, close=float(c[-1]), entry=entry,
            invalidation_minor=sign * d["lii"][2], invalidation_major=sign * d["l2"][2],
            target=target, r2=round(d["r2"], 3), rii=round(d["rii"], 3),
            wave1_top=float(sign * d["h1"][2]),
            checks={**check_partial_rules(d["l0"][2], d["h1"][2], d["l2"][2], d["hi"][2], d["lii"][2]), **d["proj"]},
            dates={k: str(idx[v[0]])[:10] for k, v in pts.items()},
        ))
    return out
