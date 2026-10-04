"""インジケーター。すべて「その足の確定時点までの情報だけ」で計算する(先読みなし)。

重要: フラクタルは「左右n本」を見るので、ピボットの足iが確定するのは i+n 本目の終値後。
fractal_swings は結果を『確定した足(i+n)の行』に載せて返す。ピボット足の行に載せることはしない。
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(s: pd.Series, n: int) -> pd.Series:
    """単純移動平均。最初の n-1 本は NaN。"""
    return s.rolling(n, min_periods=n).mean()


def ema(s: pd.Series, n: int) -> pd.Series:
    """指数移動平均(span=n, adjust=False)。最初の n-1 本は NaN。"""
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    pc = close.shift(1)
    tr = pd.concat([(high - low), (high - pc).abs(), (low - pc).abs()], axis=1).max(axis=1)
    return tr


def atr(high: pd.Series, low: pd.Series, close: pd.Series, n: int = 14) -> pd.Series:
    """ATR(Wilder平滑: ewm alpha=1/n, adjust=False)。最初の n-1 本は NaN。"""
    tr = true_range(high, low, close)
    return tr.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()


def slope(s: pd.Series, k: int = 1) -> pd.Series:
    """k本前との差。"""
    return s - s.shift(k)


def is_rising(s: pd.Series, k: int = 1) -> pd.Series:
    """k本前より上(厳密に大きい)。NaN を含む場合は False。"""
    return (s > s.shift(k)).fillna(False)


def is_falling(s: pd.Series, k: int = 1) -> pd.Series:
    return (s < s.shift(k)).fillna(False)


def _pivot_mask(price: np.ndarray, n: int, is_high: bool) -> np.ndarray:
    """ピボット足 i の真偽(i の左右 n 本を見る。未確定情報を使うので、直接シグナルに使ってはいけない)。

    高値ピボット: 左 n 本より厳密に高く、右 n 本以上(>=)。
    安値ピボット: 左 n 本より厳密に低く、右 n 本以下(<=)。
    (左を厳密・右を非厳密にすることで、同値が並んでも1本だけがピボットになる)
    """
    N = len(price)
    mask = np.zeros(N, dtype=bool)
    if N < 2 * n + 1:
        return mask
    mask[n : N - n] = True
    for k in range(1, n + 1):
        left_a, left_b = price[k:], price[:-k]  # i>=k : price[i] vs price[i-k]
        right_a, right_b = price[:-k], price[k:]  # i<N-k: price[i] vs price[i+k]
        with np.errstate(invalid="ignore"):
            if is_high:
                mask[k:] &= left_a > left_b
                mask[: N - k] &= right_a >= right_b
            else:
                mask[k:] &= left_a < left_b
                mask[: N - k] &= right_a <= right_b
    return mask


def _swing_columns(price: np.ndarray, mask: np.ndarray, n: int):
    """確定足(i+n)の行から見える『直近』『その前』のピボット価格と位置(行番号)。"""
    N = len(price)
    pos = np.flatnonzero(mask)
    nan = np.full(N, np.nan)
    if len(pos) == 0:
        return nan, nan.copy(), nan.copy(), nan.copy(), nan.copy()
    conf = pos + n  # 確定する行
    rows = np.arange(N)
    j = np.searchsorted(conf, rows, side="right") - 1  # 行 r 時点で確定済みの最新ピボット
    last_ok = j >= 0
    prev_ok = j >= 1
    pj = np.clip(j, 0, None)
    pj1 = np.clip(j - 1, 0, None)
    last = np.where(last_ok, price[pos[pj]], np.nan)
    last_pos = np.where(last_ok, pos[pj].astype(float), np.nan)
    prev = np.where(prev_ok, price[pos[pj1]], np.nan)
    prev_pos = np.where(prev_ok, pos[pj1].astype(float), np.nan)
    new = np.full(N, np.nan)
    new[conf[conf < N]] = price[pos[conf < N]]
    return last, last_pos, prev, prev_pos, new


def fractal_swings(high: pd.Series, low: pd.Series, n: int) -> pd.DataFrame:
    """フラクタル(左右n本)によるスイング高値・安値。確定は n 本後(確定遅延)。

    返す列(index は入力と同じ。値は『その行の終値時点で既に確定している情報』のみ):
      sh_last / sh_last_pos : 直近の確定スイング高値の価格 / その高値をつけた足の行番号
      sh_prev / sh_prev_pos : その一つ前の確定スイング高値
      sh_new                : この行(=確定した足)で新たに確定した高値(それ以外は NaN)
      sl_*                  : 安値版
    行番号は入力 Series の位置(0始まり)。入力を先頭側から切り出すと位置がずれるので、
    末尾側を切る(prefix)使い方だけを想定する。
    """
    h = high.to_numpy(dtype=float)
    l = low.to_numpy(dtype=float)
    out = {}
    for tag, price, is_high in (("sh", h, True), ("sl", l, False)):
        mask = _pivot_mask(price, n, is_high)
        last, last_pos, prev, prev_pos, new = _swing_columns(price, mask, n)
        out[f"{tag}_last"] = last
        out[f"{tag}_last_pos"] = last_pos
        out[f"{tag}_prev"] = prev
        out[f"{tag}_prev_pos"] = prev_pos
        out[f"{tag}_new"] = new
    return pd.DataFrame(out, index=high.index)


def cross_ages(fast: pd.Series, slow: pd.Series) -> tuple[pd.Series, pd.Series]:
    """クロスからの経過本数。(ゴールデンクロス後の本数, デッドクロス後の本数) を返す。

    クロスした足で 0、その次の足で 1 ...。まだ一度もクロスしていなければ NaN。
    fast==slow の足は直前の状態を引き継ぐ(ゼロ交差の誤検出を避ける)。
    """
    diff = (fast - slow).to_numpy(dtype=float)
    N = len(diff)
    sign = np.sign(diff)
    sign[sign == 0] = np.nan
    state = pd.Series(sign).ffill().to_numpy()
    prev_state = np.r_[np.nan, state[:-1]]
    gc = (state == 1) & (prev_state == -1)
    dc = (state == -1) & (prev_state == 1)
    rows = np.arange(N)

    def age(event: np.ndarray) -> np.ndarray:
        last = np.maximum.accumulate(np.where(event, rows, -1))
        return np.where(last >= 0, rows - last, np.nan).astype(float)

    return (
        pd.Series(age(gc), index=fast.index),
        pd.Series(age(dc), index=fast.index),
    )
