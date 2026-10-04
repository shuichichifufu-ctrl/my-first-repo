"""サーバー日の最終足(close_time==day_end)が欠けると、EOD全決済が働かず翌日以降に持ち越すか(shift=0 でも)を確認する(レビュー用)。"""
import os
import sys
import warnings

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
warnings.filterwarnings("ignore")
from core.config import synthetic_test_config  # noqa: E402
from core.data import build_dataset  # noqa: E402
from core.params import Params  # noqa: E402
from core.synthetic import generate_synthetic  # noqa: E402
import strategy  # noqa: E402

LOOSE = Params(eod_close=True, d1_mode="D", h4_require_swing=False, h1_cross_window=None, hi_lookback=20)
cfg = synthetic_test_config()
raw = generate_synthetic("USDJPY", start="2018-01-01", years=1.5, seed=3).m15
ds = build_dataset(raw, cfg, "USDJPY")
de = ds["day_end"].to_numpy().astype("int64")
last_idx = pd.Series(np.arange(len(ds))).groupby(de).max().to_numpy()
rng = np.random.default_rng(0)
drop = set(rng.choice(last_idx, size=int(len(last_idx) * 0.15), replace=False).tolist())
raw2 = raw.drop(index=[i for i in drop if i < len(raw)]).reset_index(drop=True)
for name, r in (("欠損なし", raw), ("日の最終足を15%欠損", raw2)):
    d = build_dataset(r, cfg, "USDJPY")
    tr, F = strategy.run_backtest(d, LOOSE, cfg)
    hrs = (tr["exit_time"] - tr["entry_time"]).dt.total_seconds() / 3600
    print(f"{name}: 取引{len(tr)}件 / 26時間超保有 {int((hrs > 26).sum())}件 / 最大保有 {hrs.max():.1f}時間 / "
          f"exit_reason={tr['exit_reason'].value_counts().to_dict()}")
