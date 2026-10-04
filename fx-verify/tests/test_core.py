"""基盤(core)のテスト。最重要: 上位足の先読みが無いこと(未確定の足が15分足から見えない)。

注意: gates のテストで使う閾値は『評価ロジックの動作確認用のダミー値』であり、ea-lab のゲート基準ではない。
"""
import math
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core import gates, indicators as ind, schema  # noqa: E402
from core.config import (  # noqa: E402
    CostConfig, DayBoundaryConfig, NotConfiguredError, SYNTHETIC_NOTICE,
    default_config, pip_size, synthetic_test_config,
)
from core.data import (  # noqa: E402
    attach_htf, build_dataset, load_ohlc_csv, resample_htf, resample_to_base,
    server_to_utc, truncate_dataset, us_dst_active, validate_ohlc,
)
from core.metrics import compute_metrics, max_drawdown, profit_factor  # noqa: E402
from core.params import SENSITIVITY_GRID, SENSITIVITY_PAIRS, SENSITIVITY_REQUIRES, Params  # noqa: E402
from core.synthetic import generate_synthetic, generate_universe, write_synthetic_csv  # noqa: E402

CFG = default_config()


def make_flat(start: str, periods: int, freq: str = "15min") -> pd.DataFrame:
    """連番の終値を持つ決定的な15分足(連続・週末なし)。close = 行番号。"""
    t = pd.date_range(start, periods=periods, freq=freq)
    c = np.arange(periods, dtype=float) + 100.0
    df = pd.DataFrame({"time": t, "open": c, "high": c + 0.5, "low": c - 0.5, "close": c, "volume": 1.0})
    df["close_time"] = df["time"] + pd.Timedelta(minutes=15)
    return df


@pytest.fixture(scope="module")
def synth():
    return generate_synthetic("USDJPY", start="2018-01-01", years=0.6, seed=7, with_m1=True)


@pytest.fixture(scope="module")
def ds(synth):
    return build_dataset(synth.m15, CFG, "USDJPY")


# ======================================================================================
# 先読み防止(最重要)
# ======================================================================================
def test_unconfirmed_h1_is_invisible_to_m15():
    """未確定の1時間足が15分足から見えない(10:00開始の1時間足は11:00に確定)。"""
    df = make_flat("2024-01-09 00:00", 4 * 24 * 3)  # 冬・連続3日
    h1 = resample_htf(df, "h1", CFG)
    out = attach_htf(df, h1, prefix="h1_", lag="confirmed")
    row = lambda hhmm: out[out["time"] == pd.Timestamp(f"2024-01-10 {hhmm}")].iloc[0]  # noqa: E731

    # 10:30開始の15分足(close 10:45): 10:00-11:00 の1時間足は未確定 → 見えるのは 09:00 開始の足
    r = row("10:30")
    assert r["h1_time"] == pd.Timestamp("2024-01-10 09:00")
    assert r["h1_confirm"] == pd.Timestamp("2024-01-10 10:00")
    # 09:00 の1時間足の終値 = 09:45 開始の15分足の終値
    assert r["h1_close"] == df.loc[df["time"] == pd.Timestamp("2024-01-10 09:45"), "close"].iloc[0]
    # 進行中の1時間足の高値(10:30足の高値以上)が漏れていない
    assert r["h1_high"] < r["high"] and r["h1_close"] < r["close"]

    # 10:45開始の15分足(close 11:00): ちょうど確定した 10:00 の1時間足が見える
    r = row("10:45")
    assert r["h1_time"] == pd.Timestamp("2024-01-10 10:00")
    assert r["h1_close"] == r["close"]


def test_all_rows_only_see_confirmed_htf():
    """全行で confirm <= close_time、かつ『確定済みの中で最新』の上位足が見えていること。"""
    df = make_flat("2024-01-09 00:00", 4 * 24 * 6)
    for tf in ("h1", "h4", "d1"):
        htf = resample_htf(df, tf, CFG)
        out = attach_htf(df, htf, prefix=f"{tf}_")
        seen = out.dropna(subset=[f"{tf}_confirm"])
        assert len(seen) > 0
        assert (seen[f"{tf}_confirm"] <= seen["close_time"]).all(), tf
        conf = htf["confirm_time"].to_numpy()
        idx = np.searchsorted(conf, seen["close_time"].to_numpy(), side="right")
        assert (seen[f"{tf}_confirm"].to_numpy() == conf[idx - 1]).all(), tf


def test_strict_lag_delays_one_more_bar():
    df = make_flat("2024-01-09 00:00", 4 * 24 * 3)
    h1 = resample_htf(df, "h1", CFG)
    out = attach_htf(df, h1, prefix="h1_", lag="strict")
    r = out[out["time"] == pd.Timestamp("2024-01-10 10:45")].iloc[0]
    assert r["h1_time"] == pd.Timestamp("2024-01-10 09:00")  # 11:00確定の足は close_time==11:00 では見えない


def test_attach_rejects_unconfirmed_lag_option():
    df = make_flat("2024-01-09 00:00", 400)
    h1 = resample_htf(df, "h1", CFG)
    with pytest.raises(ValueError):
        attach_htf(df, h1, prefix="h1_", lag="none")


def test_dataset_unchanged_by_future_perturbation(synth):
    """未来の価格を書き換えても、それより前の行の全列(上位足指標含む)は一切変わらない。"""
    base = synth.m15
    K = len(base) * 2 // 3
    perturbed = base.copy()
    for c in ("open", "high", "low", "close"):
        perturbed.loc[perturbed.index >= K, c] = perturbed.loc[perturbed.index >= K, c] * 1.13
    a = build_dataset(base, CFG, "USDJPY").iloc[:K]
    b = build_dataset(perturbed, CFG, "USDJPY").iloc[:K]
    pd.testing.assert_frame_equal(a, b, check_exact=False, rtol=1e-12, atol=0)


def test_dataset_prefix_invariance(synth, ds):
    """データを途中で切って作り直しても、共通部分の値は完全に一致する(未来を使っていない)。"""
    for frac in (0.3, 0.55, 0.8):
        K = int(len(synth.m15) * frac)
        part = build_dataset(synth.m15.iloc[:K], CFG, "USDJPY")
        pd.testing.assert_frame_equal(
            part.iloc[:K].reset_index(drop=True), ds.iloc[:K].reset_index(drop=True),
            check_exact=False, rtol=1e-12, atol=0,
        )


def test_truncate_dataset_is_prefix_of_full(ds):
    end = ds["close_time"].iloc[len(ds) // 2]
    cut = truncate_dataset(ds, end)
    assert cut["close_time"].max() <= end
    pd.testing.assert_frame_equal(cut, ds.iloc[: len(cut)])


# ======================================================================================
# フラクタル(確定遅延)
# ======================================================================================
def test_fractal_confirm_delay():
    high = pd.Series([1, 2, 3, 10, 4, 3, 2, 1, 2, 3, 2, 1.0])
    low = high - 0.5
    sw = ind.fractal_swings(high, low, 2)
    # ピボット高値は i=3(値10)。左右2本見るので確定は i+2=5 行目
    assert sw["sh_last"].iloc[:5].isna().all()
    assert sw["sh_last"].iloc[5] == 10 and sw["sh_last_pos"].iloc[5] == 3
    assert sw["sh_new"].iloc[5] == 10 and sw["sh_new"].drop(index=5).isna().sum() >= 10
    # 2つ目のピボット高値 i=9(値3) は 11 行目で確定、prev が 10
    assert sw["sh_last"].iloc[11] == 3 and sw["sh_prev"].iloc[11] == 10
    assert sw["sh_last"].iloc[10] == 10


def test_fractal_prefix_invariance():
    rng = np.random.default_rng(0)
    c = 100 + np.cumsum(rng.normal(0, 1, 500))
    high = pd.Series(c + rng.random(500))
    low = pd.Series(c - rng.random(500))
    for n in (2, 3, 5):
        full = ind.fractal_swings(high, low, n)
        for K in (60, 200, 333):
            part = ind.fractal_swings(high.iloc[:K], low.iloc[:K], n)
            pd.testing.assert_frame_equal(part, full.iloc[:K])


def test_fractal_plateau_gives_single_pivot():
    high = pd.Series([1, 2, 5, 5, 2, 1, 0.5, 0.4, 0.3])
    sw = ind.fractal_swings(high, high - 1, 2)
    assert sw["sh_new"].notna().sum() == 1


# ======================================================================================
# 指標
# ======================================================================================
def test_sma_ema_atr_values():
    rng = np.random.default_rng(1)
    close = pd.Series(100 + np.cumsum(rng.normal(0, 1, 100)))
    high, low = close + 0.7, close - 0.4
    s = ind.sma(close, 5)
    assert s.iloc[:4].isna().all() and abs(s.iloc[10] - close.iloc[6:11].mean()) < 1e-12
    e = ind.ema(close, 10)
    a = 2 / 11
    manual = close.iloc[0]
    for v in close.iloc[1:]:
        manual = manual * (1 - a) + v * a
    assert e.iloc[:9].isna().all() and abs(e.iloc[-1] - manual) < 1e-9
    tr = ind.true_range(high, low, close)
    assert abs(tr.iloc[0] - 1.1) < 1e-12
    at = ind.atr(high, low, close, 14)
    m = tr.iloc[0]
    for v in tr.iloc[1:]:
        m = m * (1 - 1 / 14) + v / 14
    assert at.iloc[:13].isna().all() and abs(at.iloc[-1] - m) < 1e-9


def test_slope_and_rising():
    s = pd.Series([1, 2, 3, 2, 2.0, np.nan, 4])
    assert ind.is_rising(s, 1).tolist() == [False, True, True, False, False, False, False]
    assert ind.slope(s, 2).iloc[2] == 2


def test_cross_ages():
    fast = pd.Series([1, 1, 3, 3, 3, 1, 1, 3.0])
    slow = pd.Series([2, 2, 2, 2, 2, 2, 2, 2.0])
    gc, dc = ind.cross_ages(fast, slow)
    assert gc.isna().iloc[:2].all()
    assert gc.iloc[2] == 0 and gc.iloc[4] == 2 and gc.iloc[7] == 0
    assert dc.iloc[5] == 0 and dc.iloc[6] == 1 and dc.isna().iloc[:5].all()


# ======================================================================================
# サーバー時間・リサンプル
# ======================================================================================
def test_us_dst_boundaries():
    t = pd.DatetimeIndex(["2024-03-10 06:59", "2024-03-10 07:00", "2024-11-03 05:59", "2024-11-03 06:00",
                          "2006-03-20", "2006-04-03", "2006-10-29 05:59", "2006-10-29 06:00"])
    got = us_dst_active(t).tolist()
    assert got == [False, True, True, False, False, True, True, False]


def test_daily_boundary_ny_close_winter_summer_and_gmt_shift():
    def conf_hours(start, shift):
        cfg = CFG.with_gmt_shift(shift)
        df = make_flat(start, 4 * 24 * 10)
        d1 = resample_htf(df, "d1", cfg)
        return set(d1["confirm_time"].dt.hour)

    assert conf_hours("2024-01-08", 0) == {22}   # 冬 GMT+2 → UTC 22:00
    assert conf_hours("2024-07-08", 0) == {21}   # 夏 GMT+3 → UTC 21:00
    assert conf_hours("2024-01-08", +1) == {21}  # GMTずらし +1h
    assert conf_hours("2024-01-08", -1) == {23}  # GMTずらし -1h


def test_daily_resample_values_and_h4_alignment():
    df = make_flat("2024-01-08 00:00", 4 * 24 * 5)
    d1 = resample_htf(df, "d1", CFG)
    mid = d1.iloc[1]  # 先頭の欠けた足は捨てられている
    day = df[(df["time"] >= mid["time"]) & (df["time"] < mid["confirm_time"])]
    assert mid["n_base"] == 96 == len(day)
    assert mid["open"] == day["open"].iloc[0] and mid["close"] == day["close"].iloc[-1]
    assert mid["high"] == day["high"].max() and mid["low"] == day["low"].min()
    assert (d1["confirm_time"] - d1["time"] == pd.Timedelta(days=1)).all()
    h4 = resample_htf(df, "h4", CFG)  # サーバー時間 0,4,8.. → 冬は UTC 22,2,6,...
    assert set(h4["time"].dt.hour) == {22, 2, 6, 10, 14, 18}
    assert (h4["confirm_time"] - h4["time"] == pd.Timedelta(hours=4)).all()


def test_edge_partial_bins_dropped():
    df = make_flat("2024-01-08 05:15", 4 * 30)  # 先頭が1時間足の区切りの途中から
    h1 = resample_htf(df, "h1", CFG)
    assert h1["time"].iloc[0] == pd.Timestamp("2024-01-08 06:00")  # 05:00台の欠けた足は無い
    assert (h1["n_base"] == 4).all()


def test_server_to_utc_roundtrip():
    day = DayBoundaryConfig()
    st = pd.DatetimeIndex(["2024-01-10 02:00", "2024-07-10 03:00"])
    assert server_to_utc(st, day).tolist() == [pd.Timestamp("2024-01-10 00:00"), pd.Timestamp("2024-07-10 00:00")]


def test_resample_to_base_from_m1(synth):
    m15 = resample_to_base(synth.m1, 15)
    pd.testing.assert_frame_equal(m15, synth.m15, check_exact=False, rtol=1e-12)


# ======================================================================================
# CSV
# ======================================================================================
def test_csv_roundtrip_with_comment(tmp_path, synth):
    p = tmp_path / "SYNTHETIC_USDJPY_M15.csv"
    sub = synth.m15.iloc[:500]
    write_synthetic_csv(sub, str(p), "USDJPY")
    assert open(p, encoding="utf-8").readline().startswith("#")
    back = load_ohlc_csv(str(p))
    pd.testing.assert_frame_equal(back, sub.reset_index(drop=True), check_exact=False, atol=1e-6)
    assert validate_ohlc(back)["n_bad_ohlc"] == 0


def test_csv_mt4_headerless_and_tz(tmp_path):
    p = tmp_path / "mt4.csv"
    p.write_text("2024.01.10,02:00,1.1000,1.1010,1.0990,1.1005,100\n2024.01.10,02:15,1.1005,1.1020,1.1000,1.1015,80\n")
    d = load_ohlc_csv(str(p), source_tz="ny_close_server")
    assert d["time"].iloc[0] == pd.Timestamp("2024-01-10 00:00")
    d2 = load_ohlc_csv(str(p), source_tz="fixed", source_fixed_offset_hours=2.0)
    assert d2["time"].iloc[1] == pd.Timestamp("2024-01-10 00:15")
    d3 = load_ohlc_csv(str(p))
    assert list(d3.columns) == ["time", "open", "high", "low", "close", "volume"] and d3["volume"].iloc[1] == 80


def test_csv_header_and_dedupe(tmp_path):
    p = tmp_path / "h.csv"
    p.write_text("time,open,high,low,close,volume\n2024-01-10 00:15:00,1,2,0.5,1.5,1\n"
                 "2024-01-10 00:00:00,1,2,0.5,1.5,1\n2024-01-10 00:00:00,9,9,9,9,9\n")
    d = load_ohlc_csv(str(p))
    assert len(d) == 2 and d["time"].is_monotonic_increasing and d["open"].iloc[0] == 1


# ======================================================================================
# 合成データ
# ======================================================================================
def test_synthetic_properties(synth):
    m15 = synth.m15
    assert m15.attrs.get("synthetic") is True
    assert validate_ohlc(m15)["n_bad_ohlc"] == 0
    assert (m15["low"] > 0).all()
    again = generate_synthetic("USDJPY", start="2018-01-01", years=0.6, seed=7).m15
    pd.testing.assert_frame_equal(again, m15)
    other = generate_synthetic("USDJPY", start="2018-01-01", years=0.6, seed=8).m15
    assert not np.allclose(other["close"].to_numpy()[:100], m15["close"].to_numpy()[:100])
    # サーバー時間の土日は足なし
    assert (ds_server_dow(m15) < 5).all()


def ds_server_dow(df):
    d = build_dataset(df.iloc[:2000], CFG, "X")
    return pd.DatetimeIndex(d["server_time"]).dayofweek.to_numpy()


def test_synthetic_universe_multi_pair():
    u = generate_universe(("USDJPY", "EURUSD"), years=0.1, seed=3)
    assert set(u) == {"USDJPY", "EURUSD"}
    assert u["EURUSD"].m15["close"].mean() < 5 < u["USDJPY"].m15["close"].mean()
    assert u["USDJPY"].m1 is None


def test_ds_columns_present(ds):
    for c in ("pair", "time", "close_time", "server_time", "day_end", "ema10", "ema320", "atr14",
              "fr2_sh_last", "fr5_sl_last_pos", "d1_close", "d1_sma20", "d1_sma100", "d1_sma20_chg5",
              "h4_sma20", "h4_sma80", "h4_sma120", "h4_fr2_hl", "h1_sma20", "h1_sma80", "h1_gc_age",
              "h1_dc_age", "h1_atr14", "d1_confirm", "h4_confirm", "h1_confirm"):
        assert c in ds.columns, c
    assert ds["h4_fr2_hl"].dtype == bool
    assert (ds["day_end"] > ds["time"]).all() and (ds["day_end"] - ds["close_time"] < pd.Timedelta(days=1, hours=1)).all()
    assert isinstance(ds.index, pd.RangeIndex)


# ======================================================================================
# config / gates(placeholder 方針)
# ======================================================================================
def test_cost_unset_raises_and_synthetic_is_labeled():
    c = default_config().costs
    assert not c.is_ready("USDJPY")
    with pytest.raises(NotConfiguredError):
        c.spread_for("USDJPY")
    with pytest.raises(NotConfiguredError):
        c.slippage()
    s = synthetic_test_config().costs
    assert s.is_test_value and SYNTHETIC_NOTICE in s.source and s.is_ready("EURUSD")
    assert abs(s.cost_price("EURUSD") - (1.0 + 0.2) * 0.0001) < 1e-12
    assert pip_size("EURJPY") == 0.01 and pip_size("GBPUSD") == 0.0001


def test_config_gmt_shift_is_immutable_copy():
    c2 = CFG.with_gmt_shift(1)
    assert c2.day.gmt_shift_hours == 1 and CFG.day.gmt_shift_hours == 0


def test_gates_placeholder_returns_hold():
    r = gates.evaluate_gate_set(gates.PHASE0_GATE, {"pf": 9.9, "n_trades": 1000})
    assert r.verdict == gates.HOLD and not r.complete
    assert gates.evaluate_gate_set(gates.PROMOTION_GATE, {}).verdict == gates.HOLD
    for g in (gates.PHASE0_GATE, gates.PROMOTION_GATE):
        assert all(rule.threshold is None for rule in g.rules)  # 基準値を自作していない


def test_gates_unset_threshold_is_hold_even_with_great_metrics():
    gs = gates.GateSet("t", (gates.GateRule("x", "pf", ">=", None),))
    assert gates.evaluate_gate_set(gs, {"pf": 100.0}).verdict == gates.HOLD


def test_gates_evaluator_logic_with_dummy_thresholds():
    # ダミー値(ロジック確認用。ea-labの基準ではない)
    r1 = gates.GateRule("a", "pf", ">=", 1.0, scope="train")
    r2 = gates.GateRule("b", "max_dd_r", "<=", 5.0, scope="all")
    r3 = gates.GateRule("c", "n_trades", ">=", 10, scope="oos")
    gs = gates.GateSet("t", (r1, r2, r3))
    assert gates.evaluate_gate_set(gs, {"pf": 1.5, "max_dd_r": 3.0}, scope="train").verdict == gates.PASS
    assert gates.evaluate_gate_set(gs, {"pf": 0.5, "max_dd_r": 3.0}, scope="train").verdict == gates.FAIL
    assert gates.evaluate_gate_set(gs, {"pf": 1.5, "max_dd_r": None}, scope="train").verdict == gates.HOLD
    # 不合格が1つでもあれば、他が保留でも不合格
    assert gates.evaluate_gate_set(gs, {"pf": 0.5, "max_dd_r": None}, scope="train").verdict == gates.FAIL
    assert gates.evaluate_gate_set(gs, {"max_dd_r": 1, "n_trades": 3}, scope="oos").verdict == gates.FAIL


def test_gates_json_loader(tmp_path):
    p = tmp_path / "g.json"
    p.write_text('{"name":"x","rules":[{"name":"n","metric":"pf","op":">=","threshold":null,"scope":"train"}]}')
    gs = gates.load_gate_set_json(str(p))
    assert gs.rules[0].threshold is None
    assert gates.evaluate_gate_set(gs, {"pf": 3}, "train").verdict == gates.HOLD


# ======================================================================================
# Params / schema / metrics
# ======================================================================================
def test_params_defaults_match_handoff_base_case():
    p = Params()
    assert (p.h1_cross_window, p.d1_mode, p.d1_slope_bars) == (48, "A", 5)
    assert (p.h4_long_sma, p.h4_require_swing) == (120, True)
    assert (p.po_slope_bars, p.po_expand) == (3, False)
    assert (p.hi_mode, p.hi_lookback, p.hi_break_on) == ("lookback", 40, "close")
    assert (p.pb_mode, p.pb_touch_ema, p.pb_forbid_ema80_close, p.pb_forbid_ema320_touch) == ("ema", 40, True, True)
    assert (p.tl_mode, p.tl_fractal_n, p.tl_break_on, p.tl_expire_bars) == ("trendline", 2, "close", 32)
    assert (p.sl_mode, p.sl_margin_atr, p.sl_max_h1_atr) == ("atr", 0.1, None)
    assert (p.tp1_fraction, p.be_after_tp1, p.trail_mode, p.eod_close) == (0.5, "entry", "m15_swing", True)
    assert p.is_original() and not p.replace(d10_max_spread_pips=2.0).is_original()
    p.validate()


def test_params_roundtrip_and_key():
    p = Params().replace(d10_session_utc=(7, 16), tp1_fraction=0.3)
    assert Params.from_dict(p.to_dict()) == p
    assert p.key() == Params.from_dict(p.to_dict()).key() != Params().key()
    with pytest.raises(ValueError):
        Params.from_dict({"nope": 1})
    with pytest.raises(ValueError):
        Params(d1_mode="Z").validate()


def test_sensitivity_grid_is_valid_and_covered_by_feature_spec():
    fields = set(Params.__dataclass_fields__)
    spec = CFG.features
    for k, vals in SENSITIVITY_GRID.items():
        assert k in fields, k
        for v in vals:
            Params().replace(**{k: v}, **SENSITIVITY_REQUIRES.get(k, {})).validate()
    for ks, combos in SENSITIVITY_PAIRS.items():
        for combo in combos:
            Params().replace(**dict(zip(ks, combo))).validate()
    # 候補値で必要になる指標が事前計算されている
    assert set(SENSITIVITY_GRID["po_slope_bars"]) | {Params().d1_slope_bars} >= set()
    assert {1, 3, 5} <= set(spec.slope_lags)
    assert set(SENSITIVITY_GRID["tl_fractal_n"]) <= set(spec.m15_fractal_n)
    assert set(SENSITIVITY_GRID["hi_swing_fractal_n"]) <= set(spec.m15_fractal_n)
    assert {Params().d1_swing_fractal_n, Params().h4_swing_fractal_n} <= set(spec.htf_fractal_n)
    assert set(SENSITIVITY_GRID["h4_long_sma"]) <= set(spec.h4_sma)
    assert {Params().pb_touch_ema, 20, 80} <= set(spec.m15_ema)


def _trade(**kw):
    t = pd.Timestamp("2024-01-10 10:00")
    base = dict(trade_id=0, pair="USDJPY", side="long", signal_time=t, entry_time=t + pd.Timedelta(minutes=15),
                exit_time=t + pd.Timedelta(hours=2), entry=100.0, sl=99.0, tp1=102.0, risk=1.0, atr15=0.3, h0=102.0,
                pb_extreme=99.1, partial=True, tp1_time=t + pd.Timedelta(hours=1), exit_price=103.0,
                exit_reason="trail_stop", r_multiple=2.0, cost_r=0.1, pnl_r=1.9, bars_held=8)
    base.update(kw)
    return base


def test_schema_validation():
    schema.validate_trades(pd.DataFrame([], columns=schema.TRADE_COLUMNS))
    df = pd.DataFrame([_trade()])[schema.TRADE_COLUMNS]
    schema.validate_trades(df)
    with pytest.raises(ValueError):
        schema.validate_trades(pd.DataFrame([_trade(pnl_r=5.0)]))
    with pytest.raises(ValueError):
        schema.validate_trades(pd.DataFrame([_trade(exit_reason="???")]))
    with pytest.raises(ValueError):
        schema.validate_trades(pd.DataFrame([_trade(entry_time=pd.Timestamp("2024-01-10 10:00"))]))
    f = {k: 0 for k in schema.funnel_keys()}
    schema.validate_funnel(f)
    f["long.setup_po"] = 3
    with pytest.raises(ValueError):
        schema.validate_funnel(f)  # 収支が合わない
    f["long.cancel_expired"] = 2
    f["long.setup_filled"] = 1
    f["long.setup_break"] = 2
    f["long.setup_pullback"] = 1
    f["long.setup_line"] = 1
    f["long.setup_line_break"] = 1
    f["long.setup_filters"] = 1
    schema.validate_funnel(f)
    del f["bars_total"]
    with pytest.raises(ValueError):
        schema.validate_funnel(f)


def test_metrics():
    rows = [_trade(trade_id=i, pnl_r=v, r_multiple=v + 0.1, exit_time=pd.Timestamp("2024-01-10 12:00") + pd.Timedelta(hours=i))
            for i, v in enumerate([2.0, -1.0, -1.0, 1.0])]
    m = compute_metrics(pd.DataFrame(rows))
    assert m["n_trades"] == 4 and m["win_rate"] == 0.5
    assert abs(m["pf"] - 3.0 / 2.0) < 1e-12 and abs(m["avg_r"] - 0.25) < 1e-12
    assert abs(m["max_dd_r"] - 2.0) < 1e-12 and m["max_consec_losses"] == 2
    assert set(compute_metrics(pd.DataFrame([], columns=schema.TRADE_COLUMNS))) >= {"n_trades", "pf", "max_dd_r"}
    assert compute_metrics(pd.DataFrame([], columns=schema.TRADE_COLUMNS))["pf"] is None
    assert profit_factor(np.array([1.0, 2.0])) == math.inf
    assert max_drawdown(np.array([1.0, 1.0, -3.0, 1.0])) == 3.0


def test_interfaces_doc_mentions_all_names():
    """INTERFACES.md に、Params のフィールド・trades列・funnelキー・指標キーが漏れなく書かれている(仕様と実装のズレ防止)。"""
    from core.metrics import METRIC_KEYS

    doc = open(os.path.join(os.path.dirname(__file__), "..", "INTERFACES.md"), encoding="utf-8").read()
    missing = [f for f in Params.__dataclass_fields__ if f"`{f}`" not in doc]
    missing += [c for c in schema.TRADE_COLUMNS if f"`{c}`" not in doc]
    missing += [k for k in schema.FUNNEL_BAR_STEPS + schema.FUNNEL_SETUP_STEPS + schema.FUNNEL_CANCEL_KEYS if k not in doc]
    missing += [k for k in METRIC_KEYS if k not in doc]
    missing += [r for r in schema.EXIT_REASONS if r not in doc]
    assert not missing, missing
