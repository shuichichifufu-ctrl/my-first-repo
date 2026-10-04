"""GMTずらし時の『日の終わり(day_end)』『EOD全決済』『週末持ち越し』の検証(レビュー用)。

仕様: 引継書 D9「ニューヨーク時間の終わり(サーバー時間で日足確定前)に全決済する」。
疑い: EOD 決済は `close_time == day_end` の足でだけ起きる。GMTを±1ずらすと、週末前の最後の足の close_time が
      day_end と一致せず、EOD全決済が起きないまま週末を持ち越す取引が出るのではないか。
"""
from __future__ import annotations

import os
import sys
import warnings

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
warnings.filterwarnings("ignore")

from core.config import synthetic_test_config  # noqa: E402
from core.data import build_dataset  # noqa: E402
from core.params import Params  # noqa: E402
from core.synthetic import generate_synthetic  # noqa: E402
import strategy  # noqa: E402

LOOSE = Params(eod_close=True, d1_mode="D", h4_require_swing=False, h1_cross_window=None, hi_lookback=20)


def main():
    cfg0 = synthetic_test_config()
    for seed in (3, 11):
        raw = generate_synthetic("USDJPY", start="2018-01-01", years=1.5, seed=seed).m15
        print(f"\n=== seed={seed} {len(raw)}本 ===")
        for shift in (-1, 0, 1):
            cfg = cfg0.with_gmt_shift(shift)
            ds = build_dataset(raw, cfg, "USDJPY")
            ct = ds["close_time"].to_numpy().astype("int64")
            de = ds["day_end"].to_numpy().astype("int64")
            # 各サーバー日の『最後の足』の close_time が day_end と一致するか
            last_of_day = pd.Series(np.arange(len(ds))).groupby(de).max().to_numpy()
            match = ct[last_of_day] == pd.Series(de).groupby(de).first().index.to_numpy()
            n_days = len(last_of_day)
            n_mis = int((~match).sum())
            # 週末前(次の足まで 24h 超空く)の最後の足
            gap_after = np.r_[(ds["time"].to_numpy()[1:] - ds["close_time"].to_numpy()[:-1]) > np.timedelta64(6, "h"), True]
            wk_idx = np.flatnonzero(gap_after[:-1])
            wk_match = ct[wk_idx] == de[wk_idx]
            tr, F = strategy.run_backtest(ds, LOOSE, cfg)
            held = tr[(tr["exit_time"] - tr["entry_time"]) > pd.Timedelta(hours=26)]
            cross_weekend = 0
            times = ds["time"].to_numpy()
            pos = {t: n for n, t in enumerate(ds["time"])}
            for _, t in tr.iterrows():
                a, b = pos[t["entry_time"]], pos[t["exit_time"]]
                if b > a and (times[a + 1 : b + 1] - ds["close_time"].to_numpy()[a:b] > np.timedelta64(6, "h")).any():
                    cross_weekend += 1
            print(
                f"shift={shift:+d}: サーバー日 {n_days} 日のうち、最終足の close_time != day_end の日 = {n_mis} / "
                f"週末前の最終足(n={len(wk_idx)})で close_time==day_end になる割合 = {wk_match.mean():.2f} / "
                f"取引 {len(tr)} 件、26時間超の保有 = {len(held)} 件、週末またぎ = {cross_weekend} 件 "
                f"/ exit_reason={tr['exit_reason'].value_counts().to_dict()}"
            )
            if len(held):
                print(held[["side", "entry_time", "exit_time", "exit_reason", "r_multiple"]].head(4).to_string())


if __name__ == "__main__":
    main()
