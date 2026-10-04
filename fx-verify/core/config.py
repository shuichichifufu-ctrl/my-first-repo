"""設定(config)。

方針:
- ea-lab の既存設定(スプレッド/スリッページ)はこの環境で確認できないので、値は「未設定(None)」を既定にする。
- 未設定のまま取引コストを要求すると NotConfiguredError を出す(黙ってコスト0で回さない)。
- 合成テスト用の値は synthetic_test_config() にだけ置き、「テスト用・実値ではない」を明記する。
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Mapping, Optional

SYNTHETIC_NOTICE = "テスト用・実値ではない"
UNSET_SOURCE = "未設定: ea-lab の既存設定(DESIGN.md / RUNBOOK.md 等)から転記すること"


class NotConfiguredError(RuntimeError):
    """placeholder のまま使おうとした場合のエラー。"""


def pip_size(pair: str) -> float:
    """1pipの価格幅。円クロスは0.01、それ以外は0.0001(FXの一般的な慣習)。"""
    return 0.01 if "JPY" in pair.upper() else 0.0001


@dataclass(frozen=True)
class DayBoundaryConfig:
    """サーバー時間(=日足・4時間足の区切り)の定義。

    mode='ny_close': ニューヨーククローズ式。サーバー時間は 冬 GMT+2 / 米国夏時間中 GMT+3。
                     (日足は NY 17:00 に切り替わる。UTC では冬22:00 / 夏21:00)
    mode='fixed'   : 常に fixed_offset_hours を使う(夏冬の切替なし)。
    gmt_shift_hours: 検証用の GMT ずらし(±1h)。サーバー時間にそのまま加算され、
                     日足/4時間足/1時間足の区切り位置が動く。
    """

    mode: str = "ny_close"
    winter_offset_hours: float = 2.0
    summer_offset_hours: float = 3.0
    fixed_offset_hours: float = 2.0
    gmt_shift_hours: float = 0.0

    def __post_init__(self) -> None:
        if self.mode not in ("ny_close", "fixed"):
            raise ValueError(f"mode は 'ny_close' か 'fixed': {self.mode!r}")


@dataclass(frozen=True)
class CostConfig:
    """取引コスト。pips単位。None は未設定。

    spread_pips: {"USDJPY": x, ...}  通貨ペアごとのスプレッド(固定値。往復で1回分を計上)
    slippage_pips: 1回の約定あたりのスリッページ(エントリー1回+決済1回分=2回で計上)
    """

    spread_pips: Mapping[str, Optional[float]] = field(default_factory=dict)
    slippage_pips: Optional[float] = None
    source: str = UNSET_SOURCE
    is_test_value: bool = False

    def spread_for(self, pair: str) -> float:
        v = self.spread_pips.get(pair)
        if v is None:
            raise NotConfiguredError(
                f"{pair} のスプレッドが未設定です。ea-lab の既存設定から CostConfig に転記してください。"
            )
        return float(v)

    def slippage(self) -> float:
        if self.slippage_pips is None:
            raise NotConfiguredError(
                "スリッページが未設定です。ea-lab の既存設定から CostConfig に転記してください。"
            )
        return float(self.slippage_pips)

    def is_ready(self, pair: str) -> bool:
        return self.spread_pips.get(pair) is not None and self.slippage_pips is not None

    def cost_price(self, pair: str) -> float:
        """往復コストの価格幅 = スプレッド + スリッページ×2(エントリー・決済)。"""
        return (self.spread_for(pair) + 2.0 * self.slippage()) * pip_size(pair)


@dataclass(frozen=True)
class FeatureSpec:
    """build_dataset が事前計算する指標の一覧(超集合)。Params の候補値は全てここに含めること。"""

    d1_sma: tuple = (20, 100)
    h4_sma: tuple = (20, 80, 120)
    h1_sma: tuple = (20, 80)
    m15_ema: tuple = (10, 20, 40, 80, 320)
    atr_period: int = 14
    htf_fractal_n: tuple = (2, 3, 5)  # 上位足スイング(D2-B, D3)用
    m15_fractal_n: tuple = (2, 3, 5)  # 15分足スイング(D5, D7, D9)用
    slope_lags: tuple = (1, 3, 5)  # 上位足SMAの傾き: sma - sma.shift(k)
    h1_cross: tuple = (20, 80)  # 1時間足クロス(D1)の (短期, 長期)


@dataclass(frozen=True)
class SplitConfig:
    """学習用/検証用の分割。実データの期間を見て決めるため placeholder(None)。

    train_end: この時刻(UTC, 'YYYY-MM-DD')までを学習用、より後を検証用(アウトオブサンプル)とする。
    """

    train_end: Optional[str] = None
    note: str = "未設定: 実データの期間確認後に決める(レポートに分け方を記録)"


@dataclass(frozen=True)
class Config:
    day: DayBoundaryConfig = field(default_factory=DayBoundaryConfig)
    costs: CostConfig = field(default_factory=CostConfig)
    features: FeatureSpec = field(default_factory=FeatureSpec)
    split: SplitConfig = field(default_factory=SplitConfig)
    base_minutes: int = 15
    # 判定足の次の足の始値で約定するとき、足の間隔がこれを超えて空いていたらエントリー見送り(週末ギャップ等)
    entry_max_gap_minutes: int = 15

    def with_gmt_shift(self, hours: float) -> "Config":
        return replace(self, day=replace(self.day, gmt_shift_hours=float(hours)))

    def with_costs(self, costs: CostConfig) -> "Config":
        return replace(self, costs=costs)


def default_config() -> Config:
    """既定設定。コスト・分割は未設定(placeholder)。"""
    return Config()


def synthetic_test_config() -> Config:
    """合成データのテスト専用設定。

    【テスト用・実値ではない】ここのスプレッド/スリッページは、パイプラインの動作確認のための
    適当な値であり、ea-lab の既存設定でも実際の市場コストでもない。
    この設定で出した成績を検証結果として報告してはならない。
    """
    costs = CostConfig(
        spread_pips={"USDJPY": 1.0, "EURUSD": 1.0, "GBPUSD": 1.5, "EURJPY": 1.5, "AUDUSD": 1.2},
        slippage_pips=0.1,
        source=f"合成テスト用の仮置き値({SYNTHETIC_NOTICE})",
        is_test_value=True,
    )
    return Config(costs=costs)
