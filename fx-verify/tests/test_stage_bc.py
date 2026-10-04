"""段階B・C(stages/stage_bc.py)のテスト。

strategy.py(別担当)が無くても動くよう、ほとんどのテストは『偽の実行関数(runner)』を使う。
偽の実行関数は Params から取引数と平均Rを決める(表で与える)ので、台地・尖り・台地の中央選びの
ロジックを狙い通りに検証できる。ここで使う数値はロジック確認用のダミーで、成績ではない。
strategy.py があれば、実物を使った結合テストも走る(無ければ skip)。
"""
import importlib.util
import os
import sys
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)

from core import schema  # noqa: E402
from core.config import NotConfiguredError, default_config, synthetic_test_config  # noqa: E402
from core.data import build_dataset  # noqa: E402
from core.params import SENSITIVITY_REQUIRES, Params, base_params  # noqa: E402
from core.synthetic import generate_synthetic  # noqa: E402


def _load_stage_bc():
    """stages/stage_bc.py をファイルパスで読み込む(stages.py との名前衝突を避けるため)。"""
    path = os.path.join(ROOT, "stages", "stage_bc.py")
    spec = importlib.util.spec_from_file_location("stage_bc", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["stage_bc"] = mod
    spec.loader.exec_module(mod)
    return mod


sb = _load_stage_bc()
CFG = synthetic_test_config()  # 合成テスト用(テスト用・実値ではない)
HAS_STRATEGY = importlib.util.find_spec("strategy") is not None


# ======================================================================================
# 偽の実行関数
# ======================================================================================
def make_trades(n: int, avg_r: float, pair: str = "USDJPY") -> pd.DataFrame:
    """n 件(偶数)の取引。pnl_r = avg_r ± 1 を交互に並べる(平均が avg_r ちょうど)。"""
    assert n % 2 == 0
    cost = 0.05
    t0 = pd.Timestamp("2018-03-01")
    i = np.arange(n)
    pnl = avg_r + np.where(i % 2 == 0, 1.0, -1.0)
    sig = t0 + pd.to_timedelta(i * 60, unit="min")
    df = pd.DataFrame(
        {
            "trade_id": i,
            "pair": pair,
            "side": "long",
            "signal_time": sig,
            "entry_time": sig + pd.Timedelta(minutes=15),
            "exit_time": sig + pd.Timedelta(minutes=45),
            "entry": 100.0,
            "sl": 99.0,
            "tp1": 101.0,
            "risk": 1.0,
            "atr15": 0.5,
            "h0": 101.0,
            "pb_extreme": 99.1,
            "partial": False,
            "tp1_time": pd.NaT,
            "exit_price": 100.0,
            "exit_reason": "sl",
            "r_multiple": pnl + cost,
            "cost_r": cost,
            "pnl_r": pnl,
            "bars_held": 3,
        }
    )
    return df[schema.TRADE_COLUMNS]


def make_funnel(n_bars: int, n: int) -> dict:
    f = {k: 0 for k in schema.funnel_keys()}
    f["bars_total"] = n_bars
    for k in schema.FUNNEL_BAR_STEPS + schema.FUNNEL_SETUP_STEPS:
        f[f"long.{k}"] = n_bars if k in schema.FUNNEL_BAR_STEPS else n
    return f


class FakeRunner:
    """fn(params) -> (取引数, 平均R)。呼び出し履歴(渡されたデータの最終時刻・Params)を残す。"""

    def __init__(self, fn):
        self.fn = fn
        self.calls = []
        self.dfs = []

    def __call__(self, df15, params, cfg, df1m=None):
        self.calls.append(params)
        self.dfs.append(df15)
        n, avg = self.fn(params)
        return make_trades(n, avg), make_funnel(len(df15), n)

    @property
    def keys(self):
        return [p.key() for p in self.calls]


def surface_b(p: Params):
    """段階B用の応答曲面(基準案=平均R 0.10、100取引。項目ごとの足し算)。ロジック確認用のダミー。"""
    avg = 0.10
    avg += {20: -0.02, 40: 0.0, 80: 0.02}[p.hi_lookback]  # なだらか(台地)
    avg += {20: -0.30, 40: 0.0, 80: -0.30}[p.pb_touch_ema]  # 基準だけ突出(尖り)
    avg += {"A": 0.0, "B": 0.05, "C": -0.05, "D": 0.30}[p.d1_mode]  # D は比較用
    avg += {0.3: -0.01, 0.5: 0.0, 0.7: 0.01}[p.tp1_fraction]
    n = 10 if p.h1_cross_window == 12 else 100  # 12本の水準だけ取引数不足
    if p.h1_cross_window == 12:
        avg += 0.8  # 取引数不足の水準が派手でも選定に影響しないことの確認用
    return n, avg


TABLE_C = [  # 行: hi_lookback 20/40/80、列: tp1_fraction 0.3/0.5/0.7
    # 全体がなだらかな台地(平均R 0.29〜0.35)。最高点は角の (20, 0.3)=0.35。中央(40, 0.5)=0.30 は近傍8点とPF差が小さい。
    # (平均Rが 0.29〜0.35 のとき PF=(1+r)/(1-r) は 1.82〜2.08。make_trades の仕様)
    [0.35, 0.29, 0.30],
    [0.29, 0.30, 0.34],
    [0.30, 0.34, 0.33],
]


def surface_c(p: Params):
    i = {20: 0, 40: 1, 80: 2}[p.hi_lookback]
    j = {0.3: 0, 0.5: 1, 0.7: 2}[p.tp1_fraction]
    return 100, TABLE_C[i][j]


@pytest.fixture(scope="module")
def ds():
    sp = generate_synthetic("USDJPY", start="2018-01-01", years=0.6, seed=3)
    return build_dataset(sp.m15, CFG, "USDJPY")


@pytest.fixture(scope="module")
def split(ds):
    return SimpleNamespace(train_end=sb.month_start_split(ds, 0.6), note="テスト")


# ======================================================================================
# 時間分割・型安全
# ======================================================================================
def test_month_start_split(ds):
    end = sb.month_start_split(ds, 0.6)
    assert end.day == 1 and end.hour == 0 and end.minute == 0
    first, last = ds["close_time"].iloc[0], ds["close_time"].iloc[-1]
    assert first < end < last
    # 目標位置(60%)から1か月以内に収まる
    target = first + (last - first) * 0.6
    assert abs((target - end).days) <= 31
    with pytest.raises(ValueError):
        sb.month_start_split(ds, 1.0)
    with pytest.raises(ValueError):
        sb.month_start_split(ds.iloc[:50], 0.6)  # 期間が短すぎて月初に丸められない


def test_split_dataset_train_has_no_future_and_oos_is_sealed(ds):
    end = sb.month_start_split(ds, 0.6)
    sp = sb.split_dataset(ds, end)
    assert sp.train.df["close_time"].max() <= end
    assert len(sp.train.df) == int((ds["close_time"] <= end).sum())
    assert sp.oos.n_oos_bars == int((ds["close_time"] > end).sum()) > 0
    assert "close" not in repr(sp.oos) and sp.oos.access_log == []
    with pytest.raises(ValueError):
        sp.oos.open("")  # 理由なしでは開けない
    full = sp.oos.open("テスト: 全期間の長さ確認")
    assert len(full) == len(ds) and sp.oos.access_log == ["テスト: 全期間の長さ確認"]
    with pytest.raises(ValueError):
        sb.split_dataset(ds, ds["close_time"].max())  # 検証期間が空
    with pytest.raises(ValueError):
        sb.split_dataset(ds, ds["close_time"].min())  # 学習期間が空


def test_train_dataset_rejects_oos_rows(ds):
    end = sb.month_start_split(ds, 0.6)
    with pytest.raises(ValueError, match="より後の足"):
        sb.TrainDataset(ds, end)  # 全期間をそのまま入れると検証期間が混ざる


def test_core_functions_accept_only_train_dataset(ds):
    runner = FakeRunner(surface_b)
    with pytest.raises(TypeError):
        sb.sensitivity_analysis(ds, base_params(), CFG, runner=runner)  # 素の DataFrame は不可
    with pytest.raises(TypeError):
        sb.limited_grid(ds, base_params(), CFG, {"hi_lookback": [20, 40]}, runner=runner)
    oos = sb.split_dataset(ds, sb.month_start_split(ds, 0.6)).oos
    with pytest.raises(TypeError):
        sb._as_train({"USDJPY": oos}, None, "USDJPY")
    assert runner.calls == []  # 何も実行されていない


def test_truncate_1m():
    t = pd.date_range("2018-01-01", periods=10, freq="1min")
    m1 = pd.DataFrame({"time": t, "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0})
    out = sb.truncate_1m(m1, pd.Timestamp("2018-01-01 00:05"))
    assert out["time"].max() == pd.Timestamp("2018-01-01 00:04")  # 00:04開始の足は 00:05 に確定
    assert sb.truncate_1m(None, pd.Timestamp("2018-01-01")) is None


# ======================================================================================
# 段階B
# ======================================================================================
def test_stage_b_only_sees_train_period(ds, split):
    """実行関数に渡るデータは学習用期間だけ。検証期間の値を書き換えても渡るデータは同一。"""
    r1 = FakeRunner(surface_b)
    sb.stage_b({"USDJPY": ds}, CFG, split, runner=r1)
    assert r1.dfs and all(pd.Timestamp(d["close_time"].max()) <= split.train_end for d in r1.dfs)

    ds2 = ds.copy()
    future = ds2["close_time"] > split.train_end
    for c in ("open", "high", "low", "close"):
        ds2.loc[future, c] = ds2.loc[future, c] * 1.5 + 7.0
    r2 = FakeRunner(surface_b)
    sb.stage_b({"USDJPY": ds2}, CFG, split, runner=r2)
    pd.testing.assert_frame_equal(r1.dfs[0], r2.dfs[0])
    assert len(r1.dfs) == len(r2.dfs)


def test_stage_b_table_shape_and_trials(ds, split):
    r = FakeRunner(surface_b)
    df = sb.stage_b({"USDJPY": ds}, CFG, split, runner=r)
    need = ["param", "value", "is_base", "params_key", "n_trades", "win_rate", "pf", "avg_r", "total_r", "max_dd_r"]
    assert list(df.columns[: len(need)]) == need
    assert {"expectancy_r", "adj_pf_diff", "plateau_point"} <= set(df.columns)
    # 同じ設定は1回だけ回す = 実行回数は設定数(重複なし)に等しい。基準案も1回
    assert len(r.calls) == len(set(r.keys)) == df.attrs["n_trials"] == df.attrs["n_runs"]
    assert df.attrs["n_trials"] == df["params_key"].nunique()
    assert df.attrs["period"] == "train" and df.attrs["base_key"] == base_params().key()
    # 基準案の値を持つ行は is_base
    row = df[(df["param"] == "hi_lookback") & (df["value"] == 40)].iloc[0]
    assert row["is_base"] and row["params_key"] == base_params().key()
    # グリッドの全項目が表に出る
    from core.params import SENSITIVITY_GRID

    assert set(df["param"]) >= set(SENSITIVITY_GRID)
    # 平均R = 期待値R、勝率は 0.5(±1 交互のダミー)
    assert (df["avg_r"] == df["expectancy_r"]).all()
    assert np.allclose(df["win_rate"], 0.5)


def test_stage_b_requires_and_pairs(ds, split):
    r = FakeRunner(surface_b)
    df = sb.stage_b({"USDJPY": ds}, CFG, split, runner=r)
    for field, req in SENSITIVITY_REQUIRES.items():
        sub = df[df["param"] == field]
        assert len(sub) > 0 and all(k in " ".join(sub["requires"]) for k in req)
    swing_calls = [p for p in r.calls if p.hi_mode == "swing"]
    assert swing_calls  # hi_swing_fractal_n の行では hi_mode='swing' が同時に設定されている
    # 比率方式は組の項目。pb_mode='ratio' が同時に設定され、param は "a+b"
    pr = df[df["param"] == "pb_ratio_min+pb_ratio_max"]
    assert sorted(pr["value"].tolist()) == [(0.236, 0.618), (0.382, 0.786)]
    assert any(p.pb_mode == "ratio" and p.pb_ratio_min == 0.236 for p in r.calls)


def test_stage_b_other_params_stay_at_base(ds, split):
    """1項目ずつ: 各設定は基準案から高々(その項目+従属設定)しか違わない。"""
    r = FakeRunner(surface_b)
    sb.stage_b({"USDJPY": ds}, CFG, split, runner=r)
    base = base_params().to_dict()
    for p in r.calls:
        diff = {k for k, v in p.to_dict().items() if v != base[k]}
        assert len(diff) <= 3, diff  # 例: pb_ratio_min, pb_ratio_max, pb_mode


def test_stage_b_plateau_judgment(ds, split):
    df = sb.stage_b({"USDJPY": ds}, CFG, split, runner=FakeRunner(surface_b))
    summ = df.attrs["plateau_summary"].set_index("param")
    # hi_lookback: 0.08/0.10/0.12 → 隣とのPF差が小さく符号も同じ → 台地
    assert summ.loc["hi_lookback", "judgment"] == "台地"
    assert summ.loc["hi_lookback", "max_adj_pf_diff"] < 0.1
    # pb_touch_ema: 基準(40)だけ突出 → 尖り(特定の値だけで跳ねている)
    assert summ.loc["pb_touch_ema", "judgment"] == "尖り"
    assert summ.loc["pb_touch_ema", "max_adj_pf_diff"] > 0.5
    assert summ.loc["pb_touch_ema", "best_value"] == 40
    # d1_mode は順序なし。比較用の D は効きの計算から除外される
    assert summ.loc["d1_mode", "judgment"] == "順序なし(比較のみ)"
    assert summ.loc["d1_mode", "avg_r_range"] == pytest.approx(0.10)
    assert "比較用" in summ.loc["d1_mode", "note"]
    # 水準が2つだけ(tp1 は3水準だが h4_long_sma は2水準・同じ成績)→ 判定不能(有効水準2)
    assert summ.loc["h4_long_sma", "judgment"] == "判定不能(有効水準2)"
    # 取引数不足の水準は判定対象外。派手な平均R(0.9)でも効きの計算に入らない
    h1 = df[df["param"] == "h1_cross_window"].set_index("value")
    assert not h1.loc[12, "valid"] and h1.loc[12, "n_trades"] == 10
    assert summ.loc["h1_cross_window", "avg_r_range"] == pytest.approx(0.0)
    assert "取引数不足" in summ.loc["h1_cross_window", "note"]
    # 台地判定の目安は結果に記録される(ゲート基準ではないことも)
    assert df.attrs["criteria"]["min_trades_for_analysis"] == 30 and "ゲート基準ではない" in df.attrs["criteria"]["note"]


def test_pf_cv_and_diffs_values(ds, split):
    df = sb.stage_b({"USDJPY": ds}, CFG, split, runner=FakeRunner(surface_b))
    sub = df[df["param"] == "hi_lookback"].set_index("value").sort_index()
    # PF = (1+avg)/(1-avg)(±1交互のダミー)
    pf = lambda a: (1 + a) / (1 - a)  # noqa: E731
    assert sub.loc[40, "pf"] == pytest.approx(pf(0.10))
    assert sub.loc[40, "adj_pf_diff"] == pytest.approx(max(abs(pf(0.10) - pf(0.08)), abs(pf(0.10) - pf(0.12))))
    s = df.attrs["plateau_summary"].set_index("param").loc["hi_lookback"]
    v = np.array([pf(0.08), pf(0.10), pf(0.12)])
    assert s["pf_cv"] == pytest.approx(v.std() / v.mean())


def test_stage_b_validates_runner_output(ds, split):
    def bad_runner(df15, params, cfg, df1m=None):
        t = make_trades(10, 0.1)
        t["pnl_r"] = t["pnl_r"] + 1.0  # pnl_r = r_multiple - cost_r が崩れる
        return t, make_funnel(len(df15), 10)

    with pytest.raises(ValueError):
        sb.stage_b({"USDJPY": ds}, CFG, split, runner=bad_runner)


def test_cost_not_configured_propagates(ds, split):
    def runner(df15, params, cfg, df1m=None):
        cfg.costs.cost_price("USDJPY")  # 未設定なら NotConfiguredError(strategy と同じ挙動)
        return make_trades(10, 0.1), make_funnel(len(df15), 10)

    with pytest.raises(NotConfiguredError):
        sb.stage_b({"USDJPY": ds}, default_config(), split, runner=runner)


# ======================================================================================
# 軸の選定
# ======================================================================================
def test_select_axes(ds, split):
    df = sb.stage_b({"USDJPY": ds}, CFG, split, runner=FakeRunner(surface_b))
    sel = sb.select_axes(df, top_k=3)
    assert list(sel) == ["pb_touch_ema", "d1_mode", "hi_lookback"]  # avg_r の幅の大きい順(0.30, 0.10, 0.04)
    assert sel["d1_mode"] == ["A", "B", "C"]  # 比較用の D は水準に入れない
    assert sel["hi_lookback"] == [20, 40, 80]
    assert [r["rank"] for r in sel.reasons] == [1, 2, 3] and sel.reasons[0]["param"] == "pb_touch_ema"
    assert "従属設定" in " ".join(e["reason"] for e in sel.excluded if e["param"] == "tl_recent_m")
    assert any(e["param"] == "pb_ratio_min+pb_ratio_max" for e in sel.excluded)
    # 取引数不足の水準(h1_cross_window=12)は水準から外れ、そもそも効きがゼロなので選ばれない
    assert "h1_cross_window" not in sel
    assert len(sb.select_axes(df, top_k=4)) == 4
    with pytest.raises(ValueError):
        sb.select_axes(df, top_k=0)


# ======================================================================================
# 段階C
# ======================================================================================
AXES_C = {"hi_lookback": [20, 40, 80], "tp1_fraction": [0.3, 0.5, 0.7]}


def test_neighbors_geometry():
    nb = sb._neighbors((1, 1), (3, 3), (True, True), "box")
    assert len(nb) == 9
    assert len(sb._neighbors((0, 0), (3, 3), (True, True), "box")) == 4  # 角は4点
    assert sorted(sb._neighbors((1, 1), (3, 3), (True, True), "cross")) == [(0, 1), (1, 0), (1, 1), (1, 2), (2, 1)]
    # 順序のない軸(False)は自分自身のみ
    assert sorted(sb._neighbors((1, 1), (3, 3), (True, False), "box")) == [(0, 1), (1, 1), (2, 1)]
    with pytest.raises(ValueError):
        sb._neighbors((0,), (2,), (True,), "diamond")


def test_neighbors_can_exclude_self():
    assert (1, 1) not in sb._neighbors((1, 1), (3, 3), (True, True), "box", include_self=False)
    assert len(sb._neighbors((1, 1), (3, 3), (True, True), "box", include_self=False)) == 8
    assert sb._neighbors((2,), (5,), (True,), "box", include_self=False) == [(1,), (3,)]
    assert sorted(sb._neighbors((1, 1), (3, 3), (True, True), "cross", include_self=False)) == [(0, 1), (1, 0), (1, 2), (2, 1)]
    # 順序のない軸だけなら、近傍(自分以外)は空
    assert sb._neighbors((1,), (3,), (False,), "box", include_self=False) == []
    assert sb._neighbors((1,), (3,), (False,), "box") == [(1,)]  # 既定は従来どおり自分を含む


def test_stage_c_picks_plateau_center_not_best_point(ds, split):
    r = FakeRunner(surface_c)
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes=AXES_C, runner=r)
    df = res["results"]
    assert len(df) == 9 and len(r.calls) == 9
    # 最高成績の点は角の (hi=20, tp=0.3)=0.35。選ばれるのは近傍が揃った台地の中央(40, 0.5)
    best = df.loc[df["avg_r"].idxmax()]
    assert (best["hi_lookback"], best["tp1_fraction"]) == (20, 0.3)
    ch = res["chosen_params"]
    assert (ch["hi_lookback"], ch["tp1_fraction"]) == (40, 0.5)
    chosen_row = df[df["is_chosen"]].iloc[0]
    assert df["is_chosen"].sum() == 1
    # 近傍平均は『自分自身を除く』8点の平均(自分の 0.30 は入らない)
    others = [v for i, row in enumerate(TABLE_C) for j, v in enumerate(row) if (i, j) != (1, 1)]
    assert chosen_row["nbr_slots"] == 8 and chosen_row["nbr_valid"] == 8
    assert chosen_row["nbr_avg_r"] == pytest.approx(np.mean(others))
    assert chosen_row["nbr_avg_r"] != pytest.approx(np.mean(sum(TABLE_C, [])))  # 自分を含む平均ではない
    assert bool(chosen_row["plateau_point"]) is True
    info = res["selection_info"]
    assert info["chosen_is_own_best"] is False and info["chosen_own_rank"] == 5
    assert info["best_own_values"] == {"hi_lookback": 20, "tp1_fraction": 0.3}
    assert "台地の中央" in res["selection_rule"] and "最高成績の点ではなく" in res["selection_rule"]
    assert "自分自身を除く" in res["selection_rule"]
    # 端の点(2,2)は近傍平均が最大だが、近傍が揃っていないので選ばれない
    corner = df[(df["hi_lookback"] == 80) & (df["tp1_fraction"] == 0.7)].iloc[0]
    assert corner["nbr_avg_r"] > chosen_row["nbr_avg_r"] and not corner["is_chosen"]
    # 返す設定は Params に復元できる
    assert Params.from_dict(ch).hi_lookback == 40


def test_stage_c_does_not_choose_a_sharp_peak(ds, split):
    """平均Rが (低, 突出, 低) の尖った山: 中央が最高点でも、近傍とPF差が大きいので台地ではない → 選ばない。

    以前は『自分を含む近傍平均』で中央(山の頂)が選ばれていた(再現済みのレビュー指摘)。
    """
    tbl = {0.3: 0.05, 0.5: 0.60, 0.7: 0.05}
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes={"tp1_fraction": [0.3, 0.5, 0.7]},
                     runner=FakeRunner(lambda p: (100, tbl[p.tp1_fraction])))
    assert res["chosen_params"] is None
    assert not res["results"]["is_chosen"].any()
    info = res["selection_info"]
    assert info["no_plateau"] is True and info["no_plateau_reason"] == "no_plateau_point"
    assert "台地を作れず" in info["note"] and any("台地を作れない" in w for w in info["warnings"])
    # 近傍平均は自分自身を除く: 山の頂の近傍平均は両端の平均(0.05)であって、自分を含む 0.233 ではない
    top = res["results"].set_index("tp1_fraction").loc[0.5]
    assert top["nbr_avg_r"] == pytest.approx(0.05) and top["nbr_slots"] == 2
    assert bool(top["plateau_point"]) is False


def test_stage_c_does_not_choose_a_valley_between_good_neighbors(ds, split):
    """(良, 悪, 良): 谷の底は近傍平均が高いが、自分は近傍と違う → 台地ではない。端の点も隣と違うので選ばない。"""
    tbl = {0.3: 0.50, 0.5: 0.00, 0.7: 0.50}
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes={"tp1_fraction": [0.3, 0.5, 0.7]},
                     runner=FakeRunner(lambda p: (100, tbl[p.tp1_fraction])))
    assert res["chosen_params"] is None and res["selection_info"]["no_plateau"] is True


def test_stage_c_picks_center_of_gentle_one_axis_plateau(ds, split):
    tbl = {0.3: 0.30, 0.5: 0.33, 0.7: 0.31}
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes={"tp1_fraction": [0.3, 0.5, 0.7]},
                     runner=FakeRunner(lambda p: (100, tbl[p.tp1_fraction])))
    assert res["chosen_params"]["tp1_fraction"] == 0.5
    row = res["results"][res["results"]["is_chosen"]].iloc[0]
    assert row["nbr_avg_r"] == pytest.approx((0.30 + 0.31) / 2)  # 自分(0.33)を含まない


def test_stage_c_unordered_axes_only_cannot_form_a_plateau(ds, split):
    """順序のない軸(d1_mode)だけのグリッド。以前は最高点(B=0.9)がそのまま選ばれていた。今は『台地を作れない』。"""
    tbl = {"A": 0.10, "B": 0.90, "C": 0.20}
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes={"d1_mode": ["A", "B", "C"]},
                     runner=FakeRunner(lambda p: (100, tbl[p.d1_mode])))
    assert res["chosen_params"] is None
    info = res["selection_info"]
    assert info["no_plateau"] is True and info["no_plateau_reason"] == "no_ordered_axis"
    assert info["unordered_axes"] == ["d1_mode"] and info["ordered_axes"] == []
    assert any("台地を作れない" in w for w in info["warnings"])
    assert not res["results"]["is_chosen"].any()


def test_stage_c_unordered_level_is_judged_by_its_ordered_neighbors(ds, split):
    """順序のない軸(d1_mode)×順序のある軸(tp1_fraction)。B は一点だけ突出(0.9)。A は全体が台地。
    以前は B の突出点が選ばれ得た。今は B の突出点は台地でないので、台地の A の中央が選ばれる。"""
    def fn(p):
        if p.d1_mode == "B":
            return 100, {0.3: 0.05, 0.5: 0.90, 0.7: 0.05}[p.tp1_fraction]
        return 100, {0.3: 0.14, 0.5: 0.16, 0.7: 0.15}[p.tp1_fraction]

    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes={"d1_mode": ["A", "B"], "tp1_fraction": [0.3, 0.5, 0.7]},
                     runner=FakeRunner(fn))
    ch = res["chosen_params"]
    assert ch["d1_mode"] == "A" and ch["tp1_fraction"] == 0.5
    info = res["selection_info"]
    assert info["chosen_is_own_best"] is False and info["best_own_values"] == {"d1_mode": "B", "tp1_fraction": 0.5}
    assert info["unordered_axes"] == ["d1_mode"] and info["ordered_axes"] == ["tp1_fraction"]
    assert any("順序のない軸" in w for w in info["warnings"])


def test_stage_c_warns_when_chosen_is_also_own_best(ds, split):
    tbl = {0.3: 0.30, 0.5: 0.34, 0.7: 0.31}
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes={"tp1_fraction": [0.3, 0.5, 0.7]},
                     runner=FakeRunner(lambda p: (100, tbl[p.tp1_fraction])))
    info = res["selection_info"]
    assert info["chosen_is_own_best"] is True
    assert any("最高" in w for w in info["warnings"])


def test_stage_c_cross_neighborhood_option(ds, split):
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes=AXES_C, runner=FakeRunner(surface_c), neighborhood="cross")
    c = res["results"]
    mid = c[(c["hi_lookback"] == 40) & (c["tp1_fraction"] == 0.5)].iloc[0]
    assert mid["nbr_slots"] == 4  # 自分を除く(上下左右)
    assert mid["nbr_avg_r"] == pytest.approx(np.mean([0.29, 0.34, 0.29, 0.34]))


def test_stage_c_trial_count(ds, split):
    rb = FakeRunner(surface_b)
    bdf = sb.stage_b({"USDJPY": ds}, CFG, split, runner=rb)
    rc = FakeRunner(surface_c)
    res = sb.stage_c({"USDJPY": ds}, CFG, split, axes=AXES_C, runner=rc, stage_b_df=bdf)
    keys_b = set(bdf["params_key"])
    keys_c = set(rc.keys)
    keys_a = {base_params().key()}
    d = res["n_trials_detail"]
    assert res["n_trials"] == d["total_distinct"] == len(keys_a | keys_b | keys_c)
    assert d["A"] == 1 and d["B"] == len(keys_b) and d["C"] == 9
    # Cの9点のうち B と重なるのは (hi, 0.5) の3点と (40, 0.3)(40, 0.7) の計5点 → 新規は角の4点
    assert d["C_new_vs_AB"] == 4 and res["n_trials"] == len(keys_b) + 4
    assert d["stage_b_included"] and not d["is_lower_bound"]
    # 段階Bの表を渡さなければ下限値(A+C)として明示される
    res2 = sb.stage_c({"USDJPY": ds}, CFG, split, axes=AXES_C, runner=FakeRunner(surface_c))
    assert res2["n_trials_detail"]["is_lower_bound"] and res2["n_trials"] == len(keys_a | keys_c)


def test_stage_c_only_sees_train_period(ds, split):
    r = FakeRunner(surface_c)
    sb.stage_c({"USDJPY": ds}, CFG, split, axes=AXES_C, runner=r)
    assert all(pd.Timestamp(d["close_time"].max()) <= split.train_end for d in r.dfs)


def test_stage_c_deterministic(ds, split):
    a = sb.stage_c({"USDJPY": ds}, CFG, split, axes=AXES_C, runner=FakeRunner(surface_c))
    b = sb.stage_c({"USDJPY": ds}, CFG, split, axes=AXES_C, runner=FakeRunner(surface_c))
    assert a["chosen_params"] == b["chosen_params"]
    pd.testing.assert_frame_equal(a["results"], b["results"])


def test_stage_c_axes_validation_and_guards(ds, split):
    run = lambda **kw: sb.stage_c({"USDJPY": ds}, CFG, split, runner=FakeRunner(surface_c), **kw)  # noqa: E731
    with pytest.raises(ValueError, match="未知の軸"):
        run(axes={"no_such_param": [1, 2]})
    with pytest.raises(ValueError, match="軸が1つも無い"):
        run(axes={})
    with pytest.raises(ValueError, match="max_combos"):
        run(axes=AXES_C, max_combos=4)
    # 重複水準は除かれ、順序のある軸は昇順に整う
    res = run(axes={"hi_lookback": [80, 20, 40, 40], "tp1_fraction": [0.7, 0.5, 0.3]})
    assert res["axes"] == {"hi_lookback": [20, 40, 80], "tp1_fraction": [0.3, 0.5, 0.7]}


def test_stage_c_skips_invalid_points(ds, split):
    """sl_mode='fixed_pips' は sl_fixed_pips が無いと無効 → 飛ばして記録。"""
    r = FakeRunner(lambda p: (100, 0.1))
    res = sb.stage_c(
        {"USDJPY": ds}, CFG, split, runner=r, axes={"sl_mode": ["atr", "fixed_pips"], "hi_lookback": [20, 40]}
    )
    assert len(res["results"]) == 2 and len(res["skipped"]) == 2
    assert all("sl_fixed_pips" in s["reason"] for s in res["skipped"])


def test_stage_c_fixed_overrides_for_dependent_axis(ds, split):
    r = FakeRunner(lambda p: (100, 0.1))
    res = sb.stage_c({"USDJPY": ds}, CFG, split, runner=r, axes={"tl_recent_m": [3, 5, 8]})
    assert res["fixed_overrides"] == {"tl_mode": "recent_high"}
    assert all(p.tl_mode == "recent_high" for p in r.calls)
    assert res["chosen_params"]["tl_mode"] == "recent_high"


def test_stage_c_no_valid_points_returns_none(ds, split):
    r = FakeRunner(lambda p: (10, 0.5))  # 全点が取引数不足
    res = sb.stage_c({"USDJPY": ds}, CFG, split, runner=r, axes=AXES_C)
    assert res["chosen_params"] is None and "選べなかった" in res["selection_info"]["note"]
    assert res["n_trials"] == 9


def test_stage_c_relaxes_when_no_central_candidate(ds, split):
    """中央の点が取引数不足でも、端の点から選ぶ(緩和したことを記録する)。"""
    def fn(p):
        n = 10 if (p.hi_lookback == 40 and p.tp1_fraction == 0.5) else 100
        return n, 0.2

    res = sb.stage_c({"USDJPY": ds}, CFG, split, runner=FakeRunner(fn), axes=AXES_C)
    assert res["chosen_params"] is not None
    assert any("端の点" in s for s in res["selection_info"]["relaxed"])


def test_stage_b_then_select_then_stage_c_chain(ds, split):
    """段階B → 軸の選定 → 段階C がつながる(偽の実行関数)。"""
    def smooth_b(p):  # surface_b から pb_touch_ema の尖り(基準だけ突出)を取り除いたもの(なだらかな台地がある場合の配線確認)
        n, avg = surface_b(p)
        return n, avg + {20: 0.30, 40: 0.0, 80: 0.30}[p.pb_touch_ema] + {20: -0.01, 40: 0.0, 80: -0.01}[p.pb_touch_ema]

    bdf = sb.stage_b({"USDJPY": ds}, CFG, split, runner=FakeRunner(smooth_b))
    axes = sb.select_axes(bdf, top_k=3)
    res = sb.stage_c({"USDJPY": ds}, CFG, split, runner=FakeRunner(smooth_b), axes=axes, stage_b_df=bdf)
    assert set(res["axes"]) == set(axes)
    assert res["n_trials"] >= bdf.attrs["n_trials"]
    assert res["chosen_params"] is not None


def test_stage_b_then_select_then_stage_c_with_spiky_axis_does_not_pick_the_peak(ds, split):
    """surface_b は pb_touch_ema が『基準(40)だけ突出』の尖り。尖った軸を含むと台地が作れず、山の頂は選ばれない。"""
    bdf = sb.stage_b({"USDJPY": ds}, CFG, split, runner=FakeRunner(surface_b))
    axes = sb.select_axes(bdf, top_k=3)
    assert "pb_touch_ema" in axes
    res = sb.stage_c({"USDJPY": ds}, CFG, split, runner=FakeRunner(surface_b), axes=axes, stage_b_df=bdf)
    assert res["chosen_params"] is None and res["selection_info"]["no_plateau"] is True


# ======================================================================================
# strategy.py(別担当)が出来ていれば、実物での結合テスト
# ======================================================================================
@pytest.mark.skipif(not HAS_STRATEGY, reason="strategy.py が未作成")
def test_integration_with_real_strategy_and_future_invariance(ds, split):
    small_grid = {"hi_lookback": [20, 40], "tp1_fraction": [0.3, 0.5]}
    a = sb.stage_b({"USDJPY": ds}, CFG, split, grid=small_grid, pairs_grid={})
    assert a.attrs["n_trials"] == 3  # base(hi40,tp0.5) + hi20 + tp0.3
    assert (a["n_trades"] >= 0).all()
    ds2 = ds.copy()
    fut = ds2["close_time"] > split.train_end
    for c in ("open", "high", "low", "close"):
        ds2.loc[fut, c] = ds2.loc[fut, c] * 1.3 + 5.0
    b = sb.stage_b({"USDJPY": ds2}, CFG, split, grid=small_grid, pairs_grid={})
    cols = ["param", "value", "params_key", "n_trades", "win_rate", "avg_r", "total_r", "max_dd_r"]
    pd.testing.assert_frame_equal(a[cols], b[cols])  # 検証期間を書き換えても学習用の結果は不変


@pytest.mark.skipif(not HAS_STRATEGY, reason="strategy.py が未作成")
def test_integration_cost_unset_raises(ds, split):
    with pytest.raises(NotConfiguredError):
        sb.stage_b({"USDJPY": ds}, default_config(), split, grid={"hi_lookback": [20, 40]}, pairs_grid={})


@pytest.mark.skipif(HAS_STRATEGY, reason="strategy.py がある場合は別テストで確認")
def test_default_runner_gives_clear_error_without_strategy(ds, split):
    with pytest.raises(ImportError, match="strategy"):
        sb.stage_b({"USDJPY": ds}, CFG, split, grid={"hi_lookback": [20]}, pairs_grid={})
