"""戦略エンジン(引継書 第3章 D1〜D9 の基準案を Params で表現し、買い・売りを対称に実装する)。

仕様の正本: 引継書 第3〜5章・第8章 と INTERFACES.md §5。

流れ(各サイドで独立):
  1H GC監視(D1) → 日足/4H環境認識(D2,D3) → 15分パーフェクトオーダー(D4) → 直近高値ブレイク(D5)
  → 押し(D6) → 切り下げライン(H0-H1)ブレイク(D7) → 判定足の『次の足の始値』で約定
  損切り(D8) / 部分利確・建値移動・追随・時間切れ(D9)

実装の要点
- 売りは価格を符号反転した『鏡像』にして買いと同じコードで処理する(対称性をコードで保証)。
  鏡像では高値↔安値・EMAの並び・不等号が自然に逆になる。出力の価格は元の向きに戻す。
- 先読み禁止: 足 i の判定は行 i の列(確定済み情報)だけで行う。約定は次の足の始値。
  約定後の管理(SL/TP/追随)は未来の足を順に見るが、判定(シグナル)には使わない。
  『ポジション保有中は新規約定しない』の判定は、その時点で実際に保有中かどうかを使う(リアルタイムでも分かる情報)。
- 同一足でSLとTP(TP1/固定R)の両方に届いたらSL優先。df1m があれば、その足の1分足の順序で判定
  (同じ1分足内で両方ならSL。1分足が欠けている・矛盾する場合もSL)。
- コスト未設定なら NotConfiguredError(黙ってコスト0にしない)。
- funnel_dict に『各条件の通過数(候補が減る箇所)』を記録する(core.schema.funnel_keys と一致)。
- D10(原典に無い追加フィルター)は Params の d10_* で別扱い。基準(既定)では無効。

補完した点(引継書・INTERFACES に明記が無く、実装で判断した点)は STRATEGY_NOTES に列挙する。
レポート第9/10章にそのまま載せられる。
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from core.config import Config, pip_size
from core.params import Params
from core.schema import (
    SIDES,
    TRADE_COLUMNS,
    funnel_keys,
    validate_funnel,
    validate_trades,
)

STRATEGY_NOTES: List[str] = [
    "売りは価格を符号反転した鏡像で買いと同じコードを通す(高値↔安値、EMAの並び、不等号が逆になる)。",
    "局面の開始は『PO(パーフェクトオーダー)が False→True になった足』で上位足条件(D1〜D3)が真のときだけ。"
    "局面が消えた後、POが一度崩れて再成立するまで同じ流れの再開始はしない(引継書の文言どおり)。",
    "D5の基準高値 ref は局面開始時点で固定する(lookback: 開始足を含む過去N本の最高値 / swing: 開始時点の確定スイング高値)。"
    "swing モードで確定スイングがまだ無い足は『準備未完了(ready=False)』として局面を開始しない。",
    "H0 は『ブレイク足以降の最高値』。H0 が更新された足は押しの評価をせず、押しの状態(触れフラグ・最安値・本数・H1)をリセットする。"
    "H0 更新の足では押し禁止条件も評価しない(H0 以降=H0の足より後の足だけが対象)。",
    "D6 ema モード: 『安値が pb_touch_ema に触れた』は一度満たせば維持(H0更新でリセット)。"
    "ratio モードは毎足評価(押しが深くなり比率が上限を超えたら一時的に不成立=非粘着)。"
    "ratio の分母のスイング安値は『局面開始足〜ブレイク足の最安値』。",
    "D7 trendline: H1 は『H0より後に確定した最初の、H0より低いフラクタル高値』で固定し、(H0足,H0)-(H1足,H1)の直線を延長する"
    "(その後に別の安値更新の高値ができても引き直さない)。",
    "D7 のブレイクは『押し条件が前の足の終わりまでに成立していた』場合のみ有効(同じ足で押しの条件成立とブレイクが重なった場合は次の足以降)。"
    "ラインの確定と同じ足でのブレイクは可(確定は足の終値時点で分かる情報)。",
    "毎足の判定順: 上位足条件の喪失 → ブレイク前のPO崩れ → H0更新 → 押し禁止条件 → 有効期限 → 押し条件/ライン/ブレイク判定。"
    "有効期限は H0足から tl_expire_bars 本目までシグナル可(次の足で期限切れ)。",
    "D8の損切り: SL = 押しの最安値 - sl_margin_atr × 判定足のATR(14,15分足)。リスクは約定足の始値から測る。",
    "保有中の判定: 損切り・利確が足の途中で起きた足でも、その足の終値時点ではフラット(次の足で約定可)。"
    "20EMA割れの決済(次の足の始値)は、その足の終値時点では保有中扱い。",
    "第1利確後の建値移動・追随は第1利確が約定した足の『次の足から』有効(その足の終値後に引き上げを評価)。"
    "第1利確の足の1分足順序で『第1利確→(旧SLに戻る)』となった場合は旧SL(exit_reason='sl'、partial=True)で残りを決済する。",
    "be_after_tp1='none' で当初SLのまま残りがSLに掛かった場合の exit_reason は 'sl'(partial=True)。",
    "固定R決済・20EMA割れ決済・追随は第1利確後の残りにだけ適用(第1利確前は当初SLと第1利確のみ)。",
    "同じ足で買い売りの両シグナルが出ることは上位足条件が排他なので実質起きないが、起きた場合は買いを先に処理する。",
    "段階Eのランダム取引: 損切り幅(risk/ATR)と第1利確距離(R)は、実取引から『同じ取引を1つ復元抽出して組で使う』"
    "(同サイドの実取引があればそのサイドから)。h0 は tp1、pb_extreme は sl に等しい近似値を入れる。"
    "重複・保有中の足は引き直し(約定済みの保有区間と重なる候補は捨てて次の候補を引く)。",
]

_BASE_NS = 15 * 60 * 1_000_000_000


# =====================================================================================
# 入力の読み出しと足条件(ベクトル化)
# =====================================================================================
def _num(df: pd.DataFrame, name: str) -> np.ndarray:
    if name not in df.columns:
        raise ValueError(f"入力データに列 {name!r} がありません(core.data.build_dataset の出力を使うこと)")
    return df[name].to_numpy(dtype=float)


def _flag(df: pd.DataFrame, name: str) -> np.ndarray:
    if name not in df.columns:
        raise ValueError(f"入力データに列 {name!r} がありません(core.data.build_dataset の出力を使うこと)")
    return df[name].to_numpy(dtype=bool)


def _ns(df: pd.DataFrame, name: str) -> np.ndarray:
    if name not in df.columns:
        raise ValueError(f"入力データに列 {name!r} がありません(core.data.build_dataset の出力を使うこと)")
    return df[name].to_numpy(dtype="datetime64[ns]").astype("int64")


def _shift(a: np.ndarray, k: int) -> np.ndarray:
    """k本前の値(先頭 k 本は NaN)。"""
    out = np.full(len(a), np.nan)
    if k < len(a):
        out[k:] = a[: len(a) - k]
    return out


def _side_conditions(df: pd.DataFrame, p: Params, sgn: int) -> Dict[str, np.ndarray]:
    """1サイド分の足条件(いずれも各行の確定済み情報だけで決まる)。sgn=+1 買い / -1 売り。

    返す配列(bool): ready, h1, d1, h4, po。cum_* は累積(funnel用)。
    """
    long = sgn > 0
    N = len(df)
    need: List[np.ndarray] = []  # ready に使う列(すべて非NaNであること)

    emas = [_num(df, f"ema{n}") for n in (10, 20, 40, 80, 320)]
    atr = _num(df, "atr14")
    need += emas + [atr]

    # --- D1: 1時間足クロス ---------------------------------------------------------
    h1s20, h1s80 = _num(df, "h1_sma20"), _num(df, "h1_sma80")
    need += [h1s20, h1s80]
    with np.errstate(invalid="ignore"):
        h1 = sgn * (h1s20 - h1s80) > 0
        if p.h1_cross_window is not None:
            age = _num(df, "h1_gc_age" if long else "h1_dc_age")
            h1 = h1 & (age <= p.h1_cross_window)  # NaN(未クロス)は False

    # --- D2: 日足 -----------------------------------------------------------------
    if p.d1_mode == "D":
        d1 = np.ones(N, dtype=bool)
    else:
        d1c, d1s20 = _num(df, "d1_close"), _num(df, "d1_sma20")
        chg = _num(df, f"d1_sma20_chg{p.d1_slope_bars}")
        need += [d1c, d1s20, chg]
        with np.errstate(invalid="ignore"):
            d1 = (sgn * (d1c - d1s20) > 0) & (sgn * chg > 0)
            if p.d1_mode == "C":
                s100 = _num(df, "d1_sma100")
                need.append(s100)
                d1 = d1 & (sgn * (d1s20 - s100) > 0)
            elif p.d1_mode == "B":
                n = p.d1_swing_fractal_n
                need.append(_num(df, f"d1_fr{n}_{'sl' if long else 'sh'}_prev"))
                d1 = d1 & _flag(df, f"d1_fr{n}_{'hl' if long else 'lh'}")

    # --- D3: 4時間足 ---------------------------------------------------------------
    h4s20, h4sl = _num(df, "h4_sma20"), _num(df, f"h4_sma{p.h4_long_sma}")
    need += [h4s20, h4sl]
    with np.errstate(invalid="ignore"):
        h4 = sgn * (h4s20 - h4sl) > 0
        if p.h4_require_swing:
            n = p.h4_swing_fractal_n
            need.append(_num(df, f"h4_fr{n}_{'sl' if long else 'sh'}_prev"))
            h4 = h4 & _flag(df, f"h4_fr{n}_{'hl' if long else 'lh'}")

    # --- D8/D10 で使う上位足ATR / D5 swing で使う確定スイング ---------------------------
    if p.sl_max_h1_atr is not None:
        need.append(_num(df, "h1_atr14"))
    if p.hi_mode == "swing":
        need.append(_num(df, f"fr{p.hi_swing_fractal_n}_{'sh' if long else 'sl'}_last"))

    ready = np.ones(N, dtype=bool)
    for a in need:
        ready &= ~np.isnan(a)

    # --- D4: パーフェクトオーダー ---------------------------------------------------
    e = [sgn * x for x in emas]  # 鏡像: 買いの不等号で判定できる
    with np.errstate(invalid="ignore"):
        po = (e[0] > e[1]) & (e[1] > e[2]) & (e[2] > e[3]) & (e[3] > e[4])
        for x in e:
            po = po & (x > _shift(x, p.po_slope_bars))
        if p.po_expand:
            d = e[0] - e[3]
            po = po & (d > _shift(d, p.po_expand_k))
    po = po & ready

    return {"ready": ready, "h1": h1 & ready, "d1": d1 & ready, "h4": h4 & ready, "po": po}


# =====================================================================================
# 1サイド分のデータ(鏡像済み)
# =====================================================================================
class _Side:
    """1サイドの鏡像価格・足条件。以降の処理はすべて『買い』として書き、出力時に sgn で元の向きへ戻す。"""

    def __init__(self, df: pd.DataFrame, p: Params, sgn: int, df1m: Optional[pd.DataFrame]):
        self.sgn = sgn
        self.name = "long" if sgn > 0 else "short"
        long = sgn > 0
        o, h, l, c = (_num(df, k) for k in ("open", "high", "low", "close"))
        if long:
            O, H, L, C = o, h, l, c
        else:
            O, H, L, C = -o, -l, -h, -c
        self.O, self.H, self.L, self.C = O.tolist(), H.tolist(), L.tolist(), C.tolist()
        self.ema20 = (sgn * _num(df, "ema20")).tolist()
        self.ema80 = (sgn * _num(df, "ema80")).tolist()
        self.ema320 = (sgn * _num(df, "ema320")).tolist()
        self.ema_touch = (sgn * _num(df, f"ema{p.pb_touch_ema}")).tolist()
        self.atr = _num(df, "atr14").tolist()
        self.h1atr = _num(df, "h1_atr14").tolist() if p.sl_max_h1_atr is not None else None

        cond = _side_conditions(df, p, sgn)
        self.cond = cond
        htf_ok = cond["h1"] & cond["d1"] & cond["h4"]
        self.htf_ok_arr = htf_ok
        self.htf_ok = htf_ok.tolist()
        po = cond["po"]
        self.po = po.tolist()
        po_prev = np.r_[False, po[:-1]] if len(po) else po
        start = po & ~po_prev & htf_ok
        self.start = start.tolist()
        self.start_idx = np.flatnonzero(start)

        # 確定スイング(鏡像: 買い=スイング高値 fr_sh / 売り=スイング安値 fr_sl を『高値』として扱う)
        hi, lo = ("sh", "sl") if long else ("sl", "sh")

        def swing(n: int, tag: str) -> np.ndarray:
            return _num(df, f"fr{n}_{tag}_last")

        def swing_pos(n: int, tag: str) -> np.ndarray:
            return _num(df, f"fr{n}_{tag}_last_pos")

        self.hi_swing = (sgn * swing(p.hi_swing_fractal_n, hi)).tolist() if p.hi_mode == "swing" else None
        if p.tl_mode == "trendline":
            self.tl_val = (sgn * swing(p.tl_fractal_n, hi)).tolist()
            self.tl_pos = swing_pos(p.tl_fractal_n, hi).tolist()
        else:
            self.tl_val = self.tl_pos = None
        # 追随用(スイング安値)
        self.trail_m15 = None
        self.trail_h1 = None
        if p.trail_mode == "m15_swing":
            self.trail_m15 = (sgn * swing(p.trail_fractal_n, lo)).tolist()
        elif p.trail_mode == "h1_swing":
            self.trail_h1 = (sgn * _num(df, f"h1_fr{p.trail_fractal_n}_{lo}_last")).tolist()

        # 1分足(鏡像)
        self.m1 = None
        if df1m is not None and len(df1m):
            t1 = df1m["time"].to_numpy(dtype="datetime64[ns]").astype("int64")
            h1m = df1m["high"].to_numpy(dtype=float)
            l1m = df1m["low"].to_numpy(dtype=float)
            if not long:
                h1m, l1m = -l1m, -h1m
            self.m1 = (t1, h1m, l1m)


# =====================================================================================
# 約定後の管理(run_backtest と run_benchmark_random で共通)
# =====================================================================================
class _Shared:
    """サイドをまたいで共通の時刻配列など。"""

    def __init__(self, df: pd.DataFrame):
        self.N = len(df)
        self.time_ns = _ns(df, "time").tolist()
        self.close_ns = _ns(df, "close_time").tolist()
        self.day_end_ns = _ns(df, "day_end").tolist()
        self.time_ns_arr = np.asarray(self.time_ns, dtype="int64")
        self.close_ns_arr = np.asarray(self.close_ns, dtype="int64")
        self.day_end_ns_arr = np.asarray(self.day_end_ns, dtype="int64")


def _first_touch(sd: _Side, sh: _Shared, j: int, stop: float, target: float) -> Tuple[str, int, int]:
    """同じ15分足で stop と target の両方に届き得るとき、先に届いた方を返す。

    戻り値 (order, k, b): order は 'stop' | 'target'。k は target が届いた1分足の位置(stopなら -1)、
    b はその15分足の1分足範囲の終端。1分足が無い/矛盾する場合は常に 'stop'(保守的)。
    """
    if sd.m1 is None:
        return "stop", -1, -1
    t1, h1m, l1m = sd.m1
    a = int(np.searchsorted(t1, sh.time_ns[j], side="left"))
    b = int(np.searchsorted(t1, sh.time_ns[j] + _BASE_NS, side="left"))
    if a >= b:
        return "stop", -1, -1
    s = np.flatnonzero(l1m[a:b] <= stop)
    t = np.flatnonzero(h1m[a:b] >= target)
    if len(s) == 0:
        return "stop", -1, -1  # 15分足は届いたと言うのに1分足に無い=矛盾 → 保守的にSL
    if len(t) == 0 or s[0] <= t[0]:
        return "stop", -1, -1  # 同じ1分足内で両方ならSL
    return "target", a + int(t[0]), b


def _simulate(
    sd: _Side,
    sh: _Shared,
    p: Params,
    j0: int,
    entry: float,
    sl0: float,
    tp1: float,
    spread_px: float,
) -> dict:
    """約定足 j0(始値=entry)から最終決済までを管理する(鏡像=買いとして)。価格はすべて鏡像。

    戻り値: exit_idx, exit_price, reason, partial, tp1_idx, r_multiple(コスト控除前), mae_r, mfe_r
    """
    risk = entry - sl0
    O, H, L, C = sd.O, sd.H, sd.L, sd.C
    N = sh.N
    sl = sl0
    kind = "sl"  # 現在のSLの種類: sl / be_stop / trail_stop
    partial = False
    tp1_idx = -1
    frac = p.tp1_fraction
    realized = 0.0  # 決済済み分の R(割合加重)
    remain = 1.0
    maxh, minl = -np.inf, np.inf
    fixed_target = entry + p.fixed_r * risk if p.trail_mode == "fixed_r" else None
    pending_ema_exit = False

    j = j0
    while True:
        # ---- 20EMA割れによる『次の足の始値』での決済 -------------------------------------
        if pending_ema_exit:
            px = O[j]
            return _finish(realized, remain, px, entry, risk, j, "ema20_exit", partial, tp1_idx, maxh, minl)

        h, l = H[j], L[j]
        if h > maxh:
            maxh = h
        if l < minl:
            minl = l
        stop_hit = l <= sl

        if not partial:
            tp_hit = h >= tp1
            order = None
            k = b = -1
            if stop_hit and tp_hit:
                order, k, b = _first_touch(sd, sh, j, sl, tp1)
            elif stop_hit:
                order = "stop"
            elif tp_hit:
                order = "target"
            if order == "stop":
                px = O[j] if O[j] < sl else sl  # 始値が飛び越えていれば始値(不利側)
                return _finish(realized, remain, px, entry, risk, j, "sl", partial, tp1_idx, maxh, minl)
            if order == "target":
                realized += frac * (tp1 - entry) / risk
                remain = 1.0 - frac
                partial = True
                tp1_idx = j
                # 1分足で『第1利確→旧SLに戻る』と判定された場合、旧SLは足の残りの間は有効
                if stop_hit and b > k + 1:
                    t1, h1m, l1m = sd.m1
                    if (l1m[k + 1 : b] <= sl).any():
                        return _finish(realized, remain, sl, entry, risk, j, "sl", partial, tp1_idx, maxh, minl)
                # 建値移動(この足のSL判定は済んでいるので、次の足から有効)
                if p.be_after_tp1 == "entry":
                    new_sl = entry
                elif p.be_after_tp1 == "entry_plus_spread":
                    new_sl = entry + spread_px
                else:
                    new_sl = None
                if new_sl is not None and new_sl > sl:
                    sl, kind = new_sl, "be_stop"
        else:
            tgt_hit = fixed_target is not None and h >= fixed_target
            order = None
            k = b = -1
            if stop_hit and tgt_hit:
                order, k, b = _first_touch(sd, sh, j, sl, fixed_target)
            elif stop_hit:
                order = "stop"
            elif tgt_hit:
                order = "target"
            if order == "stop":
                px = O[j] if O[j] < sl else sl
                return _finish(realized, remain, px, entry, risk, j, kind, partial, tp1_idx, maxh, minl)
            if order == "target":
                return _finish(realized, remain, fixed_target, entry, risk, j, "fixed_r", partial, tp1_idx, maxh, minl)

        # ---- 足の終値での処理 ------------------------------------------------------------
        # EOD(D9): この足がサーバー日の最後の足なら終値で全決済する。
        #   (a) 足の終わりが日の終わり以降(ちょうど一致 or GMTずらしで跨ぐ)
        #   (b) 次の足の始まりが日の終わり以降(週末・休場・欠測で、その日の最後の足になった場合)
        # 「ちょうど一致」だけを見ると、GMT±1のずらしや最終足の欠測で週末まで持ち越してしまう。
        if p.eod_close and (
            sh.close_ns[j] >= sh.day_end_ns[j]
            or (j + 1 < N and sh.time_ns[j + 1] >= sh.day_end_ns[j])
        ):
            return _finish(realized, remain, C[j], entry, risk, j, "eod", partial, tp1_idx, maxh, minl)
        if j == N - 1:
            return _finish(realized, remain, C[j], entry, risk, j, "data_end", partial, tp1_idx, maxh, minl)

        if partial:
            tm = p.trail_mode
            if tm == "ema20_close":
                if C[j] < sd.ema20[j]:
                    pending_ema_exit = True
            elif tm in ("m15_swing", "h1_swing"):
                cand = (sd.trail_m15 if tm == "m15_swing" else sd.trail_h1)[j]
                if cand > sl and cand < C[j]:  # NaN は False。SLは下げない
                    sl, kind = cand, "trail_stop"
        j += 1


def _finish(realized, remain, px, entry, risk, j, reason, partial, tp1_idx, maxh, minl) -> dict:
    r = realized + remain * (px - entry) / risk
    return {
        "exit_idx": j,
        "exit_price": px,
        "reason": reason,
        "partial": partial,
        "tp1_idx": tp1_idx,
        "r_multiple": r,
        "mae_r": (entry - minl) / risk,
        "mfe_r": (maxh - entry) / risk,
    }


# =====================================================================================
# トレード行の組み立て
# =====================================================================================
def _trade_row(
    sd: _Side, sh: _Shared, df_times: np.ndarray, p: Params, cost_price: float,
    sig_idx: int, entry_idx: int, entry: float, sl0: float, tp1: float,
    h0: float, ext: float, sim: dict,
) -> dict:
    sgn = sd.sgn
    risk = entry - sl0
    cost_r = cost_price / risk
    ei = sim["exit_idx"]
    return {
        "side": sd.name,
        "signal_time": df_times[sig_idx],
        "entry_time": df_times[entry_idx],
        "exit_time": df_times[ei],
        "entry": sgn * entry,
        "sl": sgn * sl0,
        "tp1": sgn * tp1,
        "risk": risk,
        "atr15": sd.atr[sig_idx],
        "h0": sgn * h0,
        "pb_extreme": sgn * ext,
        "partial": bool(sim["partial"]),
        "tp1_time": df_times[sim["tp1_idx"]] if sim["tp1_idx"] >= 0 else np.datetime64("NaT"),
        "exit_price": sgn * sim["exit_price"],
        "exit_reason": sim["reason"],
        "r_multiple": sim["r_multiple"],
        "cost_r": cost_r,
        "pnl_r": sim["r_multiple"] - cost_r,
        "bars_held": ei - entry_idx + 1,
        "mae_r": sim["mae_r"],
        "mfe_r": sim["mfe_r"],
        "tp1_r": (tp1 - entry) / risk,
        "params_key": p.key(),
    }


def _trades_frame(rows: List[dict], pair: str) -> pd.DataFrame:
    cols = TRADE_COLUMNS + ["mae_r", "mfe_r", "params_key", "tp1_r"]
    if not rows:
        df = pd.DataFrame({c: pd.Series(dtype="object") for c in cols})
        for c in ("signal_time", "entry_time", "exit_time", "tp1_time"):
            df[c] = pd.Series(dtype="datetime64[ns]")
        for c in ("entry", "sl", "tp1", "risk", "atr15", "h0", "pb_extreme", "exit_price",
                  "r_multiple", "cost_r", "pnl_r", "mae_r", "mfe_r", "tp1_r"):
            df[c] = pd.Series(dtype="float64")
        df["trade_id"] = pd.Series(dtype="int64")
        df["bars_held"] = pd.Series(dtype="int64")
        df["partial"] = pd.Series(dtype="bool")
        return df[cols]
    rows = sorted(rows, key=lambda r: (r["entry_time"], r["side"]))
    df = pd.DataFrame(rows)
    df.insert(0, "pair", pair)
    df.insert(0, "trade_id", np.arange(len(df), dtype="int64"))
    for c in ("signal_time", "entry_time", "exit_time", "tp1_time"):
        df[c] = pd.to_datetime(df[c]).astype("datetime64[ns]")
    df["partial"] = df["partial"].astype(bool)
    df["bars_held"] = df["bars_held"].astype("int64")
    return df[cols]


# =====================================================================================
# 局面の状態機械(1サイド)
# =====================================================================================
_STAGES = ("setup_break", "setup_pullback", "setup_line", "setup_line_break")


class _Machine:
    def __init__(self, sd: _Side, p: Params, F: Dict[str, int]):
        self.sd, self.p, self.F = sd, p, F
        self.active = False

    # ---- 計数 -----------------------------------------------------------------------
    def _reach(self, stage: str) -> None:
        if stage not in self.reached:
            self.reached.add(stage)
            self.F[f"{self.sd.name}.{stage}"] += 1

    def reach(self, stage: str) -> None:
        self._reach(stage)

    def end(self, reason: str) -> None:
        """局面の終了。reason は 'setup_filled' か cancel_* のキー。"""
        if reason == "setup_filled":
            self._reach("setup_filled")
        else:
            self.F[f"{self.sd.name}.{reason}"] += 1
        self.active = False

    def _cancel(self, key: str) -> bool:
        self.end(key)
        return False

    # ---- 開始 -----------------------------------------------------------------------
    def begin(self, i: int) -> None:
        sd, p = self.sd, self.p
        self.active = True
        self.reached = set()
        self.F[f"{sd.name}.setup_po"] += 1
        self.broke = False
        self.min_low_pre = sd.L[i]
        if p.hi_mode == "lookback":
            lo = max(0, i - p.hi_lookback + 1)
            self.ref = max(sd.H[lo : i + 1])
        else:
            self.ref = sd.hi_swing[i]
        self._reset_pb()
        self.H0 = None
        self.H0_pos = -1

    def _reset_pb(self) -> None:
        self.touched = False
        self.ext = float("inf")
        self.nbars = 0
        self.H1 = None
        self.H1_pos = -1
        self.ok_prev = False

    # ---- 1足の評価。ラインブレイク(シグナル)が出たら True ----------------------------------
    def step(self, i: int) -> bool:
        sd, p = self.sd, self.p
        if not sd.htf_ok[i]:
            return self._cancel("cancel_htf_lost")

        if not self.broke:
            if not sd.po[i]:
                return self._cancel("cancel_po_lost")
            if sd.L[i] < self.min_low_pre:
                self.min_low_pre = sd.L[i]
            brk = (sd.C[i] > self.ref) if p.hi_break_on == "close" else (sd.H[i] > self.ref)
            if brk:
                self.broke = True
                self.H0 = sd.H[i]
                self.H0_pos = i
                self._reset_pb()
                self._reach("setup_break")
            return False

        # ---- H0 の更新(更新した足は押しの評価をしない) ------------------------------------
        if sd.H[i] > self.H0:
            self.H0 = sd.H[i]
            self.H0_pos = i
            self._reset_pb()
            return False

        # ---- 押しの追跡 ------------------------------------------------------------------
        self.nbars += 1
        if sd.L[i] < self.ext:
            self.ext = sd.L[i]
        if p.pb_forbid_ema80_close and sd.C[i] < sd.ema80[i]:
            return self._cancel("cancel_pullback_violated")
        if p.pb_forbid_ema320_touch and sd.L[i] <= sd.ema320[i]:
            return self._cancel("cancel_pullback_violated")
        if i > self.H0_pos + p.tl_expire_bars:
            return self._cancel("cancel_expired")

        if p.pb_mode == "ema":
            if not self.touched and sd.L[i] <= sd.ema_touch[i]:
                self.touched = True
            ok = self.touched
        else:
            den = self.H0 - self.min_low_pre
            ok = den > 0 and p.pb_ratio_min <= (self.H0 - self.ext) / den <= p.pb_ratio_max
        ok = ok and self.nbars >= p.pb_min_bars
        if ok:
            self._reach("setup_pullback")

        # ---- ライン(D7) ------------------------------------------------------------------
        if p.tl_mode == "trendline":
            if self.H1 is None:
                v, pos = sd.tl_val[i], sd.tl_pos[i]
                if pos == pos and pos > self.H0_pos and v < self.H0:  # pos==pos は NaN 除外
                    self.H1, self.H1_pos = v, int(pos)
            avail = self.H1 is not None
            if avail:
                line = self.H0 + (self.H1 - self.H0) * (i - self.H0_pos) / (self.H1_pos - self.H0_pos)
        else:
            m = p.tl_recent_m
            avail = i - m > self.H0_pos
            if avail:
                line = max(sd.H[i - m : i])

        sig = False
        if avail:
            if ok or self.ok_prev:
                self._reach("setup_line")
            if self.ok_prev:
                if p.tl_break_on == "close":
                    sig = sd.C[i] > line
                else:
                    sig = sd.H[i] > line + p.tl_margin_atr * sd.atr[i]
                if sig:
                    self._reach("setup_line_break")
        self.ok_prev = ok
        return sig


# =====================================================================================
# 共通の下ごしらえ
# =====================================================================================
def _prepare(df: pd.DataFrame, params: Params, cfg: Config, df1m):
    params.validate()
    if len(df) == 0:
        raise ValueError("df15_with_htf が空です")
    pair = str(df["pair"].iloc[0]) if "pair" in df.columns else ""
    # コスト未設定なら NotConfiguredError(黙ってコスト0にしない)
    cost_price = cfg.costs.cost_price(pair)
    spread_pips = cfg.costs.spread_for(pair)
    sgns = {"both": (1, -1), "long": (1,), "short": (-1,)}[params.side]
    sh = _Shared(df)
    sides = [_Side(df, params, s, df1m) for s in sgns]
    df_times = df["time"].to_numpy(dtype="datetime64[ns]")
    return pair, cost_price, spread_pips, sh, sides, df_times


def _empty_funnel(N: int) -> Dict[str, int]:
    F = {k: 0 for k in funnel_keys()}
    F["bars_total"] = N
    return F


def _bar_funnel(F: Dict[str, int], sides: List[_Side]) -> None:
    for sd in sides:
        c = sd.cond
        cum = c["ready"]
        F[f"{sd.name}.bars_ready"] = int(cum.sum())
        cum = cum & c["h1"]
        F[f"{sd.name}.h1_cross"] = int(cum.sum())
        cum = cum & c["d1"]
        F[f"{sd.name}.d1"] = int(cum.sum())
        cum = cum & c["h4"]
        F[f"{sd.name}.h4"] = int(cum.sum())
        cum = cum & c["po"]
        F[f"{sd.name}.po"] = int(cum.sum())


def _next_bar_ok(sh: _Shared, p: Params, cfg: Config, i: int) -> bool:
    """判定足 i の次の足で約定できるか(次の足がある・ギャップ無し・EOD前)。"""
    if i + 1 >= sh.N:
        return False
    if sh.time_ns[i + 1] - sh.close_ns[i] > cfg.entry_max_gap_minutes * 60 * 1_000_000_000:
        return False
    if p.eod_close and sh.time_ns[i + 1] >= sh.day_end_ns[i]:
        return False
    return True


def _next_bar_ok_arr(sh: _Shared, p: Params, cfg: Config) -> np.ndarray:
    """_next_bar_ok のベクトル版(全判定足 i について)。"""
    N = sh.N
    ok = np.zeros(N, dtype=bool)
    if N < 2:
        return ok
    nxt = sh.time_ns_arr[1:]
    good = (nxt - sh.close_ns_arr[:-1]) <= cfg.entry_max_gap_minutes * 60 * 1_000_000_000
    if p.eod_close:
        good &= nxt < sh.day_end_ns_arr[:-1]
    ok[:-1] = good
    return ok


# =====================================================================================
# 公開API
# =====================================================================================
def run_backtest(
    df15_with_htf: pd.DataFrame,
    params: Params,
    cfg: Config,
    df1m: Optional[pd.DataFrame] = None,
) -> Tuple[pd.DataFrame, dict]:
    """1通貨ペア分のバックテスト。戻り値 (trades_df, funnel_dict)。

    df15_with_htf: core.data.build_dataset の出力(または truncate_dataset で末尾を切ったもの)。
    df1m: 任意。1分足(UTC, 列 time/open/high/low/close)。SLとTP1が同じ15分足で両方届き得る足の先後を判定する。
    コスト未設定なら NotConfiguredError。
    """
    df = df15_with_htf.reset_index(drop=True)
    if len(df) == 0:
        F = _empty_funnel(0)
        return _trades_frame([], ""), F
    pair, cost_price, spread_pips, sh, sides, df_times = _prepare(df, params, cfg, df1m)
    p = params
    F = _empty_funnel(sh.N)
    _bar_funnel(F, sides)
    machines = [_Machine(sd, p, F) for sd in sides]
    rows: List[dict] = []
    pip = pip_size(pair)
    spread_px = spread_pips * pip
    gap_ok = lambda i: _next_bar_ok(sh, p, cfg, i)  # noqa: E731
    busy_until = -1  # 判定足 i < busy_until の間は保有中(約定不可)

    def try_enter(m: _Machine, i: int) -> str:
        nonlocal busy_until
        sd = m.sd
        if not gap_ok(i):
            return "cancel_no_next_bar"
        entry = sd.O[i + 1]
        ext = m.ext
        if p.sl_mode == "atr":
            sl0 = ext - p.sl_margin_atr * sd.atr[i]
        else:
            sl0 = ext - (spread_pips + p.sl_fixed_pips) * pip
        tp1 = m.H0
        risk = entry - sl0
        # ---- D8 / D10 フィルター -----------------------------------------------------
        if risk <= 0 or tp1 <= entry:
            return "cancel_filter"
        if p.sl_max_h1_atr is not None and risk > p.sl_max_h1_atr * sd.h1atr[i]:
            return "cancel_filter"
        if p.d10_session_utc is not None:
            s, e = p.d10_session_utc
            hr = (sh.time_ns[i] // 3_600_000_000_000) % 24
            inside = (s <= hr < e) if s <= e else (hr >= s or hr < e)
            if s != e and not inside:
                return "cancel_filter"
        if p.d10_max_spread_pips is not None and spread_pips > p.d10_max_spread_pips:
            return "cancel_filter"
        if p.d10_min_tp_sl_ratio is not None and (tp1 - entry) / risk < p.d10_min_tp_sl_ratio:
            return "cancel_filter"
        m.reach("setup_filters")
        if i < busy_until:
            return "cancel_in_position"
        # ---- 約定: 次の足の始値 -------------------------------------------------------
        sim = _simulate(sd, sh, p, i + 1, entry, sl0, tp1, spread_px)
        rows.append(_trade_row(sd, sh, df_times, p, cost_price, i, i + 1, entry, sl0, tp1, m.H0, ext, sim))
        busy_until = sim["exit_idx"]
        return "setup_filled"

    N = sh.N
    i = 0
    while i < N:
        if not any(m.active for m in machines):
            nxt = None
            for m in machines:
                k = int(np.searchsorted(m.sd.start_idx, i, side="left"))
                if k < len(m.sd.start_idx):
                    c = int(m.sd.start_idx[k])
                    nxt = c if nxt is None else min(nxt, c)
            if nxt is None:
                break
            i = nxt
        for m in machines:
            if m.active and m.step(i):
                m.end(try_enter(m, i))
            if not m.active and m.sd.start[i]:
                m.begin(i)
        i += 1
    for m in machines:
        if m.active:
            m.end("cancel_open_at_end")

    trades = _trades_frame(rows, pair)
    validate_trades(trades)
    validate_funnel(F)
    return trades, F


def run_benchmark_random(
    df15_with_htf: pd.DataFrame,
    params: Params,
    cfg: Config,
    *,
    seed: int,
    ref_trades: pd.DataFrame,
    df1m: Optional[pd.DataFrame] = None,
) -> Tuple[pd.DataFrame, dict]:
    """段階E: D1〜D3 の方向が一致している足のランダムな時刻にエントリー(15分足のD4〜D7を置き換える)。

    決済管理(TP1・建値・追随・EOD)は run_backtest と同一の _simulate を使う。
    実取引 ref_trades と同数(サイドごと)のエントリーを候補から一様ランダムに選ぶ。
    損切り幅は (risk/atr15) を、第1利確距離は (tp1距離/risk) を、ref_trades の同じ取引から組で復元抽出して使う。
    """
    df = df15_with_htf.reset_index(drop=True)
    if len(df) == 0:
        return _trades_frame([], ""), _empty_funnel(0)
    pair, cost_price, spread_pips, sh, sides, df_times = _prepare(df, params, cfg, df1m)
    p = params
    F = _empty_funnel(sh.N)
    _bar_funnel(F, sides)
    if ref_trades is None or len(ref_trades) == 0:
        validate_funnel(F)
        return _trades_frame([], pair), F

    rng = np.random.default_rng(seed)
    refs = ref_trades.reset_index(drop=True)
    ref_risk_atr = (refs["risk"] / refs["atr15"]).to_numpy(dtype=float)
    ref_tp_r = ((refs["tp1"] - refs["entry"]).abs() / refs["risk"]).to_numpy(dtype=float)
    ref_side = refs["side"].to_numpy()
    pip = pip_size(pair)
    spread_px = spread_pips * pip
    N = sh.N

    # 候補(判定足 i): htf_ok(ready を含む=ATRあり)かつ 次の足で約定可
    next_ok = _next_bar_ok_arr(sh, p, cfg)
    pools: Dict[str, np.ndarray] = {}
    perms: Dict[str, np.ndarray] = {}
    ptr: Dict[str, int] = {}
    need: Dict[str, int] = {}
    ref_idx: Dict[str, np.ndarray] = {}
    for sd in sides:
        pool = np.flatnonzero(sd.htf_ok_arr & next_ok)
        pools[sd.name] = pool
        perms[sd.name] = rng.permutation(pool) if len(pool) else pool
        ptr[sd.name] = 0
        need[sd.name] = int((ref_side == sd.name).sum())
        same = np.flatnonzero(ref_side == sd.name)
        ref_idx[sd.name] = same if len(same) else np.arange(len(refs))
    side_by_name = {sd.name: sd for sd in sides}
    slots = [n for n in need for _ in range(need[n])]
    rng.shuffle(slots)

    occupied = np.zeros(N, dtype=bool)
    rows: List[dict] = []
    for name in slots:
        sd = side_by_name[name]
        while ptr[name] < len(perms[name]):
            i = int(perms[name][ptr[name]])
            ptr[name] += 1
            e = i + 1
            if occupied[e]:
                continue
            r = int(rng.choice(ref_idx[name]))
            risk = ref_risk_atr[r] * sd.atr[i]
            if not (risk > 0):
                continue
            entry = sd.O[e]
            sl0 = entry - risk
            tp1 = entry + ref_tp_r[r] * risk
            sim = _simulate(sd, sh, p, e, entry, sl0, tp1, spread_px)
            if occupied[e : sim["exit_idx"] + 1].any():
                continue  # 保有区間が既存の取引と重なる → 引き直し
            occupied[e : sim["exit_idx"] + 1] = True
            rows.append(_trade_row(sd, sh, df_times, p, cost_price, i, e, entry, sl0, tp1, tp1, sl0, sim))
            F[f"{name}.setup_po"] += 1
            for st in _STAGES + ("setup_filters", "setup_filled"):
                F[f"{name}.{st}"] += 1
            break

    trades = _trades_frame(rows, pair)
    validate_trades(trades)
    validate_funnel(F)
    return trades, F
