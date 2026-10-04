"""検証スクリプト自体の検出力の確認(ミューテーション)。わざと先読みを入れた版で、不変性テストが失敗することを確かめる。"""
import os, sys, warnings
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
warnings.filterwarnings("ignore")
import core.data as data, core.indicators as ind
from core.config import default_config, synthetic_test_config
from core.synthetic import generate_synthetic
import verify_lookahead as V
import strategy

raw = generate_synthetic("USDJPY", start="2018-01-01", years=0.6, seed=3).m15
cfg = default_config()
k = V.pick_cuts(raw, (0.45,))[0]
cut = pd.Timestamp(raw.loc[k, "time"])

def dataset_invariant():
    a = data.build_dataset(raw, cfg, "USDJPY"); b = data.build_dataset(V.perturb(raw, k, "randwalk", 1), cfg, "USDJPY")
    a = a[a["close_time"] <= cut].reset_index(drop=True); b = b[b["close_time"] <= cut].reset_index(drop=True)
    return V.frames_equal(a, b)[0]

print("原本: 不変 =", dataset_invariant())

# ミュータント1: 上位足を1時間早く見せる(未確定足が見える)
orig_attach = data.attach_htf
def leaky_attach(df15, htf, *, prefix, lag="confirmed", columns=None, base_minutes=15):
    htf2 = htf.copy(); htf2["confirm_time"] = htf2["confirm_time"] - pd.Timedelta(hours=1 if prefix != "d1_" else 6)
    return orig_attach(df15, htf2, prefix=prefix, lag=lag, columns=columns, base_minutes=base_minutes)
data.attach_htf = leaky_attach
print("ミュータント1(上位足を早く可視化): 不変 =", dataset_invariant(), "(Falseなら検出できている)")
data.attach_htf = orig_attach

# ミュータント2: フラクタルの確定遅延を無くす(ピボット足の行に載せる)
orig_cols = ind._swing_columns
def nodelay(price, mask, n):
    return orig_cols(price, mask, 0)
ind._swing_columns = nodelay
data.fractal_swings = ind.fractal_swings
print("ミュータント2(フラクタル確定遅延0): 不変 =", dataset_invariant(), "(Falseなら検出できている)")
ind._swing_columns = orig_cols

# ミュータント3: 約定を判定足の終値(=同じ足)にする
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "strategy.py"), encoding="utf-8").read()
print("原本の約定行:", [l.strip() for l in src.splitlines() if "entry = sd.O[i + 1]" in l])
