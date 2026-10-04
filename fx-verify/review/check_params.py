"""独立レビュー用: パラメータが実際に効いているか・凍結や台地選択の挙動を確認する。(コードは修正しない)"""
import os, sys, warnings
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np, pandas as pd
from core.config import synthetic_test_config
from core.data import build_dataset, truncate_dataset
from core.params import base_params
from core.synthetic import generate_universe
import strategy

cfg = synthetic_test_config()
uni = generate_universe(("USDJPY",), start="2018-01-01", years=3, seed=0)
ds = build_dataset(uni["USDJPY"].m15, cfg, "USDJPY")
p = base_params()
tr, F = strategy.run_backtest(ds, p, cfg)
print("base n_trades", len(tr))
for k in (0, 3, 8, 30, 200):
    t, f = strategy.run_backtest(ds, p.replace(pb_min_bars=k), cfg)
    print("pb_min_bars", k, len(t), round(t["pnl_r"].mean(), 4) if len(t) else None)
# 局面開始から約定までの本数
print(tr[["side","signal_time","entry_time","h0","pb_extreme"]].head())
