"""ea-lab ゲート判定の枠(基準値は placeholder)。

【絶対ルール】ここに基準値(PF等の閾値)を自作・推測して書かない。
ea-lab の DESIGN.md(Phase-0 優位性証明ゲート / 昇格ゲート)から『転記』する。
転記方法: (a) このファイルの PHASE0_GATE / PROMOTION_GATE の rules に GateRule を追加する、
          (b) JSON(例は下)を作って load_gate_set_json() で読む。
閾値が None のルール、またはルールが1つも無いゲートセットの判定は「保留」を返す(合格にも不合格にもしない)。

JSON の書式例(値はダミー。実値は ea-lab から転記):
  {"name": "phase0", "rules": [
     {"name": "<ea-lab上の項目名>", "metric": "pf", "op": ">=", "threshold": null,
      "scope": "train", "source": "ea-lab/DESIGN.md §?? から転記"}]}

metric は core/metrics.py の compute_metrics が返すキー(n_trades, pf, avg_r, max_dd_r, win_rate など)。
scope は適用範囲の目印: 'train' / 'oos' / 'pair' / 'gmt_shift' / 'all'。
"""
from __future__ import annotations

import json
import math
import operator
from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional

HOLD = "保留"
PASS = "合格"
FAIL = "不合格"

_OPS = {">=": operator.ge, ">": operator.gt, "<=": operator.le, "<": operator.lt, "==": operator.eq}
SCOPES = ("train", "oos", "pair", "gmt_shift", "all")


@dataclass(frozen=True)
class GateRule:
    name: str  # ea-lab 上での項目名
    metric: str  # compute_metrics のキー
    op: str  # '>=' '>' '<=' '<' '=='
    threshold: Optional[float] = None  # None = 未転記
    scope: str = "all"
    source: str = "未転記: ea-lab の DESIGN.md から転記すること"

    def __post_init__(self) -> None:
        if self.op not in _OPS:
            raise ValueError(f"op は {list(_OPS)} のどれか: {self.op!r}")
        if self.scope not in SCOPES:
            raise ValueError(f"scope は {SCOPES} のどれか: {self.scope!r}")


@dataclass(frozen=True)
class GateSet:
    name: str
    rules: tuple = ()
    source: str = "未転記: ea-lab の DESIGN.md から転記すること"

    def rules_for(self, scope: str) -> List[GateRule]:
        """scope に適用されるルール('all' のルールは常に含む)。"""
        return [r for r in self.rules if r.scope in (scope, "all")]


@dataclass
class RuleResult:
    rule: GateRule
    verdict: str  # 合格 / 不合格 / 保留
    value: Optional[float]
    reason: str


@dataclass
class GateResult:
    gate: str
    verdict: str
    results: List[RuleResult] = field(default_factory=list)
    complete: bool = False  # 全ルールが判定できたか(保留が1つも無いか)
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "gate": self.gate, "verdict": self.verdict, "complete": self.complete, "note": self.note,
            "rules": [
                {"name": r.rule.name, "metric": r.rule.metric, "op": r.rule.op,
                 "threshold": r.rule.threshold, "scope": r.rule.scope, "value": r.value,
                 "verdict": r.verdict, "reason": r.reason}
                for r in self.results
            ],
        }


# ---- placeholder(ea-lab から転記するまで空) ------------------------------------------
PHASE0_GATE = GateSet(name="phase0_edge_proof", rules=())  # TODO: ea-lab DESIGN.md「Phase-0 優位性証明ゲート」から転記
PROMOTION_GATE = GateSet(name="promotion", rules=())  # TODO: ea-lab DESIGN.md「昇格ゲート」から転記


def evaluate_rule(rule: GateRule, metrics: Mapping[str, Optional[float]]) -> RuleResult:
    if rule.threshold is None:
        return RuleResult(rule, HOLD, metrics.get(rule.metric), "閾値が未転記(ea-labから転記が必要)")
    if rule.metric not in metrics:
        return RuleResult(rule, HOLD, None, f"指標 {rule.metric} が metrics にない")
    v = metrics[rule.metric]
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return RuleResult(rule, HOLD, None, f"指標 {rule.metric} が算出不能(取引0件など)")
    ok = _OPS[rule.op](v, rule.threshold)
    return RuleResult(rule, PASS if ok else FAIL, float(v), f"{v:g} {rule.op} {rule.threshold:g} → {'成立' if ok else '不成立'}")


def evaluate_gate_set(gate: GateSet, metrics: Mapping[str, Optional[float]], scope: str = "all") -> GateResult:
    """ゲートセットを1区間(1つの metrics)に対して判定する。

    集約: 1つでも「不合格」→ 不合格 / 不合格なしで「保留」あり(または適用ルールが0件)→ 保留 / 全て合格 → 合格。
    scope='all' なら全ルール、それ以外ならその scope と 'all' のルールだけを使う。
    """
    rules = list(gate.rules) if scope == "all" else gate.rules_for(scope)
    if not rules:
        return GateResult(gate.name, HOLD, [], complete=False,
                          note="適用できるルールが無い(ea-lab のゲート基準が未転記)")
    results = [evaluate_rule(r, metrics) for r in rules]
    if any(r.verdict == FAIL for r in results):
        verdict = FAIL
    elif any(r.verdict == HOLD for r in results):
        verdict = HOLD
    else:
        verdict = PASS
    complete = all(r.verdict != HOLD for r in results)
    note = "" if complete else "未転記/算出不能のルールを含む"
    return GateResult(gate.name, verdict, results, complete, note)


def load_gate_set_json(path: str) -> GateSet:
    """ea-lab から転記した JSON を読む(書式はモジュール冒頭)。"""
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    rules = tuple(
        GateRule(
            name=r["name"], metric=r["metric"], op=r["op"], threshold=r.get("threshold"),
            scope=r.get("scope", "all"), source=r.get("source", ""),
        )
        for r in d.get("rules", [])
    )
    return GateSet(name=d.get("name", "gate"), rules=rules, source=d.get("source", ""))
