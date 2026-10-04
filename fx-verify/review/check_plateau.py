"""独立レビュー用: 段階Cの『台地の中央』選択が最高点を選んでしまう場合があるかを、偽の実行関数で確認する。(コードは修正しない)"""
import importlib.util, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np, pandas as pd
import stages as S
from core.config import synthetic_test_config
from core.params import base_params
sb = S.stage_bc

print("neighbors(順序あり1軸, box) idx=2:", sb._neighbors((2,), [5], [True], "box"))
print("neighbors(順序なし, box) idx=1:", sb._neighbors((1,), [3], [False], "box"))

def make_runner(table, axis):
    def runner(df, params, cfg, df1m=None):
        v = getattr(params, axis)
        r = table[v]
        n = 40
        t = pd.DataFrame({"pnl_r": np.full(n, r), "r_multiple": np.full(n, r), "cost_r": np.zeros(n),
                          "exit_time": pd.date_range("2020-01-01", periods=n, freq="h"),
                          "entry_time": pd.date_range("2020-01-01", periods=n, freq="h"),
                          "side": ["long"]*n, "partial": [False]*n})
        return t, {"long.setup_po": n, "short.setup_po": 0}
    return runner

ds = pd.DataFrame({"close_time": pd.date_range("2020-01-01", periods=10, freq="15min"), "pair": "USDJPY"})
train = sb.TrainDataset(ds, ds["close_time"].max())
cfg = synthetic_test_config()
# 1) 順序あり1軸: 尖った山 (水準 24,36,48,60,72 は tl_expire_bars を流用して擬似的に使う)
tbl = {16: 0.0, 32: 0.1, 64: 1.0}
res = sb.limited_grid(train, base_params(), cfg, {"tl_expire_bars": [16, 32, 64]}, runner=make_runner(tbl, "tl_expire_bars"), validate=False)
print("順序あり3水準 選択:", res["selection_info"].get("chosen_values"), "own_best:", res["selection_info"].get("chosen_is_own_best"))
# 5水準の疑似: sl_margin_atr は3水準なので、hi_lookback で 20,40,80 のみ。tp1_fraction 0.3,0.5,0.7 を使う
tbl2 = {0.3: 0.0, 0.5: 1.0, 0.7: 0.0}
res = sb.limited_grid(train, base_params(), cfg, {"tp1_fraction": [0.3, 0.5, 0.7]}, runner=make_runner(tbl2, "tp1_fraction"), validate=False)
print("山(0,1.0,0) 選択:", res["selection_info"].get("chosen_values"), "own_best:", res["selection_info"].get("chosen_is_own_best"))
print(res["results"][["tp1_fraction","avg_r","nbr_slots","nbr_valid","nbr_avg_r","is_chosen"]])
# 2) 順序なし軸のみ
tbl3 = {"A": 0.1, "C": 0.2, "B": 0.9}
res = sb.limited_grid(train, base_params(), cfg, {"d1_mode": ["A", "B", "C"]}, runner=make_runner(tbl3, "d1_mode"), validate=False)
print("順序なし軸 選択:", res["selection_info"].get("chosen_values"), "own_best:", res["selection_info"].get("chosen_is_own_best"))
print("rule:", res["selection_rule"][-60:])
