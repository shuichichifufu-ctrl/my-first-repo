"""report.py のテスト(判定規則・レポート構成・成績集計・感度分析表・通過数の表)。

【注意】このファイルの閾値(avg_r > 0 など)は、判定ロジックを試すための『テスト用ダミー・実値ではない』もの。
ea-lab の本当のゲート基準ではない。
"""
from __future__ import annotations

import copy
import json
import math

import numpy as np
import pandas as pd
import pytest

from core.gates import FAIL, HOLD, PASS, GateRule, GateSet
from core.params import base_params
from core.schema import TRADE_COLUMNS, funnel_keys
from report import (
    SYNTHETIC_BANNER,
    V_HOLD,
    V_LOSE,
    V_WIN,
    build_report,
    decide_verdict,
    evaluate_stage_c_train_gate,
    funnel_table,
    heatmap_table,
    performance_tables,
    sensitivity_table,
    summarize_performance,
    to_jsonable,
    write_report,
    write_result_json,
)

SECTION_TITLES = [
    "## 1. 結論",
    "## 2. ea-lab ゲートの項目ごとの合否",
    "## 3. 原典準拠の基準設定(段階A)の成績",
    "## 4. 選んだ設定とその選び方・試した設定の総数",
    "## 5. 主要な成績",
    "## 6. 感度分析の結果",
    "## 7. ベンチマーク(段階E)との比較",
    "## 8. 条件ごとの通過数",
    "## 9. 原典に無い補完をした部分と、それが結果に与えた影響",
    "## 10. 限界と未確認事項",
]

# ---- テスト用ダミーのゲート(実値ではない) ------------------------------------------------------
DUMMY_RULES = (
    GateRule("テスト用ダミー1", "n_trades", ">=", 1, scope="all", source="テスト用ダミー・実値ではない"),
    GateRule("テスト用ダミー2", "avg_r", ">", 0, scope="all", source="テスト用ダミー・実値ではない"),
)
DUMMY_GATES = {"phase0": GateSet("phase0", DUMMY_RULES), "promotion": GateSet("promotion", DUMMY_RULES)}


# ---- 結果(result)の組み立て ------------------------------------------------------------------
def _metrics(n=50, avg_r=0.2, pf=1.3, win=0.45):
    if avg_r is None:  # 取引0件など、算出不能の指標
        return {k: None for k in ("win_rate", "pf", "avg_r", "expectancy_r", "avg_win_r", "avg_loss_r", "partial_rate",
                                  "avg_cost_r", "gross_avg_r")} | {
            "n_trades": n, "n_long": 0, "n_short": 0, "total_r": 0.0, "max_dd_r": 0.0, "max_consec_losses": 0}
    return {
        "n_trades": n, "n_long": n // 2, "n_short": n - n // 2, "win_rate": win, "pf": pf, "avg_r": avg_r,
        "expectancy_r": avg_r, "total_r": avg_r * n, "avg_win_r": 1.0, "avg_loss_r": -0.7, "max_dd_r": 4.0,
        "max_consec_losses": 5, "partial_rate": 0.5, "avg_cost_r": 0.05, "gross_avg_r": avg_r + 0.05,
    }


def _gate_dict(gates, metrics, scope):
    from core.gates import evaluate_gate_set

    return {n: evaluate_gate_set(g, metrics, scope=scope).to_dict() for n, g in gates.items()}


def _seg(pair, period, scope, gmt=0.0, gates=DUMMY_GATES, **mk):
    m = _metrics(**mk)
    return {
        "pair": pair, "period": period, "gmt_shift": gmt, "scope": scope, "metrics": m,
        "breakdown_year": {2020: m, 2021: m}, "breakdown_side": {"long": m, "short": m},
        "gates": _gate_dict(gates, m, scope),
    }


def _funnel():
    f = {k: 0 for k in funnel_keys()}
    f["bars_total"] = 1000
    for s, base in (("long", 1.0), ("short", 0.8)):
        for i, k in enumerate(["bars_ready", "h1_cross", "d1", "h4", "po"]):
            f[f"{s}.{k}"] = int(900 * base / (i + 1))
        for i, k in enumerate(["setup_po", "setup_break", "setup_pullback", "setup_line", "setup_line_break", "setup_filters", "setup_filled"]):
            f[f"{s}.{k}"] = max(0, int(40 * base) - 5 * i)
        f[f"{s}.cancel_po_lost"] = f[f"{s}.setup_po"] - f[f"{s}.setup_filled"]
    return f


def make_result(*, synthetic=False, gates=DUMMY_GATES, **over):
    """すべてそろった『実データ・ゲート転記済み・全区間合格』の result。上書きして各ケースを作る。"""
    m = _metrics()
    segs = [
        _seg("USDJPY", "train", "train", gates=gates),
        _seg("USDJPY", "oos", "oos", gates=gates),
        _seg("EURUSD", "all", "pair", gates=gates),
        _seg("GBPUSD", "all", "pair", gates=gates),
        _seg("EURJPY", "all", "pair", gates=gates),
        _seg("USDJPY", "oos", "gmt_shift", gmt=-1.0, gates=gates),
        _seg("USDJPY", "oos", "gmt_shift", gmt=1.0, gates=gates),
    ]
    sb = pd.DataFrame(
        [
            ["h1_cross_window", 12, False, "k1", 20, 0.4, 1.1, 0.05, 1.0, 3.0],
            ["h1_cross_window", 48, True, "k2", 30, 0.45, 1.3, 0.20, 6.0, 4.0],
            ["h1_cross_window", None, False, "k3", 40, 0.5, 1.5, 0.30, 12.0, 5.0],
            ["trail_mode", "m15_swing", True, "k2", 30, 0.45, 1.3, 0.20, 6.0, 4.0],
            ["trail_mode", "ema20_close", False, "k4", 31, 0.44, 1.2, 0.15, 4.6, 4.0],
        ],
        columns=["param", "value", "is_base", "params_key", "n_trades", "win_rate", "pf", "avg_r", "total_r", "max_dd_r"],
    )
    sb.attrs["n_trials"] = 5
    sc_res = pd.DataFrame(
        [[48, "A", 30, 0.45, 1.3, 0.2, 6.0, 4.0, True], [96, "B", 25, 0.41, 1.1, 0.1, 2.5, 5.0, False],
         [48, "B", 22, 0.4, 1.0, 0.0, 0.0, 5.0, False], [96, "A", 28, 0.5, 1.6, 0.3, 8.4, 3.0, False]],
        columns=["h1_cross_window", "d1_mode", "n_trades", "win_rate", "pf", "avg_r", "total_r", "max_dd_r", "is_chosen"],
    )
    sc = {
        "results": sc_res, "n_trials": 9, "axes": {"h1_cross_window": [48, 96], "d1_mode": ["A", "B"]},
        "chosen_params": base_params().to_dict(), "selection_rule": "近傍平均の平均Rが最大の点(台地の中央)",
    }
    res = {
        "meta": {
            "synthetic": synthetic, "data_source": "合成" if synthetic else "実データ data/", "pairs": ["USDJPY", "EURUSD", "GBPUSD", "EURJPY"],
            "periods": {"USDJPY": ("2018-01-01", "2021-12-31")},
            "split": {"train_end": "2020-06-30", "note": "テスト"},
            "costs": {"source": "テスト用", "is_test_value": synthetic, "ready": True},
            "gates": {n: {"n_rules": len(g.rules), "complete": bool(g.rules) and all(r.threshold is not None for r in g.rules)} for n, g in gates.items()},
            "reselected": False, "gmt_shifts": [-1, 0, 1], "notes": ["補完メモ: テスト"], "limits": ["限界メモ: テスト"],
        },
        "stage_a": {
            "params": base_params().to_dict(), "pair": "USDJPY",
            "all": {"metrics": m, "breakdown_year": {2020: m}, "breakdown_side": {"long": m, "short": m}, "funnel": _funnel()},
            "train": {"metrics": m}, "oos": {"metrics": m},
        },
        "stage_b": sb,
        "stage_c": sc,
        "stage_c_gate": {"n_evaluated": 4, "n_pass": 4, "n_fail": 0, "n_hold": 0, "gate_sets_used": ["phase0", "promotion"]},
        "stage_d": {"segments": segs, "chosen_params": base_params().to_dict(), "missing_required_pairs": [], "reselected": False,
                    "gmt_shifts": [-1, 0, 1]},
        "stage_e": {
            "segments": [{"pair": "USDJPY", "period": "oos", "scope": "oos", "real": m,
                          "random": {"avg_r": {"mean": 0.0, "p05": -0.1, "p50": 0.0, "p95": 0.1}, "pf": {"p50": 1.0}, "win_rate": {}, "n_runs": 100},
                          "real_avg_r_percentile": 0.99}],
            "n_runs": 100, "seed": 0,
        },
    }
    res.update(over)
    return res


# =============================================================================================
# 判定規則
# =============================================================================================
def test_全部そろって合格なら勝てる():
    v = decide_verdict(make_result())
    assert v["verdict"] == V_WIN, v
    assert v["missing"] == []


def test_合成データは全部合格でも必ず保留():
    r = make_result(synthetic=True)
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD
    assert any("合成データ" in m for m in v["missing"])
    assert "判定できない" in v["primary_reason"] or "判定根拠" in v["primary_reason"]


def test_ゲート未転記なら保留で不足物にゲートが出る():
    empty = {"phase0": GateSet("phase0", ()), "promotion": GateSet("promotion", ())}
    r = make_result(gates=empty)  # 区間のゲート結果も「保留」になる
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD
    assert sum("ゲート「" in m and "未転記" in m for m in v["missing"]) == 2


def test_閾値None混じりのゲートも保留():
    rules = DUMMY_RULES + (GateRule("未転記ルール", "pf", ">=", None),)
    g = {"phase0": GateSet("phase0", rules), "promotion": GateSet("promotion", DUMMY_RULES)}
    v = decide_verdict(make_result(gates=g))
    assert v["verdict"] == V_HOLD
    assert any("phase0" in m and "閾値が未転記" in m for m in v["missing"])


def test_メタにゲート情報が無ければ保留():
    r = make_result()
    r["meta"].pop("gates")
    assert decide_verdict(r)["verdict"] == V_HOLD


def test_コスト未設定なら保留():
    r = make_result()
    r["meta"]["costs"] = {"source": "未設定", "is_test_value": False, "ready": False}
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("スプレッド" in m for m in v["missing"])


def test_実データでコストがテスト値なら保留():
    r = make_result()
    r["meta"]["costs"] = {"source": "テスト", "is_test_value": True, "ready": True}
    assert decide_verdict(r)["verdict"] == V_HOLD


def test_実データ未接続なら保留():
    r = make_result()
    r["meta"]["data_source"] = ""
    r["meta"]["pairs"] = []
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("実FXデータ" in m for m in v["missing"])


def test_選び直しがあれば保留():
    r = make_result()
    r["stage_d"]["reselected"] = True
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("選び直" in m for m in v["missing"])
    r2 = make_result()
    r2["meta"]["reselected"] = True
    assert decide_verdict(r2)["verdict"] == V_HOLD


def test_OOS区間が無ければ保留():
    r = make_result()
    r["stage_d"]["segments"] = [s for s in r["stage_d"]["segments"] if s["scope"] != "oos"]
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("アウトオブサンプル" in m for m in v["missing"])


def test_必要ペア欠けなら保留():
    r = make_result()
    r["stage_d"]["segments"] = [s for s in r["stage_d"]["segments"] if s["pair"] != "GBPUSD"]
    r["stage_d"].pop("missing_required_pairs")
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("GBPUSD" in m for m in v["missing"])
    r2 = make_result()
    r2["stage_d"]["missing_required_pairs"] = ["EURJPY"]
    assert decide_verdict(r2)["verdict"] == V_HOLD


def test_GMTずらし区間が無ければ保留():
    r = make_result()
    r["stage_d"]["segments"] = [s for s in r["stage_d"]["segments"] if s["scope"] != "gmt_shift"]
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("GMT" in m for m in v["missing"])


def test_段階Dが無く段階Cで通る設定があるなら保留():
    r = make_result(stage_d=None)
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("段階D" in m for m in v["missing"])


def test_段階Dに不合格の区間があれば勝てない():
    bad = copy.deepcopy(DUMMY_GATES)
    r = make_result()
    r["stage_d"]["segments"][3] = _seg("GBPUSD", "all", "pair", avg_r=-0.3)  # avg_r > 0 が不成立
    v = decide_verdict(r)
    assert v["verdict"] == V_LOSE, v
    assert any("GBPUSD" in x for x in v["fail_reasons"])
    assert "不合格" in v["primary_reason"]


def test_検証用だけ不合格でも勝てない():
    r = make_result()
    r["stage_d"]["segments"][1] = _seg("USDJPY", "oos", "oos", avg_r=-0.05)
    assert decide_verdict(r)["verdict"] == V_LOSE


def test_合格に保留が混じるなら保留():
    avg_only = {n: GateSet(n, (DUMMY_RULES[1],)) for n in ("phase0", "promotion")}  # avg_r > 0 だけ
    r = make_result(gates=avg_only)
    r["stage_d"]["segments"][2] = _seg("EURUSD", "all", "pair", gates=avg_only, n=5, avg_r=None)  # 指標算出不能 → 保留
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD


def test_適用ルールが無いゲートは区間判定で無視する():
    only_train = {
        "phase0": GateSet("phase0", (GateRule("train用", "n_trades", ">=", 1, scope="train"),)),
        "promotion": GateSet("promotion", (GateRule("oos等用", "avg_r", ">", 0, scope="all"),)),
    }
    r = make_result(gates=only_train)
    # oos の区間では phase0 に適用ルールが無い(保留・rules空)が、promotion が合格なら区間は合格
    assert decide_verdict(r)["verdict"] == V_WIN


def test_学習用ゲートを満たす設定が無ければ段階Dなしで勝てない():
    r = make_result(
        stage_d=None, stage_e=None,
        stage_c_gate={"n_evaluated": 6, "n_pass": 0, "n_fail": 6, "n_hold": 0, "gate_sets_used": ["phase0"]},
    )
    v = decide_verdict(r)
    assert v["verdict"] == V_LOSE and "学習用" in v["primary_reason"]


def test_学習用ゲートが判定不能の設定が残るなら保留():
    r = make_result(
        stage_d=None,
        stage_c_gate={"n_evaluated": 6, "n_pass": 0, "n_fail": 4, "n_hold": 2, "gate_sets_used": ["phase0"]},
    )
    assert decide_verdict(r)["verdict"] == V_HOLD


def test_学習用ゲートの判定が渡されていなければ保留():
    r = make_result()
    r.pop("stage_c_gate")
    assert decide_verdict(r)["verdict"] == V_HOLD


def test_gate_setsから学習用ゲートを自動判定():
    r = make_result()
    r.pop("stage_c_gate")
    r["gate_sets"] = DUMMY_GATES
    assert decide_verdict(r)["verdict"] == V_WIN


def test_段階Cが未実施なら保留():
    r = make_result(stage_c=None, stage_c_gate=None)
    assert decide_verdict(r)["verdict"] == V_HOLD


def test_追加フィルターD10入りの設定は保留():
    r = make_result()
    p = base_params().replace(d10_max_spread_pips=2.0).to_dict()
    r["stage_c"]["chosen_params"] = p
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("D10" in m for m in v["missing"])


def test_実行エラーがあれば保留():
    r = make_result()
    r["meta"]["errors"] = ["段階B: ValueError: テスト"]
    v = decide_verdict(r)
    assert v["verdict"] == V_HOLD and any("実行エラー" in m for m in v["missing"])


def test_空のresultでも落ちずに保留():
    v = decide_verdict({})
    assert v["verdict"] == V_HOLD and v["missing"]
    assert build_report({}).startswith("# ")


# =============================================================================================
# 学習用ゲート判定(段階C)
# =============================================================================================
def test_evaluate_stage_c_train_gate():
    sc = {"results": pd.DataFrame({"n_trades": [10, 10, 5], "avg_r": [0.1, -0.1, np.nan], "pf": [1.2, 0.8, np.nan]})}
    out = evaluate_stage_c_train_gate(sc, DUMMY_GATES)
    assert out["n_evaluated"] == 3
    assert out["n_pass"] == 1 and out["n_fail"] == 1 and out["n_hold"] == 1


def test_evaluate_stage_c_train_gate_未転記は全部保留():
    sc = {"results": pd.DataFrame({"n_trades": [10], "avg_r": [0.5]})}
    out = evaluate_stage_c_train_gate(sc, {"phase0": GateSet("phase0", ()), "promotion": GateSet("promotion", ())})
    assert out["n_pass"] == 0 and out["n_hold"] == 1


def test_evaluate_stage_c_train_gate_指標が行に無ければ保留():
    rules = (GateRule("連敗", "max_consec_losses", "<=", 3, scope="train"),)
    sc = {"results": pd.DataFrame({"n_trades": [10], "avg_r": [0.5]})}
    out = evaluate_stage_c_train_gate(sc, {"phase0": GateSet("phase0", rules)})
    assert out["n_hold"] == 1 and out["n_pass"] == 0


# =============================================================================================
# レポートの構成
# =============================================================================================
def _heading_positions(md):
    pos = []
    for t in SECTION_TITLES:
        i = md.find(t)
        assert i >= 0, f"見出しが無い: {t}"
        pos.append(i)
    return pos


def test_レポートは10項構成で結論が最初():
    md = build_report(make_result())
    pos = _heading_positions(md)
    assert pos == sorted(pos)
    first_line = md.splitlines()[0]
    assert "【勝てる】" in first_line
    # 結論の節に、一番の理由が入っている
    sec1 = md[pos[0]:pos[1]]
    assert "一番の理由" in sec1 and "【勝てる】" in sec1


def test_各段階が未実施でも10項構成で表示される():
    md = build_report({"meta": {"synthetic": False}})
    _heading_positions(md)
    assert "【保留】" in md.splitlines()[0]
    assert md.count("未実施") >= 5


def test_合成データは冒頭に大きな警告と保留と各表に注記():
    md = build_report(make_result(synthetic=True))
    head = md[:600]
    assert "【合成データ】動作確認用であり判定根拠ではない" in head
    assert "【保留】" in md.splitlines()[0]
    assert md.count("(合成データ・テスト用)") >= 6
    assert SYNTHETIC_BANNER.splitlines()[0] in md


def test_実データなら合成の警告は出ない():
    md = build_report(make_result())
    assert "動作確認用であり判定根拠ではない" not in md
    assert "(合成データ・テスト用)" not in md


def test_ゲート未転記なら閾値を作らず未転記と表示():
    rules = (GateRule("ea-lab項目", "pf", ">=", None),)
    g = {"phase0": GateSet("phase0", rules), "promotion": GateSet("promotion", ())}
    r = make_result(gates=g)
    md = build_report(r)
    assert "未転記" in md
    assert "pf >= 未転記" in md
    assert "【保留】" in md.splitlines()[0]


def test_閾値は転記された値をそのまま表示():
    md = build_report(make_result())
    assert "avg_r > 0 |" in md and "n_trades >= 1 |" in md


def test_不足しているものが結論に列挙される():
    r = make_result()
    r["meta"]["costs"]["ready"] = False
    md = build_report(r)
    sec1 = md[md.find("## 1. 結論"):md.find("## 2.")]
    assert "不足しているもの" in sec1 and "スプレッド" in sec1


def test_第5章の項目が出る_年別ペア別売買別():
    md = build_report(make_result())
    sec5 = md[md.find("## 5."):md.find("## 6.")]
    for w in ("取引回数", "勝率", "PF", "平均R", "期待値R", "最大DD", "年別", "通貨ペア別", "買い・売り別", "2020", "EURJPY", "追加フィルター(D10)"):
        assert w in sec5, w


def test_D10は別節で原典準拠と混ぜない():
    r = make_result(extra_filter_results=[{"label": "時間帯フィルター込み", "metrics": _metrics(avg_r=0.9)}])
    md = build_report(r)
    sec5 = md[md.find("## 5."):md.find("## 6.")]
    i = sec5.find("5-3.")
    assert i > 0 and "時間帯フィルター込み" in sec5[i:]
    assert "時間帯フィルター込み" not in sec5[:i]


def test_第4章に試行総数と選び方():
    md = build_report(make_result())
    sec4 = md[md.find("## 4."):md.find("## 5.")]
    assert "試した設定の総数" in sec4 and "9 件" in sec4
    assert "台地の中央" in sec4
    assert "選び直しの有無" in sec4


def test_第6章に感度分析表とヒートマップ():
    md = build_report(make_result())
    sec6 = md[md.find("## 6."):md.find("## 7.")]
    assert "h1_cross_window" in sec6 and "★" in sec6 and "なし(None)" in sec6
    assert "h1_cross_window \\ d1_mode" in sec6


def test_第7章にベンチマーク表():
    md = build_report(make_result())
    sec7 = md[md.find("## 7."):md.find("## 8.")]
    assert "ランダム95%点" in sec7 and "99%" in sec7 and "基準は、このレポートでは決めていない" in sec7


def test_ベンチマークに劣後するなら参考注記が出るが判定は変えない():
    r = make_result()
    r["stage_e"]["segments"][0]["real_avg_r_percentile"] = 0.40
    assert decide_verdict(r)["verdict"] == V_WIN
    assert "半数以上が、実戦略以上の平均R" in build_report(r)


def test_第8章に通過数と最も減る段階():
    md = build_report(make_result())
    sec8 = md[md.find("## 8."):md.find("## 9.")]
    assert "D1: 1時間足クロス" in sec8 and "最も減る段階" in sec8 and "約定(= 取引数)" in sec8


def test_第9章にD9補完と影響表():
    md = build_report(make_result())
    sec9 = md[md.find("## 9."):md.find("## 10.")]
    assert "D9の残り半分の決済は原典に記載がない補完" in sec9
    assert "trail_mode" in sec9 and "h1_cross_window" not in sec9
    assert "補完メモ: テスト" in sec9


def test_第10章に限界と追加検証():
    md = build_report(make_result())
    sec10 = md[md.find("## 10."):]
    assert "ea-lab リポジトリと実FXデータは、この検証環境には無かった" in sec10
    assert "追加で検証するなら" in sec10 and "限界メモ: テスト" in sec10


def test_PFがinfやNoneの表示():
    m = _metrics(pf=math.inf)
    r = make_result()
    r["stage_a"]["all"]["metrics"] = m
    md = build_report(r)
    assert "∞" in md
    m2 = _metrics(pf=None)
    r["stage_a"]["all"]["metrics"] = m2
    assert "算出不能" in build_report(r)


def test_write_reportとwrite_result_json(tmp_path):
    r = make_result()
    r["gate_sets"] = DUMMY_GATES
    p = tmp_path / "sub" / "report.md"
    write_report(r, str(p))
    assert p.read_text(encoding="utf-8").startswith("# ")
    j = tmp_path / "sub" / "result.json"
    write_result_json(r, str(j))
    d = json.loads(j.read_text(encoding="utf-8"))
    assert d["meta"]["gates"]["phase0"]["complete"] is True
    assert "gate_sets" not in d
    assert isinstance(d["stage_b"], list) and d["stage_b"][0]["param"] == "h1_cross_window"


# =============================================================================================
# 成績集計
# =============================================================================================
def _trades():
    t0 = pd.Timestamp("2020-01-06 10:00")
    rows = []
    # (pair, side, entry, pnl_r)
    spec = [
        ("USDJPY", "long", "2020-01-06 10:00", 2.0),
        ("USDJPY", "short", "2020-02-06 10:00", -1.0),
        ("EURUSD", "long", "2021-03-08 10:00", -1.0),
        ("EURUSD", "short", "2021-04-08 10:00", 1.0),
        ("USDJPY", "long", "2021-05-10 10:00", -1.0),
    ]
    for i, (pair, side, et, pnl) in enumerate(spec):
        e = pd.Timestamp(et)
        rows.append({
            "trade_id": i, "pair": pair, "side": side, "signal_time": e - pd.Timedelta(minutes=15), "entry_time": e,
            "exit_time": e + pd.Timedelta(hours=2), "entry": 100.0, "sl": 99.0, "tp1": 101.0, "risk": 1.0, "atr15": 0.3,
            "h0": 101.0, "pb_extreme": 99.1, "partial": pnl > 0, "tp1_time": pd.NaT, "exit_price": 100.0,
            "exit_reason": "sl", "r_multiple": pnl + 0.1, "cost_r": 0.1, "pnl_r": pnl, "bars_held": 8,
        })
    df = pd.DataFrame(rows)
    assert list(df.columns) == TRADE_COLUMNS
    return df


def test_summarize_performance_手計算と一致():
    s = summarize_performance(_trades())
    o = s["overall"]
    assert o["n_trades"] == 5
    assert o["win_rate"] == pytest.approx(2 / 5)
    assert o["pf"] == pytest.approx(3.0 / 3.0)  # 勝ち 2+1=3 / 負け 1+1+1=3
    assert o["avg_r"] == pytest.approx(0.0) and o["expectancy_r"] == pytest.approx(0.0)
    # 累積: 2, 1, 0, 1, 0 → ピーク2から0まで下落 = 2
    assert o["max_dd_r"] == pytest.approx(2.0)
    assert set(s["by_year"]) == {2020, 2021}
    assert s["by_year"][2020]["n_trades"] == 2 and s["by_year"][2020]["avg_r"] == pytest.approx(0.5)
    assert s["by_year"][2021]["avg_r"] == pytest.approx(-1 / 3)
    assert set(s["by_pair"]) == {"EURUSD", "USDJPY"}
    assert s["by_pair"]["USDJPY"]["n_trades"] == 3 and s["by_pair"]["USDJPY"]["total_r"] == pytest.approx(0.0)
    assert s["by_side"]["long"]["n_trades"] == 3 and s["by_side"]["short"]["n_trades"] == 2
    assert s["by_side"]["short"]["win_rate"] == pytest.approx(0.5)


def test_summarize_performance_取引0件でも落ちない():
    s = summarize_performance(_trades().iloc[0:0])
    assert s["overall"]["n_trades"] == 0 and s["overall"]["pf"] is None
    assert s["by_year"] == {} and s["by_pair"] == {}
    md = performance_tables(_trades().iloc[0:0])
    assert "算出不能" in md


def test_performance_tables_に全項目():
    md = performance_tables(_trades())
    for w in ("取引回数", "勝率", "PF", "平均R", "期待値R", "最大DD(R)", "年別", "通貨ペア別", "買い・売り別", "40.0%", "2020", "EURUSD", "買い", "売り"):
        assert w in md, w


# =============================================================================================
# 感度分析表・通過数・ヒートマップ・JSON
# =============================================================================================
def test_sensitivity_table():
    md = sensitivity_table(make_result()["stage_b"])
    assert "項目ごとの効き" in md
    # 幅の大きい順: h1_cross_window(0.30-0.05=0.25) が trail_mode(0.05) より先
    assert md.index("| h1_cross_window |") < md.index("| trail_mode |")
    assert md.count("★") == 2
    assert "0.250" in md
    assert "(感度分析の結果が空です)" == sensitivity_table(pd.DataFrame())


def test_funnel_table():
    f = _funnel()
    md = funnel_table(f)
    assert "買い: 足ごとの条件" in md and "売り: 局面ごとの到達数" in md and "局面の終わり方" in md
    assert "1000" in md
    md_long = funnel_table(f, side="long")
    assert "売り" not in md_long
    assert funnel_table({}) == "(通過数のデータがありません)"


def test_funnel_table_ゼロ除算しない():
    f = {k: 0 for k in funnel_keys()}
    md = funnel_table(f)
    assert "—" in md


def test_heatmap_table():
    sc = make_result()["stage_c"]
    md = heatmap_table(sc["results"], sc["axes"])
    assert md and "h1_cross_window \\ d1_mode" in md
    assert heatmap_table(sc["results"], {"h1_cross_window": [48]}) is None


def test_to_jsonable():
    obj = {
        "inf": math.inf, "nan": float("nan"), "np": np.int64(3), "ts": pd.Timestamp("2020-01-01"), "nat": pd.NaT,
        "params": base_params(), "df": pd.DataFrame({"a": [1, np.nan]}), "tuple": (1, 2), "k": {1: np.float64(0.5)},
    }
    s = json.dumps(to_jsonable(obj), ensure_ascii=False)
    d = json.loads(s)
    assert d["inf"] == "inf" and d["nan"] is None and d["np"] == 3
    assert d["ts"].startswith("2020-01-01") and d["nat"] is None
    assert d["params"]["h1_cross_window"] == 48
    assert d["df"] == [{"a": 1.0}, {"a": None}]
    assert d["tuple"] == [1, 2] and d["k"] == {"1": 0.5}
