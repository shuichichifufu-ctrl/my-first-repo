"""独立レビュー用: 段階Cに取引0件の点が1つあると『全設定が学習用ゲート不通過 → 勝てない』にならず保留になるかを確認。(コードは修正しない)"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np, pandas as pd
from core.gates import GateSet, GateRule
from report import evaluate_stage_c_train_gate
# 注意: 閾値は『テスト用ダミー』。ea-lab の値ではない。
g = GateSet("dummy", rules=(GateRule("テスト用ダミー", "pf", ">=", 1.0, "train"),))
res = pd.DataFrame({"n_trades": [50, 40, 0], "pf": [0.8, 0.9, np.nan], "avg_r": [-0.1, -0.05, np.nan],
                    "win_rate": [.4, .45, np.nan], "total_r": [-5, -2, 0.0], "max_dd_r": [8, 6, 0.0], "expectancy_r": [-0.1, -0.05, np.nan]})
print(evaluate_stage_c_train_gate({"results": res}, {"dummy": g}))
