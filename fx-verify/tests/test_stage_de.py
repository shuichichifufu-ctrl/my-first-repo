"""段階D・E(stages/stage_de.py)のテスト。

大半は『偽の実行関数』を使う(strategy.py が無くても動く。ロジックの確認用で、成績ではない)。
strategy.py があれば、実物を使った結合テストも走る(無ければ skip)。
データは core.synthetic の合成データ(テスト専用。コストも synthetic_test_config の『テスト用・実値ではない』値)。

ゲートの閾値: 本物のゲート基準は未転記(None)。ここで使う閾値は、判定の仕組み(合格/不合格/保留の集約)を
確かめるための『テスト専用のダミー(1e9 など現実離れした値)』で、基準値ではない。
"""
import importlib.util
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)

from core import schema  # noqa: E402
from core.config import NotConfiguredError, default_config, synthetic_test_config  # noqa: E402
from core.data import build_dataset  # noqa: E402
from core.gates import FAIL, HOLD, PASS, PHASE0_GATE, PROMOTION_GATE, GateRule, GateSet  # noqa: E402
from core.metrics import compute_metrics  # noqa: E402
from core.params import Params, base_params  # noqa: E402
from core.synthetic import generate_synthetic  # noqa: E402


def _load_stage_de():
    """stages/stage_de.py をファイルパスで読み込む(stages.py との名前衝突を避けるため)。"""
    path = os.path.join(ROOT, "stages", "stage_de.py")
    spec = importlib.util.spec_from_file_location("stage_de", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["stage_de"] = mod
    spec.loader.exec_module(mod)
    return mod


sd = _load_stage_de()
CFG = synthetic_test_config()  # テスト用・実値ではない
HAS_STRATEGY = importlib.util.find_spec("strategy") is not None

PAIRS = ["USDJPY", "EURUSD", "GBPUSD", "EURJPY"]


# ======================================================================================
# 共通の部品
# ======================================================================================
@pytest.fixture(scope="module")
def raw15():
    """合成の15分足(約0.5年・4ペア)。テスト専用。"""
    out = {}
    for i, p in enumerate(PAIRS):
        out[p] = generate_synthetic(p, start="2018-01-01", years=0.5, seed=10 + i).m15
    return out


@pytest.fixture(scope="module")
def datasets(raw15):
    return {p: build_dataset(df, CFG, p) for p, df in raw15.items()}


@pytest.fixture(scope="module")
def split(datasets):
    """train_end = 4月1日(データは1〜6月)。"""
    return sd.Split(pd.Timestamp("2018-04-01"), "テスト用の分割")


def _trades_from_rows(df: pd.DataFrame, idx, pnl, pair) -> pd.DataFrame:
    """df の行 idx(判定足)で、次の足の始値で約定した取引を作る。pnl は pnl_r。"""
    rows = []
    for k, (i, r) in enumerate(zip(idx, pnl)):
        i = int(i)
        cost = 0.05
        rows.append(
            {
                "trade_id": k, "pair": pair, "side": "long",
                "signal_time": df["time"].iloc[i], "entry_time": df["time"].iloc[i + 1],
                "exit_time": df["time"].iloc[min(i + 3, len(df) - 1)],
                "entry": float(df["open"].iloc[i + 1]), "sl": float(df["open"].iloc[i + 1]) - 1.0,
                "tp1": float(df["open"].iloc[i + 1]) + 1.0, "risk": 1.0,
                "atr15": float(df["atr14"].iloc[i]) if pd.notna(df["atr14"].iloc[i]) else 0.5,
                "h0": float(df["open"].iloc[i + 1]) + 1.0, "pb_extreme": float(df["open"].iloc[i + 1]) - 0.9,
                "partial": False, "tp1_time": pd.NaT, "exit_price": float(df["open"].iloc[i + 1]),
                "exit_reason": "sl", "r_multiple": float(r) + cost, "cost_r": cost, "pnl_r": float(r),
                "bars_held": 3,
            }
        )
    if not rows:
        return sd.empty_trades()
    return pd.DataFrame(rows)[schema.TRADE_COLUMNS]


class FakeRunner:
    """偽の run_backtest。df の行から決まった取引を返す(中身は設定の key から決まる偽の損益)。呼び出しを記録する。"""

    def __init__(self, step=300, avg_r=0.2):
        self.step, self.avg_r = step, avg_r
        self.calls = []

    def __call__(self, df, params, cfg, df1m=None):
        pair = str(df["pair"].iloc[0])
        self.calls.append(
            {
                "pair": pair, "n": len(df), "last_close": df["close_time"].max(), "key": params.key(),
                "day_end0": df["day_end"].iloc[0], "has_1m": df1m is not None,
            }
        )
        idx = np.arange(100, len(df) - 5, self.step) if self.step else np.array([], dtype=int)
        pnl = self.avg_r + np.where(np.arange(len(idx)) % 2 == 0, 1.0, -1.0)
        trades = _trades_from_rows(df.reset_index(drop=True), idx, pnl, pair)
        f = sd.empty_funnel(len(df))
        return trades, f


class FakeBenchmark:
    """偽の run_benchmark_random。ready(ema320・atr14が非NaN)の足から、ref と同数をランダムに選ぶ。"""

    def __init__(self, avg_r=0.0):
        self.avg_r = avg_r
        self.calls = []

    def __call__(self, df, params, cfg, *, seed, ref_trades, df1m=None):
        d = df.reset_index(drop=True)
        self.calls.append({"seed": seed, "n_ref": len(ref_trades), "n": len(d), "pair": str(d["pair"].iloc[0])})
        rng = np.random.default_rng(seed)
        ok = np.flatnonzero((d["ema320"].notna() & d["atr14"].notna()).to_numpy())
        ok = ok[ok < len(d) - 5]
        n = min(len(ref_trades), len(ok))
        idx = np.sort(rng.choice(ok, size=n, replace=False)) if n else np.array([], dtype=int)
        pnl = self.avg_r + rng.normal(0.0, 1.0, n)
        trades = _trades_from_rows(d, idx, pnl, str(d["pair"].iloc[0]))
        return trades, sd.empty_funnel(len(d))


# ======================================================================================
# 1. 設定の凍結
# ======================================================================================
class TestFreeze:
    def test_hash_is_deterministic_and_sensitive(self):
        p = base_params()
        h1 = sd.config_hash(p, "USDJPY", "2018-04-01")
        assert h1 == sd.config_hash(Params.from_dict(p.to_dict()), "USDJPY", pd.Timestamp("2018-04-01"))
        assert len(h1) == 64
        assert h1 != sd.config_hash(p.replace(hi_lookback=80), "USDJPY", "2018-04-01")
        assert h1 != sd.config_hash(p, "EURUSD", "2018-04-01")
        assert h1 != sd.config_hash(p, "USDJPY", "2018-05-01")

    def test_first_freeze_then_same(self):
        reg = sd.FreezeRegistry()
        r1 = reg.freeze(base_params(), train_end="2018-04-01", source="t")
        assert r1["status"] == "new" and not r1["reselected"]
        r2 = reg.freeze(base_params().to_dict(), train_end="2018-04-01")  # dict でも同じ
        assert r2["status"] == "same" and r2["hash"] == r1["hash"]
        assert not reg.reselected

    def test_replace_before_validation_warns_but_not_reselected(self):
        reg = sd.FreezeRegistry()
        reg.freeze(base_params(), train_end="2018-04-01")
        with pytest.warns(sd.ReselectionWarning, match="検証用期間はまだ見ていない"):
            r = reg.freeze(base_params().replace(hi_lookback=80), train_end="2018-04-01")
        assert r["status"] == "replaced_before_validation"
        assert r["changed"] == ["hi_lookback"]
        assert not reg.reselected
        assert reg.current["params"]["hi_lookback"] == 80

    def test_reselect_after_validation_is_flagged_and_sticky(self):
        reg = sd.FreezeRegistry()
        reg.freeze(base_params(), train_end="2018-04-01")
        reg.mark_validation_seen("stage_d")
        with pytest.warns(sd.ReselectionWarning, match="選び直しを検出"):
            r = reg.freeze(base_params().replace(tl_expire_bars=64), train_end="2018-04-01")
        assert r["status"] == "reselected_after_validation" and r["reselected"]
        assert reg.reselected
        # 元の設定に戻しても、選び直しの事実は消えない
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            reg.freeze(base_params(), train_end="2018-04-01")
        assert reg.reselected
        assert reg.summary()["reselected"] is True

    def test_persistence_across_instances(self, tmp_path):
        path = str(tmp_path / "freeze.json")
        a = sd.FreezeRegistry(path)
        a.freeze(base_params(), train_end="2018-04-01")
        a.mark_validation_seen("stage_d")
        b = sd.FreezeRegistry(path)  # 別プロセスを想定
        assert b.validation_seen and b.current["hash"] == a.current["hash"]
        assert b.freeze(base_params(), train_end="2018-04-01")["status"] == "same"
        with pytest.warns(sd.ReselectionWarning):
            b.freeze(base_params().replace(sl_margin_atr=0.3), train_end="2018-04-01")
        c = sd.FreezeRegistry(path)
        assert c.reselected, "選び直しの記録は保存されて次の実行にも残る"

    def test_chain_detects_tampering(self, tmp_path):
        path = str(tmp_path / "freeze.json")
        a = sd.FreezeRegistry(path)
        a.freeze(base_params(), train_end="2018-04-01")
        a.mark_validation_seen("stage_d")
        assert a.verify_integrity()
        with open(path, encoding="utf-8") as f:
            st = json.load(f)
        st["events"][0]["params_key"] = "forged"  # イベントを手で書き換える
        with open(path, "w", encoding="utf-8") as f:
            json.dump(st, f)
        with pytest.warns(sd.ReselectionWarning, match="整合性エラー"):
            b = sd.FreezeRegistry(path)
        assert not b.integrity_ok and b.reselected

    def test_broken_file_is_not_silently_reset(self, tmp_path):
        path = tmp_path / "freeze.json"
        path.write_text("{ broken", encoding="utf-8")
        with pytest.raises(ValueError, match="黙って作り直さない"):
            sd.FreezeRegistry(str(path))

    def test_pair_set_change_after_evaluation_warns(self):
        reg = sd.FreezeRegistry()
        reg.freeze(base_params(), train_end="2018-04-01")
        assert reg.record_evaluation("D", ["USDJPY", "EURUSD", "GBPUSD"], [-1, 0, 1]) is None
        with pytest.warns(sd.ReselectionWarning, match="検証対象ペア"):
            msg = reg.record_evaluation("D", ["USDJPY", "EURUSD"], [-1, 0, 1])
        assert msg and reg.summary()["pair_set_changed"] is True
        assert not reg.reselected  # 選び直し扱いにはしない(理由の記録を求めるだけ)

    def test_none_chosen_is_rejected(self):
        with pytest.raises(ValueError, match="chosen が None"):
            sd._coerce_params(None)


# ======================================================================================
# 2. run_period
# ======================================================================================
class TestRunPeriod:
    def test_train_truncates_and_oos_filters(self, datasets, split):
        ds = datasets["USDJPY"]
        fr = FakeRunner(step=137)
        tr = sd.run_period(ds, base_params(), CFG, "train", split, runner=fr)
        assert fr.calls[-1]["last_close"] <= split.train_end, "学習用は末尾を切ったデータで回す"
        assert fr.calls[-1]["n"] == (ds["close_time"] <= split.train_end).sum()
        assert (tr.trades["entry_time"] <= split.train_end).all()

        oo = sd.run_period(ds, base_params(), CFG, "oos", split, runner=fr)
        assert fr.calls[-1]["n"] == len(ds), "検証用は全期間で回す(指標のウォームアップのため)"
        assert len(oo.trades) > 0 and (oo.trades["entry_time"] > split.train_end).all()
        assert list(oo.trades["trade_id"]) == list(range(len(oo.trades)))

        al = sd.run_period(ds, base_params(), CFG, "all", split, runner=fr)
        assert len(al.trades) >= len(tr.trades) + len(oo.trades) - 1  # 境目で最大1件のずれ(約定が train_end ちょうど)
        assert oo.n_bars == (ds["close_time"] > split.train_end).sum()

    def test_period_must_be_valid(self, datasets, split):
        with pytest.raises(ValueError):
            sd.run_period(datasets["USDJPY"], base_params(), CFG, "future", split, runner=FakeRunner())

    def test_empty_slice_gives_empty_result(self, datasets):
        ds = datasets["USDJPY"]
        early = sd.Split(pd.Timestamp("2000-01-01"))  # 学習用が空
        r = sd.run_period(ds, base_params(), CFG, "train", early, runner=FakeRunner())
        assert r.metrics["n_trades"] == 0 and r.n_bars == 0

    def test_1m_truncated_for_train(self, datasets, split):
        ds = datasets["USDJPY"]
        t = pd.date_range("2018-03-30", "2018-04-03", freq="1min")
        m1 = pd.DataFrame({"time": t, "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0})
        got = sd._truncate_1m(m1, split.train_end)
        assert (got["time"] + pd.Timedelta(minutes=1) <= split.train_end).all()
        assert sd._truncate_1m(None, split.train_end) is None

    def test_train_end_of_accepts_various(self):
        ts = pd.Timestamp("2018-04-01")
        assert sd.train_end_of(sd.Split(ts)) == ts
        assert sd.train_end_of({"train_end": "2018-04-01"}) == ts
        assert sd.train_end_of("2018-04-01") == ts
        assert sd.train_end_of(pd.Timestamp("2018-04-01", tz="UTC")) == ts
        with pytest.raises(ValueError):
            sd.train_end_of(sd.Split(None))


# ======================================================================================
# 3. 段階D
# ======================================================================================
class TestStageD:
    def _run(self, raw15, datasets, split, **kw):
        fr = kw.pop("runner", None) or FakeRunner()
        res = sd.stage_d(raw15, CFG, split, base_params(), runner=fr, datasets=datasets, **kw)
        return res, fr

    def test_segment_layout(self, raw15, datasets, split):
        res, fr = self._run(raw15, datasets, split)
        segs = res["segments"]
        got = [(s["pair"], s["period"], s["gmt_shift"], s["scope"]) for s in segs]
        assert got[:5] == [
            ("USDJPY", "train", 0.0, "train"),
            ("USDJPY", "oos", 0.0, "oos"),
            ("EURUSD", "all", 0.0, "pair"),
            ("GBPUSD", "all", 0.0, "pair"),
            ("EURJPY", "all", 0.0, "pair"),
        ]
        shifted = [g for g in got if g[3] == "gmt_shift"]
        assert {g[2] for g in shifted} == {-1.0, 1.0}
        # 主ペアは検証用期間、他ペアは全期間でずらす
        assert ("USDJPY", "oos", -1.0, "gmt_shift") in got and ("EURJPY", "all", 1.0, "gmt_shift") in got
        assert len(segs) == 2 + 3 + 2 * 4
        for s in segs:
            assert set(s) >= {"pair", "period", "gmt_shift", "scope", "metrics", "breakdown_year", "breakdown_side", "gates"}
        assert res["missing_pairs"] == ["AUDUSD"] and res["missing_required_pairs"] == []

    def test_gmt_shift_rebuilds_dataset(self, raw15, datasets, split):
        res, fr = self._run(raw15, datasets, split)
        ends = {}
        for c in fr.calls:
            ends.setdefault(c["pair"], set()).add(c["day_end0"])
        # ずらし -1/0/+1 で日の区切り(day_end)が変わる = データが作り直されている
        assert all(len(v) == 3 for v in ends.values()), ends

    def test_chosen_is_never_retuned(self, raw15, datasets, split):
        chosen = base_params().replace(hi_lookback=80)
        fr = FakeRunner()
        sd.stage_d(raw15, CFG, split, chosen, runner=fr, datasets=datasets)
        assert {c["key"] for c in fr.calls} == {chosen.key()}, "全区間で同じ設定のまま(再調整なし)"

    def test_gates_hold_when_unset(self, raw15, datasets, split):
        res, _ = self._run(raw15, datasets, split)
        assert PHASE0_GATE.rules == () and PROMOTION_GATE.rules == (), "閾値は自作しない(未転記のまま)"
        for s in res["segments"]:
            for g in ("phase0", "promotion"):
                assert s["gates"][g]["verdict"] == HOLD and s["gates"][g]["complete"] is False
        for g in ("phase0", "promotion"):
            gs = res["gate_summary"][g]
            assert gs["verdict"] == HOLD and gs["n_hold"] == len(res["segments"]) and gs["n_pass"] == gs["n_fail"] == 0
        assert res["gates_ready"]["phase0"] == {"n_rules": 0, "complete": False}

    def test_gate_rule_with_none_threshold_is_hold(self, raw15, datasets, split):
        gate = GateSet("g", rules=(GateRule("x", "pf", ">=", None, scope="all"),))
        res, _ = self._run(raw15, datasets, split, gate_sets={"g": gate})
        assert res["gate_summary"]["g"]["verdict"] == HOLD
        assert res["gates_ready"]["g"]["complete"] is False

    def test_gate_aggregation_machinery(self, raw15, datasets, split):
        """集約の仕組みだけを確認する(閾値はテスト専用のダミー。基準値ではない)。"""
        ok = GateSet("ok", rules=(GateRule("dummy", "n_trades", ">=", 0.0, scope="all"),))
        ng = GateSet("ng", rules=(GateRule("dummy", "avg_r", ">", 1e9, scope="all"),))
        only_oos = GateSet(
            "mix",
            rules=(
                GateRule("dummy_oos", "n_trades", ">=", 0.0, scope="oos"),
                GateRule("dummy_pair", "avg_r", ">", 1e9, scope="pair"),
            ),
        )
        res, _ = self._run(raw15, datasets, split, gate_sets={"ok": ok, "ng": ng, "mix": only_oos})
        gsum = res["gate_summary"]
        assert gsum["ok"]["verdict"] == PASS and gsum["ok"]["n_fail"] == 0
        assert gsum["ng"]["verdict"] == FAIL and gsum["ng"]["n_pass"] == 0
        # scope='oos' の規則は oos 区間だけに効き、pair の規則は他ペア全期間だけに効く
        assert gsum["mix"]["by_scope"]["oos"] == PASS
        assert gsum["mix"]["by_scope"]["pair"] == FAIL
        assert gsum["mix"]["verdict"] == FAIL
        # scope に当てはまるルールが無い区間(train / gmt_shift)は保留
        assert gsum["mix"]["by_scope"]["train"] == HOLD and gsum["mix"]["by_scope"]["gmt_shift"] == HOLD
        assert gsum["mix"]["n_hold"] > 0

    def test_aggregate_verdicts(self):
        a = sd.aggregate_verdicts
        assert a([]) == HOLD
        assert a([PASS, PASS]) == PASS
        assert a([PASS, HOLD]) == HOLD
        assert a([PASS, HOLD, FAIL]) == FAIL

    def test_missing_required_pair_is_recorded(self, raw15, datasets, split):
        sub = {k: v for k, v in raw15.items() if k != "GBPUSD"}
        res, _ = self._run(sub, {k: v for k, v in datasets.items() if k != "GBPUSD"}, split)
        assert "GBPUSD" in res["missing_pairs"] and res["missing_required_pairs"] == ["GBPUSD"]
        assert all(s["pair"] != "GBPUSD" for s in res["segments"])

    def test_missing_main_pair(self, raw15, split):
        with pytest.raises(ValueError, match="主ペア"):
            sd.stage_d({"EURUSD": raw15["EURUSD"]}, CFG, split, base_params(), runner=FakeRunner())

    def test_costs_unset_raises_before_heavy_work(self, raw15, split):
        fr = FakeRunner()
        with pytest.raises(NotConfiguredError):
            sd.stage_d(raw15, default_config(), split, base_params(), runner=fr)
        assert fr.calls == [], "コスト未設定は計算を始める前に止める"
        reg = sd.FreezeRegistry()
        with pytest.raises(NotConfiguredError):
            sd.stage_d(raw15, default_config(), split, base_params(), runner=fr, registry=reg)
        assert reg.current is None and not reg.validation_seen, "止まったときに『検証を見た』と記録しない"

    def test_reselect_between_runs_is_reported(self, raw15, datasets, split):
        reg = sd.FreezeRegistry()
        first = sd.stage_d(raw15, CFG, split, base_params(), runner=FakeRunner(), datasets=datasets, registry=reg)
        assert first["reselected"] is False and first["freeze"]["last_status"] == "new"
        assert first["freeze"]["validation_seen"] is True
        with pytest.warns(sd.ReselectionWarning):
            second = sd.stage_d(
                raw15, CFG, split, base_params().replace(hi_lookback=20), runner=FakeRunner(), datasets=datasets,
                registry=reg,
            )
        assert second["reselected"] is True
        assert second["freeze"]["last_status"] == "reselected_after_validation"
        assert second["warnings"] and "選び直し" in second["warnings"][0]
        assert second["freeze"]["last_changed"] == ["hi_lookback"]

    def test_frozen_before_stage_d_then_different_chosen(self, raw15, datasets, split):
        """段階Cの直後に凍結 → 違う設定で段階Dを回すと、検証を見る前なので差し替え扱い(選び直しにはしない)。"""
        reg = sd.FreezeRegistry()
        reg.freeze(base_params(), train_end=split.train_end, source="stage_c")
        with pytest.warns(sd.ReselectionWarning):
            res = sd.stage_d(raw15, CFG, split, base_params().replace(pb_min_bars=3), runner=FakeRunner(),
                             datasets=datasets, registry=reg)
        assert res["freeze"]["last_status"] == "replaced_before_validation" and res["reselected"] is False

    def test_chosen_as_dict_and_keep_trades(self, raw15, datasets, split):
        res = sd.stage_d(raw15, CFG, split, base_params().to_dict(), runner=FakeRunner(), datasets=datasets,
                         keep_trades=True)
        assert isinstance(res["segments"][0]["trades"], pd.DataFrame)
        out = sd.to_jsonable(res)
        json.dumps({k: v for k, v in out.items() if k != "segments"})  # 例外が出ない
        json.dumps([{k: v for k, v in s.items() if k != "trades"} for s in out["segments"]], default=str)

    def test_costs_meta(self, raw15, datasets, split):
        res, _ = self._run(raw15, datasets, split)
        assert res["costs"]["is_test_value"] is True and res["costs"]["ready"] is True
        assert res["split"]["train_end"] == "2018-04-01 00:00:00"
        assert any("ゲートの基準値" in n for n in res["notes"])


# ======================================================================================
# 4. 段階E の統計部品
# ======================================================================================
class TestStats:
    def test_rank_among(self):
        s = [0.0, 0.1, 0.2, 0.3, 0.4]
        r = sd.rank_among(0.25, s)
        assert r["below"] == pytest.approx(3 / 5)
        assert r["mid"] == pytest.approx(3 / 5)
        assert r["p_value"] == pytest.approx((2 + 1) / (5 + 1))
        t = sd.rank_among(0.2, s)  # 同値あり
        assert t["below"] == pytest.approx(2 / 5) and t["mid"] == pytest.approx(2.5 / 5)
        assert sd.rank_among(10.0, s)["below"] == 1.0
        assert sd.rank_among(-10.0, s)["below"] == 0.0

    def test_rank_among_handles_none_nan_inf(self):
        assert sd.rank_among(None, [1.0])["below"] is None
        assert sd.rank_among(float("nan"), [1.0])["below"] is None
        assert sd.rank_among(1.0, [])["below"] is None
        assert sd.rank_among(1.0, [None, float("nan")])["below"] is None
        r = sd.rank_among(1.5, [None, 1.0, 2.0, float("inf")])  # None は除く
        assert r["n_sample"] == 3 and r["below"] == pytest.approx(1 / 3)
        assert sd.rank_among(float("inf"), [1.0, float("inf")])["below"] == pytest.approx(0.5)

    def test_distribution(self):
        d = sd.distribution(list(range(101)))
        assert d["mean"] == pytest.approx(50.0) and d["p50"] == pytest.approx(50.0)
        assert d["p05"] == pytest.approx(5.0) and d["p95"] == pytest.approx(95.0)
        assert d["n_valid"] == 101 and d["min"] == 0 and d["max"] == 100
        e = sd.distribution([None, float("nan")])
        assert e["mean"] is None and e["n_valid"] == 0
        inf = sd.distribution([1.0, 2.0, float("inf"), float("inf")])
        assert inf["n_inf"] == 2 and inf["mean"] == pytest.approx(1.5)
        assert inf["p95"] == float("inf")
        assert not any(np.isnan(inf[k]) for k in ("p05", "p50", "p95", "min", "max"))  # nan にならない
        assert np.isfinite(inf["p05"]) and inf["p05"] < 2.0

    def test_mask_pre_period(self, datasets, split):
        ds = datasets["USDJPY"]
        m = sd.mask_pre_period(ds, split.train_end)
        pre = (ds["close_time"] <= split.train_end).to_numpy()
        for c in sd.MASK_COLUMNS:
            assert m.loc[pre, c].isna().all()
            pd.testing.assert_series_equal(m.loc[~pre, c], ds.loc[~pre, c])
        assert ds["atr14"].notna().any(), "元のデータは書き換えない"
        pd.testing.assert_series_equal(m["close"], ds["close"])  # 価格列は触らない


# ======================================================================================
# 5. 段階E
# ======================================================================================
class TestStageE:
    def _run(self, datasets, split, **kw):
        fr, fb = kw.pop("runner", None) or FakeRunner(), kw.pop("benchmark_runner", None) or FakeBenchmark()
        res = sd.stage_e(datasets, CFG, split, base_params(), runner=fr, benchmark_runner=fb, **kw)
        return res, fr, fb

    def test_layout_and_seeds(self, datasets, split):
        res, fr, fb = self._run(datasets, split, n_runs=7, seed=100)
        got = [(s["pair"], s["period"], s["scope"]) for s in res["segments"]]
        assert got == [("USDJPY", "train", "train"), ("USDJPY", "oos", "oos"), ("EURUSD", "all", "pair"),
                       ("GBPUSD", "all", "pair"), ("EURJPY", "all", "pair")]
        assert res["n_runs"] == 7 and res["seed"] == 100
        seeds_first = [c["seed"] for c in fb.calls if c["pair"] == "USDJPY"][:7]
        assert seeds_first == list(range(100, 107)), "seed, seed+1, ... で固定"
        for s in res["segments"]:
            assert s["random"]["n_runs"] == 7
            assert s["random"]["seed_first"] == 100 and s["random"]["seed_last"] == 106
            assert set(s["random"]["avg_r"]) >= {"mean", "p05", "p50", "p95"}
            assert set(s) >= {"pair", "period", "real", "random", "real_avg_r_percentile"}

    def test_default_n_runs_is_200(self):
        import inspect

        assert inspect.signature(sd.stage_e).parameters["n_runs"].default == 200

    def test_trade_frequency_matches_real(self, datasets, split):
        res, _, _ = self._run(datasets, split, n_runs=5, seed=1)
        for s in res["segments"]:
            n_real = s["real"]["n_trades"]
            assert n_real > 0
            assert s["random"]["freq_matched"] is True
            assert s["random"]["n_trades"]["min"] == s["random"]["n_trades"]["max"] == n_real

    def test_oos_random_only_in_oos_period(self, datasets, split):
        res, _, _ = self._run(datasets, split, n_runs=5, seed=3, keep_runs=True)
        oos = next(s for s in res["segments"] if s["period"] == "oos")
        assert oos["random"]["n_filtered_outside_period"] == 0, "マスクで学習用期間は候補に入らない"
        assert oos["random"]["freq_matched"] is True

    def test_oos_filters_trades_outside_when_runner_ignores_mask(self, datasets, split):
        """strategy がマスクを無視して学習用期間に約定した場合でも、検証用期間の外の取引は捨てて数を記録する。"""

        def bad_bench(df, params, cfg, *, seed, ref_trades, df1m=None):
            d = df.reset_index(drop=True)
            idx = np.array([200, 300, len(d) - 10])  # 先頭2つは学習用期間(4月より前)、最後はデータ末尾(検証用期間)
            return _trades_from_rows(d, idx, [0.1, 0.2, 0.3], "USDJPY"), sd.empty_funnel(len(d))

        res = sd.stage_e(datasets, CFG, split, base_params(), runner=FakeRunner(), benchmark_runner=bad_bench,
                         n_runs=2, seed=0, pairs=[], keep_runs=True)
        oos = next(s for s in res["segments"] if s["period"] == "oos")
        assert oos["random"]["n_filtered_outside_period"] == 4  # 2試行 × 学習用期間の2件
        assert oos["random"]["freq_matched"] is False and "揃っていない" in oos["note"]

    def test_train_benchmark_gets_truncated_data(self, datasets, split):
        res, fr, fb = self._run(datasets, split, n_runs=2, seed=0, pairs=[])
        # 呼び出し順: 主ペア train → その2回のベンチ、oos → ...
        n_train = int((datasets["USDJPY"]["close_time"] <= split.train_end).sum())
        assert fb.calls[0]["n"] == n_train and fb.calls[1]["n"] == n_train
        assert fb.calls[2]["n"] == len(datasets["USDJPY"])  # oos は全期間(候補だけマスク)

    def test_percentile_matches_manual_calculation(self, datasets, split):
        res, _, _ = self._run(datasets, split, n_runs=30, seed=5, keep_runs=True, pairs=[])
        for s in res["segments"]:
            runs = s["runs"]["avg_r"].dropna().to_numpy()
            real = s["real"]["avg_r"]
            assert s["real_avg_r_percentile"] == pytest.approx(float((runs < real).mean()))
            assert s["p_value_avg_r"] == pytest.approx((float((runs >= real).sum()) + 1) / (len(runs) + 1))
            assert s["random"]["avg_r"]["mean"] == pytest.approx(float(runs.mean()))
            assert s["entry_edge_r"] == pytest.approx(real - runs.mean())
            assert s["random"]["avg_r"]["p50"] == pytest.approx(float(np.percentile(runs, 50)))
            assert "実戦略の平均R" in s["reading"]

    def test_strong_real_strategy_ranks_high(self, datasets, split):
        res, _, _ = self._run(datasets, split, runner=FakeRunner(avg_r=2.0), benchmark_runner=FakeBenchmark(avg_r=0.0),
                              n_runs=40, seed=0, pairs=[])
        for s in res["segments"]:
            assert s["real_avg_r_percentile"] == 1.0 and s["entry_edge_r"] > 1.0
        res2, _, _ = self._run(datasets, split, runner=FakeRunner(avg_r=-2.0), benchmark_runner=FakeBenchmark(avg_r=0.0),
                               n_runs=40, seed=0, pairs=[])
        for s in res2["segments"]:
            assert s["real_avg_r_percentile"] == 0.0 and s["entry_edge_r"] < -1.0

    def test_same_seed_same_result_and_different_seed_differs(self, datasets, split):
        a, _, _ = self._run(datasets, split, n_runs=10, seed=42, pairs=[])
        b, _, _ = self._run(datasets, split, n_runs=10, seed=42, pairs=[])
        c, _, _ = self._run(datasets, split, n_runs=10, seed=43, pairs=[])
        ja = json.dumps(sd.to_jsonable({k: v for k, v in a.items() if k != "freeze"}), sort_keys=True, default=str)
        jb = json.dumps(sd.to_jsonable({k: v for k, v in b.items() if k != "freeze"}), sort_keys=True, default=str)
        assert ja == jb
        assert a["segments"][0]["random"]["avg_r"]["mean"] != c["segments"][0]["random"]["avg_r"]["mean"]

    def test_no_real_trades_means_no_random_runs(self, datasets, split):
        res, _, fb = self._run(datasets, split, runner=FakeRunner(step=None), n_runs=5, pairs=[])
        for s in res["segments"]:
            assert s["real"]["n_trades"] == 0 and s["random"]["n_runs"] == 0
            assert s["real_avg_r_percentile"] is None and s["entry_edge_r"] is None
            assert "0件" in s["note"] and "比較できない" in s["reading"]
        assert fb.calls == []

    def test_reselection_detected_in_stage_e(self, datasets, split):
        reg = sd.FreezeRegistry()
        sd.stage_e(datasets, CFG, split, base_params(), runner=FakeRunner(), benchmark_runner=FakeBenchmark(),
                   n_runs=2, registry=reg, pairs=[])
        with pytest.warns(sd.ReselectionWarning):
            res = sd.stage_e(datasets, CFG, split, base_params().replace(hi_lookback=80), runner=FakeRunner(),
                             benchmark_runner=FakeBenchmark(), n_runs=2, registry=reg, pairs=[])
        assert res["reselected"] is True

    def test_d_then_e_with_same_params_is_not_reselection(self, raw15, datasets, split):
        reg = sd.FreezeRegistry()
        sd.stage_d(raw15, CFG, split, base_params(), runner=FakeRunner(), datasets=datasets, registry=reg)
        with warnings.catch_warnings():
            warnings.simplefilter("error", sd.ReselectionWarning)  # 警告が出たら失敗
            res = sd.stage_e(datasets, CFG, split, base_params(), runner=FakeRunner(), benchmark_runner=FakeBenchmark(),
                             n_runs=2, registry=reg)
        assert res["reselected"] is False and res["freeze"]["last_status"] == "same"
        assert set(res["freeze"]["validation_seen_by"]) == {"stage_d", "stage_e"}

    def test_costs_unset_raises(self, datasets, split):
        fb = FakeBenchmark()
        with pytest.raises(NotConfiguredError):
            sd.stage_e(datasets, default_config(), split, base_params(), runner=FakeRunner(), benchmark_runner=fb)
        assert fb.calls == []

    def test_n_runs_validation(self, datasets, split):
        with pytest.raises(ValueError):
            sd.stage_e(datasets, CFG, split, base_params(), n_runs=0, runner=FakeRunner(), benchmark_runner=FakeBenchmark())

    def test_cross_pair_order_default(self, datasets, split):
        res, _, _ = self._run(datasets, split, n_runs=1)
        assert res["cross_pairs"] == ["EURUSD", "GBPUSD", "EURJPY"]


# ======================================================================================
# 6. 実物の strategy との結合(strategy.py があるときだけ)
# ======================================================================================
@pytest.fixture(scope="module")
def real_data():
    """トレンドを強めた合成データ(取引が出やすい)。テスト専用。"""
    raw = {
        p: generate_synthetic(p, start="2018-01-01", years=1.2, seed=20 + i, trend_strength=1.0, swing_amp=0.8).m15
        for i, p in enumerate(["USDJPY", "EURUSD"])
    }
    ds = {p: build_dataset(df, CFG, p) for p, df in raw.items()}
    sp = sd.Split(pd.Timestamp("2018-08-01"), "テスト用")
    return raw, ds, sp


@pytest.mark.skipif(not HAS_STRATEGY, reason="strategy.py が無い")
class TestWithRealStrategy:
    LOOSE = dict(po_slope_bars=1, pb_touch_ema=20, h1_cross_window=None, d1_mode="D", h4_require_swing=False,
                 tl_mode="recent_high", tl_recent_m=3, hi_lookback=20)

    def test_stage_d_real(self, real_data):
        raw, ds, sp = real_data
        chosen = base_params().replace(**self.LOOSE)
        res = sd.stage_d(raw, CFG, sp, chosen, pairs=["EURUSD"], datasets=ds, gmt_shifts=(-1, 0, 1), keep_trades=True)
        assert len(res["segments"]) == 2 + 1 + 2 * 2
        total = sum(s["metrics"]["n_trades"] for s in res["segments"])
        assert total > 0, "結合テストが空振りしないこと(取引が出る設定)"
        for s in res["segments"]:
            schema.validate_trades(s["trades"])
            schema.validate_funnel(s["funnel"])
            assert s["gates"]["phase0"]["verdict"] == HOLD
        oos = next(s for s in res["segments"] if s["period"] == "oos" and s["gmt_shift"] == 0.0)
        assert (oos["trades"]["entry_time"] > sp.train_end).all()

    def test_stage_e_real_matches_frequency_and_is_deterministic(self, real_data):
        raw, ds, sp = real_data
        chosen = base_params().replace(**self.LOOSE)
        a = sd.stage_e(ds, CFG, sp, chosen, n_runs=6, seed=7, pairs=["EURUSD"], keep_runs=True)
        b = sd.stage_e(ds, CFG, sp, chosen, n_runs=6, seed=7, pairs=["EURUSD"], keep_runs=True)
        n_real_total = sum(s["real"]["n_trades"] for s in a["segments"])
        assert n_real_total > 0
        for sa, sb in zip(a["segments"], b["segments"]):
            pd.testing.assert_frame_equal(sa["runs"], sb["runs"])
            if sa["real"]["n_trades"] > 0:
                assert sa["random"]["n_runs"] == 6
                assert sa["random"]["n_filtered_outside_period"] == 0, "実物でも検証用期間の外に約定しない"
                assert 0.0 <= sa["real_avg_r_percentile"] <= 1.0

    def test_real_benchmark_oos_entries_are_after_train_end(self, real_data):
        """マスク方式が実物の strategy でも効いていること(検証用期間の候補だけから約定する)。"""
        from strategy import run_backtest, run_benchmark_random

        raw, ds, sp = real_data
        chosen = base_params().replace(**self.LOOSE)
        real = sd.run_period(ds["USDJPY"], chosen, CFG, "oos", sp)
        if len(real.trades) == 0:
            pytest.skip("検証用期間に取引が無い")
        masked = sd.mask_pre_period(ds["USDJPY"], sp.train_end)
        bt, bf = run_benchmark_random(masked, chosen, CFG, seed=0, ref_trades=real.trades)
        assert len(bt) > 0 and (bt["entry_time"] > sp.train_end).all()
        assert len(bt) == len(real.trades)
