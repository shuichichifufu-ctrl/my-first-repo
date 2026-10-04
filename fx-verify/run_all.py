"""段階A→Eを通しで実行して、判定レポート(report.md)と再現用の result.json を出す CLI。

使い方:
    python run_all.py --synthetic [--years 3] [--seed 0] [--out out/]
        合成データ(乱数)+テスト用コストで動作確認。結果は必ず『保留』。判定根拠にならない。

    python run_all.py --data-dir data --pairs USDJPY EURUSD GBPUSD EURJPY \\
        --file-pattern "{pair}_M15.csv" --source-tz ny_close_server \\
        --costs-json costs.json --gates-json phase0.json promotion.json --train-end 2022-12-31 --out out/
        実データ。ゲート基準値(--gates-json)・コスト(--costs-json)が未設定なら、判定は『保留』で不足物を明記する。

実データの形式・接続後の手順は README.md を参照。

【設計】
- 段階の実装は `stages` モジュール(INTERFACES §6)の関数だけに依存する。`run_pipeline(..., stages=...)` で差し替え可能。
- ゲート基準値・スプレッド・スリッページは、ここでは作らない。無ければ「未設定」のまま進め、レポートは「保留」になる。
- 実データでコストが未設定のときは、重い計算をせずに「保留(コスト未設定)」のレポートだけ出して終了する。
- 段階の途中でエラーが出ても、そこまでの結果とエラー内容をレポートに載せる(判定は保留)。終了コードは 1。
"""
from __future__ import annotations

import argparse
import inspect
import json
import os
import sys
import traceback
import warnings
from dataclasses import replace
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from core.config import (  # noqa: E402
    Config,
    CostConfig,
    NotConfiguredError,
    SplitConfig,
    default_config,
    synthetic_test_config,
)
from core.data import load_ohlc_csv, resample_to_base, validate_ohlc  # noqa: E402
from core.gates import PHASE0_GATE, PROMOTION_GATE, GateSet, load_gate_set_json  # noqa: E402
from core.params import Params, base_params  # noqa: E402
from report import (  # noqa: E402
    decide_verdict,
    evaluate_stage_c_train_gate,
    write_report,
    write_result_json,
)

DEFAULT_PAIRS = ("USDJPY", "EURUSD", "GBPUSD", "EURJPY")
DEFAULT_MAIN_PAIR = "USDJPY"
GATE_KEYS = ("phase0", "promotion")
REQUIRED_STAGE_FUNCS = ("build_all", "make_split", "stage_a", "stage_b", "select_axes", "stage_c", "stage_d", "stage_e")


# =============================================================================================
# 設定ファイルの読込
# =============================================================================================
def load_costs_json(path: str) -> CostConfig:
    """ea-lab から転記したコスト設定(JSON)を読む。

    書式: {"spread_pips": {"USDJPY": <数値>, ...}, "slippage_pips": <数値>, "source": "ea-lab/...から転記"}
    値が null のものは『未設定』として扱う(黙って0にしない)。
    """
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    spreads = {str(k): (None if v is None else float(v)) for k, v in (d.get("spread_pips") or {}).items()}
    slip = d.get("slippage_pips")
    src = d.get("source") or f"{os.path.basename(path)}(出典の記入なし)"
    return CostConfig(
        spread_pips=spreads, slippage_pips=None if slip is None else float(slip), source=str(src),
        is_test_value=bool(d.get("is_test_value", False)),
    )


def load_gate_sets(paths: Optional[Sequence[str]]) -> Dict[str, GateSet]:
    """--gates-json の読込。1つ目 = phase0、2つ目 = promotion。指定が無ければ core/gates.py の値(未転記なら空)。"""
    gates = {"phase0": PHASE0_GATE, "promotion": PROMOTION_GATE}
    if paths:
        if len(paths) > len(GATE_KEYS):
            raise ValueError("--gates-json は最大2つ(phase0 promotion の順)")
        for key, p in zip(GATE_KEYS, paths):
            gates[key] = load_gate_set_json(p)
    return gates


def gates_meta(gate_sets: Mapping[str, GateSet]) -> Dict[str, Dict[str, Any]]:
    """meta.gates 用。complete = ルールが1つ以上あり、全ルールに閾値が入っている。"""
    return {
        name: {
            "n_rules": len(g.rules),
            "complete": bool(g.rules) and all(r.threshold is not None for r in g.rules),
        }
        for name, g in gate_sets.items()
    }


# =============================================================================================
# データ読込
# =============================================================================================
def load_real_data(
    data_dir: str,
    pairs: Sequence[str],
    *,
    file_pattern: str = "{pair}_M15.csv",
    m1_pattern: Optional[str] = None,
    source_tz: str = "utc",
    source_offset: float = 0.0,
) -> Dict[str, Any]:
    """実データCSVを通貨ペアごとに読む。戻り値: {"raw15": {pair: df}, "missing": [pair], "quality": {pair: dict}, "notes": [str]}

    ファイルが無いペアは missing に入れて続行(止めない)。15分足が無く1分足(m1_pattern)があれば、15分足にまとめる。
    """
    raw15: Dict[str, pd.DataFrame] = {}
    missing: List[str] = []
    quality: Dict[str, Dict[str, Any]] = {}
    notes: List[str] = []
    kw = {"source_tz": source_tz, "source_fixed_offset_hours": source_offset}
    for pair in pairs:
        p15 = os.path.join(data_dir, file_pattern.format(pair=pair))
        p1 = os.path.join(data_dir, m1_pattern.format(pair=pair)) if m1_pattern else None
        if os.path.exists(p15):
            df = load_ohlc_csv(p15, **kw)
        elif p1 and os.path.exists(p1):
            df = resample_to_base(load_ohlc_csv(p1, **kw), 15)
            notes.append(f"{pair}: 15分足ファイルが無いため1分足({os.path.basename(p1)})から15分足を作った")
        else:
            missing.append(pair)
            continue
        raw15[pair] = df
        quality[pair] = validate_ohlc(df, 15)
    return {"raw15": raw15, "missing": missing, "quality": quality, "notes": notes}


def load_synthetic_data(years: float, seed: int, pairs: Sequence[str] = DEFAULT_PAIRS) -> Dict[str, pd.DataFrame]:
    """合成データ(テスト専用)。実際の為替データではない。"""
    from core.synthetic import generate_universe

    uni = generate_universe(tuple(pairs), start="2018-01-01", years=years, seed=seed)
    return {p: sp.m15 for p, sp in uni.items()}


# =============================================================================================
# パイプライン
# =============================================================================================
def load_stages(stages: Any = None) -> Any:
    """段階モジュール(INTERFACES §6 の関数群)。足りない関数があれば、何が無いかを書いて ImportError。"""
    mod = stages
    if mod is None:
        import importlib

        mod = importlib.import_module("stages")
    absent = [n for n in REQUIRED_STAGE_FUNCS if not callable(getattr(mod, n, None))]
    if absent:
        raise ImportError(
            "stages モジュールに次の関数がありません: " + ", ".join(absent)
            + "。INTERFACES.md §6 の stages.py(stages担当)が揃っているか確認してください。"
        )
    return mod


def _accepts(fn: Callable, name: str) -> bool:
    try:
        return name in inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False


def _periods(raw15: Mapping[str, pd.DataFrame]) -> Dict[str, List[str]]:
    out = {}
    for p, df in raw15.items():
        t = pd.DatetimeIndex(df["time"])
        out[p] = [t.min().strftime("%Y-%m-%d"), t.max().strftime("%Y-%m-%d")] if len(t) else ["", ""]
    return out


def _split_meta(split: Any) -> Dict[str, Any]:
    if split is None:
        return {}
    te = split.get("train_end") if isinstance(split, Mapping) else getattr(split, "train_end", None)
    note = split.get("note") if isinstance(split, Mapping) else getattr(split, "note", "")
    return {"train_end": None if te is None else str(te), "note": note or ""}


def _strategy_notes() -> List[str]:
    try:
        import strategy

        return [str(x) for x in getattr(strategy, "STRATEGY_NOTES", [])]
    except Exception:  # strategy が無い/壊れていても、レポート生成は止めない
        return []


def _fallback_to_base(sb: Any, stage_a: Optional[Mapping[str, Any]], axes: Any) -> "tuple[Params, Dict[str, Any]]":
    """段階Cを回せないとき(軸が選べない)の代わりの結果。基準設定をそのまま『選んだ設定』にする。

    学習用期間(と段階Bの表)だけで決まる。検証用期間・他ペアの結果は見ていない(引継書 第8章)。
    results は None(= 段階Cの設定ごとの学習用ゲート判定は 0 件 → レポートは『段階Cで評価できた設定が無い』を不足に挙げる)。
    """
    base = Params.from_dict(dict((stage_a or {}).get("params") or {})) if stage_a else base_params()
    n_train = ((stage_a or {}).get("train") or {}).get("metrics", {}).get("n_trades")
    n_b = getattr(sb, "attrs", {}).get("n_trials")
    excluded = getattr(axes, "excluded", None) or []
    rule = (
        "限定グリッド(段階C)は実施していない: 学習用期間の取引が少なく"
        + (f"(基準設定で {n_train} 件)" if n_train is not None else "")
        + "、台地の判定に足りる水準(取引数が分析用の目安以上)が2つ以上ある項目が段階Bに1つも無かった。"
        "そのため段階Aの基準設定(原典準拠)をそのまま固定して段階D・Eに進んだ。台地の中央を選ぶ手順は踏んでいない。"
    )
    fb = {
        "results": None,
        "n_trials": n_b if n_b is not None else 1,
        "n_trials_detail": {"A": 1, "B": n_b, "C": 0, "note": "段階Cは未実施(基準設定を固定)"},
        "axes": {},
        "chosen_params": base.to_dict(),
        "selection_rule": rule,
        "selection_info": {"fallback": "base_params", "n_train_trades_base": n_train,
                           "excluded": [e.get("param") for e in excluded][:20]},
        "fallback": True,
    }
    return base, fb


def run_pipeline(
    raw15: Mapping[str, pd.DataFrame],
    cfg: Config,
    *,
    gate_sets: Optional[Mapping[str, GateSet]] = None,
    synthetic: bool = False,
    data_source: str = "",
    main_pair: str = DEFAULT_MAIN_PAIR,
    gmt_shifts: Sequence[float] = (-1, 0, 1),
    n_runs: int = 100,
    seed: int = 0,
    top_k: int = 4,
    stages: Any = None,
    meta_extra: Optional[Mapping[str, Any]] = None,
    progress: Optional[Callable[[str], None]] = None,
    registry: Any = None,
) -> Dict[str, Any]:
    """段階A→Eを通しで実行し、report.build_report に渡せる result を返す。

    コストが未設定のときは段階を実行せず、meta だけの result を返す(判定は保留・コスト未設定)。

    registry: 凍結記録(stages.FreezeRegistry)。段階Cで設定を選んだ直後に凍結し、同じ registry を段階D・Eに渡す。
        path 付きなら実行をまたいで引き継がれ、検証用期間を見た後に設定が変わっていれば meta.reselected=True になる(引継書 第8章)。
        None のときは stages に FreezeRegistry があれば一時的なもの(保存されない)を使う。この場合、別の実行での
        選び直しは検出できないので、meta.freeze.path が None になり、レポートは『選び直しの有無: 未確認』と書く。
    """
    say = progress or (lambda s: None)
    gate_sets = dict(gate_sets) if gate_sets is not None else load_gate_sets(None)
    pairs = list(raw15)
    errors: List[str] = []
    limits: List[str] = []
    notes: List[str] = []

    cost_ready = bool(pairs) and all(cfg.costs.is_ready(p) for p in pairs)
    meta: Dict[str, Any] = {
        "synthetic": bool(synthetic),
        "data_source": data_source,
        "pairs": pairs,
        "periods": _periods(raw15),
        "split": {},
        "costs": {"source": cfg.costs.source, "is_test_value": bool(cfg.costs.is_test_value), "ready": cost_ready},
        "gates": gates_meta(gate_sets),
        "reselected": False,
        "gmt_shifts": [float(h) for h in gmt_shifts],
        "notes": notes,
        "limits": limits,
        "errors": errors,
        "reproduce": {"seed": seed, "n_runs": n_runs, "top_k": top_k, "main_pair": main_pair},
    }
    result: Dict[str, Any] = {
        "meta": meta, "stage_a": None, "stage_b": None, "stage_c": None, "stage_d": None, "stage_e": None,
        "gate_sets": gate_sets,
    }
    if meta_extra:
        for k, v in meta_extra.items():
            if k in ("limits", "notes", "errors"):
                meta[k].extend(v)
            else:
                meta[k] = v

    if main_pair not in raw15:
        errors.append(f"主ペア {main_pair} のデータが無い(読めたのは {pairs or 'なし'})")
        return result
    if not cost_ready:
        unready = [p for p in pairs if not cfg.costs.is_ready(p)]
        limits.append(
            "スプレッド/スリッページが未設定のペア: " + "・".join(unready)
            + "。コスト未設定のまま成績を出すと甘い結果になるため、段階A〜Eは実行していない。"
        )
        return result

    st = load_stages(stages)

    def step(name: str, fn: Callable[[], Any]) -> Any:
        say(f"{name} を実行中...")
        try:
            return fn()
        except NotConfiguredError as e:
            errors.append(f"{name}: 未設定のものがある({e})")
        except Exception as e:  # noqa: BLE001  どの段階で何が起きたかをレポートに残すため広く受ける
            errors.append(f"{name}: {type(e).__name__}: {e}")
            limits.append(f"{name} のエラー詳細:\n{traceback.format_exc(limit=6)}")
        return None

    datasets = step("データ準備(build_all)", lambda: st.build_all(dict(raw15), cfg))
    if datasets is None:
        return result
    split = step("学習用/検証用の分割(make_split)", lambda: st.make_split(datasets[main_pair], cfg))
    if split is None:
        return result
    meta["split"] = _split_meta(split)

    result["stage_a"] = step("段階A(原典準拠の基準設定)", lambda: st.stage_a(datasets, cfg, split, pair=main_pair))
    sb = step("段階B(感度分析)", lambda: st.stage_b(datasets, cfg, split, pair=main_pair))
    result["stage_b"] = sb

    chosen: Optional[Params] = None
    if sb is not None:
        axes = step("軸の選定(select_axes)", lambda: st.select_axes(sb, top_k=top_k))
        if axes is not None and len(axes) == 0:
            # 学習用期間の取引が少なく、台地判定に足りる水準が2つ以上ある項目が1つも無い。
            # 限定グリッドは回せない → 段階Aの基準設定(原典準拠・検証用期間を見ずに決まる)をそのまま固定して D・E に進む。
            chosen, fb = _fallback_to_base(sb, result["stage_a"], axes)
            result["stage_c"] = fb
            meta["stage_c_fallback"] = True
            limits.append(fb["selection_rule"])
        elif axes is not None:
            kw: Dict[str, Any] = {"pair": main_pair, "axes": axes}
            if _accepts(st.stage_c, "stage_b_df"):  # 試行総数に段階Bを含めるため(あれば)
                kw["stage_b_df"] = sb
            sc = step("段階C(限定グリッド)", lambda: st.stage_c(datasets, cfg, split, **kw))
            result["stage_c"] = sc
            if sc is not None and sc.get("chosen_params"):
                chosen = Params.from_dict(dict(sc["chosen_params"]))

    # ---- 凍結: 段階Cで選んだ直後(段階D・Eで検証用期間・他ペアを見る前)に設定を記録する -------------------------
    reg = registry
    if reg is None and callable(getattr(st, "FreezeRegistry", None)):
        reg = st.FreezeRegistry()  # 保存先なし(実行をまたいだ検出はできない)
    freeze_res: Optional[Dict[str, Any]] = None
    if reg is not None and chosen is not None:
        src = "stage_c_fallback_base" if meta.get("stage_c_fallback") else "stage_c"
        with warnings.catch_warnings(record=True):  # 同じ内容を meta.limits に書くので、警告の二重表示は抑える
            warnings.simplefilter("always")
            freeze_res = reg.freeze(chosen, main_pair=main_pair, train_end=split, source=src)
        if freeze_res["status"] in ("replaced_before_validation", "reselected_after_validation"):
            limits.append(freeze_res["message"])
        if freeze_res["status"] == "reselected_after_validation":
            meta["reselected"] = True
        meta["freeze"] = reg.summary(freeze_res)
        meta["reselected"] = bool(meta["reselected"] or reg.reselected)
    elif reg is not None:
        meta["freeze"] = reg.summary(None)
    else:
        meta["freeze"] = {"path": None, "hash": None, "note": "凍結記録なし(stages に FreezeRegistry が無い)"}

    tg = evaluate_stage_c_train_gate(result["stage_c"], gate_sets)
    result["stage_c_gate"] = tg

    gates_complete = all(m["complete"] for m in meta["gates"].values())
    train_blocked = gates_complete and tg["n_evaluated"] > 0 and tg["n_pass"] == 0 and tg["n_hold"] == 0
    if train_blocked:
        notes.append("段階Cで学習用ゲートに届く設定が無かったため、段階D・Eは省略した(引継書 第4章)。")
    elif chosen is None:
        info_c = ((result.get("stage_c") or {}).get("selection_info") or {})
        limits.append(
            "段階Cで設定を選べなかったため、段階D・Eを実行していない。"
            + (f"理由: {info_c['note']}" if info_c.get("note") else "")
        )
    else:
        reg_d = {"registry": reg} if reg is not None and _accepts(st.stage_d, "registry") else {}
        reg_e = {"registry": reg} if reg is not None and _accepts(st.stage_e, "registry") else {}
        result["stage_d"] = step(
            "段階D(検証用期間・横展開・GMTずらし・ゲート判定)",
            lambda: st.stage_d(dict(raw15), cfg, split, chosen, main_pair=main_pair,
                               gmt_shifts=tuple(gmt_shifts), gate_sets=gate_sets, **reg_d),
        )
        result["stage_e"] = step(
            "段階E(ランダムエントリーとの比較)",
            lambda: st.stage_e(datasets, cfg, split, chosen, main_pair=main_pair, n_runs=n_runs, seed=seed, **reg_e),
        )
        if reg is not None:
            meta["freeze"] = reg.summary(freeze_res)  # 段階D・Eが『検証を見た』記録を含む最終状態
            if reg.reselected:
                meta["reselected"] = True
        for name in ("stage_d", "stage_e"):
            r = result[name]
            if r:
                if r.get("reselected"):
                    meta["reselected"] = True
                for n in r.get("notes") or []:
                    if n not in notes:
                        notes.append(n)

    for n in _strategy_notes():
        if n not in notes:
            notes.insert(0, n)
    for n in getattr(st, "STAGE_NOTES", []) or []:
        if n not in notes:
            notes.append(str(n))
    limits.append("1分足は使っていない(SL と TP1 が同じ15分足で両方届いた場合は常に SL 優先)。")
    return result


# =============================================================================================
# CLI
# =============================================================================================
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="15分足FXデイトレ手法の検証(段階A→E)を通しで実行し、判定レポートを出す",
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--data-dir", help="実データCSVのフォルダ(形式は README.md)")
    src.add_argument("--synthetic", action="store_true", help="合成データで動作確認(結果は必ず保留・判定根拠にならない)")
    ap.add_argument("--pairs", nargs="+", default=list(DEFAULT_PAIRS), help="通貨ペア(既定: USDJPY EURUSD GBPUSD EURJPY)")
    ap.add_argument("--main-pair", default=DEFAULT_MAIN_PAIR, help="主ペア(既定 USDJPY)")
    ap.add_argument("--file-pattern", default="{pair}_M15.csv", help='15分足のファイル名(既定 "{pair}_M15.csv")')
    ap.add_argument("--m1-pattern", default=None, help='1分足のファイル名(例 "{pair}_M1.csv")。15分足が無いときだけ15分足に変換して使う')
    ap.add_argument("--source-tz", default="utc", choices=["utc", "fixed", "ny_close_server"],
                    help="CSVの時刻の基準(既定 utc。MT4のサーバー時間なら ny_close_server)")
    ap.add_argument("--source-offset", type=float, default=0.0, help="--source-tz fixed のときの UTC からのずれ(時間)")
    ap.add_argument("--gates-json", nargs="+", default=None, help="ea-lab のゲート基準(JSON)。1つ目 phase0、2つ目 promotion")
    ap.add_argument("--costs-json", default=None, help="ea-lab のスプレッド/スリッページ(JSON)")
    ap.add_argument("--train-end", default=None, help="学習用期間の終わり(YYYY-MM-DD)。省略時は全期間の60%%位置を月初に丸める")
    ap.add_argument("--gmt-shifts", nargs="+", type=float, default=[-1, 0, 1], help="GMTずらし(時間)。既定 -1 0 1")
    ap.add_argument("--years", type=float, default=3.0, help="--synthetic のデータ年数")
    ap.add_argument("--seed", type=int, default=0, help="乱数の種(合成データ・ランダムベンチマーク)")
    ap.add_argument("--n-runs", type=int, default=100, help="段階Eのランダム試行回数")
    ap.add_argument("--top-k", type=int, default=4, help="段階Cで動かす項目数(3〜4)")
    ap.add_argument("--freeze-file", default=None,
                    help="凍結記録(JSON)の保存先。既定は <out>/freeze.json。段階Cの直後に選んだ設定を凍結し、"
                         "同じファイルを使う再実行で、検証用期間を見た後に設定が変わっていれば『選び直し』として検出する。"
                         "新しい検証を始めるときだけ、理由を記録したうえでファイルを消すこと")
    ap.add_argument("--out", default="out", help="出力フォルダ(report.md, result.json, freeze.json)")
    return ap


def main(argv: Optional[Sequence[str]] = None, *, stages: Any = None) -> int:
    args = build_parser().parse_args(argv)
    say = lambda s: print(f"[run_all] {s}", file=sys.stderr)  # noqa: E731

    meta_extra: Dict[str, Any] = {"limits": [], "notes": []}
    if args.synthetic:
        cfg = synthetic_test_config()
        raw15 = load_synthetic_data(args.years, args.seed, args.pairs)
        source = f"合成データ(乱数。テスト専用。seed={args.seed}, {args.years}年)"
        meta_extra["limits"].append("合成データ・テスト用コストでの動作確認。実データでの結果ではない。")
    else:
        cfg = default_config()
        if args.costs_json:
            cfg = cfg.with_costs(load_costs_json(args.costs_json))
        data = load_real_data(
            args.data_dir, args.pairs, file_pattern=args.file_pattern, m1_pattern=args.m1_pattern,
            source_tz=args.source_tz, source_offset=args.source_offset,
        )
        raw15 = data["raw15"]
        source = f"実データ {os.path.abspath(args.data_dir)}"
        meta_extra["notes"].extend(data["notes"])
        if data["missing"]:
            meta_extra["limits"].append(
                "ファイルが見つからず、評価できなかった通貨ペア: " + "・".join(data["missing"])
                + f"(探したファイル名: {args.file_pattern})"
            )
        for p, q in data["quality"].items():
            if q.get("n_bad_ohlc"):
                meta_extra["limits"].append(f"{p}: 高値・安値が始値/終値と矛盾する足が {q['n_bad_ohlc']} 本ある(データ品質)")
        if not args.costs_json:
            meta_extra["limits"].append("--costs-json が無い(スプレッド/スリッページ未設定)。")
    if args.train_end:
        cfg = replace(cfg, split=SplitConfig(train_end=args.train_end, note=f"--train-end {args.train_end} で指定"))
        meta_extra["split_by_user"] = True

    gate_sets = load_gate_sets(args.gates_json)
    freeze_path = args.freeze_file or os.path.join(args.out, "freeze.json")
    try:
        st_mod = load_stages(stages)
        registry = st_mod.FreezeRegistry(freeze_path) if callable(getattr(st_mod, "FreezeRegistry", None)) else None
    except ImportError as e:
        print(f"[run_all] 実行できません: {e}", file=sys.stderr)
        return 2
    except ValueError as e:  # 凍結記録が壊れている: 黙って作り直さない
        print(f"[run_all] 実行できません: {e}", file=sys.stderr)
        return 2
    if registry is not None:
        say(f"凍結記録: {os.path.abspath(freeze_path)}(記録が既にあれば引き継ぐ)")
    try:
        result = run_pipeline(
            raw15, cfg, gate_sets=gate_sets, synthetic=args.synthetic, data_source=source,
            main_pair=args.main_pair, gmt_shifts=args.gmt_shifts, n_runs=args.n_runs, seed=args.seed, top_k=args.top_k,
            stages=stages, meta_extra=meta_extra, progress=say, registry=registry,
        )
    except ImportError as e:  # 段階モジュール(stages)が揃っていない
        print(f"[run_all] 実行できません: {e}", file=sys.stderr)
        return 2
    out_dir = args.out
    write_report(result, os.path.join(out_dir, "report.md"))
    write_result_json(result, os.path.join(out_dir, "result.json"))
    v = decide_verdict(result)
    print(f"結論: {v['verdict']}\n理由: {v['primary_reason']}")
    for m in v["missing"]:
        print(f"  不足: {m}")
    print(f"レポート: {os.path.abspath(os.path.join(out_dir, 'report.md'))}")
    print(f"再現用データ: {os.path.abspath(os.path.join(out_dir, 'result.json'))}")
    return 1 if result["meta"]["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
