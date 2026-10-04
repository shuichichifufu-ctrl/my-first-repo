"""判定レポート生成(引継書 第6章の10項構成)と、勝てる/勝てない/保留の判定。

仕様の正本は引継書 第0章・第6章・第8章と INTERFACES.md §7。

【絶対ルール】
- ゲートの閾値(PF など)をこのファイルで作らない。`GateResult.to_dict()` の値をそのまま表示する。
  未転記は「未転記」と表示する。
- 合成データ(meta.synthetic=True)の結果は必ず「保留」。『動作確認用であり判定根拠ではない』と大きく注記する。
- D10(原典に無い追加フィルター)の結果は、原典準拠の結果と別の節に書く。

公開関数:
    decide_verdict(result) -> {"verdict", "primary_reason", "missing", ...}
    build_report(result) -> str                 # Markdown(日本語)
    write_report(result, path)
    summarize_performance(trades) -> dict       # 取引回数・勝率・PF・平均R・期待値R・最大DD + 年別/通貨ペア別/買い売り別
    performance_tables(trades) -> str           # 上の Markdown 表
    sensitivity_table(stage_b_df) -> str        # 感度分析(項目ごとの表)
    funnel_table(funnel) -> str                 # 条件ごとの通過数
    evaluate_stage_c_train_gate(stage_c, gate_sets) -> dict   # 段階Cの各設定を学習用ゲートで判定
    to_jsonable(obj) / write_result_json(result, path)
"""
from __future__ import annotations

import dataclasses
import json
import math
import os
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from core.gates import FAIL, HOLD as GATE_HOLD, PASS, GateSet, evaluate_gate_set
from core.metrics import (
    breakdown_by_pair,
    breakdown_by_side,
    breakdown_by_year,
    compute_metrics,
)
from core.params import base_params

# ---- 結論の語(引継書 第0章) ---------------------------------------------------------------
V_WIN = "勝てる"
V_LOSE = "勝てない"
V_HOLD = "保留"

REQUIRED_CROSS_PAIRS = ("EURUSD", "GBPUSD", "EURJPY")  # 引継書 第1章の既定案(横展開)
DEFAULT_MAIN_PAIR = "USDJPY"
GATE_NAMES = ("phase0", "promotion")

SYNTHETIC_TAG = "(合成データ・テスト用)"
SYNTHETIC_BANNER = (
    "> # 【合成データ】動作確認用であり判定根拠ではない\n"
    ">\n"
    "> このレポートの数値は、乱数で作った合成データとテスト用の仮コストで出したものです。\n"
    "> **実際の為替データでも ea-lab の設定でもありません。手法の優位性の証拠にはなりません。**\n"
    "> 結論は必ず「保留」です。勝てるか勝てないかの判定には、実FXデータ・ea-lab ゲート基準値・"
    "スプレッド/スリッページ設定が必要です。"
)

PERIOD_JA = {"all": "全期間", "train": "学習用", "oos": "検証用(OOS)"}
SCOPE_JA = {"train": "学習用", "oos": "検証用(OOS)", "pair": "横展開(再調整なし)", "gmt_shift": "GMTずらし", "all": "全体"}

METRIC_COLUMNS: List[Tuple[str, str]] = [
    ("n_trades", "取引回数"),
    ("win_rate", "勝率"),
    ("pf", "PF"),
    ("avg_r", "平均R"),
    ("expectancy_r", "期待値R"),
    ("max_dd_r", "最大DD(R)"),
    ("total_r", "合計R"),
]

FUNNEL_BAR_LABELS = {
    "bars_ready": "指標が揃った足(計算可能)",
    "h1_cross": "D1: 1時間足クロス(有効期間内)",
    "d1": "D2: 日足の環境認識",
    "h4": "D3: 4時間足の環境認識",
    "po": "D4: パーフェクトオーダー",
}
FUNNEL_SETUP_LABELS = {
    "setup_po": "局面の開始(PO成立 かつ 上位足OK)",
    "setup_break": "D5: 直近高値を上抜け",
    "setup_pullback": "D6: 押しの条件を満たした",
    "setup_line": "D7: 切り下げラインが確定",
    "setup_line_break": "D7: ラインを上抜け",
    "setup_filters": "D8/D10: 損切り幅などのフィルター通過",
    "setup_filled": "約定(= 取引数)",
}
FUNNEL_CANCEL_LABELS = {
    "cancel_po_lost": "ブレイク前にPOが崩れた",
    "cancel_htf_lost": "上位足条件が崩れた",
    "cancel_pullback_violated": "押し禁止条件に抵触(80EMA終値割れ等)",
    "cancel_expired": "有効期限切れ",
    "cancel_filter": "損切り幅上限などで見送り",
    "cancel_in_position": "保有中で約定できず",
    "cancel_no_next_bar": "次の足が無い/ギャップ/日またぎ",
    "cancel_open_at_end": "データ末尾で未決",
}

# 項目 -> Params のフィールド名(感度分析表からD9などを抜き出すため)
D9_PARAMS = ("tp1_fraction", "be_after_tp1", "trail_mode", "fixed_r", "eod_close")


# =============================================================================================
# 1. 表示用の小物
# =============================================================================================
def _is_nan(x: Any) -> bool:
    try:
        return isinstance(x, (float, np.floating)) and math.isnan(float(x))
    except (TypeError, ValueError):
        return False


def fnum(x: Any, nd: int = 3) -> str:
    """数値の丸め。None/NaN は「—」、無限大は「∞」。"""
    if x is None or _is_nan(x):
        return "—"
    if isinstance(x, (bool, np.bool_)):
        return "はい" if x else "いいえ"
    if isinstance(x, (int, np.integer)):
        return str(int(x))
    try:
        v = float(x)
    except (TypeError, ValueError):
        return str(x)
    if math.isinf(v):
        return "∞" if v > 0 else "-∞"
    return f"{v:.{nd}f}"


def fpf(x: Any) -> str:
    """PF の表示。None は「算出不能」、inf は「∞」。"""
    if x is None or _is_nan(x):
        return "算出不能"
    return fnum(x, 2)


def fpct(x: Any, nd: int = 1) -> str:
    if x is None or _is_nan(x):
        return "—"
    return f"{float(x) * 100:.{nd}f}%"


def _esc(s: Any) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def md_table(headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> str:
    rows = [list(r) for r in rows]
    out = ["| " + " | ".join(_esc(h) for h in headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(_esc(c) for c in r) + " |")
    return "\n".join(out)


def _fmt_metric(key: str, m: Mapping[str, Any]) -> str:
    v = m.get(key)
    if key == "n_trades":
        return fnum(v if v is not None else 0)
    if key == "win_rate":
        return fpct(v)
    if key == "pf":
        return fpf(v)
    return fnum(v, 3)


def metrics_table(rows: Sequence[Tuple[str, Mapping[str, Any]]], first_header: str = "区間") -> str:
    """[(ラベル, metrics dict)] -> 主要成績の Markdown 表。"""
    headers = [first_header] + [h for _, h in METRIC_COLUMNS]
    body = []
    for label, m in rows:
        m = m or {}
        body.append([label] + [_fmt_metric(k, m) for k, _ in METRIC_COLUMNS])
    return md_table(headers, body)


def _bullets(items: Iterable[str]) -> str:
    return "\n".join(f"- {x}" for x in items)


def _get(d: Any, *keys: str, default: Any = None) -> Any:
    cur = d
    for k in keys:
        if cur is None:
            return default
        if isinstance(cur, Mapping):
            cur = cur.get(k)
        else:
            cur = getattr(cur, k, None)
    return default if cur is None else cur


# =============================================================================================
# 2. 成績集計(取引回数・勝率・PF・平均R・期待値R・最大DD・年別・通貨ペア別・買い売り別)
# =============================================================================================
def summarize_performance(trades: pd.DataFrame) -> Dict[str, Any]:
    """取引一覧(core.schema.TRADE_COLUMNS)から主要成績をまとめる。

    戻り値: {"overall": metrics, "by_year": {年: metrics}, "by_pair": {ペア: metrics}, "by_side": {long/short: metrics}}
    勝ち = pnl_r > 0。PF は勝ちR合計/負けR合計。取引0件でも同じ形で返す(算出不能は None)。
    """
    return {
        "overall": compute_metrics(trades),
        "by_year": breakdown_by_year(trades),
        "by_pair": breakdown_by_pair(trades),
        "by_side": breakdown_by_side(trades),
    }


def performance_tables(trades: pd.DataFrame, *, title_prefix: str = "") -> str:
    """summarize_performance の結果を Markdown 表にする(全体・年別・通貨ペア別・買い売り別)。"""
    s = summarize_performance(trades)
    parts = [f"{title_prefix}**全体**", metrics_table([("全体", s["overall"])])]
    if s["by_year"]:
        parts += [f"{title_prefix}**年別**", metrics_table([(str(y), m) for y, m in s["by_year"].items()], "年")]
    if s["by_pair"]:
        parts += [f"{title_prefix}**通貨ペア別**", metrics_table(list(s["by_pair"].items()), "通貨ペア")]
    parts += [
        f"{title_prefix}**買い・売り別**",
        metrics_table([({"long": "買い", "short": "売り"}[k], m) for k, m in s["by_side"].items()], "売買"),
    ]
    return "\n\n".join(parts)


# =============================================================================================
# 3. 感度分析表・段階Cヒートマップ・条件ごとの通過数
# =============================================================================================
def _val_str(v: Any) -> str:
    if v is None or _is_nan(v):
        return "なし(None)"
    if isinstance(v, (bool, np.bool_)):
        return "True" if v else "False"
    if isinstance(v, (tuple, list)):
        return "(" + ", ".join(_val_str(x) for x in v) + ")"
    return str(v)


def _is_true(x: Any) -> bool:
    return bool(x) and not _is_nan(x)


def sensitivity_summary(df: pd.DataFrame) -> pd.DataFrame:
    """項目ごとの『平均Rの動き』。列: param, n_levels, avg_r_min, avg_r_max, avg_r_range, base_avg_r。"""
    rows = []
    for param, g in df.groupby("param", sort=False):
        ar = pd.to_numeric(g["avg_r"], errors="coerce")
        base = g[g["is_base"].map(_is_true)] if "is_base" in g.columns else g.iloc[0:0]
        rows.append(
            {
                "param": param,
                "n_levels": int(len(g)),
                "avg_r_min": float(ar.min()) if ar.notna().any() else None,
                "avg_r_max": float(ar.max()) if ar.notna().any() else None,
                "avg_r_range": float(ar.max() - ar.min()) if ar.notna().any() else None,
                "base_avg_r": float(pd.to_numeric(base["avg_r"], errors="coerce").iloc[0]) if len(base) else None,
            }
        )
    return pd.DataFrame(rows)


def sensitivity_table(df: pd.DataFrame) -> str:
    """段階B(1項目ずつ動かす)の結果を、項目ごとの表にする。基準案の行に ★ を付ける。

    台地かどうかの見方: 近い値でも平均Rがなだらかに良ければ台地。特定の値だけ跳ねていれば偶然の疑い。
    """
    if df is None or len(df) == 0:
        return "(感度分析の結果が空です)"
    parts = []
    summ = sensitivity_summary(df)
    parts.append("**項目ごとの効き(平均Rの幅が大きい順。幅が大きい項目ほど結果を左右している)**")
    s2 = summ.sort_values("avg_r_range", ascending=False, na_position="last")
    parts.append(
        md_table(
            ["項目", "水準数", "平均R 最小", "平均R 最大", "幅", "基準案の平均R"],
            [
                [r.param, r.n_levels, fnum(r.avg_r_min), fnum(r.avg_r_max), fnum(r.avg_r_range), fnum(r.base_avg_r)]
                for r in s2.itertuples()
            ],
        )
    )
    extra_cols = [c for c in ("plateau", "plateau_label", "low_trades", "n_trades_ok") if c in df.columns]
    for param, g in df.groupby("param", sort=False):
        headers = ["値", "取引回数", "勝率", "PF", "平均R", "合計R", "最大DD(R)"] + extra_cols + ["基準案"]
        rows = []
        for r in g.itertuples(index=False):
            d = r._asdict()
            rows.append(
                [_val_str(d["value"]), fnum(d.get("n_trades")), fpct(d.get("win_rate")), fpf(d.get("pf")),
                 fnum(d.get("avg_r")), fnum(d.get("total_r")), fnum(d.get("max_dd_r"))]
                + [_val_str(d.get(c)) for c in extra_cols]
                + ["★" if _is_true(d.get("is_base")) else ""]
            )
        parts.append(f"**{param}**")
        parts.append(md_table(headers, rows))
    return "\n\n".join(parts)


def heatmap_table(results: pd.DataFrame, axes: Mapping[str, Sequence[Any]], metric: str = "avg_r") -> Optional[str]:
    """段階Cの結果から、先頭2軸の平均R(他の軸は平均)をヒートマップ風の表にする。軸が2つ未満なら None。"""
    keys = [k for k in axes if k in results.columns]
    if len(keys) < 2 or metric not in results.columns:
        return None
    a, b = keys[0], keys[1]
    t = results.assign(**{metric: pd.to_numeric(results[metric], errors="coerce")})
    piv = t.groupby([a, b], sort=False, dropna=False)[metric].mean().unstack(b)
    headers = [f"{a} \\ {b}"] + [_val_str(c) for c in piv.columns]
    rows = [[_val_str(idx)] + [fnum(v) for v in row] for idx, row in zip(piv.index, piv.to_numpy())]
    return md_table(headers, rows)


def funnel_table(funnel: Mapping[str, Any], side: Optional[str] = None) -> str:
    """条件ごとの通過数(どこで候補が減っているか)。side=None なら買い・売り両方。"""
    if not funnel:
        return "(通過数のデータがありません)"
    sides = [side] if side else ["long", "short"]
    parts = [f"- 入力の足数: {fnum(funnel.get('bars_total'))}"]
    for s in sides:
        name = {"long": "買い", "short": "売り"}[s]
        rows = []
        prev = None
        worst: Optional[Tuple[float, str]] = None
        for k, label in FUNNEL_BAR_LABELS.items():
            v = funnel.get(f"{s}.{k}")
            ratio = "—" if prev in (None, 0) or v is None else fpct(v / prev)
            if prev not in (None, 0) and v is not None:
                r = v / prev
                if worst is None or r < worst[0]:
                    worst = (r, label)
            rows.append([label, fnum(v), ratio])
            prev = v if v is not None else prev
        parts.append(f"**{name}: 足ごとの条件(前の条件をすべて満たした足の累積数)**")
        parts.append(md_table(["条件", "通過数", "前段からの通過率"], rows))
        if worst is not None:
            parts.append(f"- {name}の足条件で最も減る段階: 「{worst[1]}」(前段の {fpct(worst[0])} が通過)")
        rows = []
        prev = None
        worst2: Optional[Tuple[float, str]] = None
        for k, label in FUNNEL_SETUP_LABELS.items():
            v = funnel.get(f"{s}.{k}")
            ratio = "—" if prev in (None, 0) or v is None else fpct(v / prev)
            if prev not in (None, 0) and v is not None:
                r = v / prev
                if worst2 is None or r < worst2[0]:
                    worst2 = (r, label)
            rows.append([label, fnum(v), ratio])
            prev = v if v is not None else prev
        parts.append(f"**{name}: 局面ごとの到達数(その段階以上に到達した局面数の累積)**")
        parts.append(md_table(["段階", "到達数", "前段からの通過率"], rows))
        if worst2 is not None:
            parts.append(f"- {name}の局面で最も減る段階: 「{worst2[1]}」(前段の {fpct(worst2[0])} が通過)")
        crow = [[label, fnum(funnel.get(f"{s}.{k}"))] for k, label in FUNNEL_CANCEL_LABELS.items()]
        parts.append(f"**{name}: 局面の終わり方(約定しなかった局面の理由)**")
        parts.append(md_table(["理由", "局面数"], crow))
    return "\n\n".join(parts)


# =============================================================================================
# 4. 段階Cの設定を学習用ゲートで判定
# =============================================================================================
def _row_to_metrics(row: Mapping[str, Any]) -> Dict[str, Optional[float]]:
    out: Dict[str, Optional[float]] = {}
    for k, v in row.items():
        if isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_)):
            out[str(k)] = None if _is_nan(v) else float(v)
    return out


def evaluate_stage_c_train_gate(stage_c: Optional[Mapping[str, Any]], gate_sets: Optional[Mapping[str, GateSet]]) -> Dict[str, Any]:
    """段階Cの全設定を、ゲートの学習用基準(scope='train')で判定する。

    - 学習用に適用できるルールが1つも無いゲートセットは無視する。
    - 1設定の判定: どれかのゲートで不合格 → 不合格 / 保留があれば保留 / すべて合格 → 合格。
    - 基準値は gates.py(または JSON)から来たものだけを使う。ここで作らない。
    戻り値: {"n_evaluated","n_pass","n_fail","n_hold","gate_sets_used": [名前]}
    """
    res = _get(stage_c, "results")
    out = {"n_evaluated": 0, "n_pass": 0, "n_fail": 0, "n_hold": 0, "gate_sets_used": []}
    if res is None or not isinstance(res, pd.DataFrame) or len(res) == 0 or not gate_sets:
        return out
    used = {n: g for n, g in gate_sets.items() if g.rules_for("train")}
    out["gate_sets_used"] = sorted(used)
    for _, row in res.iterrows():
        m = _row_to_metrics(row.to_dict())
        vs = [evaluate_gate_set(g, m, scope="train").verdict for g in used.values()]
        if not vs:
            v = GATE_HOLD
        elif FAIL in vs:
            v = FAIL
        elif any(x != PASS for x in vs):
            v = GATE_HOLD
        else:
            v = PASS
        out["n_evaluated"] += 1
        out[{PASS: "n_pass", FAIL: "n_fail"}.get(v, "n_hold")] += 1
    return out


# =============================================================================================
# 5. 結論の判定(INTERFACES §7 の規則)
# =============================================================================================
def _seg_verdict(seg: Mapping[str, Any]) -> str:
    """1区間のゲート判定。適用ルールが無いゲート(rules が空)は無視。1つも無ければ保留。"""
    vs = [g.get("verdict") for g in (seg.get("gates") or {}).values() if g.get("rules")]
    if not vs:
        return GATE_HOLD
    if FAIL in vs:
        return FAIL
    if any(v != PASS for v in vs):
        return GATE_HOLD
    return PASS


def _seg_label(seg: Mapping[str, Any]) -> str:
    gs = seg.get("gmt_shift", 0) or 0
    s = f"{seg.get('pair', '?')} / {PERIOD_JA.get(seg.get('period'), seg.get('period'))}"
    if seg.get("scope") == "gmt_shift" or float(gs) != 0.0:
        s += f" / GMT{float(gs):+g}h"
    return s


def _gates_meta(result: Mapping[str, Any]) -> Optional[Mapping[str, Any]]:
    g = _get(result, "meta", "gates")
    if g is None:
        g = _get(result, "stage_d", "gates_ready")
    return g


def _reselected(result: Mapping[str, Any]) -> bool:
    return bool(
        _get(result, "meta", "reselected", default=False)
        or _get(result, "stage_d", "reselected", default=False)
        or _get(result, "stage_e", "reselected", default=False)
    )


def _freeze_meta(result: Mapping[str, Any]) -> Mapping[str, Any]:
    f = _get(result, "meta", "freeze")
    if not f:
        f = _get(result, "stage_d", "freeze")
    return f if isinstance(f, Mapping) else {}


def _freeze_confirmed(result: Mapping[str, Any]) -> bool:
    """『選び直しなし』と言ってよい根拠(実行をまたいで残る凍結記録)があるか。

    記録ファイルがあり、中身の鎖(ハッシュ)が壊れておらず、凍結した設定がある場合だけ True。
    メモリ上だけの記録(path なし)では、別の実行での選び直しは検出できないので False(=未確認)。
    """
    f = _freeze_meta(result)
    return bool(f.get("path") and f.get("hash") and f.get("integrity_ok", True))


def _reselection_text(result: Mapping[str, Any]) -> str:
    """第4章『選び直しの有無』の文面。記録の有無を確かめたうえで『なし』と書く。"""
    f = _freeze_meta(result)
    if _reselected(result):
        why = ""
        if f and not f.get("integrity_ok", True):
            why = f"(凍結記録の整合性エラー: {f.get('integrity_problem')})"
        return "**あり(検証用期間や他ペアを見てから選び直した)。判定は保留寄り。**" + why
    if _freeze_confirmed(result):
        h = str(f.get("hash"))[:12]
        txt = (
            f"なし(凍結記録 {f.get('path')} で確認。段階Cで選んだ直後に設定を凍結し(hash={h})、"
            f"検証用期間・他ペアの結果を見る前の凍結と同じ設定を使った。記録イベント {f.get('n_events')} 件)。"
        )
        if f.get("last_status") == "replaced_before_validation":
            txt += "ただし、検証用期間を見る前に凍結済みの設定を差し替えた記録がある(選び直し扱いではない。理由は限界の章を参照)。"
        if f.get("pair_set_changed"):
            txt += "**注意: 検証対象ペアが前回の実行と違う。結果を見てから入れ替えていないか確認すること。**"
        return txt
    return (
        "**未確認**(凍結記録ファイルが無い、または記録が空のため、選び直しの有無を機械的には確認できていない。"
        "`run_all.py --freeze-file` で記録を残して再実行すること)。"
    )


def _chosen_params_dict(result: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    return _get(result, "stage_c", "chosen_params") or _get(result, "stage_d", "chosen_params")


def _uses_d10(params: Optional[Mapping[str, Any]]) -> bool:
    if not params:
        return False
    return any(params.get(k) is not None for k in ("d10_session_utc", "d10_max_spread_pips", "d10_min_tp_sl_ratio"))


def _coverage_missing(result: Mapping[str, Any]) -> List[str]:
    """段階Dの区間が、勝てると言うのに必要な範囲(学習・検証・必要ペア・GMTずらし)を覆っているか。"""
    sd = result.get("stage_d")
    out: List[str] = []
    if not sd:
        return ["段階D(検証用期間・横展開・GMTずらし)が未実施"]
    segs = sd.get("segments") or []
    scopes = {s.get("scope") for s in segs}
    if "train" not in scopes:
        out.append("段階Dに学習用期間の区間が無い")
    if "oos" not in scopes:
        out.append("検証用期間(アウトオブサンプル)の結果が無い")
    pairs_done = {s.get("pair") for s in segs if s.get("scope") == "pair"}
    miss = sd.get("missing_required_pairs")
    if miss is None:
        miss = [p for p in REQUIRED_CROSS_PAIRS if p not in pairs_done]
    if miss:
        out.append("横展開に必要な通貨ペアのデータが無い: " + "・".join(miss))
    expected = _get(result, "meta", "gmt_shifts") or sd.get("gmt_shifts") or []
    got = {float(s.get("gmt_shift", 0) or 0) for s in segs if s.get("scope") == "gmt_shift"}
    lack = [h for h in expected if float(h) != 0.0 and float(h) not in got]
    if lack:
        out.append("GMTずらし検証の区間が無い: " + "・".join(f"{float(h):+g}h" for h in lack))
    return out


def decide_verdict(result: Mapping[str, Any]) -> Dict[str, Any]:
    """勝てる / 勝てない / 保留 を判定する(引継書 第0章、INTERFACES §7)。

    保留(missing に理由を列挙): 合成データ / ゲート基準が未転記 / コスト未設定 / 実データ無し・OOS期間なし・必要ペア欠け /
        選び直し(reselected) / 段階の実行エラー / 追加フィルター(D10)を含む設定。
    保留条件が無いとき:
        段階Cで学習用ゲートを満たす設定が1つも無い → 勝てない
        段階Dで不合格の区間がある(通過が一部の設定・ペアに限られる) → 勝てない
        段階Dの全区間・全ゲートが合格 → 勝てる
        それ以外(保留の区間が残る) → 保留
    戻り値: {"verdict","primary_reason","missing","fail_reasons","basis"}
    """
    meta = result.get("meta") or {}
    missing: List[str] = []
    synthetic = bool(meta.get("synthetic"))

    if synthetic:
        missing.append("合成データ(乱数で作ったテスト用データ)のため。動作確認用であり判定根拠ではない。実FXデータの接続が必要")
    elif not meta.get("data_source") or not meta.get("pairs"):
        missing.append("実FXデータが未接続(データの所在・期間が不明)")

    gates = _gates_meta(result)
    gate_unset = False
    for name in GATE_NAMES:
        g = (gates or {}).get(name) if gates else None
        if not g or not g.get("n_rules"):
            missing.append(f"ea-lab ゲート「{name}」の基準値が未転記(DESIGN.md から転記が必要)")
            gate_unset = True
        elif not g.get("complete"):
            missing.append(f"ea-lab ゲート「{name}」に閾値が未転記のルールが残っている")
            gate_unset = True

    costs = meta.get("costs")
    if not costs or not costs.get("ready"):
        missing.append("スプレッド/スリッページが未設定(ea-lab の既存設定から転記が必要)")
    elif costs.get("is_test_value") and not synthetic:
        missing.append("スプレッド/スリッページがテスト用の値のまま(実値ではない)")

    split = meta.get("split") or _get(result, "stage_d", "split")
    if not (split and split.get("train_end")):
        missing.append("学習用期間と検証用期間(OOS)の分割が未設定")

    if _reselected(result):
        missing.append("検証用期間や他通貨ペアの結果を見てから設定を選び直した(引継書 第8章)。判定は保留寄りに扱う")

    # 検証用期間・他ペアを見た(段階Dを実行した)のに、実行をまたぐ凍結記録で『選び直しなし』を確認できない場合
    if (isinstance(meta.get("freeze"), Mapping) and result.get("stage_d") is not None
            and not _reselected(result) and not _freeze_confirmed(result)):
        missing.append(
            "選び直しの有無を確認できていない(実行をまたいで残る凍結記録が無い)。引継書 第8章により判定は保留寄りに扱う"
        )

    for e in meta.get("errors") or []:
        missing.append(f"実行エラー: {e}")

    chosen = _chosen_params_dict(result)
    if _uses_d10(chosen):
        missing.append("選んだ設定に原典に無い追加フィルター(D10)が含まれる。原典準拠としての判定は別に必要")

    # ---- 学習用ゲート(段階C) -----------------------------------------------------------------
    tg = result.get("stage_c_gate")
    if tg is None and result.get("gate_sets") and result.get("stage_c"):
        tg = evaluate_stage_c_train_gate(result.get("stage_c"), result.get("gate_sets"))
    train_blocked = False  # 段階Cの全設定が学習用ゲート不通過 → 段階Dは省略してよい
    if result.get("stage_c") is None:
        missing.append("段階C(限定グリッド)が未実施")
    elif tg is None:
        missing.append("段階Cの設定に対する学習用ゲートの判定結果が渡されていない")
    elif tg.get("n_evaluated", 0) == 0:
        missing.append("段階Cで評価できた設定が無い")
    elif tg.get("n_pass", 0) == 0:
        if tg.get("n_hold", 0) > 0:
            if not gate_unset:  # ゲート未転記は上で不足として出している(重複させない)
                missing.append(f"段階Cの {tg['n_hold']} 設定は学習用ゲートを判定できない(指標が無い等)")
        else:
            train_blocked = True

    need_d = not train_blocked
    if need_d:
        missing.extend(_coverage_missing(result))

    # ---- 判定 -----------------------------------------------------------------------------------
    fail_reasons: List[str] = []
    basis: Dict[str, Any] = {"stage_c_gate": tg}
    if missing:
        if synthetic:
            reason = (
                "合成データ(乱数)で動作確認しただけなので、勝てるか勝てないかは判定できない。"
                "判定には実FXデータ・ea-lab ゲート基準値・コスト設定が必要。"
            )
        else:
            head = "、".join(missing[:2])
            more = f"(ほか{len(missing) - 2}件)" if len(missing) > 2 else ""
            reason = f"判定に必要なものが不足しているため保留。主な不足: {head}{more}。"
        return {"verdict": V_HOLD, "primary_reason": reason, "missing": missing, "fail_reasons": [], "basis": basis}

    if train_blocked:
        n = tg.get("n_evaluated", 0)
        reason = f"段階Cで試した {n} 設定のどれも、ea-lab ゲートの学習用基準を満たさなかった(検証用期間・他ペアは見るまでもなく不通過)。"
        return {"verdict": V_LOSE, "primary_reason": reason, "missing": [], "fail_reasons": [reason], "basis": basis}

    segs = (result.get("stage_d") or {}).get("segments") or []
    verdicts = [(s, _seg_verdict(s)) for s in segs]
    basis["segment_verdicts"] = [(_seg_label(s), v) for s, v in verdicts]
    fails = [s for s, v in verdicts if v == FAIL]
    holds = [s for s, v in verdicts if v == GATE_HOLD]
    if fails:
        labels = "、".join(_seg_label(s) for s in fails[:4]) + (f" ほか{len(fails) - 4}区間" if len(fails) > 4 else "")
        reason = (
            f"段階Dで ea-lab ゲートが不合格の区間がある({labels})。"
            "通過が一部の設定・期間・ペアに限られ、頑健な優位性とは言えない。"
        )
        fail_reasons = [_seg_label(s) for s in fails]
        return {"verdict": V_LOSE, "primary_reason": reason, "missing": [], "fail_reasons": fail_reasons, "basis": basis}
    if holds:
        labels = "、".join(_seg_label(s) for s in holds[:4])
        miss = [f"区間「{_seg_label(s)}」のゲート判定が保留(適用ルール無し・指標算出不能など)" for s in holds]
        reason = f"不合格はないが、ゲート判定が確定しない区間が残っている({labels})。"
        return {"verdict": V_HOLD, "primary_reason": reason, "missing": miss, "fail_reasons": [], "basis": basis}
    reason = (
        "段階Dの全区間(学習用・検証用・他通貨ペアの再調整なし・GMTずらし)で、"
        "ea-lab ゲート(Phase-0・昇格)をすべて通過した。"
    )
    return {"verdict": V_WIN, "primary_reason": reason, "missing": [], "fail_reasons": [], "basis": basis}


# =============================================================================================
# 6. レポート本文(引継書 第6章の10項)
# =============================================================================================
def _tag(synthetic: bool) -> str:
    return f" {SYNTHETIC_TAG}" if synthetic else ""


def _not_run(what: str, why: str = "") -> str:
    return f"(未実施: {what}{'。' + why if why else ''})"


def _threshold_str(rule: Mapping[str, Any]) -> str:
    th = rule.get("threshold")
    # 閾値は転記された値をそのまま表示する(丸めて別の値に見せない)
    return f"{rule.get('metric')} {rule.get('op')} " + ("未転記" if th is None else f"{float(th):.10g}")


def _section1(result: Mapping[str, Any], v: Mapping[str, Any], synthetic: bool) -> str:
    verdict = v["verdict"]
    lines = ["## 1. 結論", "", f"### 【{verdict}】", "", f"**一番の理由**: {v['primary_reason']}", ""]
    if synthetic:
        lines += ["**合成データのため結論は必ず「保留」です。この結果は動作確認用であり判定根拠ではありません。**", ""]
    if v.get("missing"):
        lines += ["**不足しているもの(これが揃うまで勝てる/勝てないは言えない)**", "", _bullets(v["missing"]), ""]
    if v.get("fail_reasons") and verdict == V_LOSE:
        lines += ["**不合格・不通過の内訳**", "", _bullets(v["fail_reasons"]), ""]
    lines += [
        "**判定の規則(引継書 第0章)**",
        "",
        "- 勝てる: ea-lab の既存ゲートを、検証期間外のデータ(アウトオブサンプル)と複数通貨ペアで通過した",
        "- 勝てない: どの妥当な定義でもゲートを通過しない、または通過が一部の設定に限られ曲線当てはめと判断される",
        "- 保留: データ不足などで判定できない(不足しているものを明記)",
        "- ゲート基準値・コスト・実データのどれかが未設定なら、常に保留(基準値はこのリポジトリで自作しない)",
    ]
    bench = _benchmark_caution(result)
    if bench:
        lines += ["", f"**参考(判定規則には含めない)**: {bench}"]
    return "\n".join(lines)


def _benchmark_caution(result: Mapping[str, Any]) -> str:
    """段階Eの参考注記。判定規則には含めない。『優位』とみなす基準値は作らず、ランダムの中央値(50%)だけを目安にする。"""
    se = result.get("stage_e")
    if not se:
        return ""
    msgs = []
    for s in se.get("segments") or []:
        pct = s.get("real_avg_r_percentile")
        if pct is not None and not _is_nan(pct) and pct <= 0.5 and s.get("scope") in ("oos", "pair"):
            msgs.append(f"{_seg_label(s)}(ランダムを上回った割合 {fpct(pct, 0)})")
    if msgs:
        return ("段階E: ランダムエントリーの半数以上が、実戦略以上の平均Rを出している区間がある: "
                + "、".join(msgs) + "。エントリー手順に意味があるかは慎重に見ること。")
    return ""


def _section2(result: Mapping[str, Any], synthetic: bool) -> str:
    lines = [f"## 2. ea-lab ゲートの項目ごとの合否{_tag(synthetic)}", ""]
    meta = result.get("meta") or {}
    gates = _gates_meta(result) or {}
    glines = []
    for name in GATE_NAMES:
        g = gates.get(name)
        if not g or not g.get("n_rules"):
            glines.append(f"{name}: ルール0件(**未転記**。ea-lab の DESIGN.md から転記する)")
        else:
            glines.append(f"{name}: {g['n_rules']} ルール、{'閾値すべて転記済み' if g.get('complete') else '**閾値が未転記のルールあり**'}")
    lines += ["**ゲート基準の転記状況**", "", _bullets(glines), ""]

    tg = result.get("stage_c_gate")
    if tg and tg.get("n_evaluated"):
        lines += [
            "**段階C(学習用ゲート)**: 評価した設定 "
            f"{tg['n_evaluated']} 件のうち 合格 {tg.get('n_pass', 0)} / 不合格 {tg.get('n_fail', 0)} / 保留 {tg.get('n_hold', 0)}",
            "",
        ]

    sd = result.get("stage_d")
    if not sd:
        reason = ""
        if tg and tg.get("n_evaluated") and tg.get("n_pass", 0) == 0 and tg.get("n_hold", 0) == 0:
            reason = "段階Cで学習用ゲートに届く設定が無かったため、段階Dを省略(引継書 第4章)"
        lines.append(_not_run("段階D(検証用期間・横展開・GMTずらし)", reason))
        return "\n".join(lines)

    segs = sd.get("segments") or []
    gnames = list((segs[0].get("gates") or {}).keys()) if segs else list(GATE_NAMES)
    rows = []
    for s in segs:
        rows.append(
            [_seg_label(s), SCOPE_JA.get(s.get("scope"), s.get("scope")), fnum(_get(s, "metrics", "n_trades", default=0))]
            + [_get(s, "gates", n, "verdict", default="—") for n in gnames]
            + [_seg_verdict(s)]
        )
    lines += [
        "**区間ごとのゲート判定**(「保留」は閾値未転記・取引0件・適用ルール無しなど。合否が確定していない状態)",
        "",
        md_table(["区間", "種別", "取引回数"] + [f"ゲート {n}" for n in gnames] + ["総合"], rows),
        "",
    ]
    rule_rows = []
    for s in segs:
        for gn in gnames:
            for r in _get(s, "gates", gn, "rules", default=[]):
                rule_rows.append(
                    [_seg_label(s), gn, r.get("name"), _threshold_str(r), fnum(r.get("value"), 4), r.get("verdict")]
                )
    if rule_rows:
        lines += ["**ルールごとの詳細**(閾値は ea-lab から転記された値をそのまま表示)", "",
                  md_table(["区間", "ゲート", "ルール名", "条件(指標 演算子 閾値)", "実測値", "判定"], rule_rows), ""]
    else:
        lines += ["ルールごとの詳細: ルールが転記されていないため表示できません(閾値は未転記)。", ""]
    miss = sd.get("missing_pairs")
    if miss:
        lines.append(f"データが無く評価できなかった通貨ペア: {'・'.join(miss)}")
    for w in sd.get("warnings") or []:
        lines.append(f"- 警告: {w}")
    return "\n".join(lines)


def _params_block(p: Mapping[str, Any]) -> str:
    return "```\n" + "\n".join(f"{k} = {_val_str(v) if v is None else v}" for k, v in p.items()) + "\n```"


def _section3(result: Mapping[str, Any], synthetic: bool) -> str:
    lines = [f"## 3. 原典準拠の基準設定(段階A)の成績{_tag(synthetic)}", ""]
    sa = result.get("stage_a")
    if not sa:
        return "\n".join(lines + [_not_run("段階A")])
    lines += [
        f"対象: {sa.get('pair', DEFAULT_MAIN_PAIR)}。引継書 第3章の基準案だけを1本回した、本書のルールそのものの素の成績。",
        "",
        "**使った設定(基準案)**", "", _params_block(sa.get("params") or {}), "",
    ]
    rows = []
    for key, label in (("all", "全期間"), ("train", "学習用"), ("oos", "検証用(OOS)")):
        m = _get(sa, key, "metrics")
        if m is not None:
            rows.append((label, m))
    if rows:
        lines += [metrics_table(rows), "",
                  "平均R・期待値Rは、コスト控除後の1取引あたりのR(当初の損切り幅=1R)。両者は同じ値になる。", ""]
    n = _get(sa, "all", "metrics", "n_trades", default=0)
    if not n:
        lines += ["**取引が0回だった。** どの条件で候補が消えているかは、このレポートの第8章を見る。", ""]
    else:
        lines += ["取引回数が少ない・成績が悪いときは、どの条件で候補が消えているかを、このレポートの第8章で見る。", ""]
    return "\n".join(lines)


def _diff_from_base(params: Mapping[str, Any]) -> List[Tuple[str, Any, Any]]:
    base = base_params().to_dict()
    out = []
    for k, v in params.items():
        bv = base.get(k)
        vv = list(v) if isinstance(v, tuple) else v
        bb = list(bv) if isinstance(bv, tuple) else bv
        if vv != bb:
            out.append((k, bb, vv))
    return out


def _section4(result: Mapping[str, Any], synthetic: bool) -> str:
    lines = [f"## 4. 選んだ設定とその選び方・試した設定の総数{_tag(synthetic)}", ""]
    sc = result.get("stage_c")
    meta = result.get("meta") or {}
    if not sc:
        return "\n".join(lines + [_not_run("段階C(限定グリッド)")])
    chosen = sc.get("chosen_params")
    if chosen:
        diff = _diff_from_base(chosen)
        lines += ["**選んだ設定(基準案からの変更点)**", ""]
        if diff:
            lines += [md_table(["項目", "基準案", "選んだ値"], [[k, _val_str(b), _val_str(v)] for k, b, v in diff]), ""]
        else:
            lines += ["基準案のまま(変更なし)。", ""]
        if _uses_d10(chosen):
            lines += ["**注意: 追加フィルター(D10)を含む。原典準拠の結果とは別枠(このレポートの第5章 5-3)で見ること。**", ""]
    else:
        info0 = sc.get("selection_info") or {}
        if info0.get("no_plateau"):
            lines += [
                "**台地を作れず、設定を選べなかった**(尖った山・符号の変わる点しか無い、または順序のある軸が無い)。"
                "最高成績の点は選んでいない。段階D・Eは実行していない(検証用期間・他ペアは見ていない)。",
                "",
            ]
        else:
            lines += ["選べる設定が無かった(学習用期間で取引回数が足りない等)。", ""]
    lines += ["**選び方**: " + str(sc.get("selection_rule") or "(記録なし)"), ""]
    info = sc.get("selection_info")
    if info:
        lines += [f"選んだ点の詳細: {_json_inline(info)}", ""]
    axes = sc.get("axes") or {}
    if axes:
        lines += ["**動かした項目(段階Bで効きが大きかったもの)**", "",
                  md_table(["項目", "水準"], [[k, ", ".join(_val_str(x) for x in v)] for k, v in axes.items()]), ""]
    reasons = getattr(axes, "reasons", None)
    if reasons:
        lines += ["項目を選んだ理由:", "", _bullets(_json_inline(r) for r in reasons), ""]
    n_trials = sc.get("n_trials")
    lines += [
        f"**試した設定の総数(段階A+B+C、多重検定の目安): {fnum(n_trials)} 件**",
        "",
        "試した数が多いほど、偶然うまくいく設定が混ざる可能性が高い。数万通りを回して最高の1点を選ぶことはしていない"
        "(台地の中央付近を選ぶ。引継書 第8章)。",
        "",
    ]
    det = sc.get("n_trials_detail")
    if det:
        lines += [f"内訳: {_json_inline(det)}", ""]
    split = meta.get("split") or {}
    if split:
        lines += [f"**学習用/検証用の分け方**: 学習用は {split.get('train_end')} まで。{split.get('note', '')}", ""]
    lines += [
        "**選び直しの有無**: " + _reselection_text(result),
        "",
    ]
    res = sc.get("results")
    if isinstance(res, pd.DataFrame) and len(res):
        cols = [c for c in list(axes) + ["n_trades", "win_rate", "pf", "avg_r", "total_r", "max_dd_r"] if c in res.columns]
        top = res.copy()
        if "avg_r" in top.columns:
            top["avg_r"] = pd.to_numeric(top["avg_r"], errors="coerce")
            top = top.sort_values("avg_r", ascending=False, na_position="last")
        top = top.head(8)
        mark = "is_chosen" if "is_chosen" in res.columns else None
        rows = []
        for _, r in top.iterrows():
            row = []
            for c in cols:
                v = r[c]
                if c == "win_rate":
                    row.append(fpct(v))
                elif c == "pf":
                    row.append(fpf(v))
                elif c in axes:
                    row.append(_val_str(v))
                else:
                    row.append(fnum(v))
            row.append("★選んだ設定" if mark and _is_true(r[mark]) else "")
            rows.append(row)
        lines += ["**段階Cの結果(平均Rの上位8件。最高の点ではなく台地の中央を選ぶので、選んだ設定が1位とは限らない)**", "",
                  md_table(cols + [""], rows), ""]
    return "\n".join(lines)


def _json_inline(x: Any) -> str:
    try:
        return json.dumps(to_jsonable(x), ensure_ascii=False)
    except (TypeError, ValueError):
        return str(x)


def _section5(result: Mapping[str, Any], synthetic: bool) -> str:
    lines = [f"## 5. 主要な成績{_tag(synthetic)}", "",
             "取引回数・勝率・PF・平均R・期待値R・最大ドローダウン。損益はコスト控除後のR(当初の損切り幅=1R)。", ""]
    sa, sd = result.get("stage_a"), result.get("stage_d")
    if not sa and not sd:
        return "\n".join(lines + [_not_run("段階A・D")])
    if sa:
        lines += [f"### 5-1. 段階A(基準案・{sa.get('pair', DEFAULT_MAIN_PAIR)}・全期間)", ""]
        by_year = _get(sa, "all", "breakdown_year") or {}
        by_side = _get(sa, "all", "breakdown_side") or {}
        lines += ["**年別**", "",
                  metrics_table([(str(y), m) for y, m in by_year.items()], "年") if by_year else "(取引なし)", ""]
        lines += ["**買い・売り別**", "",
                  metrics_table([({"long": "買い", "short": "売り"}.get(k, k), m) for k, m in by_side.items()], "売買")
                  if by_side else "(取引なし)", ""]
    if sd:
        segs = sd.get("segments") or []
        lines += ["### 5-2. 選んだ設定(段階D・再調整なし)", "",
                  "**区間ごと(学習用・検証用・通貨ペア別・GMTずらし)**", "",
                  metrics_table([(_seg_label(s), s.get("metrics") or {}) for s in segs]), ""]
        for s in segs:
            if s.get("scope") in ("oos", "train") and s.get("gmt_shift", 0) in (0, 0.0, None):
                by_year = s.get("breakdown_year") or {}
                by_side = s.get("breakdown_side") or {}
                lines += [f"**{_seg_label(s)}: 年別**", "",
                          metrics_table([(str(y), m) for y, m in by_year.items()], "年") if by_year else "(取引なし)", "",
                          f"**{_seg_label(s)}: 買い・売り別**", "",
                          metrics_table([({"long": "買い", "short": "売り"}.get(k, k), m) for k, m in by_side.items()], "売買")
                          if by_side else "(取引なし)", ""]
        pair_rows = [(s["pair"], s.get("metrics") or {}) for s in segs
                     if s.get("scope") == "pair" or (s.get("scope") == "oos")]
        if pair_rows:
            lines += ["**通貨ペア別(主ペアは検証用期間、他ペアは全期間・再調整なし)**", "",
                      metrics_table(pair_rows, "通貨ペア"), ""]
    lines += ["### 5-3. 追加フィルター(D10)込みの結果(原典準拠とは別枠)", ""]
    extra = result.get("extra_filter_results")
    if extra:
        lines += ["**以下は原典に無い追加フィルターを入れた結果。原典準拠の結果と混ぜて判断しないこと。**", "",
                  metrics_table([(e.get("label", "?"), e.get("metrics") or {}) for e in extra], "設定"), ""]
    else:
        lines += ["今回は未実施(上の結果はすべて原典準拠。D10 は使っていない)。", ""]
    return "\n".join(lines)


def _section6(result: Mapping[str, Any], synthetic: bool) -> str:
    lines = [f"## 6. 感度分析の結果{_tag(synthetic)}", "",
             "他を基準案に固定し、D1〜D9 を1つずつ動かした結果(ドル円・学習用期間のみ)。"
             "近い値でもなだらかに良い『台地』か、特定の値だけ跳ねているか(偶然の疑い)を見る。", ""]
    sb = result.get("stage_b")
    if sb is None or (isinstance(sb, pd.DataFrame) and sb.empty):
        return "\n".join(lines + [_not_run("段階B")])
    n = getattr(sb, "attrs", {}).get("n_trials")
    if n is not None:
        lines += [f"段階Bで試した設定数: {fnum(n)}", ""]
    lines += [sensitivity_table(sb), ""]
    sc = result.get("stage_c")
    res = _get(sc, "results")
    if isinstance(res, pd.DataFrame) and sc.get("axes"):
        hm = heatmap_table(res, sc["axes"])
        if hm:
            keys = [k for k in sc["axes"] if k in res.columns][:2]
            lines += [f"**段階C: 2項目の組み合わせ({keys[0]} × {keys[1]})の平均R**(他の軸は平均)", "", hm, ""]
    return "\n".join(lines)


def _section7(result: Mapping[str, Any], synthetic: bool) -> str:
    lines = [f"## 7. ベンチマーク(段階E)との比較{_tag(synthetic)}", "",
             "同じ環境認識(D1〜D3)と同じ決済(D8・D9)のまま、15分足のエントリー(D4〜D7)だけを"
             "『方向一致時のランダムな時刻』に置き換えた場合との比較。エントリー手順に意味があるのか、"
             "環境認識と決済ルールだけで成績が決まっているのかを切り分ける。", ""]
    se = result.get("stage_e")
    if not se:
        return "\n".join(lines + [_not_run("段階E")])
    segs = se.get("segments") or []
    rows = []
    for s in segs:
        r = s.get("random") or {}
        ra = r.get("avg_r") or {}
        rp = r.get("pf") or {}
        rows.append(
            [_seg_label(s), fnum(_get(s, "real", "n_trades", default=0)), fnum(_get(s, "real", "avg_r")),
             fnum(ra.get("mean")), fnum(ra.get("p05")), fnum(ra.get("p50")), fnum(ra.get("p95")),
             fpct(s.get("real_avg_r_percentile"), 0), fpf(_get(s, "real", "pf")), fpf(rp.get("p50")), fnum(r.get("n_runs"))]
        )
    lines += [
        md_table(["区間", "実戦略の取引数", "実戦略の平均R", "ランダム平均", "ランダム5%点", "ランダム中央値", "ランダム95%点",
                  "実戦略がランダムを上回った割合", "実戦略のPF", "ランダムPF中央値", "ランダム回数"], rows),
        "",
        "『上回った割合』が高いほど、エントリー手順に上乗せ効果がある可能性。50%前後なら、環境認識と決済ルールだけで成績が決まっている疑い"
        "(ランダムと区別できない)。どこからを『優位』とみなすかの基準は、このレポートでは決めていない。",
        "",
    ]
    for s in segs:
        if s.get("reading"):
            lines.append(f"- {_seg_label(s)}: {s['reading']}")
    lines.append(f"- ランダム試行: {fnum(se.get('n_runs'))} 回、乱数の種 {se.get('seed')} から連番(再現可能)")
    return "\n".join(lines)


def _section8(result: Mapping[str, Any], synthetic: bool) -> str:
    lines = [f"## 8. 条件ごとの通過数(どこで候補が減っているか){_tag(synthetic)}", ""]
    sa = result.get("stage_a")
    f = _get(sa, "all", "funnel")
    if not f:
        return "\n".join(lines + [_not_run("段階A(条件ごとの通過数は段階Aの全期間から出す)")])
    lines += [f"段階A・基準設定・{sa.get('pair', DEFAULT_MAIN_PAIR)}・全期間。足ごとの条件は『前の条件をすべて満たした足の数』の累積。", "",
              funnel_table(f), ""]
    return "\n".join(lines)


def _section9(result: Mapping[str, Any], synthetic: bool) -> str:
    meta = result.get("meta") or {}
    lines = [f"## 9. 原典に無い補完をした部分と、それが結果に与えた影響{_tag(synthetic)}", "",
             "**D9の残り半分の決済は原典に記載がない補完**(確認できた範囲=書籍の約61%まで)。"
             "基準案は『15分足の確定スイング安値に沿って損切りを引き上げる』。"
             "第1利確後の損切り(建値へ移動)も補完。ほかにも、引継書にも仕様書にも無い細部は実装側で判断した。"
             "それらの記録を次に示す。", ""]
    notes = list(meta.get("notes") or [])
    if notes:
        lines += ["**補完した点の記録(実装側)**", "", _bullets(notes), ""]
    else:
        lines += ["補完した点の記録は渡されていない。", ""]
    sb = result.get("stage_b")
    if isinstance(sb, pd.DataFrame) and len(sb):
        d9 = sb[sb["param"].isin(D9_PARAMS)]
        if len(d9):
            lines += ["**補完部分(D9)を動かしたときの成績の変化(学習用期間・ドル円)**", "",
                      "平均Rの幅が大きいほど、補完した決済ルールが結果を左右している。", "",
                      sensitivity_table(d9), ""]
        else:
            lines += ["D9 の感度分析の行が無いため、影響は評価できない。", ""]
    else:
        lines += ["段階Bが未実施のため、補完部分の影響は評価できない。", ""]
    return "\n".join(lines)


def _section10(result: Mapping[str, Any], v: Mapping[str, Any], synthetic: bool) -> str:
    meta = result.get("meta") or {}
    lines = ["## 10. 限界と未確認事項・追加で検証するなら何をするか", ""]
    fixed = [
        "ea-lab リポジトリと実FXデータは、この検証環境には無かった。ゲート基準値・スプレッド・スリッページは"
        "ea-lab から転記するまで未設定(自作・推測していない)。",
        "書籍の後半(約61%以降)は未読。実例の章に追加ルールがある可能性がある。",
        "本書には勝率・損益比・取引回数などの検証データが一切無く、原典の成績との照合はできない。",
        "4時間足の長期線は 120SMA/80SMA の両方を検証対象とした(原典で食い違い)。4時間足のスイングは"
        "ZigZag ではなく確定遅延つきフラクタルで代用した(ZigZag は描き直されるため)。",
        "エリオット波動は機械化が難しいため使っていない。日足・4時間足は ダウ理論(安値切り上げ)と移動平均で代用した。",
        "同じ15分足の中でSLとTP1の両方に届いた場合は、1分足が無ければ SL 優先(保守的)にしている。",
        "日足の区切り(サーバー時間)の違いは GMT±1時間のずらしで確かめる設計。区切りの定義が実データ提供元と違えば成績が変わり得る。",
        "試した設定数が多いほど偶然の当たりが混ざる。数字は『n_trials』を参照。",
    ]
    lines += ["**この検証の限界**", "", _bullets(fixed), ""]
    extra = [str(x) for x in (meta.get("limits") or [])]
    if extra:
        lines += ["**この実行で記録された限界・未確認事項**", "", _bullets(extra), ""]
    if v.get("missing"):
        lines += ["**判定に足りないもの(再掲)**", "", _bullets(v["missing"]), ""]
    todo = [
        "実FXデータ(ドル円・EURUSD・GBPUSD・EURJPY、できれば1分足つき)を `fx-verify/data/` に置いて `run_all.py --data-dir` で再実行する。",
        "ea-lab の DESIGN.md から Phase-0 ゲート・昇格ゲートの基準値を転記する(JSON か core/gates.py)。",
        "ea-lab の既存設定から、通貨ペアごとのスプレッドとスリッページを転記する(costs JSON)。",
        "学習用/検証用の分割(--train-end)は、実データの期間を確認して決め、検証用期間を見てから変えない。",
        "書籍の残り(約61%以降)を読み、追加ルールがあれば Params に足して別枠で検証する。",
        "原典に無い追加フィルター(D10:時間帯・スプレッド上限など)は、原典準拠の判定が出たあとに別枠で試す。",
    ]
    lines += ["**追加で検証するなら**", "", _bullets(todo)]
    if synthetic:
        lines += ["", f"{SYNTHETIC_TAG} 上記のうち、合成データで確認できたのはパイプラインが動くことだけ。"]
    return "\n".join(lines)


def _header(result: Mapping[str, Any]) -> str:
    meta = result.get("meta") or {}
    lines = ["**検証の前提**", ""]
    info = []
    info.append(f"データ: {meta.get('data_source') or '未接続'}")
    if meta.get("pairs"):
        info.append("通貨ペア: " + "・".join(meta["pairs"]))
    periods = meta.get("periods") or {}
    if periods:
        info.append("期間: " + " / ".join(f"{p} {a}〜{b}" for p, (a, b) in periods.items()))
    split = meta.get("split") or {}
    if split.get("train_end"):
        info.append(f"学習用期間の終わり: {split['train_end']}")
    c = meta.get("costs") or {}
    info.append("コスト: " + (f"{c.get('source')}" if c else "未設定"))
    lines += [_bullets(info), ""]
    return "\n".join(lines)


def build_report(result: Mapping[str, Any]) -> str:
    """判定レポート(Markdown・日本語)。引継書 第6章の10項構成。結論が最初。"""
    meta = result.get("meta") or {}
    synthetic = bool(meta.get("synthetic"))
    v = decide_verdict(result)
    parts = [f"# 15分足FXデイトレ手法 検証レポート — 結論: 【{v['verdict']}】"]
    if synthetic:
        parts.append(SYNTHETIC_BANNER)
    parts.append(_section1(result, v, synthetic))
    parts.append(_header(result))
    for fn in (_section2, _section3, _section4, _section5, _section6, _section7, _section8, _section9):
        parts.append(fn(result, synthetic))
    parts.append(_section10(result, v, synthetic))
    if synthetic:
        parts.append(SYNTHETIC_BANNER)
    return "\n\n".join(p.strip("\n") for p in parts) + "\n"


def write_report(result: Mapping[str, Any], path: str) -> None:
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(build_report(result))


# =============================================================================================
# 7. JSON 化(result.json 用)
# =============================================================================================
def to_jsonable(obj: Any) -> Any:
    """numpy / pandas / dataclass / Params を JSON にできる形に変換する。NaN は null、inf は文字列 "inf"。"""
    if obj is None or isinstance(obj, (str, bool)):
        return obj
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (int, np.integer)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        v = float(obj)
        if math.isnan(v):
            return None
        if math.isinf(v):
            return "inf" if v > 0 else "-inf"
        return v
    if isinstance(obj, (pd.Timestamp,)):
        return None if pd.isna(obj) else obj.isoformat()
    if obj is pd.NaT:
        return None
    if isinstance(obj, pd.Timedelta):
        return str(obj)
    if isinstance(obj, pd.DataFrame):
        return [to_jsonable(r) for r in obj.to_dict(orient="records")]
    if isinstance(obj, pd.Series):
        return to_jsonable(obj.to_dict())
    if isinstance(obj, np.ndarray):
        return [to_jsonable(x) for x in obj.tolist()]
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return to_jsonable(dataclasses.asdict(obj))
    if hasattr(obj, "to_dict") and callable(obj.to_dict):
        return to_jsonable(obj.to_dict())
    if isinstance(obj, Mapping):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [to_jsonable(x) for x in obj]
    return str(obj)


def write_result_json(result: Mapping[str, Any], path: str) -> None:
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    out = dict(result)
    out.pop("gate_sets", None)  # GateSet は stage_d の gates に結果が入っているので落とす
    with open(path, "w", encoding="utf-8") as f:
        json.dump(to_jsonable(out), f, ensure_ascii=False, indent=2)
