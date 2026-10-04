"""独立レビュー用: バックテスト結果の打ち切り不変性。全期間の取引のうち、切り位置より十分前に決済した取引は、
切ったデータで回した結果と一致するはず(一致しなければ判定に未来を使っている)。(コードは修正しない)"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np, pandas as pd
from core.config import synthetic_test_config
from core.data import build_dataset, truncate_dataset
from core.params import base_params
from core.synthetic import generate_universe
import strategy

cfg = synthetic_test_config()
variants = {
 "base": base_params(),
 "swing_hi+recent": base_params().replace(hi_mode="swing", tl_mode="recent_high"),
 "ratio+h1swing": base_params().replace(pb_mode="ratio", trail_mode="h1_swing", d1_mode="B"),
 "ema20+hm": base_params().replace(trail_mode="ema20_close", tl_break_on="high_margin", hi_break_on="high"),
 "fixed_r_loose": base_params().replace(trail_mode="fixed_r", h1_cross_window=None, d1_mode="D", h4_require_swing=False),
}
for seed in (1, 2):
    uni = generate_universe(("USDJPY",), start="2018-01-01", years=3, seed=seed)
    ds = build_dataset(uni["USDJPY"].m15, cfg, "USDJPY")
    for name, p in variants.items():
        full, _ = strategy.run_backtest(ds, p, cfg)
        for frac in (0.5, 0.75):
            cut = ds["close_time"].iloc[int(len(ds) * frac)]
            part_ds = truncate_dataset(ds, cut)
            part, _ = strategy.run_backtest(part_ds, p, cfg)
            # 切り位置の3日前までに決済した取引だけ比較
            lim = cut - pd.Timedelta(days=3)
            a = full[full["exit_time"] < lim].reset_index(drop=True)
            b = part[part["exit_time"] < lim].reset_index(drop=True)
            cols = ["side", "signal_time", "entry_time", "exit_time", "entry", "sl", "tp1", "pnl_r"]
            ok = len(a) == len(b) and (len(a) == 0 or (a[cols].astype(str).values == b[cols].astype(str).values).all())
            print(f"seed={seed} {name:16s} frac={frac} full={len(a)} part={len(b)} 一致={ok}")
