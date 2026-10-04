"""独立レビュー用: 約定・損益の仮定を手計算と照合する小例(コードは修正しない)。
tests/test_strategy.py の手作りデータ(PREFIX: entry=105.0, SL=102.3, TP1=H0=106.0, risk=2.7)を流用。
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tests"))
import numpy as np, pandas as pd
import strategy
from test_strategy import (scenario, P, ZERO_COST_CFG, COST_CFG, K, bar, ENTRY_OPEN, SL0, TP1, RISK,
                           _m1_for_bar14, PREFIX)

def go(tail, params=P, cfg=ZERO_COST_CFG, short=False, m1=None, **kw):
    df = scenario(tail, short=short, **kw)
    tr, F = strategy.run_backtest(df, params, cfg, m1)
    return df, tr, F

def show(name, tr, expect=None):
    if len(tr) == 0:
        print(f"[{name}] 取引なし"); return
    t = tr.iloc[0]
    print(f"[{name}] side={t['side']} reason={t['exit_reason']} exit_px={t['exit_price']:.4f} "
          f"R={t['r_multiple']:.5f} cost_r={t['cost_r']:.5f} pnl_r={t['pnl_r']:.5f} partial={t['partial']}"
          + (f"  期待R={expect:.5f}" if expect is not None else ""))

# 1. TP1後に次の足が建値を飛び越えて窓開け
tail = [bar(105.0,106.2,104.5,106.0), bar(104.0,104.5,103.5,104.2), bar(104.2,104.3,104.0,104.1)]
_,tr,_ = go(tail); show("1 BE窓開け(long)", tr, 0.5*1/RISK + 0.5*(104.0-105.0)/RISK)
_,tr,_ = go(tail, short=True); show("1 BE窓開け(short)", tr)

# 2. コスト: 売買同一額、部分利確でも1回分
tail = [bar(105.0,106.2,104.5,106.0), bar(105.5,105.6,104.8,105.0), bar(105.0,105.1,104.9,105.0)]
_,tr,_ = go(tail, cfg=COST_CFG); show("2 cost long", tr, 0.5/RISK - 0.03/RISK)
_,tr,_ = go(tail, cfg=COST_CFG, short=True); show("2 cost short", tr)

# 3. fixed_r で第1利確距離(tp1_r)が fixed_r より大きいケース: H0を高くする
rows = list(PREFIX); rows[7] = (103.0, 112.0, 104.5, 105.5)   # H0=112 -> tp1_r = 7/2.7=2.59R > 2R
tail = [bar(105.0,112.5,104.5,112.0), bar(112.0,113.0,111.5,112.5), bar(112.5,112.6,112.0,112.2)]
from test_strategy import make_ds
df = make_ds(rows+tail)
tr,F = strategy.run_backtest(df, P.replace(trail_mode="fixed_r", fixed_r=2.0), ZERO_COST_CFG)
t = tr.iloc[0]; print("[3 fixed_r<tp1_r] tp1_r=%.3f exit=%s px=%.3f R=%.4f sl=%.3f entry=%.3f risk=%.3f" % (t["tp1_r"], t["exit_reason"], t["exit_price"], t["r_multiple"], t["sl"], t["entry"], t["risk"]))
print("   次足の始値=112.0 なのに残りは 2R価格(=%.3f) で決済" % (t["entry"]+2*t["risk"]))
# 3b: TP1に届かず2Rまで上げて反転 -> 2R指値は未適用(SL)
tail2 = [bar(105.0,110.6,104.5,110.0), bar(110.0,110.2,100.0,101.0)]
df = make_ds(rows+tail2)
tr,F = strategy.run_backtest(df, P.replace(trail_mode="fixed_r", fixed_r=2.0), ZERO_COST_CFG)
show("3b 2R通過後反転(TP1未達)", tr)

# 4. EODで日の最後の足が欠測
df0 = scenario([bar(105.0,105.5,104.6,105.2)]*6)
de = pd.Series(df0.loc[16, "close_time"], index=df0.index)
df = scenario([bar(105.0,105.5,104.6,105.2)]*6, day_end=de)
full,_ = strategy.run_backtest(df, P.replace(eod_close=True), ZERO_COST_CFG)
print("[4a EOD通常] reason=", full.iloc[0]["exit_reason"], full.iloc[0]["exit_time"])
dfm = df.drop(index=16).reset_index(drop=True)   # 日の最後の足(バー16)が欠測
tr,_ = strategy.run_backtest(dfm, P.replace(eod_close=True), ZERO_COST_CFG)
print("[4b EOD最終足欠測] reason=", tr.iloc[0]["exit_reason"], tr.iloc[0]["exit_time"], " <- eodにならず翌日へ持ち越し")

# 5. 1分足: 売り(鏡像)でも先後判定が一致するか
tail = [bar(105.0,106.5,102.0,104.0), bar(104.0,104.5,103.5,104.0)]
df = scenario(tail); calm=(105.4,104.6)
m1 = _m1_for_bar14(df, [calm,(106.5,105.0),calm,calm,calm,(105.0,102.0)]+[calm]*9)
tr,_ = strategy.run_backtest(df, P, ZERO_COST_CFG, m1); show("5 1m TP1先->SL(long)", tr, 0.5/RISK-0.5)
dfs = scenario(tail, short=True)
m1s = m1.copy(); m1s["high"], m1s["low"] = K-m1["low"], K-m1["high"]; m1s["open"]=K-m1["open"]; m1s["close"]=K-m1["close"]
tr,_ = strategy.run_backtest(dfs, P, ZERO_COST_CFG, m1s); show("5 1m TP1先->SL(short)", tr)

# 6. 1分足が部分欠測(SLに届いた分が無い)の場合
m1b = m1.drop(index=[5]).reset_index(drop=True)
tr,_ = strategy.run_backtest(df, P, ZERO_COST_CFG, m1b); show("6 1m欠測(SLの分)", tr)

# 7. 同一足でTP1・BE(建値)両方: TP1足の次足で建値SL優先
tail = [bar(105.0,106.2,104.5,106.0), bar(106.0,106.5,104.9,106.0), bar(106.0,106.1,105.9,106.0)]
_,tr,_ = go(tail); show("7 TP1後BE足でlow<建値(次足)", tr, 0.5/RISK)
