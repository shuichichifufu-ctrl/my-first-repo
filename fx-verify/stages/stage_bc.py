"""段階B(1項目ずつ動かす感度分析)と段階C(限定グリッド+台地の中央選び)。

仕様の正本は引継書 第3〜5章・第8章と INTERFACES.md §6。このファイルは段階B・Cと
「学習用/検証用の時間分割(検証期間はここでは触れない型)」だけを担当する。

【読み込み方の注意】
INTERFACES.md では `stages.py`(段階A〜E、別担当)が `fx-verify/` 直下にある。
このファイルは `fx-verify/stages/stage_bc.py` に置かれているが、`stages/__init__.py` は作っていない
(作ると `stages.py` を隠してしまうため)。したがって `from stages.stage_bc import ...` は
`stages.py` と衝突して通らない場合がある。`stages.py` から使うときは次のようにファイルパスで読み込む::

    import importlib.util, os
    _p = os.path.join(os.path.dirname(__file__), "stages", "stage_bc.py")
    _spec = importlib.util.spec_from_file_location("stage_bc", _p)
    stage_bc = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(stage_bc)

(または `stages.py` の担当が、このファイルの中身を取り込んで `stage_b / select_axes / stage_c` を再公開する)。

【検証用期間に触れない仕組み(型で守る)】
- `TrainDataset`: 学習用期間だけを持つ入れ物。`close_time` が train_end を超える行があると作れない。
- 段階B・Cの本体(`sensitivity_analysis` / `limited_grid`)は `TrainDataset` しか受け取らない(型が違えば TypeError)。
- `SealedOOS`: 検証用期間(全期間データ)を封印しておく入れ物。段階B・Cには渡さない。
  `open(purpose)` で取り出すたびに `access_log` に理由が残る。悪意への防御ではなく、うっかり防止。
- INTERFACES の `stage_b(datasets, cfg, split, ...)` は、中で必ず `TrainDataset` に変換してから本体を呼ぶ。

【補完した点・判断(レポートの第9/10章に載せる)】
- 台地の判定しきい値(`PlateauCriteria`)は分析用の仮の目安。ea-lab のゲート基準ではない
  (引継書にもea-labにも数値指定が無いため、こちらで置いた値。結果の attrs に必ず記録する)。
- 比率方式(`pb_ratio_min+pb_ratio_max`)の水準は、`pb_mode='ratio'` を同時に設定して評価する
  (SENSITIVITY_REQUIRES に載っていないが、ratio 値は ratio モードでしか使われないため)。
- `d1_mode='D'`(日足条件なし)は「効き目を測る比較用」。軸の選定(効果の大きさの計算)と
  限定グリッドの水準からは除く。表には残す。
- 限定グリッドの「近傍」は、順序のある軸では隣の水準(±1)、順序のない軸(モード切替・真偽値など)では
  動かさない(隣り合う水準が意味を持たないため。各水準は順序のある軸方向の近傍で評価する)。近傍に自分自身は含めない。
- 台地の中央選び: まず『台地の点』(近傍の有効な点すべてとPF差が pf_tol 以内で、平均Rの符号が同じ点)だけを候補にし、
  その中で近傍平均 avg_r が最大の点を選ぶ。台地の点が無い・順序のある軸が無いときは選ばない(台地を作れない)。
"""
from __future__ import annotations

import itertools
import math
import os
import sys
from dataclasses import dataclass, field, fields
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

# fx-verify 直下を import パスに入れる(pytest 以外から読み込まれる場合に備える)
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from core.config import Config  # noqa: E402
from core.data import truncate_dataset  # noqa: E402
from core.metrics import compute_metrics  # noqa: E402
from core.params import (  # noqa: E402
    SENSITIVITY_GRID,
    SENSITIVITY_PAIRS,
    SENSITIVITY_REQUIRES,
    Params,
    base_params,
)
from core.schema import validate_funnel, validate_trades  # noqa: E402

# ======================================================================================
# 1. 学習用/検証用の時間分割(検証期間はこの段階で触れない)
# ======================================================================================


def month_start_split(ds: pd.DataFrame, train_frac: float = 0.6) -> pd.Timestamp:
    """全期間の train_frac 位置を『月初』に切り下げた時刻を返す(これを train_end に使う)。

    時間で分割する(ランダム分割はしない)。データの先頭〜train_end が学習用、それより後が検証用。
    月初に丸めるのは、期間の境目をキリのよい位置に固定して、後から動かしにくくするため。
    """
    if not 0.0 < train_frac < 1.0:
        raise ValueError("train_frac は 0〜1 の間(両端を含まない)")
    ct = pd.DatetimeIndex(ds["close_time"])
    if len(ct) < 2:
        raise ValueError("データが少なすぎて分割できない")
    first, last = ct[0], ct[-1]
    target = first + (last - first) * train_frac
    end = pd.Timestamp(year=target.year, month=target.month, day=1)
    if not first < end < last:
        raise ValueError(
            f"月初に丸めた分割点 {end} がデータ範囲({first}〜{last})の内側にならない。"
            "期間が短すぎる可能性。train_end を明示的に指定すること。"
        )
    return end


@dataclass(frozen=True)
class TrainDataset:
    """学習用期間だけのデータ。段階B・Cの本体はこの型しか受け取らない。

    作成時に `close_time <= train_end` を検査する(検証期間の足が1本でも混ざると作れない)。
    `df` は 1 通貨ペア分の build_dataset 出力を `truncate_dataset` で末尾だけ切ったもの。
    """

    df: pd.DataFrame
    train_end: pd.Timestamp
    pair: str = ""

    def __post_init__(self) -> None:
        if not isinstance(self.df, pd.DataFrame) or "close_time" not in self.df.columns:
            raise TypeError("TrainDataset.df は close_time 列を持つ DataFrame(build_dataset の出力)")
        if len(self.df) == 0:
            raise ValueError("学習用期間のデータが空")
        end = pd.Timestamp(self.train_end).as_unit("ns")
        object.__setattr__(self, "train_end", end)
        latest = pd.Timestamp(self.df["close_time"].max())
        if latest > end:
            raise ValueError(
                f"学習用データに train_end({end})より後の足が含まれている(最後の close_time={latest})。"
                "検証用期間が混ざるので受け付けない。"
            )
        if not self.pair and "pair" in self.df.columns:
            object.__setattr__(self, "pair", str(self.df["pair"].iloc[0]))

    @property
    def n_bars(self) -> int:
        return len(self.df)


class SealedOOS:
    """検証用期間(アウトオブサンプル)の封印。段階B・Cの関数には渡さない。

    全期間データを内部に持ち、`open(purpose)` で取り出したときだけ中身が見える。
    取り出しの履歴(`access_log`)が残るので、「検証用期間を見たか」を後から確認できる。
    """

    def __init__(self, full_df: pd.DataFrame, train_end: pd.Timestamp) -> None:
        self._df = full_df
        self.train_end = pd.Timestamp(train_end).as_unit("ns")
        self.n_oos_bars = int((full_df["close_time"] > self.train_end).sum())
        self.access_log: List[str] = []

    def open(self, purpose: str) -> pd.DataFrame:
        if not purpose or not purpose.strip():
            raise ValueError("検証用期間を取り出す理由(purpose)を必ず書くこと")
        self.access_log.append(purpose)
        return self._df

    def __repr__(self) -> str:  # 中身を表示しない
        return f"SealedOOS(train_end={self.train_end}, n_oos_bars={self.n_oos_bars}, opened={len(self.access_log)}回)"


@dataclass(frozen=True)
class DatasetSplit:
    train: TrainDataset
    oos: SealedOOS
    train_end: pd.Timestamp
    note: str = ""


def split_dataset(ds: pd.DataFrame, train_end, *, note: str = "") -> DatasetSplit:
    """1通貨ペアの build_dataset 出力を、時間で学習用と検証用に分ける。

    - train: close_time <= train_end の行だけ(TrainDataset。段階B・Cに渡してよい)
    - oos  : 全期間を封印(SealedOOS。段階B・Cには渡さない)
    検証用期間が空(train_end がデータ末尾以降)なら ValueError。
    """
    end = pd.Timestamp(train_end).as_unit("ns")
    last = pd.Timestamp(ds["close_time"].max())
    first = pd.Timestamp(ds["close_time"].min())
    if end >= last:
        raise ValueError(f"train_end({end})がデータ末尾({last})以降で、検証用期間が無い")
    if end <= first:
        raise ValueError(f"train_end({end})がデータ先頭({first})以前で、学習用期間が無い")
    train = TrainDataset(truncate_dataset(ds, end), end)
    return DatasetSplit(train=train, oos=SealedOOS(ds, end), train_end=end, note=note)


def truncate_1m(df1m: Optional[pd.DataFrame], train_end) -> Optional[pd.DataFrame]:
    """1分足を学習用期間だけに切る(1分足の確定時刻 time+1分 <= train_end)。None はそのまま。"""
    if df1m is None:
        return None
    end = pd.Timestamp(train_end).as_unit("ns")
    t = pd.DatetimeIndex(df1m["time"])
    return df1m[(t + pd.Timedelta(minutes=1)) <= end].copy()


def _as_train(datasets: Any, split: Any, pair: str) -> TrainDataset:
    """INTERFACES の (datasets, split, pair) から TrainDataset を作る。

    datasets[pair] が TrainDataset ならそのまま。DataFrame なら split.train_end で末尾を切る。
    """
    if isinstance(datasets, TrainDataset):
        return datasets
    if isinstance(datasets, Mapping):
        if pair not in datasets:
            raise KeyError(f"datasets に {pair} が無い(あるのは {sorted(datasets)})")
        obj = datasets[pair]
    else:
        obj = datasets
    if isinstance(obj, TrainDataset):
        return obj
    if isinstance(obj, SealedOOS):
        raise TypeError("SealedOOS(検証用期間)は段階B・Cに渡せない")
    if not isinstance(obj, pd.DataFrame):
        raise TypeError(f"datasets[{pair}] は DataFrame か TrainDataset: {type(obj)}")
    train_end = getattr(split, "train_end", None)
    if train_end is None:
        raise ValueError("split.train_end が必要(学習用期間の終わり)")
    return TrainDataset(truncate_dataset(obj, train_end), pd.Timestamp(train_end), pair)


# ======================================================================================
# 2. 台地判定の目安・順序のある項目の定義
# ======================================================================================


@dataclass(frozen=True)
class PlateauCriteria:
    """台地(隣の値でもなだらか)を判定するための目安。

    【重要】これは分析用の仮の目安で、ea-lab のゲート基準ではない。引継書にもea-labにも数値指定が
    無いため、こちらで置いた値。変更してよいが、使った値は結果の attrs / 戻り値に必ず記録される。
    """

    min_trades_for_analysis: int = 30  # この取引数未満の水準は『判定対象外』(ゲートの最低取引回数とは無関係)
    pf_tol: float = 0.25  # 隣り合う水準とのPF差がこれ以内なら『なだらか』
    min_valid_neighbor_frac: float = 0.5  # 段階C: 近傍のうち有効な点がこの割合以上の点だけ選ぶ

    def to_dict(self) -> Dict[str, Any]:
        d = {f.name: getattr(self, f.name) for f in fields(self)}
        d["note"] = "分析用の仮の目安。ea-labのゲート基準ではない"
        return d


# 値に大小の順序があり、『隣の水準』に意味がある項目(それ以外はモード切替・真偽値などで順序なし)
ORDINAL_PARAMS = frozenset(
    {
        "h1_cross_window",  # None(無期限)は最大扱い
        "h4_long_sma",
        "po_slope_bars",
        "hi_lookback",
        "hi_swing_fractal_n",
        "pb_touch_ema",
        "pb_min_bars",
        "tl_fractal_n",
        "tl_recent_m",
        "tl_expire_bars",
        "sl_margin_atr",
        "sl_max_h1_atr",  # None(上限なし)は最大扱い
        "tp1_fraction",
        "fixed_r",
        "pb_ratio_min+pb_ratio_max",
    }
)

# 組(ペア)項目に同時に設定する従属設定(補完。INTERFACES の SENSITIVITY_REQUIRES には無い)
PAIRS_REQUIRES: Dict[Tuple[str, ...], Dict[str, Any]] = {
    ("pb_ratio_min", "pb_ratio_max"): {"pb_mode": "ratio"},
}

# 『効き目を測る比較用』の水準。効果の大きさの計算・グリッドの水準からは除く(表には残す)
COMPARISON_ONLY: Dict[str, frozenset] = {"d1_mode": frozenset({"D"})}

# 列順は INTERFACES §6 の段階Bの表に合わせる(expectancy_r は avg_r と同値の追加列で末尾)
METRIC_COLS = ["n_trades", "win_rate", "pf", "avg_r", "total_r", "max_dd_r", "expectancy_r"]


def _ord_key(v: Any) -> Tuple[int, Any]:
    """順序のある項目の並べ替えキー。None は最大扱い(無期限・上限なし)。"""
    return (1, 0) if v is None else (0, v)


def _is_ordinal(param: str) -> bool:
    return param in ORDINAL_PARAMS


def _nan(x: Any) -> float:
    return float("nan") if x is None else float(x)


def _pf_diff(a: float, b: float) -> float:
    if math.isnan(a) or math.isnan(b):
        return float("nan")
    if math.isinf(a) and math.isinf(b):
        return 0.0
    if math.isinf(a) or math.isinf(b):
        return float("inf")
    return abs(a - b)


# ======================================================================================
# 3. バックテストの実行(キャッシュ付き)
# ======================================================================================

Runner = Callable[..., Tuple[pd.DataFrame, dict]]


def default_runner(df15: pd.DataFrame, params: Params, cfg: Config, df1m: Optional[pd.DataFrame] = None):
    """既定の実行関数 = strategy.run_backtest(INTERFACES §5)。strategy.py は別担当が作成する。"""
    try:
        from strategy import run_backtest
    except ImportError as e:  # pragma: no cover - strategy 未作成の環境向けの案内
        raise ImportError(
            "strategy.py(run_backtest)が見つからない。strategy 担当の実装を待つか、"
            "runner= に代わりの関数を渡すこと。"
        ) from e
    return run_backtest(df15, params, cfg, df1m)


def _metrics_row(trades: pd.DataFrame) -> Dict[str, Any]:
    m = compute_metrics(trades)
    return {
        "n_trades": int(m["n_trades"]),
        "win_rate": _nan(m["win_rate"]),
        "pf": _nan(m["pf"]),  # 算出不能(None)は NaN、負け0は inf
        "avg_r": _nan(m["avg_r"]),
        "expectancy_r": _nan(m["expectancy_r"]),
        "total_r": _nan(m["total_r"]),
        "max_dd_r": _nan(m["max_dd_r"]),
    }


class _Evaluator:
    """学習用データ上で Params を評価する。同じ設定(params.key())は1回だけ回す。

    コスト未設定(NotConfiguredError)は握りつぶさず、そのまま上に投げる。
    """

    def __init__(
        self,
        train: TrainDataset,
        cfg: Config,
        runner: Optional[Runner],
        df1m: Optional[pd.DataFrame],
        validate: bool,
    ) -> None:
        if not isinstance(train, TrainDataset):
            raise TypeError(
                f"学習用データ(TrainDataset)だけを受け取る。{type(train).__name__} は不可"
                "(検証用期間が混ざるのを防ぐため)。split_dataset() で分けること。"
            )
        self.train = train
        self.cfg = cfg
        self.runner = runner or default_runner
        self.df1m = truncate_1m(df1m, train.train_end)
        self.validate = validate
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.n_runs = 0

    @property
    def keys(self) -> List[str]:
        return list(self.cache)

    def evaluate(self, params: Params) -> Dict[str, Any]:
        key = params.key()
        if key in self.cache:
            return self.cache[key]
        trades, funnel = self.runner(self.train.df, params, self.cfg, self.df1m)
        self.n_runs += 1
        if self.validate:
            validate_trades(trades)
            validate_funnel(funnel)
        row = _metrics_row(trades)
        row["n_setup_po"] = int(funnel.get("long.setup_po", 0) + funnel.get("short.setup_po", 0))
        self.cache[key] = row
        return row


# ======================================================================================
# 4. 段階B: 1項目ずつ動かす感度分析
# ======================================================================================


def _build_cases(
    base: Params, grid: Mapping[str, Sequence[Any]], pairs_grid: Mapping[Tuple[str, ...], Sequence[Tuple[Any, ...]]]
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(評価するケース一覧, 無効で飛ばしたケース一覧)。"""
    cases: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []

    def add(param: str, value: Any, overrides: Dict[str, Any]) -> None:
        try:
            p = base.replace(**overrides)
            p.validate()
        except (ValueError, TypeError) as e:
            skipped.append({"param": param, "value": value, "reason": str(e)})
            return
        cases.append(
            {
                "param": param,
                "value": value,
                "params": p,
                "requires": {k: v for k, v in overrides.items() if k != param and k not in param.split("+")},
            }
        )

    for param, values in grid.items():
        req = dict(SENSITIVITY_REQUIRES.get(param, {}))
        for v in values:
            add(param, v, {**req, param: v})
    for names, values in pairs_grid.items():
        req = dict(PAIRS_REQUIRES.get(tuple(names), {}))
        label = "+".join(names)
        for tup in values:
            if len(tup) != len(names):
                raise ValueError(f"{label} の水準 {tup} の長さが項目数と合わない")
            add(label, tuple(tup), {**req, **dict(zip(names, tup))})
    return cases, skipped


def annotate_plateau(df: pd.DataFrame, criteria: Optional[PlateauCriteria] = None) -> pd.DataFrame:
    """段階Bの表に台地の判定列を足す(項目ごと・隣り合う水準どうしで比較)。

    追加列:
      ordinal         順序のある項目か(False=モード切替など。隣接比較はしない)
      valid           取引数が min_trades_for_analysis 以上で avg_r が算出できるか
      adj_pf_diff     隣の水準(有効なもの)とのPF差の最大(絶対値)。比較相手が無ければ NaN
      adj_avg_r_diff  同、平均Rの差の最大
      plateau_point   この水準が『隣とほぼ同じ成績で、符号も同じ』か。True/False、判定不能は <NA>
    """
    crit = criteria or PlateauCriteria()
    out = df.copy()
    n = len(out)
    ordinal = np.zeros(n, dtype=bool)
    valid = np.zeros(n, dtype=bool)
    adj_pf = np.full(n, np.nan)
    adj_r = np.full(n, np.nan)
    plateau: List[Optional[bool]] = [None] * n

    pf = out["pf"].to_numpy(dtype=float)
    avg = out["avg_r"].to_numpy(dtype=float)
    ntr = out["n_trades"].to_numpy(dtype=float)
    valid[:] = (ntr >= crit.min_trades_for_analysis) & ~np.isnan(avg)

    pos = {i: k for k, i in enumerate(out.index)}
    for param, grp in out.groupby("param", sort=False):
        idxs = [pos[i] for i in grp.index]
        is_ord = _is_ordinal(param)
        for i in idxs:
            ordinal[i] = is_ord
        if not is_ord:
            continue
        vals = out["value"].to_numpy(dtype=object)
        order = sorted(idxs, key=lambda i: _ord_key(vals[i]))
        for rank, i in enumerate(order):
            if not valid[i]:
                continue
            nbrs = [order[r] for r in (rank - 1, rank + 1) if 0 <= r < len(order) and valid[order[r]]]
            if not nbrs:
                continue
            adj_pf[i] = max(_pf_diff(pf[i], pf[j]) for j in nbrs)
            adj_r[i] = max(abs(avg[i] - avg[j]) for j in nbrs)
            same_sign = all((avg[j] > 0) == (avg[i] > 0) for j in nbrs)
            plateau[i] = bool((adj_pf[i] <= crit.pf_tol) and same_sign)

    out["ordinal"] = ordinal
    out["valid"] = valid
    out["adj_pf_diff"] = adj_pf
    out["adj_avg_r_diff"] = adj_r
    out["plateau_point"] = pd.array(plateau, dtype="boolean")
    return out


def _finite(a: Iterable[float]) -> np.ndarray:
    arr = np.asarray(list(a), dtype=float)
    return arr[np.isfinite(arr)]


def plateau_summary(df: pd.DataFrame, criteria: Optional[PlateauCriteria] = None) -> pd.DataFrame:
    """項目ごとの台地判定のまとめ(1項目=1行)。

    列: param, ordinal, n_levels, n_valid, pf_min, pf_max, pf_range, pf_cv, avg_r_min, avg_r_max, avg_r_range,
        max_adj_pf_diff, max_adj_avg_r_diff, best_value, best_avg_r, best_is_plateau, n_plateau_points, judgment, note
    効きの大きさ(range / cv / best)は、取引数が足りる水準だけで、比較用の水準(d1_mode=D)を除いて計算する。
    pf_cv = PFの変動係数(標準偏差/平均。有限なPFのみ。平均が0以下なら NaN)。
    judgment:
      '台地'                 最良の水準が、隣の水準とほぼ同じ成績(PF差が pf_tol 以内・符号同じ)
      '尖り'                 最良の水準が隣の水準と大きく違う(特定の値だけで跳ねている疑い)
      '判定不能(有効水準2)'  比べる相手が1つしかない
      '判定不能(有効水準不足)' 取引数が足りる水準が2未満
      '順序なし(比較のみ)'   モード切替・真偽値など。隣り合う水準の概念が無いので台地判定はしない
    """
    crit = criteria or PlateauCriteria()
    ann = df if {"ordinal", "valid", "plateau_point"} <= set(df.columns) else annotate_plateau(df, crit)
    rows: List[Dict[str, Any]] = []
    for param, grp in ann.groupby("param", sort=False):
        cmp_levels = COMPARISON_ONLY.get(param, frozenset())
        eff = grp[grp["valid"] & ~grp["value"].isin(list(cmp_levels))] if cmp_levels else grp[grp["valid"]]
        is_ord = bool(grp["ordinal"].iloc[0])
        pfs = _finite(eff["pf"])
        avgs = eff["avg_r"].to_numpy(dtype=float)
        n_valid = int(len(eff))
        row: Dict[str, Any] = {
            "param": param,
            "ordinal": is_ord,
            "n_levels": int(len(grp)),
            "n_valid": n_valid,
            "pf_min": float(pfs.min()) if len(pfs) else float("nan"),
            "pf_max": float(pfs.max()) if len(pfs) else float("nan"),
            "pf_range": float(pfs.max() - pfs.min()) if len(pfs) else float("nan"),
            "pf_cv": float(pfs.std() / pfs.mean()) if len(pfs) >= 2 and pfs.mean() > 0 else float("nan"),
            "avg_r_min": float(avgs.min()) if n_valid else float("nan"),
            "avg_r_max": float(avgs.max()) if n_valid else float("nan"),
            "avg_r_range": float(avgs.max() - avgs.min()) if n_valid else float("nan"),
            "max_adj_pf_diff": float(np.nanmax(eff["adj_pf_diff"])) if eff["adj_pf_diff"].notna().any() else float("nan"),
            "max_adj_avg_r_diff": float(np.nanmax(eff["adj_avg_r_diff"])) if eff["adj_avg_r_diff"].notna().any() else float("nan"),
        }
        best_value, best_avg, best_is_plateau = None, float("nan"), None
        if n_valid:
            b = eff.loc[eff["avg_r"].idxmax()]
            best_value, best_avg = b["value"], float(b["avg_r"])
            pp = b["plateau_point"]
            best_is_plateau = None if pd.isna(pp) else bool(pp)
        row.update(
            best_value=best_value,
            best_avg_r=best_avg,
            best_is_plateau=best_is_plateau,
            n_plateau_points=int(grp["plateau_point"].fillna(False).astype(bool).sum()),
        )
        if n_valid < 2:
            judgment = "判定不能(有効水準不足)"
        elif not is_ord:
            judgment = "順序なし(比較のみ)"
        elif n_valid == 2:
            judgment = "判定不能(有効水準2)"
        elif best_is_plateau:
            judgment = "台地"
        else:
            judgment = "尖り"
        row["judgment"] = judgment
        notes = []
        if cmp_levels:
            notes.append(f"比較用の水準{sorted(cmp_levels)}は効きの計算から除外")
        n_thin = int(len(grp) - grp["valid"].sum())
        if n_thin:
            notes.append(f"取引数不足で判定対象外の水準が{n_thin}個")
        row["note"] = " / ".join(notes)
        rows.append(row)
    return pd.DataFrame(rows)


def sensitivity_analysis(
    train: TrainDataset,
    base: Params,
    cfg: Config,
    *,
    grid: Mapping[str, Sequence[Any]] = SENSITIVITY_GRID,
    pairs_grid: Mapping[Tuple[str, ...], Sequence[Tuple[Any, ...]]] = SENSITIVITY_PAIRS,
    df1m: Optional[pd.DataFrame] = None,
    criteria: Optional[PlateauCriteria] = None,
    runner: Optional[Runner] = None,
    validate: bool = True,
) -> pd.DataFrame:
    """段階Bの本体。学習用データ(TrainDataset)だけを受け取る。

    他を base に固定して grid / pairs_grid の項目を1つずつ動かし、『項目×値』の表を返す。
    従属設定(SENSITIVITY_REQUIRES)は同時に設定する。
    列: param, value, is_base, params_key, n_trades, win_rate, pf, avg_r, total_r, max_dd_r, expectancy_r,
        n_setup_po, requires, ordinal, valid, adj_pf_diff, adj_avg_r_diff, plateau_point
    pf: 算出不能(取引0件)は NaN、負けが0なら inf。expectancy_r は avg_r と同じ値(1取引あたり期待値R)。
    attrs: n_trials(試した設定数=重複を除いた設定数。基準案=段階Aを含む), n_runs, plateau_summary, criteria, ...
    """
    crit = criteria or PlateauCriteria()
    ev = _Evaluator(train, cfg, runner, df1m, validate)
    base.validate()
    cases, skipped = _build_cases(base, grid, pairs_grid)
    base_key = base.key()
    ev.evaluate(base)  # 基準案(段階Aと同じ設定)は必ず先に回す

    rows: List[Dict[str, Any]] = []
    for c in cases:
        p: Params = c["params"]
        m = ev.evaluate(p)
        rows.append(
            {
                "param": c["param"],
                "value": c["value"],
                "is_base": p.key() == base_key,
                "params_key": p.key(),
                **{k: m[k] for k in METRIC_COLS},
                "n_setup_po": m["n_setup_po"],
                "requires": ", ".join(f"{k}={v}" for k, v in c["requires"].items()),
            }
        )
    df = pd.DataFrame(rows)
    df = annotate_plateau(df, crit)
    df.attrs.update(
        {
            "stage": "B",
            "period": "train",
            "pair": train.pair,
            "train_end": str(train.train_end),
            "base_params": base.to_dict(),
            "base_key": base_key,
            "n_trials": len(ev.keys),
            "n_runs": ev.n_runs,
            "criteria": crit.to_dict(),
            "skipped": skipped,
            "plateau_summary": plateau_summary(df, crit),
        }
    )
    return df


def stage_b(
    datasets: Any,
    cfg: Config,
    split: Any,
    *,
    pair: str = "USDJPY",
    base: Optional[Params] = None,
    grid: Mapping[str, Sequence[Any]] = SENSITIVITY_GRID,
    pairs_grid: Mapping[Tuple[str, ...], Sequence[Tuple[Any, ...]]] = SENSITIVITY_PAIRS,
    df1m: Optional[pd.DataFrame] = None,
    criteria: Optional[PlateauCriteria] = None,
    runner: Optional[Runner] = None,
    validate: bool = True,
) -> pd.DataFrame:
    """INTERFACES §6 の段階B。学習用期間のみ(split.train_end で末尾を切ってから回す)。

    datasets: {pair: build_dataset の出力(または TrainDataset)}、split: train_end を持つ Split。
    戻り値と attrs は `sensitivity_analysis` を参照(attrs["n_trials"] = 試した設定数)。
    """
    train = _as_train(datasets, split, pair)
    return sensitivity_analysis(
        train, base or base_params(), cfg, grid=grid, pairs_grid=pairs_grid, df1m=df1m,
        criteria=criteria, runner=runner, validate=validate,
    )


# ======================================================================================
# 5. 軸の選定(段階Bで効いた項目)
# ======================================================================================


class AxesSelection(dict):
    """select_axes の戻り値。{field: [values]} の dict で、選定理由を属性に持つ。

    reasons : 選ばれた項目ごとの理由(順位・効きの大きさ・台地判定)
    excluded: 候補から外した項目と理由
    criteria: 使った目安(PlateauCriteria.to_dict())
    """

    reasons: List[Dict[str, Any]]
    excluded: List[Dict[str, Any]]
    criteria: Dict[str, Any]

    def __init__(self, *a: Any, **kw: Any) -> None:
        super().__init__(*a, **kw)
        self.reasons = []
        self.excluded = []
        self.criteria = {}


def select_axes(
    stage_b_df: pd.DataFrame,
    top_k: int = 4,
    *,
    criteria: Optional[PlateauCriteria] = None,
) -> AxesSelection:
    """段階Bで平均Rの動きが大きい項目を top_k 個(目安は3〜4)選び、{field: [水準]} を返す。

    効きの大きさ = 取引数が足りる水準どうしの avg_r の幅(最大-最小)。同じなら PF の幅。
    候補から外すもの:
      - 従属設定の項目(SENSITIVITY_REQUIRES: hi_swing_fractal_n / tl_recent_m / fixed_r)
        … 特定モードのときだけ意味を持つため。モード側の項目(hi_mode 等)が選ばれればよい
      - 組の項目(a+b) … 単独の軸として扱えない
      - 取引数が足りる水準が2つ未満の項目
    水準は、取引数が足りる水準のみ(比較用の d1_mode=D は除く)。段階Bの表の並び順を保つ。
    """
    if top_k < 1:
        raise ValueError("top_k は1以上(目安は3〜4)")
    attrs_crit = stage_b_df.attrs.get("criteria")
    crit = criteria or (PlateauCriteria(**{k: v for k, v in attrs_crit.items() if k != "note"}) if attrs_crit else PlateauCriteria())
    ann = annotate_plateau(stage_b_df, crit)
    summ = plateau_summary(ann, crit)
    sel = AxesSelection()
    sel.criteria = crit.to_dict()

    cands = []
    for _, r in summ.iterrows():
        p = r["param"]
        if "+" in p:
            sel.excluded.append({"param": p, "reason": "組の項目は軸にしない"})
        elif p in SENSITIVITY_REQUIRES:
            sel.excluded.append({"param": p, "reason": f"従属設定(特定モード {SENSITIVITY_REQUIRES[p]} のときだけ有効)"})
        elif r["n_valid"] < 2 or math.isnan(r["avg_r_range"]):
            sel.excluded.append({"param": p, "reason": "取引数が足りる水準が2つ未満"})
        else:
            cands.append(r)
    cands.sort(key=lambda r: (-r["avg_r_range"], -(0.0 if math.isnan(r["pf_range"]) else r["pf_range"]), r["param"]))

    for rank, r in enumerate(cands[:top_k], start=1):
        p = r["param"]
        cmp_levels = COMPARISON_ONLY.get(p, frozenset())
        g = ann[(ann["param"] == p) & ann["valid"]]
        values = [v for v in g["value"].tolist() if v not in cmp_levels]
        sel[p] = values
        sel.reasons.append(
            {
                "rank": rank,
                "param": p,
                "values": values,
                "avg_r_range": float(r["avg_r_range"]),
                "pf_range": float(r["pf_range"]),
                "judgment": r["judgment"],
                "reason": f"avg_r の幅が{rank}番目に大きい({r['avg_r_range']:.3f}R)。台地判定: {r['judgment']}",
            }
        )
    for r in cands[top_k:]:
        sel.excluded.append({"param": r["param"], "reason": f"効きの大きさが上位{top_k}項目に入らない(avg_r幅={r['avg_r_range']:.3f}R)"})
    return sel


# ======================================================================================
# 6. 段階C: 限定グリッドと『台地の中央』選び
# ======================================================================================


def _axis_levels(axes: Mapping[str, Sequence[Any]]) -> Dict[str, List[Any]]:
    """軸の水準を整える(重複を除く。順序のある軸は昇順、それ以外は渡された順)。"""
    known = {f.name for f in fields(Params)}
    out: Dict[str, List[Any]] = {}
    for f_name, values in axes.items():
        if f_name not in known:
            raise ValueError(f"未知の軸: {f_name}(Params のフィールド名であること)")
        uniq: List[Any] = []
        for v in values:
            if v not in uniq:
                uniq.append(v)
        if not uniq:
            raise ValueError(f"軸 {f_name} の水準が空")
        if _is_ordinal(f_name):
            uniq.sort(key=_ord_key)
        out[f_name] = uniq
    if not out:
        raise ValueError("軸が1つも無い(select_axes の結果が空の可能性)")
    return out


def _neighbors(
    idx: Tuple[int, ...], sizes: Sequence[int], ordinal: Sequence[bool], kind: str, include_self: bool = True
) -> List[Tuple[int, ...]]:
    """格子点 idx の近傍。順序のある軸のみ ±1(順序のない軸は動かさない)。

    kind='box'  : 各軸で隣を含む組み合わせ全部(チェビシェフ距離1)
    kind='cross': 動かすのは1軸だけ(自分+各軸の隣)
    include_self: True(既定)なら自分自身も含める。段階Cの選定は False(自分自身の成績を近傍の評価に混ぜない)で呼ぶ。
    """
    steps = [(-1, 0, 1) if o else (0,) for o in ordinal]
    out: List[Tuple[int, ...]] = []
    if kind == "box":
        for off in itertools.product(*steps):
            nb = tuple(i + d for i, d in zip(idx, off))
            if all(0 <= x < s for x, s in zip(nb, sizes)):
                out.append(nb)
    elif kind == "cross":
        out.append(idx)
        for a, st in enumerate(steps):
            for d in st:
                if d == 0:
                    continue
                nb = list(idx)
                nb[a] += d
                if 0 <= nb[a] < sizes[a]:
                    out.append(tuple(nb))
    else:
        raise ValueError("neighborhood は 'box' か 'cross'")
    if not include_self:
        out = [nb for nb in out if nb != tuple(idx)]
    return out


def limited_grid(
    train: TrainDataset,
    base: Params,
    cfg: Config,
    axes: Mapping[str, Sequence[Any]],
    *,
    df1m: Optional[pd.DataFrame] = None,
    stage_b_df: Optional[pd.DataFrame] = None,
    criteria: Optional[PlateauCriteria] = None,
    runner: Optional[Runner] = None,
    validate: bool = True,
    max_combos: int = 2000,
    neighborhood: str = "box",
) -> Dict[str, Any]:
    """段階Cの本体。学習用データ(TrainDataset)だけを受け取る。

    axes の全組み合わせを回し、次の手順で『台地の中央』を選ぶ(最高成績の点は選ばない)。
      1. 各点の近傍(自分自身を除く。順序のある軸の隣の水準だけ)を取る。
      2. 『台地の点』= 取引数が足りて、近傍の有効な点すべてと「PF差が pf_tol 以内、かつ平均Rの符号が同じ」な点。
         尖った山・谷・符号が変わる点はここで落ちる。台地の点が1つも無ければ選ばない(chosen_params=None)。
      3. 台地の点のうち、近傍が揃っている(端でない)点から、近傍平均 avg_r(自分自身を除く)が最大の点を選ぶ。
    順序のない軸(モード切替など)の水準どうしは隣と見なさない。各水準は、順序のある軸方向の近傍で評価する。
    順序のある軸が1つも無いグリッドでは近傍が作れないので台地を判定できず、選ばない(『台地を作れない』と記録)。
    自分自身の avg_r は選定に使わない(台地の判定で、近傍との差・符号の一致を見るときだけ使う)。
    戻り値は `stage_c` を参照。
    """
    crit = criteria or PlateauCriteria()
    ev = _Evaluator(train, cfg, runner, df1m, validate)
    base.validate()
    levels = _axis_levels(axes)
    names = list(levels)
    sizes = [len(levels[n]) for n in names]
    ordinal = [_is_ordinal(n) for n in names]
    n_combos = int(np.prod(sizes))
    if n_combos > max_combos:
        raise ValueError(f"組み合わせが{n_combos}通りで max_combos={max_combos} を超える。軸か水準を絞ること。")

    # 従属設定(例 tl_recent_m の軸 → tl_mode='recent_high')。必要な設定が軸に無いときだけ全点に固定で入れる
    fixed: Dict[str, Any] = {}
    for n in names:
        for rk, rv in SENSITIVITY_REQUIRES.get(n, {}).items():
            if rk not in levels:
                fixed[rk] = rv
    base_key = base.key()

    points: Dict[Tuple[int, ...], Dict[str, Any]] = {}
    key_to_idx: Dict[str, Tuple[int, ...]] = {}
    skipped: List[Dict[str, Any]] = []
    for idx in itertools.product(*[range(s) for s in sizes]):
        over = {n: levels[n][i] for n, i in zip(names, idx)}
        try:
            p = base.replace(**fixed, **over)
            p.validate()
        except (ValueError, TypeError) as e:
            skipped.append({"point": over, "reason": str(e)})
            continue
        m = ev.evaluate(p)
        key_to_idx.setdefault(p.key(), idx)
        points[idx] = {
            **{n: levels[n][i] for n, i in zip(names, idx)},
            "params_key": p.key(),
            "is_base": p.key() == base_key,
            **{k: m[k] for k in METRIC_COLS},
            "n_setup_po": m["n_setup_po"],
        }

    if not points:
        raise ValueError("有効な設定が1つも無い")

    # 近傍の集計(近傍は自分自身を除く)と、台地の点の判定
    valid_of = {
        idx: bool(r["n_trades"] >= crit.min_trades_for_analysis and not math.isnan(r["avg_r"]))
        for idx, r in points.items()
    }
    for idx, r in points.items():
        geo = _neighbors(idx, sizes, ordinal, neighborhood, include_self=False)  # 格子上の近傍(欠けた点を含む)
        existing = [nb for nb in geo if nb in points]
        vnb = [nb for nb in existing if valid_of[nb]]
        r["valid"] = valid_of[idx]
        r["nbr_slots"] = len(geo)
        r["nbr_valid"] = len(vnb)
        r["nbr_avg_r"] = r["nbr_min_avg_r"] = r["nbr_max_pf_diff"] = float("nan")
        r["plateau_point"] = False
        if valid_of[idx] and vnb:
            vals = np.array([points[nb]["avg_r"] for nb in vnb], dtype=float)
            r["nbr_avg_r"] = float(vals.mean())
            r["nbr_min_avg_r"] = float(vals.min())
            diffs = [_pf_diff(float(r["pf"]), float(points[nb]["pf"])) for nb in vnb]
            if not any(math.isnan(d) for d in diffs):
                r["nbr_max_pf_diff"] = float(max(diffs))
            same_sign = all((points[nb]["avg_r"] > 0) == (r["avg_r"] > 0) for nb in vnb)
            # nan(PFが算出できない)は『なだらか』と言えないので台地にしない
            r["plateau_point"] = bool(all(d <= crit.pf_tol for d in diffs) and same_sign)

    cols = names + ["params_key", "is_base"] + METRIC_COLS + [
        "n_setup_po", "valid", "nbr_slots", "nbr_valid", "nbr_avg_r", "nbr_min_avg_r", "nbr_max_pf_diff",
        "plateau_point",
    ]
    res = pd.DataFrame([points[i] for i in sorted(points)])[cols].reset_index(drop=True)
    res["is_chosen"] = False

    # ---- 選定: 台地の点のうち、近傍平均 avg_r(自分自身を除く)が最大の点(最高成績の点ではない) ----
    ordered_axes = [n for n, o in zip(names, ordinal) if o]
    unordered_axes = [n for n, o in zip(names, ordinal) if not o]
    max_slots = int(res["nbr_slots"].max())
    note_relax: List[str] = []
    warn: List[str] = []
    n_plateau = int((res["valid"] & res["plateau_point"]).sum())
    cand = res[res["valid"] & res["plateau_point"] & res["nbr_avg_r"].notna() & (res["nbr_slots"] > 0)]
    c1 = cand[(cand["nbr_valid"] / cand["nbr_slots"].clip(lower=1)) >= crit.min_valid_neighbor_frac]
    if len(c1) == 0 and len(cand) > 0:
        note_relax.append("近傍の有効点割合の条件を満たす台地の点が無く、条件を緩めた")
        c1 = cand
    c2 = c1[c1["nbr_slots"] == max_slots]  # 近傍が最も揃っている(格子の中央寄り)点に限る
    if len(c2) == 0 and len(c1) > 0:
        note_relax.append("近傍が揃った台地の点が無く、端の点も候補に含めた")
        c2 = c1

    rule = (
        "最高成績の点ではなく『台地の中央』を選ぶ: 近傍は自分自身を除く"
        f"({'各軸で隣の水準を含む全組み合わせ' if neighborhood == 'box' else '各軸の隣'}。"
        "順序のない軸の水準どうしは隣と見なさず、順序のある軸方向の近傍で評価する)。"
        f"まず『台地の点』= 取引数{crit.min_trades_for_analysis}以上で、近傍の有効な点すべてとPF差が{crit.pf_tol}以内かつ"
        "平均Rの符号が同じ点だけを候補にする(尖った山・符号の変わる点は落ちる)。"
        f"さらに近傍の有効点が{crit.min_valid_neighbor_frac:.0%}以上・近傍が最も揃った点(端でない点)に限り、"
        "その中で近傍の平均 avg_r(自分自身を除く)が最大の点を選ぶ。"
        "同点は 近傍の有効点数→近傍の最悪avg_r→設定キー順。"
        "自分自身の avg_r は選定の順位づけには使わない(台地の判定で、近傍との差・符号の一致を見るときだけ使う)。"
        "台地の点が無いときは選ばない。"
    )

    chosen_params: Optional[Dict[str, Any]] = None
    info: Dict[str, Any] = {
        "relaxed": note_relax, "n_candidates": int(len(c2)), "n_plateau_points": n_plateau,
        "ordered_axes": ordered_axes, "unordered_axes": unordered_axes, "warnings": warn,
    }
    if unordered_axes:
        warn.append(
            "順序のない軸(" + "・".join(unordered_axes) + ")の水準どうしは隣と見なさない。各水準は、順序のある軸方向の近傍で"
            "評価している(順序のある軸が無いと台地を判定できない)。"
        )
    if len(c2) > 0:
        ordered = c2.sort_values(
            ["nbr_avg_r", "nbr_valid", "nbr_min_avg_r", "params_key"],
            ascending=[False, False, False, True],
            kind="mergesort",
        )
        pick = ordered.iloc[0]
        res.loc[res["params_key"] == pick["params_key"], "is_chosen"] = True
        over = {n: levels[n][i] for n, i in zip(names, key_to_idx[pick["params_key"]])}  # 元の Python の値
        chosen = base.replace(**fixed, **over)
        chosen_params = chosen.to_dict()
        vres = res[res["valid"]]
        best_own = vres.loc[vres["avg_r"].idxmax()]
        own_rank = int((vres["avg_r"] > pick["avg_r"]).sum()) + 1
        info.update(
            chosen_values={n: over[n] for n in names},
            chosen_params_key=chosen.key(),
            chosen_avg_r=float(pick["avg_r"]),
            chosen_nbr_avg_r=float(pick["nbr_avg_r"]),
            chosen_nbr_max_pf_diff=float(pick["nbr_max_pf_diff"]),
            chosen_n_trades=int(pick["n_trades"]),
            chosen_own_rank=own_rank,
            chosen_is_own_best=bool(pick["params_key"] == best_own["params_key"]),
            best_own_values={n: best_own[n] for n in names},
            best_own_avg_r=float(best_own["avg_r"]),
            best_own_nbr_avg_r=float(best_own["nbr_avg_r"]) if not math.isnan(best_own["nbr_avg_r"]) else None,
            chosen_nbr_avg_r_positive=bool(pick["nbr_avg_r"] > 0),
        )
        if info["chosen_is_own_best"]:
            warn.append(
                "選んだ点は、自分自身の成績も全点で最高だった。台地の点の条件(近傍とPF差が小さく符号が同じ)は満たしているが、"
                "最高点と台地の中央が一致しただけで尖っていないか、近傍の値を見て確認すること。"
            )
    elif not points or not bool(res["valid"].any()):
        info["note"] = "取引数が足りる点が無く、選べなかった(chosen_params=None)。段階Dに進む設定が無い"
    elif not ordered_axes or max_slots == 0:
        info["no_plateau"] = True
        info["no_plateau_reason"] = "no_ordered_axis"
        info["note"] = (
            "順序のある軸が1つも無い(または水準が1つしかない)ため、隣の水準が作れず台地を判定できない。"
            "台地を作れず、選べなかった(chosen_params=None)。最高点をそのまま選ぶことはしない"
        )
        warn.append("台地を作れない: 順序のない軸だけのグリッドでは、台地の中央を選べない。")
    else:
        info["no_plateau"] = True
        info["no_plateau_reason"] = "no_plateau_point"
        info["note"] = (
            "取引数が足りる点はあるが、近傍とPF差が小さく符号も同じ『台地の点』が1つも無かった"
            f"(台地の点 {n_plateau} 件)。台地を作れず、選べなかった(chosen_params=None)。"
            "最高点をそのまま選ぶことはしない(尖った山・曲線当てはめの疑い)"
        )
        warn.append("台地を作れない: 成績が設定ごとに大きく変わり、なだらかな領域が無い。")

    # ---- 試行総数(多重検定の目安): 段階A+B+C の重複を除いた設定数 ----
    keys_c = set(ev.keys)
    keys_a = {base_key}
    keys_b = set(stage_b_df["params_key"]) if stage_b_df is not None and "params_key" in stage_b_df.columns else set()
    total = len(keys_a | keys_b | keys_c)
    detail = {
        "A": 1,
        "B": len(keys_b) if stage_b_df is not None else None,
        "C": len(keys_c),
        "C_new_vs_AB": len(keys_c - keys_a - keys_b),
        "grid_size": n_combos,
        "n_runs_stage_c": ev.n_runs,
        "total_distinct": total,
        "stage_b_included": stage_b_df is not None,
        "is_lower_bound": stage_b_df is None,
    }
    if stage_b_df is None:
        detail["note"] = "stage_b_df が渡されなかったため、段階Bの試行数を含まない下限値(A+Cのみ)"

    res.attrs.update({"stage": "C", "period": "train", "pair": train.pair, "train_end": str(train.train_end)})
    return {
        "results": res,
        "n_trials": total,
        "n_trials_detail": detail,
        "axes": {n: list(levels[n]) for n in names},
        "fixed_overrides": fixed,
        "chosen_params": chosen_params,
        "selection_rule": rule,
        "selection_info": info,
        "neighborhood": neighborhood,
        "criteria": crit.to_dict(),
        "skipped": skipped,
        "pair": train.pair,
        "train_end": str(train.train_end),
        "base_params": base.to_dict(),
    }


def stage_c(
    datasets: Any,
    cfg: Config,
    split: Any,
    *,
    pair: str = "USDJPY",
    base: Optional[Params] = None,
    axes: Mapping[str, Sequence[Any]],
    df1m: Optional[pd.DataFrame] = None,
    stage_b_df: Optional[pd.DataFrame] = None,
    criteria: Optional[PlateauCriteria] = None,
    runner: Optional[Runner] = None,
    validate: bool = True,
    max_combos: int = 2000,
    neighborhood: str = "box",
) -> Dict[str, Any]:
    """INTERFACES §6 の段階C。学習用期間のみ。

    戻り値:
      results           DataFrame(各軸+指標+近傍平均 nbr_avg_r(自分自身を除く)・nbr_max_pf_diff・plateau_point+is_chosen)
      n_trials          段階A+B+Cで試した設定の総数(重複を除く。多重検定の目安)。
                        stage_b_df を渡さないと段階Bを含まない下限値(n_trials_detail に明記)
      n_trials_detail   内訳 {A, B, C, C_new_vs_AB, grid_size, total_distinct, ...}
      axes              {field: 水準} 実際に使った軸
      chosen_params     選んだ設定(Params.to_dict())。選べなければ None(Params.from_dict で復元)。
                        台地の点が無い・順序のある軸が無いときも None(selection_info に no_plateau=True と理由)
      selection_rule    選び方の説明(日本語)
      selection_info    選んだ点の詳細(自分自身の順位・最高点との違いなど)
    """
    train = _as_train(datasets, split, pair)
    return limited_grid(
        train, base or base_params(), cfg, axes, df1m=df1m, stage_b_df=stage_b_df, criteria=criteria,
        runner=runner, validate=validate, max_combos=max_combos, neighborhood=neighborhood,
    )
