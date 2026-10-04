"""段階A〜E の入口(INTERFACES.md §6 の `stages.py`)。

並列実装で担当ごとにファイルが分かれたため、このファイルは「つなぎ役」に徹する:
- 段階B・C・軸の選定: `stages/stage_bc.py`(stage_b / select_axes / stage_c)
- 段階D・E・期間実行・Split:  `stages/stage_de.py`(stage_d / stage_e / run_period / Split)
- このファイルで実装するもの: build_all / make_split / stage_a(段階A)

`stages/` フォルダには `__init__.py` が無い(あると、このファイルを隠してしまう)。
そのため `stage_bc.py` / `stage_de.py` はファイルパスで読み込む(下の `_load_submodule`)。
テストが同じファイルを別途読み込んでいる場合は、読み込み済みのモジュールを再利用する。

ゲート基準値・スプレッド・スリッページはここでは作らない(未設定のまま扱い、判定は「保留」)。
"""
from __future__ import annotations

import importlib.util
import os
import sys
from typing import Any, Dict, List, Mapping, Optional

import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from core.config import Config  # noqa: E402
from core.data import build_dataset  # noqa: E402
from core.metrics import breakdown_by_side, breakdown_by_year  # noqa: E402
from core.params import Params, base_params  # noqa: E402


def _load_submodule(name: str, filename: str):
    """stages/<filename> をファイルパスで読み込む(読み込み済みなら再利用)。"""
    path = os.path.join(_HERE, "stages", filename)
    mod = sys.modules.get(name)
    if mod is not None and os.path.abspath(getattr(mod, "__file__", "") or "") == os.path.abspath(path):
        return mod
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # dataclass のために登録が必要
    spec.loader.exec_module(mod)
    return mod


stage_bc = _load_submodule("stage_bc", "stage_bc.py")
stage_de = _load_submodule("stage_de", "stage_de.py")

# ---- 再公開(run_all.py はここから関数を取る)---------------------------------------------
stage_b = stage_bc.stage_b
select_axes = stage_bc.select_axes
stage_c = stage_bc.stage_c
stage_d = stage_de.stage_d
stage_e = stage_de.stage_e
run_period = stage_de.run_period
Split = stage_de.Split
FreezeRegistry = stage_de.FreezeRegistry
RunResult = stage_de.RunResult

STAGE_NOTES: List[str] = [
    "段階B・C: 台地の判定しきい値(PlateauCriteria)と『効きの大きさ』の指標は、分析用の仮の目安。"
    "ea-lab のゲート基準ではない(引継書にもea-labにも数値指定が無いので、こちらで置いた)。",
    "段階B・C: 学習用期間の外(検証用期間)のデータは TrainDataset の型で締め出し、段階B・Cには渡していない。",
    "段階A: 基準設定は core.params.base_params()(引継書 第3章の基準案)。学習用/検証用の成績も参考に併記したが、"
    "設定の選択には使っていない(基準案は固定)。",
]


# =============================================================================================
# データ準備・分割
# =============================================================================================
def build_all(raw15: Mapping[str, pd.DataFrame], cfg: Config) -> Dict[str, pd.DataFrame]:
    """全ペアの build_dataset を作る(GMTずらし = cfg の値。0 なら基準)。

    GMTずらしを変えて作り直すときは、`build_all(raw15, cfg.with_gmt_shift(h))` で呼ぶ。
    """
    return {pair: build_dataset(df, cfg, pair) for pair, df in raw15.items()}


def make_split(ds_main: pd.DataFrame, cfg: Config, train_frac: float = 0.6) -> Split:
    """学習用/検証用の分割。

    cfg.split.train_end があればそれを使う(ユーザー指定)。無ければ全期間の train_frac 位置を月初に丸める。
    時間で分割する(ランダム分割はしない)。検証用期間を見てから変更しないこと(変更したら報告書に明記し、判定は保留寄り)。
    """
    ct = pd.DatetimeIndex(ds_main["close_time"])
    if len(ct) < 2:
        raise ValueError("データが少なすぎて学習用/検証用に分けられない")
    first, last = ct[0], ct[-1]
    if cfg.split.train_end:
        end = pd.Timestamp(cfg.split.train_end).as_unit("ns")
        if end.tzinfo is not None:
            end = end.tz_convert("UTC").tz_localize(None)
        if not first < end < last:
            raise ValueError(
                f"指定の train_end({end})がデータ範囲({first}〜{last})の内側にない。学習用・検証用の両方が必要。"
            )
        how = cfg.split.note
    else:
        end = stage_bc.month_start_split(ds_main, train_frac)
        how = f"全期間の{train_frac:.0%}位置を月初に丸めた(自動)"
    n_train = int((ct <= end).sum())
    note = (
        f"学習用: {first.date()}〜{end.date()}({n_train}本)/ 検証用: {end.date()}より後〜{last.date()}"
        f"({len(ct) - n_train}本)。分け方: {how}"
    )
    return Split(train_end=end, note=note)


# =============================================================================================
# 段階A
# =============================================================================================
def stage_a(
    datasets: Mapping[str, pd.DataFrame],
    cfg: Config,
    split: Any,
    *,
    pair: str = "USDJPY",
    params: Optional[Params] = None,
    df1m: Optional[pd.DataFrame] = None,
    runner: Any = None,
) -> Dict[str, Any]:
    """段階A: 原典準拠の基準設定(第3章の基準案)を1本だけ、主ペアで回す。

    戻り値: {"params": dict, "params_key": str, "pair": str,
             "all":   {"metrics","breakdown_year","breakdown_side","funnel","n_bars"},
             "train": {"metrics", ...同上}, "oos": {"metrics", ...同上}}
    all の funnel が『条件ごとの通過数』(取引が極端に少ないときに、どの条件で候補が消えるかを見る)。
    oos の funnel は全期間分の参考値(run_period の仕様)。
    """
    if pair not in datasets:
        raise ValueError(f"主ペア {pair} のデータが無い(あるのは {sorted(datasets)})")
    p = params or base_params()
    ds = datasets[pair]
    out: Dict[str, Any] = {"params": p.to_dict(), "params_key": p.key(), "pair": pair}
    for period in ("all", "train", "oos"):
        rr = run_period(ds, p, cfg, period, split, df1m, runner=runner)
        out[period] = {
            "metrics": rr.metrics,
            "breakdown_year": breakdown_by_year(rr.trades),
            "breakdown_side": breakdown_by_side(rr.trades),
            "funnel": rr.funnel,
            "n_bars": rr.n_bars,
        }
    return out
