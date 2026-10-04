"""strategy.py の単体テスト。

方針
- 『手作りの小さな価格系列』を使い、エントリー / SL / 部分利確 / SL優先 を手計算と照合する。
  EMAなどの指標は手で値を与える(指標計算そのものは core のテストが担当)。
- コストは、手計算が正確に合うようにテスト専用の『コスト0』設定を使う。
  【テスト用・実値ではない】実際のスプレッド・スリッページではない。
- 先読み禁止のテスト(未来の価格を書き換えても過去のシグナル・約定が不変)を含む。
"""
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import strategy  # noqa: E402
from core import indicators as ind  # noqa: E402
from core.config import (  # noqa: E402
    Config, CostConfig, NotConfiguredError, SYNTHETIC_NOTICE, default_config, synthetic_test_config,
)
from core.data import build_dataset, truncate_dataset  # noqa: E402
from core.params import Params  # noqa: E402
from core.schema import funnel_keys, validate_funnel, validate_trades  # noqa: E402
from core.synthetic import generate_synthetic  # noqa: E402

PAIR = "USDJPY"
K = 200.0  # 売りの鏡像テスト用: 価格 p -> K - p

# 【テスト用・実値ではない】手計算を正確に合わせるためのコスト0設定
ZERO_COST_CFG = Config(
    costs=CostConfig(
        spread_pips={PAIR: 0.0},
        slippage_pips=0.0,
        source=f"単体テスト用のコスト0({SYNTHETIC_NOTICE})",
        is_test_value=True,
    )
)
# 【テスト用・実値ではない】コスト計上の確認用(スプレッド2pips+スリッページ0.5pips×2 = 3pips = 0.03円)
COST_CFG = Config(
    costs=CostConfig(
        spread_pips={PAIR: 2.0}, slippage_pips=0.5,
        source=f"単体テスト用の仮置き({SYNTHETIC_NOTICE})", is_test_value=True,
    )
)

# 基準案から、手作り系列を扱いやすくするための差分(EODは別テストで確認)
P = Params(eod_close=False)


# =====================================================================================
# 手作りデータ
# =====================================================================================
# 買いの手作りシナリオ(バー0〜13)。行 = (open, high, low, close)。ATR=2.0 固定。
#   バー0-4: 横ばい(POなし) / バー5: PO成立(局面開始) / バー6: 高値(ref)を終値で上抜け(ブレイク)
#   バー7: 更に高値 → H0=106(バー7) / バー8以降: 押し(安値が40EMAに触れる)
#   バー10: フラクタル高値105.2(確定はバー12) → H1。ライン (7,106)-(10,105.2)
#   バー13: 終値がライン(104.4)を上抜け → シグナル。バー14の始値105.0で約定
#   押しの最安値 = 102.5(バー9) → SL = 102.5 - 0.1*2.0 = 102.3、risk = 2.7、tp1 = H0 = 106
PREFIX = [
    (100.0, 101.0, 99.0, 100.0),   # 0
    (100.0, 101.0, 99.0, 100.0),   # 1
    (100.0, 101.0, 99.0, 100.0),   # 2
    (100.0, 101.0, 99.0, 100.0),   # 3
    (100.0, 101.0, 99.0, 100.0),   # 4
    (100.0, 101.0, 99.5, 100.5),   # 5  PO成立。ref = max(high[0..5]) = 101
    (100.5, 104.0, 100.0, 103.0),  # 6  終値103 > 101 → ブレイク。H0=104
    (103.0, 106.0, 104.5, 105.5),  # 7  高値106 > 104 → H0=106(H0_pos=7)
    (105.5, 105.0, 103.5, 104.8),  # 8  押し開始。安値103.5 <= ema40(104.4)
    (104.8, 104.5, 102.5, 103.0),  # 9  押しの最安値 102.5
    (103.0, 105.2, 103.0, 104.0),  # 10 フラクタル高値(左8,9 より高く、右11,12 より高い)
    (104.0, 104.8, 103.2, 104.2),  # 11
    (104.2, 104.3, 103.6, 104.2),  # 12 H1確定(終値104.2 < ライン104.667 → まだブレイクしない)
    (104.2, 105.0, 104.0, 104.9),  # 13 終値104.9 > ライン104.4 → シグナル
]
# バー8の高値は 105.0 に直す(open 105.5 > high にならないように open も調整)
PREFIX[8] = (105.0, 105.0, 103.5, 104.8)

ENTRY_OPEN = 105.0  # バー14の始値(= 約定価格)
SL0 = 102.3
TP1 = 106.0
RISK = ENTRY_OPEN - SL0  # 2.7


def make_ds(rows, *, short=False, day_end=None, start="2024-01-09 00:00"):
    """手作りの (open, high, low, close) 列から、strategy に渡せるデータセットを作る。

    EMA・上位足の列は手で与える(買い用。short=True なら価格・指標を K から鏡像にし、売り条件にする)。
    フラクタルは core.indicators.fractal_swings で作る(strategy 側の読み方を本番と同じにするため)。
    """
    n = len(rows)
    o, h, l, c = (np.array([r[k] for r in rows], dtype=float) for k in range(4))
    i = np.arange(n, dtype=float)
    ema = {
        10: 108.0 + 0.05 * i, 20: 106.0 + 0.05 * i, 40: 104.0 + 0.05 * i,
        80: 100.0 + 0.05 * i, 320: 90.0 + 0.05 * i,
    }
    ema[10] = np.where(i < 5, ema[20] - 1.0, ema[10])  # バー0〜4はPOが成立しない(10EMA < 20EMA)
    if short:
        o, h, l, c = K - o, K - l, K - h, K - c
        ema = {k: K - v for k, v in ema.items()}
    t = pd.date_range(start, periods=n, freq="15min")
    df = pd.DataFrame({"pair": PAIR, "time": t, "close_time": t + pd.Timedelta(minutes=15),
                       "open": o, "high": h, "low": l, "close": c, "volume": 1.0})
    de = pd.Timestamp("2024-01-12") if day_end is None else day_end
    df["day_end"] = de if isinstance(de, pd.Series) else pd.Timestamp(de)
    extra = {f"ema{k}": v for k, v in ema.items()}
    extra["atr14"] = 2.0
    for fn in (2, 3, 5):
        sw = ind.fractal_swings(df["high"], df["low"], fn)
        for col in sw.columns:
            extra[f"fr{fn}_{col}"] = sw[col].to_numpy()
    s = -1.0 if short else 1.0
    # 上位足(確定済み): 買いなら強気、売りなら弱気で固定
    extra["h1_sma20"], extra["h1_sma80"] = 100.0 + s, 100.0
    extra["h1_gc_age"] = np.nan if short else 10.0
    extra["h1_dc_age"] = 10.0 if short else np.nan
    extra["h1_atr14"] = 5.0
    extra["d1_close"], extra["d1_sma20"], extra["d1_sma100"] = 100.0 + 5 * s, 100.0, 100.0 - 5 * s
    for k in (1, 3, 5):
        extra[f"d1_sma20_chg{k}"] = 1.0 * s
    extra["h4_sma20"] = 99.0 if short else 101.0
    extra["h4_sma80"] = 100.0
    extra["h4_sma120"] = 101.0 if short else 99.0
    for tf in ("d1", "h4", "h1"):
        for fn in (2, 3, 5):
            extra[f"{tf}_fr{fn}_sl_prev"] = 90.0
            extra[f"{tf}_fr{fn}_sh_prev"] = 110.0
            extra[f"{tf}_fr{fn}_hl"] = not short
            extra[f"{tf}_fr{fn}_lh"] = short
            extra[f"{tf}_fr{fn}_sl_last"] = 91.0
            extra[f"{tf}_fr{fn}_sh_last"] = 109.0
    df = pd.concat([df, pd.DataFrame({k: v for k, v in extra.items()}, index=df.index)], axis=1)
    return df


def scenario(tail, **kw):
    """PREFIX(バー0〜13)+ 約定足以降 tail(バー14〜)。"""
    return make_ds(PREFIX + list(tail), **kw)


def run(rows, params=P, cfg=ZERO_COST_CFG, df1m=None, **kw):
    df = scenario(rows, **kw)
    tr, F = strategy.run_backtest(df, params, cfg, df1m)
    validate_trades(tr)
    validate_funnel(F)
    return df, tr, F


# 約定足(バー14)から先を差し替えるための共通部品
def bar(o, h, l, c):
    return (o, h, l, c)


# =====================================================================================
# 1. エントリー: 次の足の始値で約定
# =====================================================================================
def test_entry_at_next_bar_open_with_expected_levels():
    # バー14: SL にも TP1 にも届かない足。以降も何も起きない(データ末尾で終了)
    tail = [bar(105.0, 105.5, 104.5, 105.2)]
    df, tr, F = run(tail)
    assert len(tr) == 1
    t = tr.iloc[0]
    assert t["side"] == "long"
    assert t["signal_time"] == df.loc[13, "time"] and t["entry_time"] == df.loc[14, "time"]
    assert t["entry_time"] > t["signal_time"]
    assert t["entry"] == pytest.approx(ENTRY_OPEN) == df.loc[14, "open"]
    assert t["sl"] == pytest.approx(SL0)          # 押しの最安値102.5 - 0.1×ATR2.0
    assert t["tp1"] == pytest.approx(TP1) == t["h0"]  # 第1利確 = H0
    assert t["pb_extreme"] == pytest.approx(102.5)
    assert t["risk"] == pytest.approx(RISK)
    assert t["atr15"] == pytest.approx(2.0)
    # 最後の足 → データ末尾の終値で決済
    assert t["exit_reason"] == "data_end" and t["exit_price"] == pytest.approx(105.2)
    assert t["r_multiple"] == pytest.approx((105.2 - ENTRY_OPEN) / RISK)
    assert not t["partial"] and pd.isna(t["tp1_time"])


def test_funnel_counts_for_completed_setup():
    df, tr, F = run([bar(105.0, 105.5, 104.5, 105.2)])
    L = "long."
    for k in ("setup_po", "setup_break", "setup_pullback", "setup_line", "setup_line_break",
              "setup_filters", "setup_filled"):
        assert F[L + k] == 1, k
    assert F["bars_total"] == len(df)
    # 売りは(上位足条件が弱気でないので)通過数0
    assert F["short.h1_cross"] == 0 and F["short.setup_po"] == 0
    # 足条件の累積通過数: PO成立は5本目以降
    assert F["long.bars_ready"] == len(df) and F["long.po"] == len(df) - 5


# =====================================================================================
# 2. 部分利確・建値・決済の損益R(手計算)
# =====================================================================================
def test_partial_take_profit_then_breakeven_stop():
    # バー14: 高値106.2 で TP1(106)に到達、安値104.5 > SL(102.3)。終値106.0
    # バー15: 建値(105.0)まで下げて建値ストップ(始値 105.5 > 建値なので建値価格で約定)
    tail = [bar(105.0, 106.2, 104.5, 106.0), bar(105.5, 105.6, 104.8, 105.0), bar(105.0, 105.1, 104.9, 105.0)]
    df, tr, F = run(tail)
    t = tr.iloc[0]
    assert t["partial"] and t["tp1_time"] == df.loc[14, "time"]
    assert t["exit_reason"] == "be_stop" and t["exit_time"] == df.loc[15, "time"]
    assert t["exit_price"] == pytest.approx(ENTRY_OPEN)
    # 半分を106で利確 = 0.5×(106-105)/2.7、残り半分は建値 = 0
    expected = 0.5 * (TP1 - ENTRY_OPEN) / RISK
    assert t["r_multiple"] == pytest.approx(expected) == pytest.approx(0.185185, abs=1e-6)
    assert t["pnl_r"] == pytest.approx(expected) and t["cost_r"] == 0.0
    assert t["bars_held"] == 2


def test_breakeven_not_effective_on_same_bar_as_tp1():
    # TP1 の足で安値が建値を割っても(建値移動は次の足から有効)、その足では SL(102.3) にしか掛からない
    tail = [bar(105.0, 106.2, 104.6, 106.0), bar(106.0, 106.5, 105.9, 106.3), bar(106.3, 106.4, 106.0, 106.2)]
    df, tr, F = run(tail, params=P.replace(trail_mode="ema20_close"))
    t = tr.iloc[0]
    assert t["partial"]
    # 14の終値106.0 < 20EMA(106+0.05*14=106.7) → 次の足(バー15)の始値で残りを決済
    assert t["exit_reason"] == "ema20_exit" and t["exit_time"] == df.loc[15, "time"]
    assert t["exit_price"] == pytest.approx(106.0)
    assert t["r_multiple"] == pytest.approx(0.5 * (1.0) / RISK + 0.5 * (106.0 - ENTRY_OPEN) / RISK)


# 追随の手作り系列(バー14〜21)。バー17 の安値105.6が15分足スイング安値(左右2本)になり、バー19の終値で確定する。
TRAIL_TAIL = [
    bar(105.0, 106.2, 104.5, 106.0),   # 14: TP1(106)に到達
    bar(106.0, 107.0, 106.2, 106.8),   # 15
    bar(106.8, 108.0, 106.4, 107.8),   # 16
    bar(107.8, 108.0, 105.6, 106.5),   # 17: スイング安値 105.6(左15,16 より低く、右18,19 より低い)
    bar(106.5, 107.5, 106.0, 107.0),   # 18
    bar(107.0, 107.6, 106.3, 107.4),   # 19: ここで17のスイング安値が確定 → SL を建値105.0 から 105.6 へ(次の足から有効)
    bar(107.4, 107.5, 105.5, 106.0),   # 20: 105.6 を割る → trail_stop(105.6)
    bar(106.0, 106.1, 105.9, 106.0),   # 21
]


def test_trailing_stop_follows_confirmed_m15_swing_low():
    # 第1利確後、確定した15分足スイング安値が現SL(建値)より高く、現在の終値より低ければ SL を引き上げる
    df, tr, F = run(TRAIL_TAIL)
    t = tr.iloc[0]
    assert t["exit_reason"] == "trail_stop" and t["exit_time"] == df.loc[20, "time"]
    assert t["exit_price"] == pytest.approx(105.6)
    expect = 0.5 * (TP1 - ENTRY_OPEN) / RISK + 0.5 * (105.6 - ENTRY_OPEN) / RISK
    assert t["r_multiple"] == pytest.approx(expect)


def test_fixed_r_exit_for_remainder():
    tail = [bar(105.0, 106.2, 104.5, 106.0), bar(106.0, 111.0, 105.8, 110.5), bar(110.5, 110.6, 110.0, 110.2)]
    df, tr, F = run(tail, params=P.replace(trail_mode="fixed_r", fixed_r=2.0))
    t = tr.iloc[0]
    target = ENTRY_OPEN + 2.0 * RISK  # 110.4
    assert t["exit_reason"] == "fixed_r" and t["exit_price"] == pytest.approx(target)
    assert t["r_multiple"] == pytest.approx(0.5 * (TP1 - ENTRY_OPEN) / RISK + 0.5 * 2.0)


def test_tp1_fraction_changes_split():
    tail = [bar(105.0, 106.2, 104.5, 106.0), bar(105.5, 105.6, 104.8, 105.0), bar(105.0, 105.1, 104.9, 105.0)]
    df, tr, F = run(tail, params=P.replace(tp1_fraction=0.3))
    assert tr.iloc[0]["r_multiple"] == pytest.approx(0.3 * (TP1 - ENTRY_OPEN) / RISK)


# =====================================================================================
# 3. SL優先(同一足でSLとTP1の両方に届く)
# =====================================================================================
def test_sl_has_priority_when_both_sl_and_tp1_touched_in_same_bar():
    # バー14: 高値106.5(TP1=106 到達)かつ 安値102.0(SL=102.3 到達) → SLが先
    tail = [bar(105.0, 106.5, 102.0, 104.0), bar(104.0, 104.5, 103.5, 104.0)]
    df, tr, F = run(tail)
    t = tr.iloc[0]
    assert t["exit_reason"] == "sl" and not t["partial"]
    assert t["exit_price"] == pytest.approx(SL0)
    assert t["r_multiple"] == pytest.approx(-1.0)
    assert t["exit_time"] == df.loc[14, "time"] and t["bars_held"] == 1


def test_gap_through_sl_fills_at_open():
    # バー14で始値が SL(102.3) より下 → 始値で約定(不利側)。ただし約定足の始値=entry なので別の足で確認:
    # バー14は何も無し、バー15は始値101.0(SLを飛び越えて開始)
    tail = [bar(105.0, 105.4, 104.6, 105.0), bar(101.0, 101.5, 100.5, 101.2)]
    df, tr, F = run(tail)
    t = tr.iloc[0]
    assert t["exit_reason"] == "sl" and t["exit_price"] == pytest.approx(101.0)
    assert t["r_multiple"] == pytest.approx((101.0 - ENTRY_OPEN) / RISK)
    assert t["r_multiple"] < -1.0


def _m1_for_bar14(df, minutes):
    """バー14(15分)の1分足を作る。minutes = 15個の (high, low)。始値・終値は適当(判定に使わない)。"""
    t0 = df.loc[14, "time"]
    rows = []
    for k, (hh, ll) in enumerate(minutes):
        rows.append({"time": t0 + pd.Timedelta(minutes=k), "open": 105.0, "high": hh, "low": ll, "close": 105.0})
    return pd.DataFrame(rows)


def test_1m_data_resolves_order_tp1_first_then_old_sl():
    # 15分足としては SL・TP1 の両方に届く足。1分足で『先に TP1(106)』→『その後 SL(102.3)』
    tail = [bar(105.0, 106.5, 102.0, 104.0), bar(104.0, 104.5, 103.5, 104.0)]
    df = scenario(tail)
    calm = (105.4, 104.6)
    m1 = _m1_for_bar14(df, [calm, (106.5, 105.0), calm, calm, calm, (105.0, 102.0)] + [calm] * 9)
    tr, F = strategy.run_backtest(df, P, ZERO_COST_CFG, m1)
    t = tr.iloc[0]
    # TP1 を先に約定(半分)、その後旧SL(建値移動は次の足から有効)で残りを決済
    assert t["partial"] and t["exit_reason"] == "sl"
    assert t["exit_price"] == pytest.approx(SL0)
    assert t["r_multiple"] == pytest.approx(0.5 * (TP1 - ENTRY_OPEN) / RISK + 0.5 * (-1.0))


def test_1m_data_sl_first_gives_full_stop():
    tail = [bar(105.0, 106.5, 102.0, 104.0), bar(104.0, 104.5, 103.5, 104.0)]
    df = scenario(tail)
    calm = (105.4, 104.6)
    m1 = _m1_for_bar14(df, [calm, (105.0, 102.0), calm, (106.5, 105.0)] + [calm] * 11)
    tr, F = strategy.run_backtest(df, P, ZERO_COST_CFG, m1)
    t = tr.iloc[0]
    assert not t["partial"] and t["exit_reason"] == "sl" and t["r_multiple"] == pytest.approx(-1.0)


def test_1m_same_minute_both_touched_means_sl():
    tail = [bar(105.0, 106.5, 102.0, 104.0), bar(104.0, 104.5, 103.5, 104.0)]
    df = scenario(tail)
    calm = (105.4, 104.6)
    m1 = _m1_for_bar14(df, [calm, (106.5, 102.0)] + [calm] * 13)  # 同じ1分足で両方
    tr, F = strategy.run_backtest(df, P, ZERO_COST_CFG, m1)
    assert not tr.iloc[0]["partial"] and tr.iloc[0]["r_multiple"] == pytest.approx(-1.0)


# =====================================================================================
# 4. 時間切れ(EOD)・コスト
# =====================================================================================
def test_eod_closes_at_last_bar_of_server_day():
    # バー16 の close_time を日の終わりにする(=サーバー日の最後の足)。判定足・約定足は同じ日。
    df0 = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 4)  # バー14〜17
    day_end = pd.Series(df0.loc[16, "close_time"], index=df0.index)
    df = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 4, day_end=day_end)
    tr, F = strategy.run_backtest(df, P.replace(eod_close=True), ZERO_COST_CFG)
    t = tr.iloc[0]
    assert t["exit_reason"] == "eod" and t["exit_time"] == df.loc[16, "time"]
    assert t["exit_price"] == pytest.approx(105.2)
    # eod_close=False なら日をまたいで保有(データ末尾まで)
    tr2, _ = strategy.run_backtest(df, P.replace(eod_close=False), ZERO_COST_CFG)
    assert tr2.iloc[0]["exit_reason"] == "data_end"


def test_eod_closes_even_if_last_bar_of_server_day_is_missing():
    # 日の最後の足(バー16)がデータに無い。close_time==day_end の足が存在しなくても、
    # 『次の足の始まりが日の終わり以降』ならその足(バー15)の終値で全決済する(日をまたいで持ち越さない)。
    df0 = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 6)  # バー14〜19
    day_end = pd.Series(df0.loc[16, "close_time"], index=df0.index)
    day_end.loc[17:] = df0.loc[16, "close_time"] + pd.Timedelta(days=1)
    df = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 6, day_end=day_end)
    df = df.drop(index=16).reset_index(drop=True)  # 日の最後の足が欠測
    tr, F = strategy.run_backtest(df, P.replace(eod_close=True), ZERO_COST_CFG)
    t = tr.iloc[0]
    assert t["exit_reason"] == "eod", t["exit_reason"]
    assert t["exit_time"] == df0.loc[15, "time"]
    assert (t["exit_time"] - t["entry_time"]) < pd.Timedelta(hours=26)


def test_eod_closes_before_weekend_gap_when_day_end_does_not_match_close_time():
    # GMTずらし相当: 日の終わり(day_end)が最終足の close_time と一致しない(最終足の終わりより後)。
    # 最終足の後に週末の空き(2日)がある。持ち越さず、最終足(バー16)の終値で全決済する。
    df0 = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 6)  # バー14〜19
    day_end = pd.Series(df0.loc[16, "close_time"] + pd.Timedelta(minutes=45), index=df0.index)  # 最終足の45分後
    day_end.loc[17:] = df0.loc[16, "close_time"] + pd.Timedelta(days=2, minutes=45)
    df = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 6, day_end=day_end)
    gap = pd.Timedelta(days=2)
    df.loc[17:, "time"] += gap
    df.loc[17:, "close_time"] += gap
    tr, F = strategy.run_backtest(df, P.replace(eod_close=True), ZERO_COST_CFG)
    t = tr.iloc[0]
    assert t["exit_reason"] == "eod", t["exit_reason"]
    assert t["exit_time"] == df.loc[16, "time"]
    assert t["exit_price"] == pytest.approx(105.2)
    assert (t["exit_time"] - t["entry_time"]) < pd.Timedelta(hours=26)
    # eod_close=False なら週末をまたいで保有する(対照)
    tr2, _ = strategy.run_backtest(df, P.replace(eod_close=False), ZERO_COST_CFG)
    assert tr2.iloc[0]["exit_reason"] == "data_end"


@pytest.mark.parametrize("shift", [-1, 0, 1])
def test_no_long_holds_over_26_hours_with_gmt_shift(shift):
    # GMTを±1時間ずらしても、EOD全決済が効いて『26時間超の保有』『週末またぎ』は0件(D9)。
    raw = generate_synthetic("USDJPY", start="2018-01-01", years=1.5, seed=3).m15
    cfg = synthetic_test_config().with_gmt_shift(shift)
    ds = build_dataset(raw, cfg, "USDJPY")
    tr, F = strategy.run_backtest(ds, LOOSE, cfg)
    validate_trades(tr)
    assert len(tr) >= 20, "テストに十分な取引数が無い"
    hours = (tr["exit_time"] - tr["entry_time"]).dt.total_seconds() / 3600
    assert int((hours > 26).sum()) == 0, tr.loc[hours > 26, ["entry_time", "exit_time", "exit_reason"]]
    # 週末またぎ(保有中に6時間超の空きがある)も0件
    times = ds["time"].to_numpy()
    close_times = ds["close_time"].to_numpy()
    pos = {t: n for n, t in enumerate(ds["time"])}
    for _, t in tr.iterrows():
        a, b = pos[t["entry_time"]], pos[t["exit_time"]]
        if b > a:
            assert not ((times[a + 1 : b + 1] - close_times[a:b]) > np.timedelta64(6, "h")).any()


def test_eod_closes_with_missing_last_bars_on_real_pipeline():
    # 日の最終足を15%欠損させても、26時間超の保有は0件。
    raw = generate_synthetic("USDJPY", start="2018-01-01", years=1.5, seed=3).m15
    cfg = synthetic_test_config()
    ds = build_dataset(raw, cfg, "USDJPY")
    de = ds["day_end"].to_numpy().astype("int64")
    last_idx = pd.Series(np.arange(len(ds))).groupby(de).max().to_numpy()
    rng = np.random.default_rng(0)
    drop = rng.choice(last_idx, size=int(len(last_idx) * 0.15), replace=False)
    raw2 = raw.drop(index=[i for i in drop if i < len(raw)]).reset_index(drop=True)
    ds2 = build_dataset(raw2, cfg, "USDJPY")
    tr, _ = strategy.run_backtest(ds2, LOOSE, cfg)
    assert len(tr) >= 20
    hours = (tr["exit_time"] - tr["entry_time"]).dt.total_seconds() / 3600
    assert int((hours > 26).sum()) == 0


def test_no_entry_when_next_bar_is_in_next_server_day():
    # 判定足(バー13)の次の足(バー14)が別のサーバー日 → エントリー見送り
    df0 = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 2)
    day_end = pd.Series(df0.loc[13, "close_time"], index=df0.index)  # 判定足が日の最後の足
    df = scenario([bar(105.0, 105.5, 104.6, 105.2)] * 2, day_end=day_end)
    tr, F = strategy.run_backtest(df, P.replace(eod_close=True), ZERO_COST_CFG)
    assert len(tr) == 0 and F["long.cancel_no_next_bar"] == 1 and F["long.setup_filled"] == 0
    validate_funnel(F)


def test_cost_is_applied_in_r_units_and_pnl_is_gross_minus_cost():
    tail = [bar(105.0, 106.2, 104.5, 106.0), bar(105.5, 105.6, 104.8, 105.0), bar(105.0, 105.1, 104.9, 105.0)]
    df, tr, F = run(tail, cfg=COST_CFG)
    t = tr.iloc[0]
    cost_price = (2.0 + 2 * 0.5) * 0.01  # (スプレッド + スリッページ×2) × pip(円=0.01)
    assert t["cost_r"] == pytest.approx(cost_price / RISK)
    assert t["pnl_r"] == pytest.approx(t["r_multiple"] - cost_price / RISK)


def test_not_configured_costs_raise():
    df = scenario([bar(105.0, 105.5, 104.5, 105.2)])
    with pytest.raises(NotConfiguredError):
        strategy.run_backtest(df, P, default_config())  # コスト未設定(placeholder)
    with pytest.raises(NotConfiguredError):
        strategy.run_benchmark_random(df, P, default_config(), seed=0, ref_trades=pd.DataFrame())


# =====================================================================================
# 5. 売り(鏡像): 買いと同じ結果になる
# =====================================================================================
@pytest.mark.parametrize("tail", [
    [bar(105.0, 106.2, 104.5, 106.0), bar(105.5, 105.6, 104.8, 105.0), bar(105.0, 105.1, 104.9, 105.0)],  # TP1→建値
    [bar(105.0, 106.5, 102.0, 104.0), bar(104.0, 104.5, 103.5, 104.0)],                                   # SL優先
    TRAIL_TAIL,                                                                                           # 追随
])
def test_short_is_exact_mirror_of_long(tail):
    _, tl, _ = run(tail)
    df_s = scenario(tail, short=True)
    ts, Fs = strategy.run_backtest(df_s, P, ZERO_COST_CFG)
    validate_trades(ts)
    validate_funnel(Fs)
    assert len(tl) == len(ts) == 1
    a, b = tl.iloc[0], ts.iloc[0]
    assert b["side"] == "short"
    for col in ("entry", "sl", "tp1", "h0", "pb_extreme", "exit_price"):
        assert b[col] == pytest.approx(K - a[col]), col
    for col in ("risk", "r_multiple", "pnl_r", "bars_held", "partial", "exit_reason", "entry_time", "exit_time"):
        assert b[col] == a[col] or b[col] == pytest.approx(a[col]), col
    assert Fs["short.setup_filled"] == 1 and Fs["long.setup_po"] == 0


def test_side_param_restricts_trading():
    tail = [bar(105.0, 105.5, 104.5, 105.2)]
    df = scenario(tail)
    tr, F = strategy.run_backtest(df, P.replace(side="short"), ZERO_COST_CFG)
    assert len(tr) == 0 and F["long.bars_ready"] == 0
    tr, F = strategy.run_backtest(df, P.replace(side="long"), ZERO_COST_CFG)
    assert len(tr) == 1


# =====================================================================================
# 6. 局面の取り消し(funnel の cancel_*)
# =====================================================================================
def test_cancel_pullback_violated_when_close_below_ema80():
    rows = list(PREFIX[:9]) + [(104.8, 104.9, 99.5, 99.8)]  # バー9: 終値99.8 < 80EMA(100.45)
    df = make_ds(rows + [(99.8, 100.0, 99.5, 99.9)] * 3)
    tr, F = strategy.run_backtest(df, P, ZERO_COST_CFG)
    assert len(tr) == 0 and F["long.cancel_pullback_violated"] == 1 and F["long.setup_break"] == 1
    validate_funnel(F)


def test_cancel_expired_after_tl_expire_bars():
    # 押しが入った後、ラインをブレイクしないまま期限(H0足から tl_expire_bars 本)を超える
    flat = (104.0, 104.1, 103.9, 104.0)
    rows = list(PREFIX[:10]) + [flat] * 20
    df = make_ds(rows)
    tr, F = strategy.run_backtest(df, P.replace(tl_expire_bars=6), ZERO_COST_CFG)
    assert len(tr) == 0 and F["long.cancel_expired"] == 1
    validate_funnel(F)


def test_cancel_htf_lost_when_dead_cross():
    df = scenario([bar(105.0, 105.5, 104.5, 105.2)])
    df.loc[10:, "h1_sma20"] = 99.0  # バー10以降、1時間足の20SMAが80SMAを下回る(デッドクロス)
    tr, F = strategy.run_backtest(df, P, ZERO_COST_CFG)
    assert len(tr) == 0 and F["long.cancel_htf_lost"] == 1
    assert F["long.h1_cross"] == 10  # バー0〜9 だけが通過


def test_filter_skips_when_tp1_below_entry():
    # 次の足の始値が H0(106) を上回って始まる → 利確が既に不利側なので見送り
    df, tr, F = run([bar(106.5, 107.0, 106.0, 106.8)])
    assert len(tr) == 0 and F["long.cancel_filter"] == 1 and F["long.setup_filters"] == 0


def test_d10_filter_is_separate_and_off_by_default():
    tail = [bar(105.0, 105.5, 104.5, 105.2)]
    assert P.is_original()
    # TP距離/損切り幅 = 1.0/2.7 = 0.37。下限 0.5 を課すと見送り(D10なので原典準拠ではない)
    df, tr, F = run(tail, params=P.replace(d10_min_tp_sl_ratio=0.5))
    assert not P.replace(d10_min_tp_sl_ratio=0.5).is_original()
    assert len(tr) == 0 and F["long.cancel_filter"] == 1


def test_sl_max_h1_atr_filter():
    tail = [bar(105.0, 105.5, 104.5, 105.2)]
    # 損切り幅2.7 > 0.5×h1_atr(5.0)=2.5 → 見送り / 1.5×5.0=7.5 なら通る
    _, tr, F = run(tail, params=P.replace(sl_max_h1_atr=0.5))
    assert len(tr) == 0 and F["long.cancel_filter"] == 1
    _, tr, F = run(tail, params=P.replace(sl_max_h1_atr=1.5))
    assert len(tr) == 1


def test_no_second_entry_while_in_position(synth_raw):
    # 長く持つ設定(EODなし・固定R3・建値移動なし)では、保有中にシグナルが出て見送りになる局面が実際に起きる
    cfg = synthetic_test_config()
    ds = build_dataset(synth_raw, cfg, "USDJPY")
    p = LOOSE.replace(eod_close=False, trail_mode="fixed_r", fixed_r=3.0, be_after_tp1="none")
    tr, F = strategy.run_backtest(ds, p, cfg)
    validate_trades(tr)
    validate_funnel(F)
    skipped = F["long.cancel_in_position"] + F["short.cancel_in_position"]
    assert skipped > 0, "保有中の見送りが1度も起きない設定ではテストにならない"
    # 保有区間は重ならない(買い・売りをまたいでも同時に1つ)
    assert (tr["entry_time"].iloc[1:].to_numpy() > tr["exit_time"].iloc[:-1].to_numpy()).all()
    # 局面の収支: setup_po = 約定 + 各cancel(validate_funnelが検査)。見送りは約定に数えられていない
    assert len(tr) == F["long.setup_filled"] + F["short.setup_filled"]
    assert F["long.setup_filters"] >= F["long.setup_filled"] + F["long.cancel_in_position"]


# =====================================================================================
# 7. 先読み禁止
# =====================================================================================
LOOSE = Params(eod_close=True, d1_mode="D", h4_require_swing=False, h1_cross_window=None, hi_lookback=20)


@pytest.fixture(scope="module")
def synth_raw():
    return generate_synthetic("USDJPY", start="2018-01-01", years=0.8, seed=11).m15


def _entry_cols(tr):
    return tr[["side", "signal_time", "entry_time", "entry", "sl", "tp1", "h0", "pb_extreme", "risk"]]


def test_future_prices_do_not_change_past_signals_and_entries(synth_raw):
    cfg = synthetic_test_config()
    ds = build_dataset(synth_raw, cfg, "USDJPY")
    base, Fb = strategy.run_backtest(ds, LOOSE, cfg)
    assert len(base) >= 20, "テストに十分な取引数が無い(パラメータを見直す)"
    k = len(ds) * 6 // 10
    cut_time = ds.loc[k, "time"]
    # バー k 以降の価格を乱暴に書き換える(乱数)
    raw2 = synth_raw.copy()
    rng = np.random.default_rng(0)
    idx = raw2.index[raw2["time"] >= cut_time]
    mult = np.exp(np.cumsum(rng.normal(0, 0.004, len(idx))))
    for col in ("open", "high", "low", "close"):
        raw2.loc[idx, col] = raw2.loc[idx, col].to_numpy() * mult
    raw2["high"] = raw2[["open", "high", "low", "close"]].max(axis=1)
    raw2["low"] = raw2[["open", "high", "low", "close"]].min(axis=1)
    ds2 = build_dataset(raw2, cfg, "USDJPY")
    chg, _ = strategy.run_backtest(ds2, LOOSE, cfg)

    # 約定がバー k より前の取引: 判定・約定に関する列が完全に一致する
    a = base[base["entry_time"] < cut_time].reset_index(drop=True)
    b = chg[chg["entry_time"] < cut_time].reset_index(drop=True)
    assert len(a) >= 5
    pd.testing.assert_frame_equal(_entry_cols(a), _entry_cols(b))
    # 決済までがバー k より前に終わった取引は、全列が一致する
    a2 = base[base["exit_time"] < cut_time].reset_index(drop=True)
    b2 = chg[chg["exit_time"] < cut_time].reset_index(drop=True)
    pd.testing.assert_frame_equal(a2.drop(columns=["trade_id"]), b2.drop(columns=["trade_id"]))


def test_truncating_the_end_does_not_change_earlier_closed_trades(synth_raw):
    cfg = synthetic_test_config()
    ds = build_dataset(synth_raw, cfg, "USDJPY")
    full, _ = strategy.run_backtest(ds, LOOSE, cfg)
    end = ds.loc[len(ds) * 7 // 10, "close_time"]
    part, Fp = strategy.run_backtest(truncate_dataset(ds, end), LOOSE, cfg)
    last = ds[ds["close_time"] <= end]["time"].iloc[-1]
    a = full[(full["exit_time"] < last)].reset_index(drop=True)
    b = part[(part["exit_time"] < last) & (part["exit_reason"] != "data_end")].reset_index(drop=True)
    assert len(a) >= 5
    pd.testing.assert_frame_equal(a.drop(columns=["trade_id"]), b.drop(columns=["trade_id"]))


def test_all_trades_enter_at_next_bar_open_on_real_pipeline(synth_raw):
    cfg = synthetic_test_config()
    ds = build_dataset(synth_raw, cfg, "USDJPY")
    tr, F = strategy.run_backtest(ds, LOOSE, cfg)
    validate_trades(tr)
    validate_funnel(F)
    opens = ds.set_index("time")["open"]
    times = ds["time"]
    pos = {t: n for n, t in enumerate(times)}
    for _, t in tr.iterrows():
        assert t["entry"] == pytest.approx(opens[t["entry_time"]])
        # 約定足は判定足の次の足
        assert pos[t["entry_time"]] == pos[t["signal_time"]] + 1
        assert t["entry_time"] > t["signal_time"]
    # ポジションは同時に1つ(取引の保有区間が重ならない)
    assert (tr["entry_time"].iloc[1:].to_numpy() > tr["exit_time"].iloc[:-1].to_numpy()).all()
    # 売りと買いの両方が出ている(対称実装の確認)
    assert set(tr["side"]) == {"long", "short"}


def test_funnel_is_monotone_and_complete_on_real_pipeline(synth_raw):
    cfg = synthetic_test_config()
    ds = build_dataset(synth_raw, cfg, "USDJPY")
    for params in (Params(), LOOSE, LOOSE.replace(pb_mode="ratio"), LOOSE.replace(tl_mode="recent_high"),
                   LOOSE.replace(hi_mode="swing"), LOOSE.replace(trail_mode="ema20_close"),
                   LOOSE.replace(trail_mode="h1_swing"), LOOSE.replace(trail_mode="fixed_r"),
                   LOOSE.replace(d1_mode="B", h4_long_sma=80), LOOSE.replace(tl_break_on="high_margin")):
        tr, F = strategy.run_backtest(ds, params, cfg)
        validate_trades(tr)
        validate_funnel(F)
        assert set(F) == set(funnel_keys())
        assert len(tr) == F["long.setup_filled"] + F["short.setup_filled"]


# =====================================================================================
# 8. 段階E: ランダム・ベンチマーク
# =====================================================================================
def test_benchmark_random_is_reproducible_and_matches_counts(synth_raw):
    cfg = synthetic_test_config()
    ds = build_dataset(synth_raw, cfg, "USDJPY")
    ref, _ = strategy.run_backtest(ds, LOOSE, cfg)
    r1, F1 = strategy.run_benchmark_random(ds, LOOSE, cfg, seed=5, ref_trades=ref)
    r2, F2 = strategy.run_benchmark_random(ds, LOOSE, cfg, seed=5, ref_trades=ref)
    r3, _ = strategy.run_benchmark_random(ds, LOOSE, cfg, seed=6, ref_trades=ref)
    pd.testing.assert_frame_equal(r1, r2)
    assert F1 == F2
    assert not r1[["entry_time"]].equals(r3[["entry_time"]])
    validate_trades(r1)
    validate_funnel(F1)
    assert len(r1) == len(ref)
    for s in ("long", "short"):
        assert (r1["side"] == s).sum() == (ref["side"] == s).sum()
    # 保有区間が重ならず、約定は次の足の始値
    assert (r1["entry_time"].iloc[1:].to_numpy() > r1["exit_time"].iloc[:-1].to_numpy()).all()
    opens = ds.set_index("time")["open"]
    assert all(r1["entry"].iloc[i] == pytest.approx(opens[r1["entry_time"].iloc[i]]) for i in range(len(r1)))
    # 損切り幅の分布は実取引の経験分布(risk/ATR)の範囲内
    ratio_ref = (ref["risk"] / ref["atr15"])
    ratio = r1["risk"] / r1["atr15"]
    assert ratio.min() >= ratio_ref.min() - 1e-9 and ratio.max() <= ratio_ref.max() + 1e-9


def test_benchmark_random_with_empty_ref_returns_empty():
    df = scenario([bar(105.0, 105.5, 104.5, 105.2)])
    tr, F = strategy.run_benchmark_random(df, P, ZERO_COST_CFG, seed=0, ref_trades=run([bar(105.0, 105.5, 104.5, 105.2)])[1].iloc[0:0])
    assert len(tr) == 0
    validate_funnel(F)


def test_strategy_notes_published():
    assert isinstance(strategy.STRATEGY_NOTES, list) and len(strategy.STRATEGY_NOTES) >= 5
    assert all(isinstance(s, str) and s for s in strategy.STRATEGY_NOTES)
