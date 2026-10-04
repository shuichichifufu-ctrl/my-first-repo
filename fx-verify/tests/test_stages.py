"""stages.py(段階A〜Eの入口・統合層)のテスト。

データは core.synthetic の合成データ(テスト専用)、コストは synthetic_test_config(テスト用・実値ではない)。
段階B〜Eの中身は tests/test_stage_bc.py / test_stage_de.py が確認しているので、ここでは
『つなぎ(build_all / make_split / stage_a / 再公開 / run_all との整合)』だけを確かめる。
"""
import os
import sys
from dataclasses import replace

import pandas as pd
import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)

import run_all  # noqa: E402
import stages  # noqa: E402
from core import schema  # noqa: E402
from core.config import SplitConfig, synthetic_test_config  # noqa: E402
from core.params import base_params  # noqa: E402
from core.synthetic import generate_synthetic  # noqa: E402

CFG = synthetic_test_config()  # テスト用・実値ではない


@pytest.fixture(scope="module")
def raw15():
    return {"USDJPY": generate_synthetic("USDJPY", start="2018-01-01", years=0.8, seed=3).m15}


@pytest.fixture(scope="module")
def datasets(raw15):
    return stages.build_all(raw15, CFG)


def test_run_allが要求する関数がすべて揃っている():
    mod = run_all.load_stages(None)
    for n in run_all.REQUIRED_STAGE_FUNCS:
        assert callable(getattr(mod, n))


def test_build_allは全ペアのデータセットを作る(raw15, datasets):
    assert set(datasets) == set(raw15)
    ds = datasets["USDJPY"]
    assert len(ds) > 0 and "close_time" in ds.columns and "ema320" in ds.columns


def test_make_splitは指定が無ければ月初に丸める(datasets):
    sp = stages.make_split(datasets["USDJPY"], CFG, train_frac=0.6)
    ct = pd.DatetimeIndex(datasets["USDJPY"]["close_time"])
    assert ct[0] < sp.train_end < ct[-1]
    assert sp.train_end.day == 1 and sp.train_end.hour == 0
    assert "学習用" in sp.note and "検証用" in sp.note


def test_make_splitはcfgのtrain_endを優先する(datasets):
    cfg = replace(CFG, split=SplitConfig(train_end="2018-04-01", note="テスト指定"))
    sp = stages.make_split(datasets["USDJPY"], cfg)
    assert sp.train_end == pd.Timestamp("2018-04-01")
    assert "テスト指定" in sp.note


def test_make_splitは範囲外のtrain_endを拒否する(datasets):
    cfg = replace(CFG, split=SplitConfig(train_end="2030-01-01"))
    with pytest.raises(ValueError):
        stages.make_split(datasets["USDJPY"], cfg)


def test_stage_aは基準設定を回しfunnelを返す(datasets):
    sp = stages.make_split(datasets["USDJPY"], CFG)
    sa = stages.stage_a(datasets, CFG, sp, pair="USDJPY")
    assert sa["pair"] == "USDJPY" and sa["params"] == base_params().to_dict()
    for k in ("all", "train", "oos"):
        assert "n_trades" in sa[k]["metrics"]
        schema.validate_funnel(sa[k]["funnel"])
    # 学習用と検証用の取引は重ならず、合計は全期間以下(train_end ちょうどの約定は両方から落ちる)
    assert sa["train"]["metrics"]["n_trades"] + sa["oos"]["metrics"]["n_trades"] <= sa["all"]["metrics"]["n_trades"] + 1
    assert sa["all"]["funnel"]["bars_total"] == len(datasets["USDJPY"])


def test_stage_aは主ペアが無ければエラー(datasets):
    sp = stages.make_split(datasets["USDJPY"], CFG)
    with pytest.raises(ValueError):
        stages.stage_a(datasets, CFG, sp, pair="EURUSD")


def test_再公開した関数は担当モジュールと同一():
    assert stages.stage_b is stages.stage_bc.stage_b
    assert stages.stage_c is stages.stage_bc.stage_c
    assert stages.select_axes is stages.stage_bc.select_axes
    assert stages.stage_d is stages.stage_de.stage_d
    assert stages.stage_e is stages.stage_de.stage_e


# ---- 軸が選べないとき(取引が少ない)のフォールバック ------------------------------------------
def test_軸が選べないときは基準設定を固定して段階D_Eへ進みエラーにしない(raw15):
    res = run_all.run_pipeline(
        raw15, CFG, synthetic=True, data_source="テスト(合成)", n_runs=2, top_k=3, gmt_shifts=(0,),
    )
    assert res["meta"]["errors"] == []
    assert res["meta"].get("stage_c_fallback") is True
    sc = res["stage_c"]
    assert sc["fallback"] is True and sc["chosen_params"] == base_params().to_dict()
    assert sc["results"] is None and "台地の中央を選ぶ手順は踏んでいない" in sc["selection_rule"]
    assert any("限定グリッド(段階C)は実施していない" in x for x in res["meta"]["limits"])
    assert res["stage_d"] is not None and res["stage_e"] is not None
