"""Params(D1〜D9 の全パラメータ)と感度分析の候補値。

正本は引継書 第3章。既定値 = 『基準案(原典に最も近い定義)』。
ここのフィールド名・既定値を変える場合は INTERFACES.md と合わせて直し、レポートに記録すること。
D10(原典に無い追加フィルター)は d10_* に分離し、既定は全て None(= 原典準拠)。
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, fields, replace
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class Params:
    # ---- D1: 1時間足クロスの有効期間 -------------------------------------------------
    # 買い: 20SMA>80SMA かつ ゴールデンクロスから h1_cross_window 本(1時間足)以内。売りは逆(デッドクロス)。
    # None = 「20SMA>80SMA である限り有効」。クロスの SMA 期間は FeatureSpec.h1_cross で固定。
    h1_cross_window: Optional[int] = 48  # 候補 12/24/48/96/None

    # ---- D2: 日足の環境認識 ---------------------------------------------------------
    # A: 終値>20SMA かつ 20SMA が d1_slope_bars 本前より上 / B: A + 確定スイングで安値切上げ(売りは高値切下げ)
    # C: A + 20SMA>100SMA / D: 日足条件なし(比較用)
    d1_mode: str = "A"  # 'A' | 'B' | 'C' | 'D'
    d1_slope_bars: int = 5  # FeatureSpec.slope_lags に含まれる値のみ(1/3/5)
    d1_swing_fractal_n: int = 2  # mode B 用。FeatureSpec.htf_fractal_n に含まれる値

    # ---- D3: 4時間足の環境認識 ------------------------------------------------------
    # 買い: 20SMA > 長期SMA かつ(h4_require_swing なら)確定スイング安値が切上げ。売りは逆。
    h4_long_sma: int = 120  # 候補 120 / 80(原典で食い違い)
    h4_require_swing: bool = True  # 候補 True / False
    h4_swing_fractal_n: int = 2

    # ---- D4: パーフェクトオーダー(15分足) --------------------------------------------
    # 買い: EMA 10>20>40>80>320 かつ 5本すべてが po_slope_bars 本前より上。売りは逆。
    po_slope_bars: int = 3  # 候補 1/3/5
    po_expand: bool = False  # True なら「広がり」条件: (EMA10-EMA80) が po_expand_k 本前より大きい(売りは差の絶対値で)
    po_expand_k: int = 3

    # ---- D5: 直近高値の定義とブレイク判定 ----------------------------------------------
    # lookback: PO成立時点から過去 hi_lookback 本の最高値 / swing: 確定フラクタル高値(左右 hi_swing_fractal_n 本)
    hi_mode: str = "lookback"  # 'lookback' | 'swing'
    hi_lookback: int = 40  # 候補 20/40/80
    hi_swing_fractal_n: int = 2  # 候補 2/3/5
    hi_break_on: str = "close"  # 'close'(終値で上回る) | 'high'(ヒゲ)

    # ---- D6: 押しの深さ -------------------------------------------------------------
    # pb_mode='ema': ブレイク後の高値H0から下げる過程で、安値が pb_touch_ema に触れる。
    #   かつ(pb_forbid_ema80_close)80EMAを終値で割らない かつ(pb_forbid_ema320_touch)320EMAに一度も触れない。
    # pb_mode='ratio': ブレイク前スイング安値→H0 の上げ幅に対する押しの比率が [pb_ratio_min, pb_ratio_max]。
    pb_mode: str = "ema"  # 'ema' | 'ratio'
    pb_touch_ema: int = 40  # 候補 20/40/80
    pb_forbid_ema80_close: bool = True
    pb_forbid_ema320_touch: bool = True
    pb_ratio_min: float = 0.382  # 候補ペア (0.236,0.618) (0.382,0.786) ※比率方式のときのみ使用
    pb_ratio_max: float = 0.786
    pb_min_bars: int = 0  # 候補 3/5/8。0 = 最低本数の条件なし

    # ---- D7: 切り下げラインとブレイク ---------------------------------------------------
    # tl_mode='trendline': H0 と後続の確定スイング高値H1(フラクタル左右 tl_fractal_n 本)を結ぶ直線
    # tl_mode='recent_high': 代理。押しの途中で直近 tl_recent_m 本の最高値を上抜け
    tl_mode: str = "trendline"  # 'trendline' | 'recent_high'
    tl_fractal_n: int = 2  # 候補 2/3/5(原典候補は2/3)
    tl_recent_m: int = 5  # 候補 3/5/8(tl_mode='recent_high' のみ)
    tl_break_on: str = "close"  # 'close'(終値>線) | 'high_margin'(高値>線+tl_margin_atr×ATR)
    tl_margin_atr: float = 0.1  # 'high_margin' のときのみ使用
    tl_expire_bars: int = 32  # 候補 16/32/64。H0の足からこの本数以内にエントリー判定が出なければ見送り

    # ---- D8: 損切り -----------------------------------------------------------------
    # SL = 押しの最安値 - sl_margin_atr × ATR(14, 15分足)(買い。売りは逆)
    sl_mode: str = "atr"  # 'atr' | 'fixed_pips'
    sl_margin_atr: float = 0.1  # 候補 0/0.1/0.3
    sl_fixed_pips: Optional[float] = None  # sl_mode='fixed_pips': 押しの最安値 - (スプレッド+この値)pips
    sl_max_h1_atr: Optional[float] = None  # 損切り幅が この倍率×ATR(14,1時間足) を超えたら見送り(例 1.5)。None=上限なし

    # ---- D9: 利確と残りの扱い ---------------------------------------------------------
    tp1_fraction: float = 0.5  # 第1利確(H0)で決済する割合。候補 0.3/0.5/0.7
    be_after_tp1: str = "entry"  # 'entry'(建値) | 'entry_plus_spread' | 'none'(動かさない)
    trail_mode: str = "m15_swing"  # 'm15_swing' | 'ema20_close' | 'h1_swing' | 'fixed_r'
    trail_fractal_n: int = 2  # m15_swing / h1_swing のフラクタル左右本数
    fixed_r: float = 2.0  # trail_mode='fixed_r' の残り決済(候補 2/3)
    eod_close: bool = True  # サーバー日の終わり(day_end)で全決済する

    # ---- 運用 ------------------------------------------------------------------------
    side: str = "both"  # 'both' | 'long' | 'short'

    # ---- D10: 原典に無い追加フィルター(基準案には入れない。使うなら必ず別枠で報告) ------------
    d10_session_utc: Optional[Tuple[int, int]] = None  # (開始時, 終了時) UTC。この時間帯の判定足だけ許可
    d10_max_spread_pips: Optional[float] = None  # このスプレッド超なら見送り
    d10_min_tp_sl_ratio: Optional[float] = None  # (H0までの距離)/(損切り幅) がこれ未満なら見送り

    # ------------------------------------------------------------------------------------
    def replace(self, **kw: Any) -> "Params":
        return replace(self, **kw)

    def is_original(self) -> bool:
        """D10 の追加フィルターを使っていない(= 原典準拠の範囲)か。"""
        return (
            self.d10_session_utc is None
            and self.d10_max_spread_pips is None
            and self.d10_min_tp_sl_ratio is None
        )

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        if d["d10_session_utc"] is not None:
            d["d10_session_utc"] = list(d["d10_session_utc"])
        return d

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Params":
        known = {f.name for f in fields(cls)}
        bad = set(d) - known
        if bad:
            raise ValueError(f"未知のパラメータ: {sorted(bad)}")
        d = dict(d)
        if d.get("d10_session_utc") is not None:
            d["d10_session_utc"] = tuple(d["d10_session_utc"])
        return cls(**d)

    def key(self) -> str:
        """設定の識別子(同じ値なら同じ文字列)。試行総数のカウントや結果表のキーに使う。"""
        s = json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False)
        return hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]

    def validate(self) -> None:
        def _in(name: str, allowed) -> None:
            v = getattr(self, name)
            if v not in allowed:
                raise ValueError(f"{name}={v!r} は {allowed} のどれか")

        _in("d1_mode", ("A", "B", "C", "D"))
        _in("hi_mode", ("lookback", "swing"))
        _in("hi_break_on", ("close", "high"))
        _in("pb_mode", ("ema", "ratio"))
        _in("pb_touch_ema", (20, 40, 80))
        _in("tl_mode", ("trendline", "recent_high"))
        _in("tl_break_on", ("close", "high_margin"))
        _in("sl_mode", ("atr", "fixed_pips"))
        _in("be_after_tp1", ("entry", "entry_plus_spread", "none"))
        _in("trail_mode", ("m15_swing", "ema20_close", "h1_swing", "fixed_r"))
        _in("side", ("both", "long", "short"))
        if not 0.0 < self.tp1_fraction < 1.0:
            raise ValueError("tp1_fraction は 0〜1 の間(両端を含まない)")
        if self.sl_mode == "fixed_pips" and self.sl_fixed_pips is None:
            raise ValueError("sl_mode='fixed_pips' には sl_fixed_pips が必要")
        if self.pb_ratio_min >= self.pb_ratio_max:
            raise ValueError("pb_ratio_min < pb_ratio_max であること")


def base_params() -> Params:
    """基準案(段階A)。"""
    return Params()


# 段階B(1項目ずつ動かす感度分析)の候補値。キー=Paramsのフィールド名(引継書 第3章の候補)。
# 値のリストに基準案の値も含める。D2-D は「効き目を測る比較用」。
# 比率方式(pb_mode='ratio')は pb_ratio_min/max の組なので別枠(SENSITIVITY_PAIRS)。
SENSITIVITY_GRID: Dict[str, List[Any]] = {
    # D1
    "h1_cross_window": [12, 24, 48, 96, None],
    # D2
    "d1_mode": ["A", "B", "C", "D"],
    # D3
    "h4_long_sma": [120, 80],
    "h4_require_swing": [True, False],
    # D4
    "po_slope_bars": [1, 3, 5],
    "po_expand": [False, True],
    # D5
    "hi_lookback": [20, 40, 80],
    "hi_swing_fractal_n": [2, 3, 5],  # hi_mode='swing' のとき
    "hi_mode": ["lookback", "swing"],
    "hi_break_on": ["close", "high"],
    # D6
    "pb_touch_ema": [20, 40, 80],
    "pb_min_bars": [0, 3, 5, 8],
    "pb_mode": ["ema", "ratio"],
    # D7
    "tl_fractal_n": [2, 3, 5],
    "tl_break_on": ["close", "high_margin"],
    "tl_mode": ["trendline", "recent_high"],
    "tl_recent_m": [3, 5, 8],  # tl_mode='recent_high' のとき
    "tl_expire_bars": [16, 32, 64],
    # D8
    "sl_margin_atr": [0.0, 0.1, 0.3],
    "sl_max_h1_atr": [None, 1.5],
    # D9
    "tp1_fraction": [0.3, 0.5, 0.7],
    "be_after_tp1": ["entry", "entry_plus_spread", "none"],
    "trail_mode": ["m15_swing", "ema20_close", "h1_swing", "fixed_r"],
    "fixed_r": [2.0, 3.0],  # trail_mode='fixed_r' のとき
    "eod_close": [True, False],
}

# 値の組で動かす項目(段階Bでは組ごとに1水準として扱う)
SENSITIVITY_PAIRS: Dict[Tuple[str, ...], List[Tuple[Any, ...]]] = {
    ("pb_ratio_min", "pb_ratio_max"): [(0.236, 0.618), (0.382, 0.786)],
}

# 条件付きで意味を持つ項目(その値を動かすときに併せて設定すべき従属設定)
SENSITIVITY_REQUIRES: Dict[str, Dict[str, Any]] = {
    "hi_swing_fractal_n": {"hi_mode": "swing"},
    "tl_recent_m": {"tl_mode": "recent_high"},
    "fixed_r": {"trail_mode": "fixed_r"},
}
