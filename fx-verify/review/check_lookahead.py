"""独立レビュー用: 先読みが無いかの打ち切り不変性テスト。
生データを途中で切って build_dataset した結果が、全データで作った結果の同じ行と一致するか(一致しなければ未来を見ている)。(コードは修正しない)"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np, pandas as pd
from core.config import synthetic_test_config
from core.data import build_dataset
from core.synthetic import generate_universe

for shift in (0.0, 1.0, -1.0):
    cfg = synthetic_test_config().with_gmt_shift(shift)
    uni = generate_universe(("USDJPY",), start="2018-01-01", years=2, seed=3)
    raw = uni["USDJPY"].m15
    full = build_dataset(raw, cfg, "USDJPY")
    bad_total = 0
    for frac in (0.4, 0.55, 0.8):
        cut = raw["time"].iloc[int(len(raw) * frac)]
        part = build_dataset(raw[raw["time"] < cut], cfg, "USDJPY")
        f = full.iloc[: len(part)].reset_index(drop=True)
        assert (f["time"].values == part["time"].values).all()
        diffs = {}
        for c in part.columns:
            a, b = f[c].to_numpy(), part[c].to_numpy()
            if a.dtype.kind in "fc":
                same = (np.isnan(a) & np.isnan(b)) | np.isclose(a, b, rtol=1e-9, atol=1e-12, equal_nan=False)
            else:
                same = (a == b) | (pd.isna(a) & pd.isna(b))
            n = int((~same).sum())
            if n:
                diffs[c] = n
        bad_total += len(diffs)
        print(f"shift={shift} cut_frac={frac} rows={len(part)} 不一致の列={diffs}")
    print("shift", shift, "不一致列合計", bad_total)
