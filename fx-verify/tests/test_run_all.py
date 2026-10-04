"""run_all.py のテスト。

段階(stages)の実装は別担当が並列で作っているので、ここでは INTERFACES §6 のシグネチャだけを真似た
『にせ物の stages』で配線(呼び出し順・引数・打ち切り・エラー処理・出力ファイル)を確かめる。
本物の stages がそろっていれば、最後の統合テストも走る(無ければ skip)。

【注意】ここのゲート閾値(avg_r > 0 など)は、動作を確かめるための『テスト用ダミー・実値ではない』もの。
"""
from __future__ import annotations

import json
import os
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from core.config import CostConfig, default_config, synthetic_test_config
from core.data import normalize_ohlc
from core.gates import GateRule, GateSet
from core.params import base_params
from core.synthetic import generate_synthetic, write_synthetic_csv
from report import V_HOLD, V_LOSE, decide_verdict
import run_all
from run_all import (
    gates_meta,
    load_costs_json,
    load_gate_sets,
    load_real_data,
    main,
    run_pipeline,
)

DUMMY_RULES = (
    GateRule("テスト用ダミー(実値ではない)", "avg_r", ">", 0, scope="all", source="テスト用ダミー"),
)
DUMMY_GATES = {"phase0": GateSet("phase0", DUMMY_RULES), "promotion": GateSet("promotion", DUMMY_RULES)}
EMPTY_GATES = {"phase0": GateSet("phase0", ()), "promotion": GateSet("promotion", ())}


# ---- にせ物の stages ----------------------------------------------------------------------
def _m(n=40, avg_r=0.1):
    return {"n_trades": n, "win_rate": 0.45, "pf": 1.2, "avg_r": avg_r, "expectancy_r": avg_r, "total_r": avg_r * n, "max_dd_r": 3.0}


def _fake_freeze_registry_cls():
    """本物の FreezeRegistry(凍結記録)。にせ物の stages にも持たせ、run_all の配線(凍結→D・Eへ受け渡し)を確かめる。"""
    from stages import FreezeRegistry

    return FreezeRegistry


def make_fake_stages(*, c_avg_r=0.1, d_avg_r=0.1, raise_in=None, reselected=False, chosen_tp1=None, with_registry=True):
    """chosen_tp1: 段階Cが選ぶ tp1_fraction(None なら基準設定)。実行ごとに変えて『選び直し』を再現するのに使う。"""
    calls = []
    reg_seen = {}

    def _maybe(name):
        calls.append(name)
        if raise_in == name:
            raise ValueError(f"{name} のテスト用エラー")

    def build_all(raw15, cfg):
        _maybe("build_all")
        return {p: df.assign(close_time=df["time"] + pd.Timedelta(minutes=15)) for p, df in raw15.items()}

    def make_split(ds_main, cfg, train_frac=0.6):
        _maybe("make_split")
        return SimpleNamespace(train_end=pd.Timestamp("2018-06-30"), note="テスト用の分割")

    def stage_a(datasets, cfg, split, *, pair="USDJPY", params=None):
        _maybe("stage_a")
        return {"params": base_params().to_dict(), "pair": pair,
                "all": {"metrics": _m(), "breakdown_year": {}, "breakdown_side": {}, "funnel": None},
                "train": {"metrics": _m()}, "oos": {"metrics": _m()}}

    def stage_b(datasets, cfg, split, *, pair="USDJPY", base=None):
        _maybe("stage_b")
        df = pd.DataFrame({"param": ["tp1_fraction"] * 2, "value": [0.3, 0.5], "is_base": [False, True],
                           "params_key": ["a", "b"], "n_trades": [30, 40], "win_rate": [0.4, 0.45], "pf": [1.1, 1.2],
                           "avg_r": [0.0, 0.1], "total_r": [0.0, 4.0], "max_dd_r": [3.0, 3.0]})
        df.attrs["n_trials"] = 2
        return df

    def select_axes(stage_b_df, top_k=4):
        _maybe("select_axes")
        calls.append(f"top_k={top_k}")
        return {"tp1_fraction": [0.3, 0.5]}

    def stage_c(datasets, cfg, split, *, pair="USDJPY", base=None, axes):
        _maybe("stage_c")
        res = pd.DataFrame({"tp1_fraction": [0.3, 0.5], "n_trades": [30, 40], "win_rate": [0.4, 0.45], "pf": [1.1, 1.2],
                            "avg_r": [c_avg_r, c_avg_r], "total_r": [1.0, 1.0], "max_dd_r": [3.0, 3.0]})
        cp = base_params() if chosen_tp1 is None else base_params().replace(tp1_fraction=chosen_tp1)
        return {"results": res, "n_trials": 5, "axes": axes, "chosen_params": cp.to_dict(),
                "selection_rule": "テスト用: 台地の中央"}

    def stage_d(raw15, cfg, split, chosen, *, main_pair="USDJPY", gmt_shifts=(-1, 0, 1), gate_sets=None, registry=None):
        _maybe("stage_d")
        calls.append(("stage_d_gmt", tuple(gmt_shifts)))
        if registry is not None:  # 本物の段階Dと同じ順序: 照合 → 『検証を見た』記録
            reg_seen["d_before"] = {"frozen": registry.current is not None, "validation_seen": registry.validation_seen}
            reg_seen["d_obj"] = registry
            registry.freeze(chosen, main_pair=main_pair, train_end=split, source="stage_d")
            registry.mark_validation_seen("stage_d")
        from core.gates import evaluate_gate_set

        def seg(pair, period, scope, gmt=0.0):
            m = _m(avg_r=d_avg_r)
            return {"pair": pair, "period": period, "gmt_shift": gmt, "scope": scope, "metrics": m,
                    "breakdown_year": {}, "breakdown_side": {},
                    "gates": {n: evaluate_gate_set(g, m, scope=scope).to_dict() for n, g in gate_sets.items()}}

        segs = [seg(main_pair, "train", "train"), seg(main_pair, "oos", "oos")]
        segs += [seg(p, "all", "pair") for p in ("EURUSD", "GBPUSD", "EURJPY") if p in raw15]
        segs += [seg(main_pair, "oos", "gmt_shift", -1.0), seg(main_pair, "oos", "gmt_shift", 1.0)]
        return {"segments": segs, "chosen_params": chosen.to_dict(),
                "reselected": reselected or (registry.reselected if registry is not None else False),
                "missing_required_pairs": [p for p in ("EURUSD", "GBPUSD", "EURJPY") if p not in raw15],
                "notes": ["段階Dのメモ(テスト)"]}

    def stage_e(datasets, cfg, split, chosen, *, main_pair="USDJPY", n_runs=100, seed=0, registry=None):
        _maybe("stage_e")
        calls.append(("stage_e", n_runs, seed))
        reg_seen["e_obj"] = registry
        return {"segments": [], "n_runs": n_runs, "seed": seed, "notes": []}

    ns = SimpleNamespace(build_all=build_all, make_split=make_split, stage_a=stage_a, stage_b=stage_b,
                         select_axes=select_axes, stage_c=stage_c, stage_d=stage_d, stage_e=stage_e)
    ns.calls = calls
    ns.reg_seen = reg_seen
    if with_registry:
        ns.FreezeRegistry = _fake_freeze_registry_cls()
    return ns


def tiny_raw15(pairs=("USDJPY", "EURUSD", "GBPUSD", "EURJPY")):
    return {p: generate_synthetic(p, years=0.05, seed=1).m15 for p in pairs}


def real_cfg(spread=1.0, slip=0.0):
    """実データ想定の設定(コストは『テスト用』の仮値。実値ではない)。"""
    cost = CostConfig(spread_pips={p: spread for p in ("USDJPY", "EURUSD", "GBPUSD", "EURJPY")}, slippage_pips=slip,
                      source="テスト用の仮値(実値ではない)", is_test_value=False)
    return default_config().with_costs(cost)


# =============================================================================================
# run_pipeline
# =============================================================================================
def test_段階AからEが順番に呼ばれ_resultが組み立つ(tmp_path):
    fk = make_fake_stages()
    reg = fk.FreezeRegistry(str(tmp_path / "freeze.json"))
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk,
                       n_runs=7, seed=3, top_k=3, registry=reg)
    order = [c for c in fk.calls if isinstance(c, str) and not c.startswith("top_k")]
    assert order == ["build_all", "make_split", "stage_a", "stage_b", "select_axes", "stage_c", "stage_d", "stage_e"]
    assert "top_k=3" in fk.calls and ("stage_e", 7, 3) in fk.calls
    assert ("stage_d_gmt", (-1.0, 0.0, 1.0)) in fk.calls or ("stage_d_gmt", (-1, 0, 1)) in fk.calls
    for k in ("stage_a", "stage_b", "stage_c", "stage_d", "stage_e", "stage_c_gate"):
        assert res[k] is not None, k
    assert res["meta"]["split"]["train_end"].startswith("2018-06-30")
    assert res["meta"]["gates"]["phase0"] == {"n_rules": 1, "complete": True}
    assert res["meta"]["costs"]["ready"] is True
    assert res["meta"]["errors"] == []
    assert "段階Dのメモ(テスト)" in res["meta"]["notes"]
    assert res["stage_c_gate"]["n_pass"] == 2
    # ダミーゲート・実データ扱い・全区間 avg_r>0 なので、規則上は『勝てる』になる(ロジックの配線確認)
    assert decide_verdict(res)["verdict"] == "勝てる"


def test_ゲート未転記なら保留_かつ全段階を回す():
    fk = make_fake_stages(c_avg_r=-1.0)  # 学習用の成績が悪くても、ゲート未転記の間は打ち切らない
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=EMPTY_GATES, data_source="テスト実データ", stages=fk)
    assert res["stage_d"] is not None and res["stage_e"] is not None
    v = decide_verdict(res)
    assert v["verdict"] == V_HOLD
    assert sum("未転記" in m for m in v["missing"]) >= 2


def test_ゲート転記済みで学習用ゲート全滅なら段階DEを省略して勝てない():
    fk = make_fake_stages(c_avg_r=-0.5)
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk)
    assert res["stage_d"] is None and res["stage_e"] is None
    assert "stage_d" not in fk.calls and "stage_e" not in [c for c in fk.calls if isinstance(c, str)]
    assert res["stage_c_gate"]["n_pass"] == 0 and res["stage_c_gate"]["n_fail"] == 2
    assert any("省略" in n for n in res["meta"]["notes"])
    assert decide_verdict(res)["verdict"] == V_LOSE


def test_段階Dで不合格なら勝てない(tmp_path):
    fk = make_fake_stages(c_avg_r=0.1, d_avg_r=-0.2)
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk,
                       registry=fk.FreezeRegistry(str(tmp_path / "freeze.json")))
    assert decide_verdict(res)["verdict"] == V_LOSE


def test_選び直しの検出はmetaに伝わり保留になる():
    fk = make_fake_stages(reselected=True)
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk)
    assert res["meta"]["reselected"] is True
    assert decide_verdict(res)["verdict"] == V_HOLD


# ---- 凍結記録(FreezeRegistry)が実行の入口につながっていること(引継書 第8章) -------------------------
def test_段階Cの直後に凍結し_同じ記録を段階DとEに渡す(tmp_path):
    fk = make_fake_stages()
    path = tmp_path / "freeze.json"
    reg = fk.FreezeRegistry(str(path))
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk,
                       registry=reg)
    # 段階Dに入った時点で、すでに凍結済み・まだ検証用期間は見ていない
    assert fk.reg_seen["d_before"] == {"frozen": True, "validation_seen": False}
    # D と E に同じ registry が渡る
    assert fk.reg_seen["d_obj"] is reg and fk.reg_seen["e_obj"] is reg
    fz = res["meta"]["freeze"]
    assert fz["path"] == str(path) and fz["hash"] and fz["validation_seen"] is True
    assert fz["source"] in ("stage_c", "stage_d")
    assert path.exists()
    assert res["meta"]["reselected"] is False
    ev = [e["type"] for e in json.loads(path.read_text(encoding="utf-8"))["events"]]
    assert ev.index("freeze_new") < ev.index("validation_seen")  # 凍結が先、検証を見たのは後


def test_記録つきで再実行して設定が変わると選び直しとして検出され保留(tmp_path):
    path = str(tmp_path / "freeze.json")
    fk1 = make_fake_stages(chosen_tp1=0.5)
    r1 = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk1,
                      registry=fk1.FreezeRegistry(path))
    assert r1["meta"]["reselected"] is False
    assert decide_verdict(r1)["verdict"] == "勝てる"  # 1回目: 凍結記録で確認できるので、配線上は勝てる経路
    # 2回目: 検証用期間を見た後で、別の設定を選んで再実行(同じ記録ファイル)
    fk2 = make_fake_stages(chosen_tp1=0.3)
    r2 = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk2,
                      registry=fk2.FreezeRegistry(path))
    assert r2["meta"]["reselected"] is True
    assert r2["meta"]["freeze"]["reselected"] is True
    assert any("選び直しを検出" in x for x in r2["meta"]["limits"])
    v = decide_verdict(r2)
    assert v["verdict"] == V_HOLD and any("選び直した" in m for m in v["missing"])
    from report import build_report

    md = build_report(r2)
    assert "**選び直しの有無**: **あり" in md
    assert "なし(" not in md.split("**選び直しの有無**")[1].split("\n")[0]
    # 設定を元に戻して3回目を回しても、選び直しの事実は消えない
    fk3 = make_fake_stages(chosen_tp1=0.5)
    r3 = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk3,
                      registry=fk3.FreezeRegistry(path))
    assert r3["meta"]["reselected"] is True


def test_記録つきで同じ設定を再実行しても選び直しにはならない(tmp_path):
    path = str(tmp_path / "freeze.json")
    for _ in range(2):
        fk = make_fake_stages(chosen_tp1=0.5)
        r = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk,
                         registry=fk.FreezeRegistry(path))
        assert r["meta"]["reselected"] is False


def test_保存先のない凍結記録では選び直しなしと言えず未確認で保留():
    # registry を渡さない(= 実行をまたいだ記録なし)。『なし』と無条件に書かず『未確認』にし、判定は保留寄り。
    fk = make_fake_stages()
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk)
    assert res["meta"]["freeze"]["path"] is None
    v = decide_verdict(res)
    assert v["verdict"] == V_HOLD and any("選び直しの有無を確認できていない" in m for m in v["missing"])
    from report import build_report

    line = [l for l in build_report(res).splitlines() if l.startswith("**選び直しの有無**")][0]
    assert "未確認" in line and "なし(" not in line


def test_段階Cを回せない基準設定への切り替えでも凍結される(tmp_path):
    fk = make_fake_stages()
    fk.select_axes = lambda stage_b_df, top_k=4: {}  # 軸が選べない → 基準設定を固定して D・E へ
    path = tmp_path / "freeze.json"
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk,
                       registry=fk.FreezeRegistry(str(path)))
    assert res["meta"]["stage_c_fallback"] is True
    assert res["meta"]["freeze"]["source"] == "stage_c_fallback_base" or res["meta"]["freeze"]["hash"]
    assert path.exists() and fk.reg_seen["d_before"]["frozen"] is True


def test_合成データは必ず保留():
    cfg = synthetic_test_config()
    res = run_pipeline(tiny_raw15(), cfg, gate_sets=DUMMY_GATES, synthetic=True, data_source="合成", stages=make_fake_stages())
    assert res["meta"]["synthetic"] is True and res["meta"]["costs"]["is_test_value"] is True
    assert decide_verdict(res)["verdict"] == V_HOLD


def test_コスト未設定なら段階を実行せず保留():
    fk = make_fake_stages()
    res = run_pipeline(tiny_raw15(), default_config(), gate_sets=DUMMY_GATES, data_source="テスト実データ", stages=fk)
    assert fk.calls == []  # 何も実行していない
    assert res["meta"]["costs"]["ready"] is False
    assert all(res[k] is None for k in ("stage_a", "stage_b", "stage_c", "stage_d", "stage_e"))
    v = decide_verdict(res)
    assert v["verdict"] == V_HOLD and any("スプレッド" in m for m in v["missing"])
    assert any("コスト" in x or "スプレッド" in x for x in res["meta"]["limits"])


def test_一部ペアだけコスト未設定でも実行しない():
    cost = CostConfig(spread_pips={"USDJPY": 1.0, "EURUSD": 1.0}, slippage_pips=0.0, source="テスト用")
    fk = make_fake_stages()
    res = run_pipeline(tiny_raw15(), default_config().with_costs(cost), gate_sets=DUMMY_GATES, data_source="x", stages=fk)
    assert fk.calls == []
    assert any("GBPUSD" in x and "EURJPY" in x for x in res["meta"]["limits"])


def test_主ペアが無ければエラー記録して保留():
    raw = tiny_raw15(("EURUSD", "GBPUSD"))
    fk = make_fake_stages()
    res = run_pipeline(raw, real_cfg(), gate_sets=DUMMY_GATES, data_source="x", stages=fk)
    assert fk.calls == []
    assert any("USDJPY" in e for e in res["meta"]["errors"])
    assert decide_verdict(res)["verdict"] == V_HOLD


def test_データが空でも落ちない():
    res = run_pipeline({}, real_cfg(), gate_sets=DUMMY_GATES, data_source="", stages=make_fake_stages())
    assert decide_verdict(res)["verdict"] == V_HOLD


@pytest.mark.parametrize("where", ["stage_a", "stage_b", "stage_c", "stage_d", "stage_e"])
def test_段階でエラーが出てもレポートまで進み保留(where):
    fk = make_fake_stages(raise_in=where)
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="x", stages=fk)
    assert any(where.replace("stage_", "段階").upper() in e.upper() or "テスト用エラー" in e for e in res["meta"]["errors"])
    assert decide_verdict(res)["verdict"] == V_HOLD
    from report import build_report

    md = build_report(res)
    assert "実行エラー" in md and "【保留】" in md.splitlines()[0]


def test_build_allのエラーで以降を止める():
    fk = make_fake_stages(raise_in="build_all")
    res = run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="x", stages=fk)
    assert fk.calls == ["build_all"]
    assert res["meta"]["errors"]


def test_stagesに関数が足りなければ分かりやすいエラー():
    with pytest.raises(ImportError) as ei:
        run_pipeline(tiny_raw15(), real_cfg(), gate_sets=DUMMY_GATES, data_source="x", stages=SimpleNamespace(build_all=lambda *a: 1))
    assert "stage_a" in str(ei.value) and "INTERFACES" in str(ei.value)


def test_gates_meta():
    assert gates_meta(DUMMY_GATES)["phase0"] == {"n_rules": 1, "complete": True}
    g = {"phase0": GateSet("phase0", (GateRule("x", "pf", ">=", None),)), "promotion": GateSet("promotion", ())}
    gm = gates_meta(g)
    assert gm["phase0"] == {"n_rules": 1, "complete": False}
    assert gm["promotion"] == {"n_rules": 0, "complete": False}


# =============================================================================================
# 設定ファイル・データ読込
# =============================================================================================
def test_load_costs_json(tmp_path):
    p = tmp_path / "costs.json"
    p.write_text(json.dumps({"spread_pips": {"USDJPY": 0.5, "EURUSD": None}, "slippage_pips": 0.2, "source": "テスト用の出典"}),
                 encoding="utf-8")
    c = load_costs_json(str(p))
    assert c.spread_pips["USDJPY"] == 0.5 and c.spread_pips["EURUSD"] is None
    assert c.slippage_pips == 0.2 and c.source == "テスト用の出典" and c.is_test_value is False
    assert c.is_ready("USDJPY") and not c.is_ready("EURUSD")


def test_load_costs_jsonの未設定はNoneのまま(tmp_path):
    p = tmp_path / "costs.json"
    p.write_text(json.dumps({"spread_pips": {"USDJPY": None}, "slippage_pips": None}), encoding="utf-8")
    c = load_costs_json(str(p))
    assert not c.is_ready("USDJPY")


def test_load_gate_sets(tmp_path):
    assert load_gate_sets(None)["phase0"].rules == ()  # 未転記
    p0 = tmp_path / "p0.json"
    p0.write_text(json.dumps({"name": "phase0", "rules": [
        {"name": "テスト用ダミー", "metric": "pf", "op": ">=", "threshold": None, "scope": "train"}]}), encoding="utf-8")
    g = load_gate_sets([str(p0)])
    assert len(g["phase0"].rules) == 1 and g["promotion"].rules == ()
    assert gates_meta(g)["phase0"]["complete"] is False  # 閾値 null → 未転記
    with pytest.raises(ValueError):
        load_gate_sets(["a", "b", "c"])


def test_load_real_data_ファイル名規則とmissing(tmp_path):
    for p in ("USDJPY", "EURUSD"):
        df = generate_synthetic(p, years=0.03, seed=2).m15
        write_synthetic_csv(df, str(tmp_path / f"{p}_M15.csv"), p)
    out = load_real_data(str(tmp_path), ["USDJPY", "EURUSD", "GBPUSD"], file_pattern="{pair}_M15.csv")
    assert set(out["raw15"]) == {"USDJPY", "EURUSD"}
    assert out["missing"] == ["GBPUSD"]
    assert list(out["raw15"]["USDJPY"].columns) == ["time", "open", "high", "low", "close", "volume"]
    assert out["quality"]["USDJPY"]["n_bars"] == len(out["raw15"]["USDJPY"])


def test_load_real_data_15分足が無ければ1分足から作る(tmp_path):
    sp = generate_synthetic("USDJPY", years=0.03, seed=2, with_m1=True)
    write_synthetic_csv(sp.m1, str(tmp_path / "USDJPY_M1.csv"), "USDJPY")
    out = load_real_data(str(tmp_path), ["USDJPY"], file_pattern="{pair}_M15.csv", m1_pattern="{pair}_M1.csv")
    assert "USDJPY" in out["raw15"] and out["missing"] == []
    assert any("1分足" in n for n in out["notes"])
    t = pd.DatetimeIndex(out["raw15"]["USDJPY"]["time"])
    assert (t.minute % 15 == 0).all()


def test_load_real_data_MT4形式のヘッダなしCSV(tmp_path):
    df = generate_synthetic("USDJPY", years=0.02, seed=5).m15.head(50)
    lines = [f"{t:%Y.%m.%d},{t:%H:%M},{o},{h},{l},{c},{v}" for t, o, h, l, c, v in
             zip(df["time"], df["open"], df["high"], df["low"], df["close"], df["volume"])]
    (tmp_path / "USDJPY_M15.csv").write_text("\n".join(lines), encoding="utf-8")
    out = load_real_data(str(tmp_path), ["USDJPY"])
    got = out["raw15"]["USDJPY"]
    assert len(got) == 50
    assert np.allclose(got["close"].to_numpy(), df["close"].to_numpy())


# =============================================================================================
# CLI
# =============================================================================================
def test_CLI_合成データ_出力ファイルと保留(tmp_path, capsys):
    out = tmp_path / "out"
    code = main(["--synthetic", "--years", "0.05", "--seed", "1", "--n-runs", "3", "--out", str(out)], stages=make_fake_stages())
    assert code == 0
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "【保留】" in md.splitlines()[0]
    assert "動作確認用であり判定根拠ではない" in md
    d = json.loads((out / "result.json").read_text(encoding="utf-8"))
    assert d["meta"]["synthetic"] is True and d["meta"]["reproduce"]["seed"] == 1
    assert d["stage_c"]["n_trials"] == 5
    printed = capsys.readouterr().out
    assert "結論: 保留" in printed


def test_CLI_実データ_コスト無しなら保留レポートだけ出す(tmp_path, capsys):
    data = tmp_path / "data"
    data.mkdir()
    for p in ("USDJPY", "EURUSD", "GBPUSD", "EURJPY"):
        write_synthetic_csv(generate_synthetic(p, years=0.03, seed=2).m15, str(data / f"{p}_M15.csv"), p)
    fk = make_fake_stages()
    out = tmp_path / "out"
    code = main(["--data-dir", str(data), "--out", str(out)], stages=fk)
    assert code == 0 and fk.calls == []
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "【保留】" in md.splitlines()[0]
    assert "スプレッド" in md and "未転記" in md
    assert "動作確認用であり判定根拠ではない" not in md  # 合成扱いにはしない
    assert "実データ" in md


def test_CLI_実データ_コストとゲートあり_勝てる経路が配線される(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    for p in ("USDJPY", "EURUSD", "GBPUSD", "EURJPY"):
        write_synthetic_csv(generate_synthetic(p, years=0.03, seed=2).m15, str(data / f"{p}_M15.csv"), p)
    costs = tmp_path / "costs.json"
    costs.write_text(json.dumps({"spread_pips": {p: 1.0 for p in ("USDJPY", "EURUSD", "GBPUSD", "EURJPY")},
                                 "slippage_pips": 0.0, "source": "テスト用の仮値(実値ではない)"}), encoding="utf-8")
    g = tmp_path / "g.json"
    g.write_text(json.dumps({"name": "g", "rules": [{"name": "テスト用ダミー", "metric": "avg_r", "op": ">", "threshold": 0,
                                                    "scope": "all"}]}), encoding="utf-8")
    out = tmp_path / "out"
    code = main(["--data-dir", str(data), "--costs-json", str(costs), "--gates-json", str(g), str(g),
                 "--train-end", "2018-01-20", "--n-runs", "2", "--out", str(out)], stages=make_fake_stages())
    assert code == 0
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "【勝てる】" in md.splitlines()[0]  # ダミーゲート・fake stages による配線確認(実際の判定ではない)


def test_CLI_凍結記録が既定でoutに作られ_再実行で設定が変わると選び直しになる(tmp_path):
    out = tmp_path / "out"
    base = ["--synthetic", "--years", "0.05", "--seed", "1", "--n-runs", "2", "--out", str(out)]
    assert main(base, stages=make_fake_stages(chosen_tp1=0.5)) == 0
    assert (out / "freeze.json").exists()
    d1 = json.loads((out / "result.json").read_text(encoding="utf-8"))
    assert d1["meta"]["reselected"] is False and d1["meta"]["freeze"]["path"].endswith("freeze.json")
    assert main(base, stages=make_fake_stages(chosen_tp1=0.3)) == 0
    d2 = json.loads((out / "result.json").read_text(encoding="utf-8"))
    assert d2["meta"]["reselected"] is True
    assert "**あり" in (out / "report.md").read_text(encoding="utf-8")


def test_CLI_freeze_fileで保存先を指定できる(tmp_path):
    fz = tmp_path / "x" / "my_freeze.json"
    out = tmp_path / "out"
    main(["--synthetic", "--years", "0.05", "--n-runs", "2", "--out", str(out), "--freeze-file", str(fz)],
         stages=make_fake_stages())
    assert fz.exists() and not (out / "freeze.json").exists()


def test_CLI_壊れた凍結記録は黙って作り直さず終了コード2(tmp_path, capsys):
    out = tmp_path / "out"
    out.mkdir()
    (out / "freeze.json").write_text("{こわれた", encoding="utf-8")
    code = main(["--synthetic", "--years", "0.05", "--out", str(out)], stages=make_fake_stages())
    assert code == 2
    assert "凍結記録" in capsys.readouterr().err
    assert (out / "freeze.json").read_text(encoding="utf-8") == "{こわれた"  # 上書きしていない


def test_CLI_ファイルが無いペアはlimitsに出る(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    write_synthetic_csv(generate_synthetic("USDJPY", years=0.03, seed=2).m15, str(data / "USDJPY_M15.csv"), "USDJPY")
    out = tmp_path / "out"
    main(["--data-dir", str(data), "--out", str(out)], stages=make_fake_stages())
    d = json.loads((out / "result.json").read_text(encoding="utf-8"))
    assert any("EURUSD" in x and "GBPUSD" in x and "EURJPY" in x for x in d["meta"]["limits"])


def test_CLI_段階エラーなら終了コード1(tmp_path):
    out = tmp_path / "out"
    code = main(["--synthetic", "--years", "0.05", "--out", str(out)], stages=make_fake_stages(raise_in="stage_b"))
    assert code == 1
    assert "実行エラー" in (out / "report.md").read_text(encoding="utf-8")


def test_CLI_stagesが無ければ終了コード2(tmp_path, capsys):
    code = main(["--synthetic", "--years", "0.03", "--out", str(tmp_path / "o")], stages=SimpleNamespace())
    assert code == 2
    assert "stage_a" in capsys.readouterr().err


def test_CLI_引数の排他():
    with pytest.raises(SystemExit):
        main(["--synthetic", "--data-dir", "x"])
    with pytest.raises(SystemExit):
        main([])


# =============================================================================================
# 本物の stages との統合(stages.py が揃っていれば走る)
# =============================================================================================
def _real_stages():
    try:
        return run_all.load_stages(None)
    except ImportError:
        return None


@pytest.mark.skipif(_real_stages() is None, reason="stages.py(stages担当)がまだ揃っていない")
def test_統合_合成データで本物のstagesを通しで実行(tmp_path):
    out = tmp_path / "out"
    code = main(["--synthetic", "--years", "1.2", "--seed", "0", "--n-runs", "3", "--top-k", "3", "--out", str(out)])
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "【保留】" in md.splitlines()[0]
    assert "動作確認用であり判定根拠ではない" in md
    for i in range(1, 11):
        assert f"## {i}. " in md
    assert code == 0, md


# =============================================================================================
# README に書いた手順(テンプレート)が実際に読めて、未転記は保留になること
# =============================================================================================
_TPL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")


def test_テンプレートは読めて未転記のまま保留になる():
    g = load_gate_sets([os.path.join(_TPL, "phase0.template.json"), os.path.join(_TPL, "promotion.template.json")])
    gm = gates_meta(g)
    assert gm["phase0"] == {"n_rules": 1, "complete": False} and gm["promotion"] == {"n_rules": 1, "complete": False}
    c = load_costs_json(os.path.join(_TPL, "costs.template.json"))
    assert not any(c.is_ready(p) for p in ("USDJPY", "EURUSD", "GBPUSD", "EURJPY", "AUDUSD"))
    res = run_pipeline(tiny_raw15(), default_config().with_costs(c), gate_sets=g, data_source="テスト実データ",
                       stages=make_fake_stages())
    v = decide_verdict(res)
    assert v["verdict"] == V_HOLD
    assert any("ゲート" in m for m in v["missing"]) and any("スプレッド" in m for m in v["missing"])


def test_READMEにデータ形式と接続後の手順が書かれている():
    p = os.path.join(os.path.dirname(_TPL), "README.md")
    md = open(p, encoding="utf-8").read()
    for w in ("USDJPY_M15.csv", "time,open,high,low,close,volume", "--source-tz", "ny_close_server",
              "PHASE0_GATE", "--gates-json", "--costs-json", "slippage_pips", "--train-end", "core/gates.py"):
        assert w in md, w
