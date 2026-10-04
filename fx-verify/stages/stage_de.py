"""段階D(検証用期間・横展開・GMTずらし + ゲート判定)と段階E(ランダムエントリーとの比較)。

仕様の正本は引継書 第3〜5章・第8章と INTERFACES.md §6。このファイルは段階D・Eだけを担当する。

【読み込み方の注意】(stage_bc.py と同じ事情)
`stages/__init__.py` は無い(作ると別担当の `stages.py` を隠すため)。`stages.py` から使うときは
ファイルパスで読み込むか、中身を取り込んで `stage_d / stage_e` を再公開する::

    import importlib.util, os, sys
    _p = os.path.join(os.path.dirname(__file__), "stages", "stage_de.py")
    _spec = importlib.util.spec_from_file_location("stage_de", _p)
    stage_de = importlib.util.module_from_spec(_spec)
    sys.modules["stage_de"] = stage_de            # dataclass のために必要
    _spec.loader.exec_module(stage_de)

【段階D】固定した設定(段階Cで台地の中央から選んだもの)を『再調整なし』で当てる。
  区間(INTERFACES §6 の stage_d と同じ):
    (主ペア, 学習用) / (主ペア, 検証用) / 他ペア全期間(EURUSD・GBPUSD・EURJPY・任意でAUDUSD) /
    各ペアのGMTずらし(既定 -1, +1。0は既出)
  各区間に core.gates のゲートを当てる。基準値(閾値)が未転記なら verdict は「保留」(それが正しい挙動)。
  このファイルに閾値を書かない。

【設定の凍結(FreezeRegistry)】― 『検証用期間・他ペアの結果を見てから選び直す』ことを防ぐ
  - 選んだ設定(Params + 主ペア + train_end)をハッシュ化して記録する(JSONファイルに残せる)。
  - 段階D/Eを回すと『検証用期間を見た』ことが記録される。
  - その後に別の設定で段階D/Eを回す(=選び直し)と、`ReselectionWarning` を出し、
    記録に `reselected=True` を立てる(以後ずっと消えない。レポートの meta.reselected に渡す → 判定は保留寄り)。
  - 検証用期間を見る前に設定を差し替えるのは許す(警告だけ出す。reselected にはしない)。
  - 記録はイベントを連鎖ハッシュで繋いでいる。ファイルを手で書き換えると整合性エラーとして検出し、
    『選び直し扱い』にする。これは悪意への防御ではなく、うっかり・無自覚な書き換えの防止。
  - やり直したいときの正規の手順は「記録ファイルを削除する」(= 新しい検証の開始。レポートに理由を書くこと)。

【段階E】同じ D1〜D3(環境認識)と D8・D9(決済)のまま、D4〜D7 のエントリーだけを
  『方向一致時のランダム時刻』に置き換えた strategy.run_benchmark_random を n_runs 回(seed, seed+1, ...)回し、
  実戦略の成績がランダムの分布の中でどこに位置するか(パーセンタイル)を出す。
  取引頻度: 各ランダム試行は実戦略の取引数と同数(strategy 側の仕様)。実際に揃ったかを `freq_matched` に記録する。
  検証用期間(oos)の比較: ランダムの候補を検証用期間だけに絞るため、学習用期間の行の
  `ema320` と `atr14` を NaN にしてから渡す(strategy の『ready = 使う列が非NaN』に依存。INTERFACES §5.1)。
  それでも学習用期間に入った取引があれば捨てて、その数を `n_filtered_outside_period` に残す。

【補完した点・判断(レポートの第9/10章に載せる)】 → モジュール変数 STAGE_DE_NOTES
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import tempfile
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

# fx-verify 直下を import パスに入れる(pytest 以外から読み込まれる場合に備える)
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from core.config import Config, NotConfiguredError  # noqa: E402
from core.data import build_dataset, truncate_dataset  # noqa: E402
from core.gates import (  # noqa: E402
    FAIL,
    HOLD,
    PASS,
    PHASE0_GATE,
    PROMOTION_GATE,
    GateSet,
    evaluate_gate_set,
)
from core.metrics import breakdown_by_side, breakdown_by_year, compute_metrics  # noqa: E402
from core.params import Params  # noqa: E402
from core.schema import TRADE_COLUMNS, funnel_keys, validate_funnel, validate_trades  # noqa: E402

MAIN_PAIR = "USDJPY"
CROSS_PAIRS_REQUIRED = ("EURUSD", "GBPUSD", "EURJPY")  # 引継書 第1章の既定案
CROSS_PAIRS_OPTIONAL = ("AUDUSD",)  # 『必要なら』
DEFAULT_GMT_SHIFTS = (-1, 0, 1)
DEFAULT_N_RUNS = 200  # 指示は『例200回』。INTERFACES の既定値(100)より多くしてある
PERIODS = ("all", "train", "oos")

# 段階Eの oos で『学習用期間の行を候補から外す』ために NaN にする列(strategy の ready 判定に使われる列)
MASK_COLUMNS = ("ema320", "atr14")

STAGE_DE_NOTES: List[str] = [
    "段階D: GMTずらしの区間は、主ペアは検証用期間(oos)、他ペアは全期間で評価する"
    "(引継書は『各ペアのGMTずらし』としか書いていない。補完。gmt_shift_period_main で変更可)。",
    "段階D: 検証用期間(oos)の取引は『全期間でバックテストし、entry_time > train_end の取引だけ残す』"
    "(INTERFACES §6)。指標のウォームアップは済んでいるが、学習用期間から持ち越したポジションが"
    "検証用期間の最初の約定を妨げることがある。train_end ちょうどに約定する取引は学習用にも検証用にも入らない。",
    "段階D: ゲートの基準値は core/gates.py(ea-lab から転記するまで空)。未転記の間、各区間・集計の verdict は『保留』。",
    "段階E: 検証用期間のランダム比較は、学習用期間の行の ema320 と atr14 を NaN にして候補から外す方式"
    "(strategy.run_benchmark_random に期間指定が無いため。strategy の ready 判定に依存)。",
    "段階E: 実戦略より平均Rが低いランダム試行の割合を percentile とした(同値は含めない)。"
    "同値を半分数える版(_mid)と、片側の経験的p値(p_value_avg_r)も併記。『優位』と読む閾値はここでは決めない。",
    "段階E: 乱数は seed, seed+1, ... を各試行に使う。区間ごとに同じ seed 列を使う(区間ごとにデータが違うので抽選は別物になる)。",
    "凍結: ハッシュの対象は Params・主ペア・train_end。検証対象ペアやGMTずらしの変更は凍結とは別に記録し、"
    "検証用期間を見た後に検証対象ペアが変わると警告する(選び直し扱いにはしない。理由をレポートに書くこと)。",
]


class ReselectionWarning(UserWarning):
    """検証用期間・他ペアの結果を見た後に、設定を選び直したときの警告。"""


# ======================================================================================
# 1. 小さな部品(分割・空の結果・1分足の切り出し・JSON化)
# ======================================================================================


@dataclass(frozen=True)
class Split:
    """学習用/検証用の分割(INTERFACES §6 の Split と同じ形。別の型でも train_end があれば受け付ける)。"""

    train_end: pd.Timestamp
    note: str = ""


def train_end_of(split: Any) -> pd.Timestamp:
    """Split / dict / 文字列 / Timestamp から train_end(UTC・tzなし)を取り出す。"""
    if hasattr(split, "train_end"):
        v = split.train_end
    elif isinstance(split, Mapping) and "train_end" in split:
        v = split["train_end"]
    else:
        v = split
    if v is None:
        raise ValueError("train_end が未設定(学習用/検証用の分割が必要)")
    ts = pd.Timestamp(v)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    return ts.as_unit("ns")


def split_note_of(split: Any) -> str:
    if hasattr(split, "note"):
        return str(split.note)
    if isinstance(split, Mapping):
        return str(split.get("note", ""))
    return ""


def empty_trades() -> pd.DataFrame:
    """取引0件の DataFrame(列だけ持つ)。"""
    return pd.DataFrame({c: pd.Series(dtype="object") for c in TRADE_COLUMNS})


def empty_funnel(n_bars: int = 0) -> Dict[str, int]:
    f = {k: 0 for k in funnel_keys()}
    f["bars_total"] = int(n_bars)
    return f


def _truncate_1m(df1m: Optional[pd.DataFrame], train_end: pd.Timestamp) -> Optional[pd.DataFrame]:
    """1分足を学習用期間だけに切る(確定時刻 time+1分 <= train_end)。None はそのまま。"""
    if df1m is None:
        return None
    t = pd.DatetimeIndex(df1m["time"])
    return df1m[(t + pd.Timedelta(minutes=1)) <= train_end].copy()


def to_jsonable(obj: Any) -> Any:
    """結果を JSON に書けるように変換する(numpy → Python、inf/NaN → 文字列、Timestamp → 文字列、DataFrame は除く)。"""
    if isinstance(obj, Mapping):
        return {(k if isinstance(k, (str, int)) else str(k)): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        if math.isnan(f):
            return "nan"
        if math.isinf(f):
            return "inf" if f > 0 else "-inf"
        return f
    if isinstance(obj, (pd.Timestamp, datetime)):
        return str(obj)
    if obj is pd.NaT:
        return None
    if isinstance(obj, pd.DataFrame):
        return f"<DataFrame {obj.shape}>"
    return obj


def _coerce_params(chosen: Any) -> Params:
    """Params か Params.to_dict() の dict を Params にする。None(段階Cで選べなかった)は不可。"""
    if chosen is None:
        raise ValueError("chosen が None(段階Cで設定を選べていない)。段階Dには進めない。")
    p = chosen if isinstance(chosen, Params) else Params.from_dict(dict(chosen))
    p.validate()
    return p


def check_costs_ready(cfg: Config, pairs: Sequence[str]) -> None:
    """コスト(スプレッド・スリッページ)が未設定なら、重い計算の前に NotConfiguredError を出す。

    黙ってコスト0にしない(INTERFACES §1.3)。値は ea-lab から CostConfig に転記すること。
    """
    bad = [p for p in pairs if not cfg.costs.is_ready(p)]
    if bad:
        raise NotConfiguredError(
            f"コスト(スプレッド/スリッページ)が未設定のペア: {bad}。"
            f"ea-lab の既存設定を CostConfig に転記すること(現在の source: {cfg.costs.source})。"
        )


def data_fingerprint(ds: pd.DataFrame) -> str:
    """データの指紋(監査用。凍結のハッシュには入れない)。足数・最初と最後の時刻・終値から作る。"""
    h = hashlib.sha256()
    h.update(str(len(ds)).encode())
    if len(ds):
        h.update(ds["close_time"].to_numpy().astype("datetime64[ns]").astype("int64").tobytes())
        h.update(ds["close"].to_numpy(dtype="float64").tobytes())
    return h.hexdigest()[:16]


# ======================================================================================
# 2. 設定の凍結(選び直しの検出)
# ======================================================================================


def _canon(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str, separators=(",", ":"))


def config_hash(params: Params, main_pair: str, train_end: Any) -> str:
    """凍結する設定のハッシュ(sha256)。Params 全項目 + 主ペア + train_end。

    検証用期間の結果を見て選び直す対象はこの3つ、という考え方。コストやゲートは外部から転記する値なので含めない。
    """
    payload = {
        "params": params.to_dict(),
        "main_pair": str(main_pair),
        "train_end": str(pd.Timestamp(train_end)),
    }
    return hashlib.sha256(_canon(payload).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _changed_fields(old: Mapping[str, Any], new: Mapping[str, Any]) -> List[str]:
    keys = sorted(set(old) | set(new))
    return [k for k in keys if old.get(k) != new.get(k)]


class FreezeRegistry:
    """選んだ設定の凍結記録。`path` を渡すと JSON に保存し、次回の実行でも引き継ぐ。

    使い方(基本)::

        reg = FreezeRegistry("out/freeze.json")
        reg.freeze(chosen, main_pair="USDJPY", train_end=split.train_end, source="stage_c")  # 段階C直後に凍結
        stage_d(..., registry=reg); stage_e(..., registry=reg)        # 内部で同じ設定か確認し、検証を見たと記録

    `freeze()` の status:
      'new'                          初めての凍結
      'same'                         記録と同じ設定(OK)
      'replaced_before_validation'   検証用期間を見る前の差し替え(警告。reselected にはしない)
      'reselected_after_validation'  検証用期間を見た後の差し替え = 選び直し(警告 + reselected=True。消えない)
    """

    VERSION = 1

    def __init__(self, path: Optional[str] = None) -> None:
        self.path = path
        self.state: Dict[str, Any] = {
            "version": self.VERSION,
            "frozen": None,  # 現在の凍結設定(dict)
            "first_frozen_hash": None,
            "validation_seen": False,
            "validation_seen_by": [],
            "reselected": False,
            "pair_set_changed": False,
            "events": [],
        }
        self.integrity_ok = True
        self.integrity_problem = ""
        if path and os.path.exists(path):
            self._load(path)

    # ---- 読み書き・整合性 ----------------------------------------------------------
    def _load(self, path: str) -> None:
        try:
            with open(path, encoding="utf-8") as f:
                st = json.load(f)
        except (OSError, ValueError) as e:
            raise ValueError(
                f"凍結記録 {path} を読めない({e})。黙って作り直さない。"
                "壊れた記録を確認し、新しい検証を始めるなら理由をレポートに書いたうえでファイルを削除すること。"
            ) from e
        if not isinstance(st, dict) or st.get("version") != self.VERSION or "events" not in st:
            raise ValueError(f"凍結記録 {path} の形式が想定と違う")
        self.state = st
        ok, problem = self._check_chain(st["events"])
        self.integrity_ok, self.integrity_problem = ok, problem
        if not ok:
            warnings.warn(
                f"凍結記録 {path} の整合性エラー: {problem}。記録が書き換えられた可能性があるので"
                "『選び直し扱い』にする。", ReselectionWarning, stacklevel=3,
            )

    @staticmethod
    def _event_hash(ev: Mapping[str, Any]) -> str:
        body = {k: v for k, v in ev.items() if k != "hash"}
        return hashlib.sha256(_canon(body).encode("utf-8")).hexdigest()

    def _check_chain(self, events: Sequence[Mapping[str, Any]]) -> Tuple[bool, str]:
        prev = ""
        for i, ev in enumerate(events):
            if ev.get("prev") != prev:
                return False, f"イベント{i}の prev が前のイベントのハッシュと一致しない"
            if ev.get("hash") != self._event_hash(ev):
                return False, f"イベント{i}の内容がハッシュと一致しない"
            prev = ev["hash"]
        return True, ""

    def verify_integrity(self) -> bool:
        ok, problem = self._check_chain(self.state["events"])
        self.integrity_ok, self.integrity_problem = ok, problem
        return ok

    def _log(self, type_: str, **data: Any) -> Dict[str, Any]:
        events = self.state["events"]
        ev: Dict[str, Any] = {
            "seq": len(events),
            "time": _now(),
            "type": type_,
            "prev": events[-1]["hash"] if events else "",
            **data,
        }
        ev["hash"] = self._event_hash(ev)
        events.append(ev)
        return ev

    def save(self) -> None:
        """path があれば保存(同じフォルダの一時ファイル経由で置き換える)。"""
        if not self.path:
            return
        d = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(self.state, f, ensure_ascii=False, indent=2, sort_keys=True, default=str)
            os.replace(tmp, self.path)
        except BaseException:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise

    # ---- 状態 ---------------------------------------------------------------------
    @property
    def current(self) -> Optional[Dict[str, Any]]:
        return self.state["frozen"]

    @property
    def validation_seen(self) -> bool:
        return bool(self.state["validation_seen"])

    @property
    def reselected(self) -> bool:
        """検証用期間を見た後に選び直した(または記録が壊れている)。一度立ったら消えない。"""
        return bool(self.state["reselected"]) or not self.integrity_ok

    @property
    def events(self) -> List[Dict[str, Any]]:
        return self.state["events"]

    # ---- 操作 ---------------------------------------------------------------------
    def freeze(
        self,
        params: Any,
        *,
        main_pair: str = MAIN_PAIR,
        train_end: Any,
        source: str = "",
        note: str = "",
        fingerprint: Optional[str] = None,
    ) -> Dict[str, Any]:
        """設定を凍結する(または記録と照合する)。戻り値は {status, hash, reselected, message, changed}。"""
        p = _coerce_params(params)
        te = str(train_end_of(train_end))
        h = config_hash(p, main_pair, te)
        record = {
            "hash": h,
            "params_key": p.key(),
            "params": p.to_dict(),
            "main_pair": main_pair,
            "train_end": te,
            "frozen_at": _now(),
            "source": source,
            "note": note,
            "data_fingerprint": fingerprint,
        }
        cur = self.state["frozen"]
        changed: List[str] = []
        if cur is None:
            status = "new"
            msg = f"設定を凍結した(hash={h[:12]}, params_key={p.key()})。以後、検証用期間を見てからの選び直しは検出される。"
            self.state["frozen"] = record
            self.state["first_frozen_hash"] = h
            self._log("freeze_new", hash=h, params_key=p.key(), source=source)
        elif cur["hash"] == h:
            status = "same"
            msg = f"凍結済みの設定と同じ(hash={h[:12]})。"
            self._log("freeze_same", hash=h, source=source)
        else:
            changed = _changed_fields(cur["params"], p.to_dict())
            for k in ("main_pair", "train_end"):
                if cur[k] != record[k]:
                    changed.append(k)
            detail = f"変わった項目: {changed}。旧 hash={cur['hash'][:12]} → 新 hash={h[:12]}"
            if self.validation_seen:
                status = "reselected_after_validation"
                self.state["reselected"] = True
                msg = (
                    "【選び直しを検出】検証用期間・他ペアの結果を見た後に、凍結済みの設定と違う設定が使われた。"
                    f"{detail}。引継書 第8章により、この結果は『保留』寄りに扱うこと(meta.reselected=True)。"
                )
                self._log("reselected", old_hash=cur["hash"], new_hash=h, changed=changed, source=source)
            else:
                status = "replaced_before_validation"
                msg = (
                    "凍結済みの設定を差し替えた(検証用期間はまだ見ていないので選び直し扱いにはしない)。"
                    f"{detail}。理由をレポートに残すこと。"
                )
                self._log("freeze_replaced", old_hash=cur["hash"], new_hash=h, changed=changed, source=source)
            self.state["frozen"] = record
            warnings.warn(msg, ReselectionWarning, stacklevel=2)
        self.save()
        return {
            "status": status,
            "hash": h,
            "params_key": p.key(),
            "reselected": self.reselected,
            "changed": changed,
            "message": msg,
        }

    def mark_validation_seen(self, stage: str) -> None:
        """段階D/Eを回す(検証用期間・他ペアの結果を見る)直前に呼ぶ。"""
        if not self.state["validation_seen"]:
            self.state["validation_seen"] = True
            self._log("validation_seen", stage=stage)
        if stage not in self.state["validation_seen_by"]:
            self.state["validation_seen_by"].append(stage)
        self.save()

    def record_evaluation(
        self, stage: str, pairs: Sequence[str], gmt_shifts: Sequence[float], cost_source: str = ""
    ) -> Optional[str]:
        """どの区間で評価したかを記録する。検証を見た後に同じ段階の検証対象ペアが変わっていたら警告文を返す。"""
        pairs_sorted = sorted(pairs)
        warn_msg: Optional[str] = None
        prev = [e for e in self.events if e["type"] == "evaluation" and e.get("stage") == stage]
        if prev and prev[-1]["pairs"] != pairs_sorted:
            warn_msg = (
                f"段階{stage}の検証対象ペアが前回と違う(前回 {prev[-1]['pairs']} → 今回 {pairs_sorted})。"
                "結果を見てからペアを入れ替えていないか確認し、理由をレポートに書くこと。"
            )
            self.state["pair_set_changed"] = True
            warnings.warn(warn_msg, ReselectionWarning, stacklevel=2)
        self._log(
            "evaluation", stage=stage, pairs=pairs_sorted, gmt_shifts=[float(s) for s in gmt_shifts],
            cost_source=cost_source,
        )
        self.save()
        return warn_msg

    def summary(self, freeze_result: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        """レポート・result.json 用のまとめ。"""
        cur = self.current or {}
        out = {
            "hash": cur.get("hash"),
            "params_key": cur.get("params_key"),
            "main_pair": cur.get("main_pair"),
            "train_end": cur.get("train_end"),
            "frozen_at": cur.get("frozen_at"),
            "source": cur.get("source"),
            "first_frozen_hash": self.state.get("first_frozen_hash"),
            "validation_seen": self.validation_seen,
            "validation_seen_by": list(self.state["validation_seen_by"]),
            "reselected": self.reselected,
            "pair_set_changed": bool(self.state["pair_set_changed"]),
            "integrity_ok": self.integrity_ok,
            "integrity_problem": self.integrity_problem,
            "n_events": len(self.events),
            "path": self.path,
        }
        if freeze_result is not None:
            out["last_status"] = freeze_result.get("status")
            out["last_message"] = freeze_result.get("message")
            out["last_changed"] = list(freeze_result.get("changed", []))
        return out


# ======================================================================================
# 3. バックテストの実行(期間ごと)
# ======================================================================================

Runner = Callable[..., Tuple[pd.DataFrame, dict]]


def default_runner(df15: pd.DataFrame, params: Params, cfg: Config, df1m: Optional[pd.DataFrame] = None):
    """既定の実行関数 = strategy.run_backtest(INTERFACES §5)。strategy.py は別担当が作成する。"""
    try:
        from strategy import run_backtest
    except ImportError as e:  # pragma: no cover - strategy 未作成の環境向けの案内
        raise ImportError(
            "strategy.py(run_backtest)が見つからない。strategy 担当の実装を待つか、runner= に代わりの関数を渡すこと。"
        ) from e
    return run_backtest(df15, params, cfg, df1m)


def default_benchmark_runner(df15, params, cfg, *, seed, ref_trades, df1m=None):
    """既定のベンチマーク実行関数 = strategy.run_benchmark_random(INTERFACES §5)。"""
    try:
        from strategy import run_benchmark_random
    except ImportError as e:  # pragma: no cover
        raise ImportError(
            "strategy.py(run_benchmark_random)が見つからない。strategy 担当の実装を待つか、"
            "benchmark_runner= に代わりの関数を渡すこと。"
        ) from e
    return run_benchmark_random(df15, params, cfg, seed=seed, ref_trades=ref_trades, df1m=df1m)


@dataclass
class RunResult:
    trades: pd.DataFrame
    funnel: dict
    metrics: dict
    params_key: str
    period: str = "all"
    n_bars: int = 0
    note: str = ""


def _renumber(trades: pd.DataFrame) -> pd.DataFrame:
    out = trades.reset_index(drop=True).copy()
    if "trade_id" in out.columns:
        out["trade_id"] = np.arange(len(out))
    return out


def run_period(
    ds: pd.DataFrame,
    params: Params,
    cfg: Config,
    period: str,
    split: Any,
    df1m: Optional[pd.DataFrame] = None,
    *,
    runner: Optional[Runner] = None,
    validate: bool = True,
) -> RunResult:
    """1通貨ペアを期間を指定して回す(INTERFACES §6 の run_period)。

    period:
      'train': split.train_end で末尾を切って回す(検証用期間の値動きを成績に混ぜない)
      'oos'  : 全期間で回し、entry_time > train_end の取引だけ残す。funnel は全期間分(参考値)
      'all'  : 全期間
    """
    if period not in PERIODS:
        raise ValueError(f"period は {PERIODS} のどれか: {period!r}")
    run = runner or default_runner
    note = ""
    end: Optional[pd.Timestamp] = None
    if period == "all":
        df, df1 = ds, df1m
        n_bars = len(ds)
    else:
        end = train_end_of(split)
        if period == "train":
            df, df1 = truncate_dataset(ds, end), _truncate_1m(df1m, end)
            n_bars = len(df)
        else:
            df, df1 = ds, df1m
            n_bars = int((ds["close_time"] > end).sum())
            note = "funnel は全期間分(参考値)。取引は entry_time > train_end のみ"
    if len(df) == 0:
        trades, funnel = empty_trades(), empty_funnel(0)
    else:
        trades, funnel = run(df, params, cfg, df1)
    if validate:
        validate_trades(trades)
        validate_funnel(funnel)
    if period == "oos":
        trades = trades[trades["entry_time"] > end]
    trades = _renumber(trades)
    return RunResult(
        trades=trades, funnel=dict(funnel), metrics=compute_metrics(trades), params_key=params.key(),
        period=period, n_bars=n_bars, note=note,
    )


# ======================================================================================
# 4. 段階D
# ======================================================================================

DEFAULT_GATE_SETS: Dict[str, GateSet] = {"phase0": PHASE0_GATE, "promotion": PROMOTION_GATE}


def aggregate_verdicts(verdicts: Sequence[str]) -> str:
    """core.gates と同じ集約: 不合格が1つでもあれば不合格 / 不合格なしで保留ありなら保留 / 全て合格なら合格。

    空なら保留。
    """
    if not verdicts:
        return HOLD
    if any(v == FAIL for v in verdicts):
        return FAIL
    if any(v == HOLD for v in verdicts):
        return HOLD
    return PASS


def summarize_gates(segments: Sequence[Mapping[str, Any]], gate_names: Sequence[str]) -> Dict[str, Any]:
    """区間ごとのゲート結果を、ゲートごとに集計する(全体・scope別・区間別)。

    全体の verdict は decide_verdict(report担当)の規則と同じ: 1つでも不合格 → 不合格、保留があれば保留、全部合格 → 合格。
    """
    out: Dict[str, Any] = {}
    for g in gate_names:
        rows = [
            {
                "pair": s["pair"], "period": s["period"], "gmt_shift": s["gmt_shift"], "scope": s["scope"],
                "verdict": s["gates"][g]["verdict"], "complete": s["gates"][g]["complete"],
            }
            for s in segments
        ]
        by_scope: Dict[str, str] = {}
        for sc in sorted({r["scope"] for r in rows}):
            by_scope[sc] = aggregate_verdicts([r["verdict"] for r in rows if r["scope"] == sc])
        out[g] = {
            "verdict": aggregate_verdicts([r["verdict"] for r in rows]),
            "complete": all(r["complete"] for r in rows) if rows else False,
            "by_scope": by_scope,
            "n_pass": sum(r["verdict"] == PASS for r in rows),
            "n_fail": sum(r["verdict"] == FAIL for r in rows),
            "n_hold": sum(r["verdict"] == HOLD for r in rows),
            "by_segment": rows,
        }
    return out


def _resolve_cross_pairs(
    available: Sequence[str], pairs: Optional[Sequence[str]], main_pair: str
) -> Tuple[List[str], List[str], List[str]]:
    """(使う他ペア, データが無かったペア, データが無くて困るペア)。

    pairs=None なら EURUSD・GBPUSD・EURJPY(必須)と AUDUSD(任意)。pairs を渡したら、渡したものは全て必須扱い。
    """
    if pairs is None:
        wanted = list(CROSS_PAIRS_REQUIRED + CROSS_PAIRS_OPTIONAL)
        required = set(CROSS_PAIRS_REQUIRED)
    else:
        wanted = [p for p in pairs if p != main_pair]
        required = set(wanted)
    have = set(available)
    present = [p for p in wanted if p in have]
    missing = [p for p in wanted if p not in have]
    return present, missing, [p for p in missing if p in required]


def _plan_segments(
    main_pair: str, cross: Sequence[str], gmt_shifts: Sequence[float], gmt_shift_period_main: str
) -> List[Dict[str, Any]]:
    if gmt_shift_period_main not in PERIODS:
        raise ValueError(f"gmt_shift_period_main は {PERIODS} のどれか")
    plan: List[Dict[str, Any]] = [
        {"pair": main_pair, "period": "train", "gmt_shift": 0.0, "scope": "train"},
        {"pair": main_pair, "period": "oos", "gmt_shift": 0.0, "scope": "oos"},
    ]
    plan += [{"pair": p, "period": "all", "gmt_shift": 0.0, "scope": "pair"} for p in cross]
    for h in gmt_shifts:
        if float(h) == 0.0:
            continue  # 0 は既出
        plan.append({"pair": main_pair, "period": gmt_shift_period_main, "gmt_shift": float(h), "scope": "gmt_shift"})
        plan += [{"pair": p, "period": "all", "gmt_shift": float(h), "scope": "gmt_shift"} for p in cross]
    return plan


class _DatasetCache:
    """(ペア, GMTずらし) ごとに build_dataset を1回だけ作る。ずらし0は datasets があればそれを使う。"""

    def __init__(self, raw15: Mapping[str, pd.DataFrame], cfg: Config, datasets: Optional[Mapping[str, pd.DataFrame]]):
        self.raw15, self.cfg, self.datasets = raw15, cfg, datasets or {}
        self._c: Dict[Tuple[str, float], pd.DataFrame] = {}

    def get(self, pair: str, shift: float) -> pd.DataFrame:
        key = (pair, float(shift))
        if key not in self._c:
            if float(shift) == 0.0 and pair in self.datasets:
                self._c[key] = self.datasets[pair]
            else:
                self._c[key] = build_dataset(self.raw15[pair], self.cfg.with_gmt_shift(shift), pair)
        return self._c[key]


def stage_d(
    raw15: Mapping[str, pd.DataFrame],
    cfg: Config,
    split: Any,
    chosen: Any,
    *,
    main_pair: str = MAIN_PAIR,
    gmt_shifts: Sequence[float] = DEFAULT_GMT_SHIFTS,
    gate_sets: Optional[Mapping[str, GateSet]] = None,
    pairs: Optional[Sequence[str]] = None,
    df1m: Optional[Mapping[str, pd.DataFrame]] = None,
    datasets: Optional[Mapping[str, pd.DataFrame]] = None,
    registry: Optional[FreezeRegistry] = None,
    runner: Optional[Runner] = None,
    gmt_shift_period_main: str = "oos",
    keep_trades: bool = False,
    validate: bool = True,
) -> Dict[str, Any]:
    """段階D。chosen を固定して(再調整せず)検証用期間・横展開・GMTずらしに当て、ゲートを判定する。

    raw15 : {pair: 15分足の素のOHLC(core.data.load_ohlc_csv / resample_to_base の出力)}。GMTずらしごとに
            build_dataset を作り直す。`datasets`(ずらし0の build_dataset 出力)を渡せば、ずらし0はそれを使う。
    split : train_end を持つもの(Split / dict / 文字列)。
    chosen: 段階Cで選んだ設定(Params か Params.to_dict())。
    pairs : 横展開のペア。None なら EURUSD・GBPUSD・EURJPY(必須)+ AUDUSD(任意)。データが無いペアは missing_pairs に記録。
    df1m  : {pair: 1分足}(任意)。
    registry: FreezeRegistry。None なら一時的なもの(保存されない=別プロセスの選び直しは検出できない)。

    コスト未設定なら NotConfiguredError(重い計算の前に出す)。主ペアのデータが無いときは ValueError。

    戻り値(INTERFACES §6 + 追加):
      segments: [{"pair","period","gmt_shift","scope","n_bars","metrics","breakdown_year","breakdown_side","funnel",
                  "gates": {gate_name: GateResult.to_dict()}, "params_key","note"(, "trades")}, ...]
      chosen_params, params_key, gate_summary, freeze(凍結のまとめ), reselected, warnings,
      main_pair, cross_pairs, missing_pairs, missing_required_pairs, gmt_shifts, gmt_shift_period_main, split, costs, notes
    """
    params = _coerce_params(chosen)
    end = train_end_of(split)
    if main_pair not in raw15:
        raise ValueError(f"主ペア {main_pair} のデータが無い(あるのは {sorted(raw15)})")
    cross, missing, missing_required = _resolve_cross_pairs(list(raw15), pairs, main_pair)
    plan = _plan_segments(main_pair, cross, gmt_shifts, gmt_shift_period_main)
    evaluated = [main_pair] + cross
    check_costs_ready(cfg, evaluated)
    gates = dict(gate_sets) if gate_sets is not None else dict(DEFAULT_GATE_SETS)

    reg = registry or FreezeRegistry()
    cache = _DatasetCache(raw15, cfg, datasets)
    fp = data_fingerprint(truncate_dataset(cache.get(main_pair, 0.0), end))
    run_warnings: List[str] = []

    # 結果を見る前に凍結(または照合)し、『見た』と記録する。選び直しはここで検出される。
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ReselectionWarning)
        fr = reg.freeze(params, main_pair=main_pair, train_end=end, source="stage_d", fingerprint=fp)
        reg.mark_validation_seen("stage_d")
        pair_warn = reg.record_evaluation("D", evaluated, gmt_shifts, cfg.costs.source)
    for w in caught:  # 呼び出し側にも警告を届ける(記録と二重にならないよう再送する)
        warnings.warn(str(w.message), ReselectionWarning, stacklevel=2)
    if fr["status"] in ("replaced_before_validation", "reselected_after_validation"):
        run_warnings.append(fr["message"])
    if pair_warn:
        run_warnings.append(pair_warn)

    segments: List[Dict[str, Any]] = []
    for seg in plan:
        pair = seg["pair"]
        ds = cache.get(pair, seg["gmt_shift"])
        rr = run_period(
            ds, params, cfg, seg["period"], split, (df1m or {}).get(pair), runner=runner, validate=validate
        )
        gate_results = {
            name: evaluate_gate_set(g, rr.metrics, scope=seg["scope"]).to_dict() for name, g in gates.items()
        }
        row: Dict[str, Any] = {
            **seg,
            "n_bars": rr.n_bars,
            "metrics": rr.metrics,
            "breakdown_year": breakdown_by_year(rr.trades),
            "breakdown_side": breakdown_by_side(rr.trades),
            "funnel": rr.funnel,
            "gates": gate_results,
            "params_key": rr.params_key,
            "note": rr.note,
        }
        if keep_trades:
            row["trades"] = rr.trades
        segments.append(row)

    return {
        "segments": segments,
        "chosen_params": params.to_dict(),
        "params_key": params.key(),
        "gate_summary": summarize_gates(segments, list(gates)),
        "freeze": reg.summary(fr),
        "reselected": reg.reselected,
        "warnings": run_warnings,
        "main_pair": main_pair,
        "cross_pairs": cross,
        "missing_pairs": missing,
        "missing_required_pairs": missing_required,
        "gmt_shifts": [float(h) for h in gmt_shifts],
        "gmt_shift_period_main": gmt_shift_period_main,
        "split": {"train_end": str(end), "note": split_note_of(split)},
        "costs": {
            "source": cfg.costs.source,
            "is_test_value": bool(cfg.costs.is_test_value),
            "ready": all(cfg.costs.is_ready(p) for p in evaluated),
        },
        "gates_ready": {
            name: {"n_rules": len(g.rules), "complete": bool(g.rules) and all(r.threshold is not None for r in g.rules)}
            for name, g in gates.items()
        },
        "notes": list(STAGE_DE_NOTES),
    }


# ======================================================================================
# 5. 段階E
# ======================================================================================


def mask_pre_period(ds: pd.DataFrame, train_end: Any) -> pd.DataFrame:
    """学習用期間(close_time <= train_end)の行の MASK_COLUMNS を NaN にしたコピーを返す。

    strategy のベンチマークは『使う列が全て非NaNの足』だけを候補にする(INTERFACES §5.1 の ready)。
    これで検証用期間の比較で、ランダムな時刻を検証用期間だけから選ばせる。
    """
    end = pd.Timestamp(train_end).as_unit("ns")
    out = ds.copy()
    m = (out["close_time"] <= end).to_numpy()
    for c in MASK_COLUMNS:
        if c in out.columns:
            col = out[c].to_numpy(dtype="float64", copy=True)
            col[m] = np.nan
            out[c] = col
    return out


def _clean(values: Sequence[Optional[float]]) -> np.ndarray:
    a = np.array([np.nan if v is None else float(v) for v in values], dtype=float)
    return a[~np.isnan(a)]


def distribution(values: Sequence[Optional[float]]) -> Dict[str, Any]:
    """ランダム試行の分布の要約。None/NaN(取引0件など)は除く。+inf(PFで負け0)は百分位に含める。

    mean/std は有限値のみ(infを含めると平均が無限大になるため。n_inf に個数を残す)。
    """
    v = _clean(values)
    out: Dict[str, Any] = {
        "mean": None, "std": None, "p05": None, "p50": None, "p95": None, "min": None, "max": None,
        "n_valid": int(len(v)), "n_inf": int(np.isposinf(v).sum()),
    }
    if len(v) == 0:
        return out
    fin = v[np.isfinite(v)]
    cap = 1e12
    capped = np.where(np.isposinf(v), cap, v)
    p05, p50, p95 = (float(x) for x in np.percentile(capped, [5, 50, 95]))
    back = lambda x: math.inf if x >= cap / 10 else x  # noqa: E731
    out.update(p05=back(p05), p50=back(p50), p95=back(p95), min=float(v.min()), max=float(v.max()))
    if len(fin):
        out["mean"] = float(fin.mean())
        out["std"] = float(fin.std(ddof=0))
    return out


def rank_among(real: Optional[float], sample: Sequence[Optional[float]]) -> Dict[str, Optional[float]]:
    """実戦略の値がランダム標本のどこにいるか。

    below : 標本のうち real を『下回る』割合(同値は含めない)= INTERFACES の real_*_percentile
    mid   : 同値を半分として数えた割合
    p_value: 片側の経験的p値 (同値以上の標本数 + 1) / (標本数 + 1)(「ランダムでも実戦略以上が出る確率」の目安)
    real が None/NaN、または標本が空なら全て None。
    """
    none = {"below": None, "mid": None, "p_value": None, "n_sample": 0}
    if real is None or (isinstance(real, float) and math.isnan(real)):
        return none
    s = _clean(sample)
    if len(s) == 0:
        return none
    r = float(real)
    lt = float((s < r).sum())
    eq = float((s == r).sum())
    ge = float((s >= r).sum())
    n = float(len(s))
    return {"below": lt / n, "mid": (lt + 0.5 * eq) / n, "p_value": (ge + 1.0) / (n + 1.0), "n_sample": int(n)}


def _fmt(x: Optional[float], nd: int = 3) -> str:
    if x is None:
        return "算出不能"
    if isinstance(x, float) and math.isinf(x):
        return "∞"
    return f"{x:.{nd}f}"


def _reading(real_avg: Optional[float], dist: Mapping[str, Any], rank: Mapping[str, Any], n_runs_used: int) -> str:
    """結果の読み方の文(閾値で優劣は決めない。事実だけ書く)。"""
    if real_avg is None:
        return "実戦略の取引が0件のため比較できない。"
    if rank["below"] is None or dist["mean"] is None:
        return "ランダム試行の成績が算出できず比較できない。"
    return (
        f"実戦略の平均R={_fmt(real_avg)}、ランダム{n_runs_used}回の平均Rは平均{_fmt(dist['mean'])}"
        f"(5%点{_fmt(dist['p05'])}〜95%点{_fmt(dist['p95'])})。"
        f"実戦略より平均Rが低いランダム試行は{rank['below']:.1%}、実戦略以上が出る割合の目安(p値)は{rank['p_value']:.3f}。"
        f"差(実戦略-ランダム平均)={_fmt(real_avg - dist['mean'])}R が、エントリー手順の上乗せ分に当たる。"
        "どこからを『優位』とみなすかの基準は、このコードでは決めていない。"
    )


def _benchmark_segment(
    ds: pd.DataFrame,
    params: Params,
    cfg: Config,
    period: str,
    end: pd.Timestamp,
    real: RunResult,
    df1m: Optional[pd.DataFrame],
    *,
    n_runs: int,
    seed: int,
    benchmark_runner: Callable[..., Tuple[pd.DataFrame, dict]],
    validate: bool,
) -> Dict[str, Any]:
    """1区間分のランダム n_runs 回。期間に合わせてデータを整える。"""
    if period == "train":
        bds, b1 = truncate_dataset(ds, end), _truncate_1m(df1m, end)
    elif period == "oos":
        bds, b1 = mask_pre_period(ds, end), df1m
    else:
        bds, b1 = ds, df1m

    ref = real.trades
    rows: List[Dict[str, Any]] = []
    n_filtered = 0
    if len(ref) > 0 and len(bds) > 0:
        for k in range(n_runs):
            bt, bf = benchmark_runner(bds, params, cfg, seed=seed + k, ref_trades=ref, df1m=b1)
            if validate:
                validate_trades(bt)
                validate_funnel(bf)
            if period == "oos":
                keep = bt["entry_time"] > end
                n_filtered += int((~keep).sum())
                bt = bt[keep]
            m = compute_metrics(bt)
            rows.append({"seed": seed + k, "n_trades": m["n_trades"], "avg_r": m["avg_r"], "pf": m["pf"],
                         "win_rate": m["win_rate"], "total_r": m["total_r"], "max_dd_r": m["max_dd_r"]})
    runs = pd.DataFrame(rows, columns=["seed", "n_trades", "avg_r", "pf", "win_rate", "total_r", "max_dd_r"])

    rm = real.metrics
    n_real = int(rm["n_trades"])
    dist_avg = distribution(runs["avg_r"].tolist())
    rank_avg = rank_among(rm["avg_r"], runs["avg_r"].tolist())
    rank_pf = rank_among(rm["pf"], runs["pf"].tolist())
    rank_wr = rank_among(rm["win_rate"], runs["win_rate"].tolist())
    n_tr = runs["n_trades"].astype(float).tolist()
    freq_matched = bool(len(runs) > 0 and all(int(x) == n_real for x in n_tr))
    entry_edge = (
        float(rm["avg_r"] - dist_avg["mean"]) if rm["avg_r"] is not None and dist_avg["mean"] is not None else None
    )
    notes: List[str] = []
    if n_real == 0:
        notes.append("実戦略の取引が0件のためランダムは回していない")
    elif len(runs) and not freq_matched:
        notes.append("ランダム試行の取引数が実戦略と揃っていない試行がある(候補不足など)。比較は参考値")
    if n_filtered:
        notes.append(f"検証用期間の外に出たランダム取引を{n_filtered}件捨てた(n_filtered_outside_period)")
    return {
        "random": {
            "avg_r": dist_avg,
            "pf": distribution(runs["pf"].tolist()),
            "win_rate": distribution(runs["win_rate"].tolist()),
            "total_r": distribution(runs["total_r"].tolist()),
            "max_dd_r": distribution(runs["max_dd_r"].tolist()),
            "n_trades": distribution(n_tr),
            "n_runs": int(len(runs)),
            "seed_first": seed if len(runs) else None,
            "seed_last": seed + len(runs) - 1 if len(runs) else None,
            "freq_matched": freq_matched,
            "n_filtered_outside_period": n_filtered,
        },
        "real_avg_r_percentile": rank_avg["below"],
        "real_avg_r_percentile_mid": rank_avg["mid"],
        "p_value_avg_r": rank_avg["p_value"],
        "real_pf_percentile": rank_pf["below"],
        "real_win_rate_percentile": rank_wr["below"],
        "entry_edge_r": entry_edge,
        "reading": _reading(rm["avg_r"], dist_avg, rank_avg, len(runs)),
        "note": " / ".join(notes),
        "runs": runs,
    }


def stage_e(
    datasets: Mapping[str, pd.DataFrame],
    cfg: Config,
    split: Any,
    chosen: Any,
    *,
    main_pair: str = MAIN_PAIR,
    n_runs: int = DEFAULT_N_RUNS,
    seed: int = 0,
    pairs: Optional[Sequence[str]] = None,
    df1m: Optional[Mapping[str, pd.DataFrame]] = None,
    registry: Optional[FreezeRegistry] = None,
    runner: Optional[Runner] = None,
    benchmark_runner: Optional[Callable[..., Tuple[pd.DataFrame, dict]]] = None,
    keep_runs: bool = False,
    validate: bool = True,
) -> Dict[str, Any]:
    """段階E: エントリー(D4〜D7)をランダム時刻に置き換えたベンチマークとの比較。

    datasets: {pair: build_dataset の出力(GMTずらし0)}。区間は段階Dと同じ(GMTずらしなし):
              (主ペア, train) / (主ペア, oos) / 他ペア全期間。pairs=None なら datasets にある他ペア全部
              (主ペアの後ろに、EURUSD→GBPUSD→EURJPY→AUDUSD→その他の順)。
    n_runs  : ランダムの回数(既定200)。乱数は seed, seed+1, ... で固定(同じ入力・seedなら結果は完全に同じ)。
    chosen  : 段階Dと同じ固定設定。registry があれば凍結と照合し、違えば選び直しとして警告・記録する。

    戻り値(INTERFACES §6 + 追加):
      {"segments": [{"pair","period","scope","n_bars","real": metrics,
                     "random": {"avg_r": {"mean","p05","p50","p95",...}, "pf": {...}, "win_rate": {...}, "n_runs": int, ...},
                     "real_avg_r_percentile": float|None,   # ランダムのうち実戦略の avg_r を下回った割合(0〜1)
                     "real_avg_r_percentile_mid", "p_value_avg_r", "real_pf_percentile", "real_win_rate_percentile",
                     "entry_edge_r", "reading", "note"(, "runs": DataFrame)}],
       "chosen_params", "params_key", "n_runs", "seed", "freeze", "reselected", "warnings", "notes", ...}
    """
    if n_runs < 1:
        raise ValueError("n_runs は1以上")
    params = _coerce_params(chosen)
    end = train_end_of(split)
    if main_pair not in datasets:
        raise ValueError(f"主ペア {main_pair} のデータが無い(あるのは {sorted(datasets)})")
    if pairs is None:
        order = {p: i for i, p in enumerate(CROSS_PAIRS_REQUIRED + CROSS_PAIRS_OPTIONAL)}
        cross = sorted((p for p in datasets if p != main_pair), key=lambda p: (order.get(p, 99), p))
        missing: List[str] = []
    else:
        cross = [p for p in pairs if p != main_pair and p in datasets]
        missing = [p for p in pairs if p != main_pair and p not in datasets]
    evaluated = [main_pair] + cross
    check_costs_ready(cfg, evaluated)
    bench = benchmark_runner or default_benchmark_runner

    reg = registry or FreezeRegistry()
    run_warnings: List[str] = []
    fp = data_fingerprint(truncate_dataset(datasets[main_pair], end))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ReselectionWarning)
        fr = reg.freeze(params, main_pair=main_pair, train_end=end, source="stage_e", fingerprint=fp)
        reg.mark_validation_seen("stage_e")
        reg.record_evaluation("E", evaluated, [0.0], cfg.costs.source)
    for w in caught:
        warnings.warn(str(w.message), ReselectionWarning, stacklevel=2)
    if fr["status"] in ("replaced_before_validation", "reselected_after_validation"):
        run_warnings.append(fr["message"])

    plan = [(main_pair, "train", "train"), (main_pair, "oos", "oos")] + [(p, "all", "pair") for p in cross]
    segments: List[Dict[str, Any]] = []
    for pair, period, scope in plan:
        ds = datasets[pair]
        d1 = (df1m or {}).get(pair)
        real = run_period(ds, params, cfg, period, split, d1, runner=runner, validate=validate)
        res = _benchmark_segment(
            ds, params, cfg, period, end, real, d1, n_runs=n_runs, seed=seed,
            benchmark_runner=bench, validate=validate,
        )
        runs = res.pop("runs")
        seg = {"pair": pair, "period": period, "scope": scope, "n_bars": real.n_bars, "real": real.metrics, **res}
        if keep_runs:
            seg["runs"] = runs
        segments.append(seg)

    return {
        "segments": segments,
        "chosen_params": params.to_dict(),
        "params_key": params.key(),
        "n_runs": int(n_runs),
        "seed": int(seed),
        "main_pair": main_pair,
        "cross_pairs": cross,
        "missing_pairs": missing,
        "freeze": reg.summary(fr),
        "reselected": reg.reselected,
        "warnings": run_warnings,
        "split": {"train_end": str(end), "note": split_note_of(split)},
        "costs": {
            "source": cfg.costs.source,
            "is_test_value": bool(cfg.costs.is_test_value),
            "ready": all(cfg.costs.is_ready(p) for p in evaluated),
        },
        "notes": list(STAGE_DE_NOTES),
    }
