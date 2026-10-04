"""run_backtest の出力(trades / funnel)の列定義と検証関数。INTERFACES.md と一致させること。"""
from __future__ import annotations

from typing import Dict, List

import pandas as pd

SIDES = ("long", "short")

# trades_df の必須列(順序もこの通り)
TRADE_COLUMNS: List[str] = [
    "trade_id",       # int 0始まり連番(entry_time 昇順)
    "pair",           # str
    "side",           # 'long' | 'short'
    "signal_time",    # 判定足の始値時刻(UTC)。この足の終値でシグナルが出た
    "entry_time",     # 約定足(判定足の次の足)の始値時刻 = 約定時刻
    "exit_time",      # 最終決済が起きた足の始値時刻(足の途中で決済した場合もその足の始値時刻)
    "entry",          # 約定価格(次の足の始値。コスト加算前の素の価格)
    "sl",             # 当初の損切り価格
    "tp1",            # 第1利確価格(H0)
    "risk",           # |entry - sl|(価格幅)。R の単位
    "atr15",          # 判定足時点の ATR(14, 15分足)(ベンチマークで損切り幅を再現するために必須)
    "h0",             # 押しの起点の高値(買い。売りは安値)
    "pb_extreme",     # 押しの最安値(買い。売りは最高値)
    "partial",        # bool: 第1利確(部分決済)が約定したか
    "tp1_time",       # 第1利確の足の始値時刻(未約定なら NaT)
    "exit_price",     # 残り(または全量)の最終決済価格
    "exit_reason",    # EXIT_REASONS のどれか
    "r_multiple",     # コスト控除前の合計R(各決済分の R を割合で加重した和)
    "cost_r",         # コスト(スプレッド + スリッページ×2)/ risk
    "pnl_r",          # r_multiple - cost_r  ← 成績集計はこれ
    "bars_held",      # 保有した15分足の本数(約定足を1と数える)
]

# 任意の追加列(あってもよい)
TRADE_OPTIONAL_COLUMNS: List[str] = ["mae_r", "mfe_r", "params_key", "tp1_r"]

EXIT_REASONS = (
    "sl",           # 当初の損切りで全量決済(第1利確前)
    "be_stop",      # 第1利確後、建値(+スプレッド)に移した損切りで残りを決済
    "trail_stop",   # 第1利確後、スイング追随で引き上げた損切りで残りを決済
    "ema20_exit",   # 15分足終値が20EMAを割り(売りは超え)、次の足の始値で残りを決済
    "fixed_r",      # 固定R(trail_mode='fixed_r')で残りを決済
    "eod",          # サーバー日の終わりで全決済(eod_close)
    "data_end",     # データ末尾で強制決済
)

# ---- funnel ------------------------------------------------------------------
# 足ごとの条件通過数(累積: 前の条件を全て満たした足の数。単調非増加)
FUNNEL_BAR_STEPS = ["bars_ready", "h1_cross", "d1", "h4", "po"]
# セットアップ(PO成立から始まる1局面)が到達した段階の数(累積: その段階以上に到達した局面数。単調非増加)
FUNNEL_SETUP_STEPS = [
    "setup_po",          # POの成立(立ち上がり)で上位足条件OK → 局面を開始
    "setup_break",       # D5: 直近高値を上抜け
    "setup_pullback",    # D6: 押しの条件(深さ・禁止条件)を満たした
    "setup_line",        # D7: 切り下げライン(H0とH1)が確定した(recent_highでは『押し中の直近高値』が確定)
    "setup_line_break",  # D7: ラインを上抜けた(有効期限内)
    "setup_filters",     # D8/D10: 損切り幅上限・TP距離・追加フィルターを通過
    "setup_filled",      # 次の足の始値で約定(= 取引数)
]
# 局面の終わり方(全ての局面は setup_filled か cancel_* のどれか1つで終わる)
FUNNEL_CANCEL_KEYS = [
    "cancel_po_lost",            # ブレイク前にPO(並び)が崩れた
    "cancel_htf_lost",           # 上位足条件(D1〜D3)が崩れた(デッドクロス等)
    "cancel_pullback_violated",  # 押し禁止条件(80EMA終値割れ・320EMA接触等)に抵触
    "cancel_expired",            # 有効期限(tl_expire_bars)切れ
    "cancel_filter",             # 損切り幅上限・TP距離・D10フィルターで見送り
    "cancel_in_position",        # すでにポジション保有中で約定できず
    "cancel_no_next_bar",        # 次の足が無い/ギャップ(週末等)でエントリー不可、またはコスト未設定等
    "cancel_open_at_end",        # データ末尾で局面が未決のまま終了
]


def funnel_keys() -> List[str]:
    keys = ["bars_total"]
    for s in SIDES:
        keys += [f"{s}.{k}" for k in FUNNEL_BAR_STEPS + FUNNEL_SETUP_STEPS + FUNNEL_CANCEL_KEYS]
    return keys


def validate_trades(df: pd.DataFrame) -> None:
    """列の過不足・基本的な整合を検証(違反は ValueError)。"""
    missing = [c for c in TRADE_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"trades に必須列が無い: {missing}")
    if len(df) == 0:
        return
    if not set(df["side"]).issubset(set(SIDES)):
        raise ValueError("side は 'long'/'short'")
    if not set(df["exit_reason"]).issubset(set(EXIT_REASONS)):
        raise ValueError(f"exit_reason は {EXIT_REASONS} のどれか")
    if not (df["exit_time"] >= df["entry_time"]).all():
        raise ValueError("exit_time < entry_time の取引がある")
    if not (df["entry_time"] > df["signal_time"]).all():
        raise ValueError("entry_time は signal_time より後(次の足の始値で約定)であること")
    if not (df["risk"] > 0).all():
        raise ValueError("risk は正")
    if not ((df["r_multiple"] - df["cost_r"] - df["pnl_r"]).abs() < 1e-9).all():
        raise ValueError("pnl_r = r_multiple - cost_r が成り立っていない")


def validate_funnel(funnel: Dict[str, int]) -> None:
    """キーの過不足・単調性・局面の収支(setup_po == setup_filled + Σcancel_*)を検証。"""
    expect = set(funnel_keys())
    got = set(funnel)
    if expect != got:
        raise ValueError(f"funnel のキーが不一致 不足={sorted(expect - got)} 余分={sorted(got - expect)}")
    for s in SIDES:
        bar = [funnel[f"{s}.{k}"] for k in FUNNEL_BAR_STEPS]
        if any(b > a for a, b in zip(bar, bar[1:])) or bar[0] > funnel["bars_total"]:
            raise ValueError(f"{s}: 足条件の通過数が単調非増加でない {bar}")
        st = [funnel[f"{s}.{k}"] for k in FUNNEL_SETUP_STEPS]
        if any(b > a for a, b in zip(st, st[1:])):
            raise ValueError(f"{s}: 局面の到達数が単調非増加でない {st}")
        ends = funnel[f"{s}.setup_filled"] + sum(funnel[f"{s}.{k}"] for k in FUNNEL_CANCEL_KEYS)
        if ends != funnel[f"{s}.setup_po"]:
            raise ValueError(f"{s}: setup_po({funnel[f'{s}.setup_po']}) != filled+cancel({ends})")
