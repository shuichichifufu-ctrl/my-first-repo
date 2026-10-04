# INTERFACES.md — fx-verify モジュール境界と関数シグネチャ(正本)

仕様の正本は **引継書(`handoff_15m_daytrade_verification.md`)の第3〜5章・第8章** と、この文書。
この文書は、並列で実装する担当同士が衝突しないように「ファイル名・関数名・列名・キー名」を固定するためのもの。
**ここに書いた名前は変更しない**(変更が必要なら基盤担当に戻す)。

> **前提(未確認事項)**: `ea-lab` リポジトリと実FXデータはこの環境に無い。
> ゲート基準値(PF等の閾値)・スプレッド・スリッページは **placeholder**(未設定)。**絶対に自作・推測しない**。
> 合成データ(`core/synthetic.py`)はテスト専用で、その成績は優位性の証拠にならない。

---

## 0. ファイル構成と担当

```
fx-verify/
  INTERFACES.md            本書                                   [基盤担当 済]
  conftest.py / requirements.txt / .gitignore                      [基盤担当 済]
  core/
    __init__.py                                                  [基盤担当 済]
    config.py       Config / CostConfig / DayBoundaryConfig ...   [基盤担当 済]
    data.py         読込・リサンプル・上位足結合・build_dataset      [基盤担当 済]
    indicators.py   SMA/EMA/ATR/フラクタル/傾き/クロス経過           [基盤担当 済]
    synthetic.py    合成OHLC(テスト専用)                           [基盤担当 済]
    gates.py        ゲート判定の枠(基準値は placeholder)           [基盤担当 済]
    params.py       Params(D1〜D10)+ 感度分析の候補値              [基盤担当 済]
    schema.py       trades/funnel の列・キー定義と検証関数          [基盤担当 済]
    metrics.py      成績指標(R単位)                               [基盤担当 済]
  tests/test_core.py                                             [基盤担当 済]
  strategy.py       run_backtest / run_benchmark_random           [strategy担当]
  stages.py         段階A〜E                                       [stages担当]
  report.py         判定レポート生成・verdict                       [report担当]
  run_verification.py  CLI(全段階を通して実行)                    [stages担当]
  tests/test_strategy.py / test_stages.py / test_report.py        [各担当]
  data/   実データCSV置き場(git管理外)    out/  結果出力(git管理外)
```

- 実装言語は Python(numpy / pandas / pytest)。ドキュメント・コメントは日本語。
- `fx-verify/` の外のファイルは変更しない。`core/` の変更は基盤担当だけ(不足があれば `strategy.py` 等の側で補い、レポートの「限界」に書く)。
- import は `fx-verify` 直下を基準にする(`from core.data import ...`、`from strategy import run_backtest`)。`conftest.py` があるので `pytest` で通る。

---

## 1. 共通規約

### 1.1 時刻
- すべて **タイムゾーンなしのUTC**(`datetime64[ns]`)。
- 15分足の `time` = **足の始値時刻**、`close_time = time + 15分` = **その足が確定する時刻**。
- 上位足は `time`(始値時刻)と `confirm_time`(確定時刻 = 区切りの終わり)を持つ。
- サーバー時間 = UTC + (冬 +2h / 米国夏時間中 +3h)(NYクローズ式、NY 17:00 で日足が切替)+ `gmt_shift_hours`(検証用 ±1h)。
  米国夏時間は tzdata に頼らず自前判定(`core.data.us_dst_active`)。

### 1.2 先読み禁止(最重要)
1. 上位足(d1/h4/h1)は **確定済みのものだけ**が15分足から見える。結合キーは「15分足の `close_time`」対「上位足の `confirm_time`」で、`confirm_time <= close_time` の最新だけ(`attach_htf`)。
   例: 10:00開始の1時間足は11:00に確定。15分足 10:30(close 10:45)からは見えず、10:45(close 11:00)から見える。
2. SMA/EMA/ATR は各時間足で計算する(15分足で上位足を近似しない)。上位足の指標は **上位足を確定させたうえで計算** し、その行を結合する。
3. スイング高安は **フラクタル(左右n本)+ 確定遅延**。ピボット足 i は i+n 本目の終値で確定。`fractal_swings` は確定した足の行にだけ値を載せる。ZigZag は使わない。
4. **判定は判定足の終値(close_time)で行い、約定は次の足の始値**。判定足の行に載っている情報だけで判断すること。
5. 同一足でSLとTPの両方に届いたら **SL優先**(1分足があれば1分足の順序で判定。同じ1分足内で両方ならSL)。
6. 検証: `tests/test_core.py` に「未確定の1時間足が見えない」「未来の価格を書き換えても過去行が不変」「データを途中で切っても共通部分が一致」のテストがある。`strategy.py` の担当も **同種のテスト(未来の価格を書き換えても、それ以前のシグナル・約定が不変)** を `tests/test_strategy.py` に必ず入れる。

### 1.3 コスト(スプレッド・スリッページ)
- `cfg.costs`(`CostConfig`)。**未設定(None)のまま使うと `NotConfiguredError`**。黙ってコスト0にしない。
- 取引コスト(価格幅)= `cfg.costs.cost_price(pair)` = (スプレッド + スリッページ×2)× pip。`cost_r = cost_price / risk`。
  価格データはスプレッドを含まない前提で、損益Rから `cost_r` を引く(`pnl_r = r_multiple - cost_r`)。部分決済でも総額は変わらない(1回分のスプレッド、エントリーと決済で各1回のスリッページ)。
- 合成テスト用の値は `core.config.synthetic_test_config()` のみ。**「テスト用・実値ではない」**。実データの検証では ea-lab の値を `CostConfig` に転記する。

### 1.4 ゲート
- 基準値は `core/gates.py` に **未転記(空)**。`evaluate_gate_set` は未転記・未算出なら「保留」。不合格が1つでもあれば「不合格」、不合格なしで保留ありなら「保留」、全て合格なら「合格」。
- 基準値は ea-lab の DESIGN.md から `GateRule` として転記するか、JSON(`load_gate_set_json`)で読む。**このリポジトリのコードや報告書で閾値を作らない**。

---

## 2. core API(実装済み・シグネチャ固定)

### 2.1 `core/config.py`
```python
class NotConfiguredError(RuntimeError)
SYNTHETIC_NOTICE = "テスト用・実値ではない"
def pip_size(pair: str) -> float                     # 円クロス 0.01 / その他 0.0001

@dataclass(frozen=True) class DayBoundaryConfig:
    mode: str = "ny_close"            # 'ny_close' | 'fixed'
    winter_offset_hours: float = 2.0; summer_offset_hours: float = 3.0
    fixed_offset_hours: float = 2.0
    gmt_shift_hours: float = 0.0      # 検証用 ±1

@dataclass(frozen=True) class CostConfig:
    spread_pips: Mapping[str, Optional[float]]   # 未設定 = None / 欠落
    slippage_pips: Optional[float] = None
    source: str; is_test_value: bool = False
    def spread_for(pair) -> float; def slippage() -> float       # 未設定なら NotConfiguredError
    def is_ready(pair) -> bool; def cost_price(pair) -> float    # (spread + 2*slip) * pip

@dataclass(frozen=True) class FeatureSpec:       # build_dataset が事前計算する指標の超集合
    d1_sma=(20,100); h4_sma=(20,80,120); h1_sma=(20,80); m15_ema=(10,20,40,80,320)
    atr_period=14; htf_fractal_n=(2,3,5); m15_fractal_n=(2,3,5)
    slope_lags=(1,3,5); h1_cross=(20,80)

@dataclass(frozen=True) class SplitConfig:  train_end: Optional[str] = None   # 未設定
@dataclass(frozen=True) class Config:
    day: DayBoundaryConfig; costs: CostConfig; features: FeatureSpec; split: SplitConfig
    base_minutes: int = 15
    entry_max_gap_minutes: int = 15     # 判定足close→次の足open の空きがこれを超えたらエントリー見送り(週末等)
    def with_gmt_shift(hours) -> Config; def with_costs(costs) -> Config
def default_config() -> Config           # コスト・分割は未設定(placeholder)
def synthetic_test_config() -> Config    # 【テスト用・実値ではない】コスト入り
```

### 2.2 `core/data.py`
```python
def load_ohlc_csv(path, *, source_tz="utc"|"fixed"|"ny_close_server", source_fixed_offset_hours=0.0, source_day=None) -> DataFrame
    # 列 [time, open, high, low, close, volume]。ヘッダあり/なし(MT4形式)対応。'#'始まりの行は無視。
def normalize_ohlc(df) -> DataFrame        # UTC ns化・NaN除去・ソート・重複除去
def validate_ohlc(df, freq_minutes=15) -> dict   # n_bars, first, last, n_bad_ohlc, n_gaps_over_freq, n_gaps_intraday, max_gap
def resample_to_base(df_fine, minutes=15, drop_edge_partial=True) -> DataFrame   # 1分足→15分足
def resample_htf(df_base, tf: 'd1'|'h4'|'h1', cfg: Config, drop_edge_partial=True) -> DataFrame
    # 列 time, open, high, low, close, volume, n_base, confirm_time(確定時刻)
def add_htf_features(htf, kind, spec) -> DataFrame
def add_m15_features(df, spec) -> DataFrame
def attach_htf(df15, htf, *, prefix, lag="confirmed"|"strict", columns=None, base_minutes=15) -> DataFrame
    # 確定済みの最新の上位足だけを asof 結合(prefix + 列名、+ {prefix}time, {prefix}confirm)
def build_dataset(df15, cfg: Config, pair: str) -> DataFrame     # ★ バックテスト入力(§3)
def truncate_dataset(ds, end_time) -> DataFrame                  # close_time <= end_time の行だけ(末尾切り)
def us_dst_active(utc) -> ndarray; server_offset(utc, day) -> ndarray; server_to_utc(server_time, day) -> DatetimeIndex
```

### 2.3 `core/indicators.py`
```python
sma(s, n); ema(s, n); true_range(high, low, close); atr(high, low, close, n=14)   # Wilder平滑(ewm alpha=1/n, adjust=False)
slope(s, k=1); is_rising(s, k=1); is_falling(s, k=1)
fractal_swings(high, low, n) -> DataFrame   # 列: sh_last, sh_last_pos, sh_prev, sh_prev_pos, sh_new, sl_*(同)
    # 値は『確定した足(i+n)の行』から見える。*_pos は入力の行番号(0始まり)。高値: 左厳密>・右>=、安値: 左厳密<・右<=
cross_ages(fast, slow) -> (gc_age, dc_age)  # クロスからの経過本数(クロス足=0、未クロスはNaN)
```

### 2.4 `core/synthetic.py`(テスト専用)
```python
SYNTHETIC_WARNING; DEFAULT_PAIRS = ("USDJPY","EURUSD","GBPUSD","EURJPY")
@dataclass class SyntheticPair: pair; m15: DataFrame; m1: Optional[DataFrame]
generate_synthetic(pair="USDJPY", *, start="2018-01-01", years=3.0, seed=0, start_price=None, daily_vol_pct=None,
                   trend_strength=0.5, swing_amp=0.5, with_m1=False, day=None) -> SyntheticPair
generate_universe(pairs=DEFAULT_PAIRS, *, start, years, seed, with_m1=False, **kw) -> Dict[str, SyntheticPair]
write_synthetic_csv(df, path, pair="")      # 先頭に '#【合成データ】...' を書く
```
`df.attrs["synthetic"] = True` を付ける(ただし pandas の演算で失われうる。メタ情報は `report` の `meta.synthetic` で明示的に持ち回る)。

### 2.5 `core/gates.py`
```python
HOLD="保留"; PASS="合格"; FAIL="不合格"
GateRule(name, metric, op, threshold=None, scope="all", source="未転記...")   # op: >= > <= < ==、scope: train/oos/pair/gmt_shift/all
GateSet(name, rules=(), source=...);  GateSet.rules_for(scope)
PHASE0_GATE, PROMOTION_GATE            # 空(ea-lab から転記するまで)
evaluate_rule(rule, metrics) -> RuleResult;  evaluate_gate_set(gate, metrics, scope="all") -> GateResult
GateResult(gate, verdict, results, complete, note).to_dict()
load_gate_set_json(path) -> GateSet
```

### 2.6 `core/metrics.py`
```python
compute_metrics(trades) -> dict   # キー METRIC_KEYS: n_trades, n_long, n_short, win_rate, pf, avg_r, expectancy_r, total_r,
                                  #   avg_win_r, avg_loss_r, max_dd_r, max_consec_losses, partial_rate, avg_cost_r, gross_avg_r
breakdown_by_year(trades) / breakdown_by_side(trades) / breakdown_by_pair(trades) -> dict[key -> metrics dict]
profit_factor(pnl_array); max_drawdown(pnl_in_order)
```
勝ち = `pnl_r > 0`。PF は勝ちR合計/負けR合計(負け0なら `inf`、取引0なら `None`)。`max_dd_r` は exit_time 順の累積 `pnl_r` のピークからの最大下落(正の値)。ゲートの `metric` はこのキー名を使う。

### 2.7 `core/schema.py`
`TRADE_COLUMNS`, `EXIT_REASONS`, `funnel_keys()`, `validate_trades(df)`, `validate_funnel(dict)`(§4・§5と一致。**strategy の出力は必ずこの2つの検証を通すこと**)。

---

## 3. `build_dataset` の出力列(= `run_backtest` の入力 `df15_with_htf`)

`build_dataset(df15, cfg, pair)`。index は `RangeIndex(0..N-1)`。**切るのは末尾側だけ**(`truncate_dataset`)。`*_pos` 列は行番号なので、先頭側を切ってはいけない。

| 列 | 意味 |
|---|---|
| `pair` | 通貨ペア名(定数列) |
| `time`, `close_time` | 15分足の始値時刻 / 確定時刻 |
| `open, high, low, close, volume` | 15分足 |
| `server_time` | 始値時刻のサーバー時間(tzなし。時間帯フィルター用) |
| `day_end` | その足が属するサーバー日の終わり(UTC)。`close_time == day_end` の足が日の最後の足 |
| `ema10, ema20, ema40, ema80, ema320` | 15分足EMA |
| `atr14` | 15分足ATR(14) |
| `fr{n}_sh_last, fr{n}_sh_prev, fr{n}_sl_last, fr{n}_sl_prev` | 15分足フラクタル(n=2,3,5)。確定済みの直近・一つ前のスイング高値/安値の価格 |
| `fr{n}_sh_last_pos, fr{n}_sh_prev_pos, fr{n}_sl_last_pos, fr{n}_sl_prev_pos` | 上記ピボット足の行番号(float。未確定はNaN) |
| `fr{n}_sh_new, fr{n}_sl_new` | その行で新たに確定したスイングの価格(それ以外NaN) |
| `d1_*` `h4_*` `h1_*` | 確定済み最新の上位足(下表)。`d1_time`/`d1_confirm` 等は見えている足の始値時刻/確定時刻(未確定ならNaT) |

上位足の列(`d1_` / `h4_` / `h1_` を前置):
`open, high, low, close`(確定値)、`sma{n}`(d1: 20,100 / h4: 20,80,120 / h1: 20,80)、`sma{n}_chg{k}` = その上位足の `sma - sma.shift(k)`(k=1,3,5)、`atr14`、
`fr{n}_sh_last, fr{n}_sh_prev, fr{n}_sl_last, fr{n}_sl_prev`(n=2,3,5。確定済みスイング)、`fr{n}_hh / fr{n}_lh / fr{n}_hl / fr{n}_ll`(bool: 高値切上/高値切下/安値切上/安値切下 = last と prev の比較)、
`h1_gc_age, h1_dc_age`(1時間足の20/80SMAクロスからの経過**1時間足本数**。クロス足=0。未クロスはNaN)。

---

## 4. `Params`(D1〜D10 の全パラメータ)— 実体は `core/params.py`

`Params`(frozen dataclass)。既定値 = 引継書 第3章の **基準案**。`replace(**kw)`, `to_dict()`, `from_dict(d)`, `key()`(設定の識別子)、`validate()`、`is_original()`(D10未使用か)。

| 項目 | フィールド | 既定 | 候補(感度分析) |
|---|---|---|---|
| D1 | `h1_cross_window` | `48` | 12 / 24 / 48 / 96 / None(None=20>80の間ずっと有効) |
| D2 | `d1_mode` | `"A"` | A / B / C / D |
| D2 | `d1_slope_bars` | `5` | (1/3/5 が事前計算済み) |
| D2 | `d1_swing_fractal_n` | `2` | mode B 用(2/3/5) |
| D3 | `h4_long_sma` | `120` | 120 / 80 |
| D3 | `h4_require_swing` | `True` | True / False |
| D3 | `h4_swing_fractal_n` | `2` | (2/3/5) |
| D4 | `po_slope_bars` | `3` | 1 / 3 / 5 |
| D4 | `po_expand`, `po_expand_k` | `False`, `3` | 広がり条件 あり/なし |
| D5 | `hi_mode` | `"lookback"` | lookback / swing |
| D5 | `hi_lookback` | `40` | 20 / 40 / 80 |
| D5 | `hi_swing_fractal_n` | `2` | 2 / 3 / 5(hi_mode='swing') |
| D5 | `hi_break_on` | `"close"` | close / high |
| D6 | `pb_mode` | `"ema"` | ema / ratio |
| D6 | `pb_touch_ema` | `40` | 20 / 40 / 80 |
| D6 | `pb_forbid_ema80_close` | `True` | — |
| D6 | `pb_forbid_ema320_touch` | `True` | — |
| D6 | `pb_ratio_min`, `pb_ratio_max` | `0.382`, `0.786` | (0.236,0.618) / (0.382,0.786)(pb_mode='ratio') |
| D6 | `pb_min_bars` | `0` | 0 / 3 / 5 / 8 |
| D7 | `tl_mode` | `"trendline"` | trendline / recent_high |
| D7 | `tl_fractal_n` | `2` | 2 / 3 / 5 |
| D7 | `tl_recent_m` | `5` | 3 / 5 / 8(tl_mode='recent_high') |
| D7 | `tl_break_on` | `"close"` | close / high_margin |
| D7 | `tl_margin_atr` | `0.1` | high_margin のとき |
| D7 | `tl_expire_bars` | `32` | 16 / 32 / 64 |
| D8 | `sl_mode` | `"atr"` | atr / fixed_pips |
| D8 | `sl_margin_atr` | `0.1` | 0 / 0.1 / 0.3 |
| D8 | `sl_fixed_pips` | `None` | sl_mode='fixed_pips' のとき必須 |
| D8 | `sl_max_h1_atr` | `None` | None / 1.5(超えたら見送り) |
| D9 | `tp1_fraction` | `0.5` | 0.3 / 0.5 / 0.7 |
| D9 | `be_after_tp1` | `"entry"` | entry / entry_plus_spread / none |
| D9 | `trail_mode` | `"m15_swing"` | m15_swing / ema20_close / h1_swing / fixed_r |
| D9 | `trail_fractal_n` | `2` | m15_swing・h1_swing のn |
| D9 | `fixed_r` | `2.0` | 2 / 3(trail_mode='fixed_r') |
| D9 | `eod_close` | `True` | True / False |
| 運用 | `side` | `"both"` | both / long / short |
| D10 | `d10_session_utc` | `None` | (開始時, 終了時) UTC |
| D10 | `d10_max_spread_pips` | `None` | — |
| D10 | `d10_min_tp_sl_ratio` | `None` | — |

- 感度分析の候補は `core.params.SENSITIVITY_GRID`(1項目ずつ)、組で動かす `SENSITIVITY_PAIRS`、従属設定 `SENSITIVITY_REQUIRES`。
  `SENSITIVITY_REQUIRES` にある項目(例 `tl_recent_m` → `tl_mode='recent_high'`)を動かすときは従属設定も同時に入れる。
- **D10 は原典に無い**。`Params.is_original()` が False の結果は、原典準拠の結果と **混ぜて報告しない**(別表・別見出し)。
- 引継書の「候補」以外の値を使う場合は、レポート第9/10章に記録。

---

## 5. `strategy.run_backtest`(strategy担当)

```python
# strategy.py
def run_backtest(df15_with_htf: pd.DataFrame, params: Params, cfg: Config,
                 df1m: Optional[pd.DataFrame] = None) -> tuple[pd.DataFrame, dict]:
    """1通貨ペア分のバックテスト。戻り値 (trades_df, funnel_dict)。
    df15_with_htf: core.data.build_dataset の出力(または truncate_dataset で末尾を切ったもの)。
    df1m: 任意。1分足(UTC, 列 time/open/high/low/close)。ある場合、SLとTP1が同じ15分足で両方届き得る足の先後を1分足で判定。
    コスト未設定なら NotConfiguredError(黙ってコスト0にしない)。
    """

def run_benchmark_random(df15_with_htf, params, cfg, *, seed: int, ref_trades: pd.DataFrame,
                         df1m=None) -> tuple[pd.DataFrame, dict]:
    """段階E。D1〜D3 の方向が一致している足のランダムな時刻にエントリー。決済はD8・D9と同じ管理(§5.3)。"""

def run_all(...)  # 不要。stages.py が上記を呼ぶ。
```

### 5.1 判定(買い。売りは高安・不等号・EMAの並びを逆にする)
**足ごとの状態**(行 i の列だけで判定。いずれも確定済み情報):

| 条件 | 買いの定義(列名) |
|---|---|
| ready | 使う列がすべて非NaN(`ema320`, `atr14`, 上位足列 等) |
| h1_cross (D1) | `h1_sma20 > h1_sma80` かつ(`h1_cross_window` が None でなければ)`h1_gc_age <= h1_cross_window`。売りは `<` と `h1_dc_age` |
| d1 (D2) | A: `d1_close > d1_sma20` かつ `d1_sma20_chg{d1_slope_bars} > 0`。B: A かつ `d1_fr{n}_hl`(安値切上)。C: A かつ `d1_sma20 > d1_sma100`。D: 常に真。売りは不等号を逆、B は `d1_fr{n}_lh`(高値切下) |
| h4 (D3) | `h4_sma20 > h4_sma{h4_long_sma}` かつ(`h4_require_swing` なら)`h4_fr{n}_hl`。売りは逆・`h4_fr{n}_lh` |
| po (D4) | `ema10>ema20>ema40>ema80>ema320` かつ 5本すべて `ema > ema.shift(po_slope_bars)`。`po_expand` なら `(ema10-ema80)` が `po_expand_k` 本前より大きい(売りは差の絶対値) |

`htf_ok = h1_cross & d1 & h4`。

**局面(setup)の状態機械**(各サイドで同時に高々1局面。ポジション保有の有無とは独立に進む):
1. **開始**: `po` が False→True に切り替わった足で `htf_ok` なら局面を開始(`setup_po`)。局面が残っている間は新規開始しない。
2. **ブレイク待ち(D5)**: 基準高値 `ref` = 開始足を含む過去 `hi_lookback` 本の最高 `high`(`hi_mode='swing'` なら、確定済み `fr{hi_swing_fractal_n}_sh_last`)。`hi_break_on` が `close` なら `close > ref`、`high` なら `high > ref` で成立(`setup_break`)。待ち中に `po` が崩れたら `cancel_po_lost`。
3. **H0**: ブレイク足以降の最高値(その足の位置 `H0_pos` も保持)。H0 を更新する高値が出たら、押しの状態(触れフラグ・最安値・H1・本数)を **リセット** し H0 を更新。
4. **押し(D6)**: H0 の次の足から評価。`pb_extreme` = H0足の次〜現在の最安 `low`。
   - ema モード: 安値が `ema{pb_touch_ema}` 以下に触れたことがある(触れフラグ)。
   - ratio モード: `(H0 - pb_extreme)/(H0 - swing_low_before_break)` が `[pb_ratio_min, pb_ratio_max]`(`swing_low_before_break` = 局面開始足〜ブレイク足の最安 `low`)。
   - 共通: `pb_min_bars` 本以上経過。禁止条件: `pb_forbid_ema80_close` なら「`close < ema80` になった」、`pb_forbid_ema320_touch` なら「`low <= ema320` になった」 → `cancel_pullback_violated`(H0 以降で一度でも)。
   - 上記を満たした時点から `setup_pullback`。(ブレイク後の PO 崩れは押しの途中では自然なので、局面を消さない。)
5. **ライン(D7)**:
   - `tl_mode='trendline'`: H0足より後にできた確定フラクタル高値(`fr{tl_fractal_n}_sh_last_pos > H0_pos` かつ `fr{tl_fractal_n}_sh_last < H0`)を H1 とし、(H0_pos, H0)-(H1_pos, H1) の直線を延長。押し条件が成立していて、かつラインが確定している最初の足で `setup_line`(押し条件の成立前にラインが確定していても、数えるのは押し条件の成立後)。ライン値 `L(i) = H0 + (H1-H0)*(i-H0_pos)/(H1_pos-H0_pos)`。
   - `tl_mode='recent_high'`: ライン値 = 直前 `tl_recent_m` 本(i-M〜i-1)の最高 `high`。窓が全部 H0足より後のときに有効(`setup_line`)。
   - ブレイク: `tl_break_on='close'` なら `close > L`、`'high_margin'` なら `high > L + tl_margin_atr*atr14`。**押し条件成立後** に起きたら `setup_line_break`。
   - **有効期限**: `i > H0_pos + tl_expire_bars` なら `cancel_expired`(H0 更新で延長)。
   - 毎足の判定順: 上位足条件の喪失(`htf_ok` が False → `cancel_htf_lost`)→ ブレイク前のPO崩れ → 押し禁止条件 → 期限切れ → シグナル判定。
6. **損切り・フィルター(D8, D10)**: `SL = pb_extreme - sl_margin_atr*atr14`(`sl_mode='fixed_pips'` は `pb_extreme - (スプレッド+sl_fixed_pips)*pip`)。`tp1 = H0`。
   `risk = entry - SL`(entry は次の足の始値)。`risk <= 0` または `tp1 <= entry`(利確が既に不利側)なら見送り。`sl_max_h1_atr` 指定時 `risk > sl_max_h1_atr*h1_atr14` なら見送り。D10(時間帯 UTC の判定足の時刻、スプレッド上限、`(tp1-entry)/risk` の下限)もここ。見送りは `cancel_filter`。通過で `setup_filters`。
7. **約定**: 次の足の始値。`next.time - close_time > cfg.entry_max_gap_minutes` なら `cancel_no_next_bar`。`eod_close` で、約定足が判定足と別のサーバー日(`next.time >= day_end`)なら `cancel_no_next_bar`。ポジション保有中(どちらのサイドでも)なら `cancel_in_position`。約定で `setup_filled`。
   データ末尾で局面が残っていれば `cancel_open_at_end`。
- **ポジションは同時に1つ**(ペアごと)。

### 5.2 約定・決済(買い。売りは逆)
- エントリー: 次の足の始値(素の価格)。コストは `cost_r` で別計上(§1.3)。
- 約定足自体でも SL/TP1 に届き得る(SL優先)。
- **SL**: 足の `low <= SL` で `SL` 価格で約定。足が `SL` を飛び越えて始まる(始値 < SL)場合は始値で約定(不利側)。
- **TP1(H0)**: 足の `high >= tp1` で `tp1` 価格で `tp1_fraction` を決済(`partial=True`)。(指値の保守的扱い。始値が飛び越えても `tp1` 価格)
- SLとTP1が同じ足で両方届く場合は **SLが先**(全量SL)。`df1m` があれば、その15分足の1分足を時系列に見て先に届いた方(同じ1分足内なら SL)。
- **TP1後の残り**: 新しい損切り・追随は **TP1が約定した足の次の足から有効**(同じ足では使わない)。
  - `be_after_tp1`: `entry` → SL を建値へ / `entry_plus_spread` → 建値+スプレッド(買い) / `none` → 動かさない。
  - `trail_mode`:
    - `m15_swing`: 各足の終値後、確定済みの 15分足スイング安値(`fr{trail_fractal_n}_sl_last`)が現SLより高く、かつ現在の終値より低ければ SL を引き上げ(下げない)。次の足から有効。
    - `h1_swing`: 同様に `h1_fr{trail_fractal_n}_sl_last`(確定済み1時間足スイング安値)。
    - `ema20_close`: 15分足の終値が `ema20` を割ったら、次の足の始値で残りを決済(`ema20_exit`)。建値SLも有効。
    - `fixed_r`: `entry + fixed_r*risk` で残りを指値決済(`fixed_r`)。SLも有効(SL優先)。
- `eod_close=True`: `close_time == day_end` の足(サーバー日の最後の足)の終値で全決済(`eod`)。
- データ末尾: 最後の足の終値で全決済(`data_end`)。
- 残りの決済が SL 系なら `exit_reason` は、TP1前なら `sl`、TP1後で建値以下に移した SL なら `be_stop`、スイング追随で引き上げた SL なら `trail_stop`。

### 5.3 損益(R)
- `risk = |entry - SL|`(価格幅)、R の単位。各決済分の R = `方向 × (決済価格 - entry) / risk` を割合で加重した和が `r_multiple`(コスト控除前)。
- `cost_r = cfg.costs.cost_price(pair) / risk`、`pnl_r = r_multiple - cost_r`。成績集計は `pnl_r`。
- `run_benchmark_random`(段階E): 候補 = そのサイドで `htf_ok` が真(D1〜D3)で、ポジション無しの足。実取引(`ref_trades`)と同数のエントリーを、候補から一様ランダム(`seed` 固定、時刻の重複・保有中は引き直し)に選び、次の足の始値で約定。
  各ランダム取引の損切り幅は `ref_trades` から経験分布で復元抽出: `risk = (risk/atr15) の抽出値 × 約定判定足の atr14`、`tp1 = entry ± (tp1までの距離/risk の抽出値) × risk`。決済管理(TP1・建値・追随・EOD)は §5.2 と **同一のコード**を使う。`ref_trades` が空なら空の結果を返す。

### 5.4 戻り値

**`trades_df`**: 列は `core.schema.TRADE_COLUMNS`(この順序)。entry_time 昇順、`trade_id` は 0 始まり連番。取引0件でも列だけ持つ空 DataFrame。

| 列 | 型 | 意味 |
|---|---|---|
| `trade_id` | int | 連番 |
| `pair` | str | 通貨ペア |
| `side` | str | `long` / `short` |
| `signal_time` | datetime | 判定足の始値時刻 |
| `entry_time` | datetime | 約定足の始値時刻(= 約定時刻。`> signal_time`) |
| `exit_time` | datetime | 最終決済が起きた足の始値時刻 |
| `entry` | float | 約定価格(素の価格) |
| `sl` | float | 当初の損切り価格 |
| `tp1` | float | 第1利確価格(H0) |
| `risk` | float | `abs(entry - sl)` |
| `atr15` | float | 判定足の ATR(14, 15分足) |
| `h0` | float | 押しの起点(買い=高値、売り=安値) |
| `pb_extreme` | float | 押しの最安値(買い)/ 最高値(売り) |
| `partial` | bool | 第1利確が約定したか |
| `tp1_time` | datetime/NaT | 第1利確の足の始値時刻 |
| `exit_price` | float | 最終決済価格(残り、または全量) |
| `exit_reason` | str | `sl` / `be_stop` / `trail_stop` / `ema20_exit` / `fixed_r` / `eod` / `data_end` |
| `r_multiple` | float | コスト控除前の合計R |
| `cost_r` | float | コストのR換算 |
| `pnl_r` | float | `r_multiple - cost_r` |
| `bars_held` | int | 保有15分足数(約定足=1) |

任意列: `mae_r`, `mfe_r`, `params_key`, `tp1_r`。検証は `core.schema.validate_trades`。

**`funnel_dict`**: 平坦な `dict[str, int]`。キーは `core.schema.funnel_keys()` と完全一致(検証は `validate_funnel`)。

- `bars_total`: 入力の足数。
- サイドごと(`long.` / `short.` を前置)の **足条件の累積通過数**(前の条件をすべて満たした足の数。単調非増加):
  `bars_ready` ⊇ `h1_cross` ⊇ `d1` ⊇ `h4` ⊇ `po`
- サイドごとの **局面の累積到達数**(その段階以上に到達した局面数。単調非増加。各段階は局面ごとに **最初に到達したとき1回だけ** 数える。H0 更新でリセットされても二重に数えない):
  `setup_po` ⊇ `setup_break` ⊇ `setup_pullback` ⊇ `setup_line` ⊇ `setup_line_break` ⊇ `setup_filters` ⊇ `setup_filled`(= 取引数)
- サイドごとの **局面の終わり方**(すべての局面は `setup_filled` か下記のどれか1つで終わる。`setup_po == setup_filled + Σcancel_*`):
  `cancel_po_lost`, `cancel_htf_lost`, `cancel_pullback_violated`, `cancel_expired`, `cancel_filter`, `cancel_in_position`, `cancel_no_next_bar`, `cancel_open_at_end`
- 実キー例: `long.bars_ready`, `short.setup_line_break`, `long.cancel_expired`。
- `run_benchmark_random` の funnel は、`setup_po`〜`setup_filled` をすべて「約定したランダム取引数」にそろえ、`cancel_*` は0、足条件は同じ定義で数える(`validate_funnel` を通すこと)。

### 5.5 実装メモ(strategy担当へ)
- ベクトル化できる足条件(htf_ok, po)は事前に計算し、局面の状態機械だけをループ(速度のため。段階B・Cで数百〜数千回呼ばれる)。
- 細部で引継書にも本書にも無い判断をした場合は、`strategy.py` の docstring に「補完した点」として箇条書きし、`report` 第9/10章に載せられるよう `STRATEGY_NOTES: list[str]` をモジュール変数で公開する。
- テスト必須: ①未来の価格を書き換えても過去のシグナル・約定が不変 ②SL/TP同一足でSL優先 ③次の足の始値で約定(`entry_time > signal_time`、`entry == next open`) ④`validate_trades`/`validate_funnel` が通る ⑤コスト未設定で `NotConfiguredError` ⑥手組みの小データで TP1半分決済→建値→決済の損益Rが手計算と一致。

---

## 6. `stages.py`(stages担当)

```python
Datasets = Dict[str, pd.DataFrame]    # pair -> build_dataset の出力(GMTずらし0)

@dataclass
class Split:                          # 学習用/検証用の分割
    train_end: pd.Timestamp           # この時刻(close_time)までが学習用、より後が検証用
    note: str                         # 分け方の説明(レポートに記録)

@dataclass
class RunResult:
    trades: pd.DataFrame; funnel: dict; metrics: dict   # metrics = core.metrics.compute_metrics(trades)
    params_key: str

def build_all(raw15: Dict[str, pd.DataFrame], cfg: Config) -> Datasets
    # build_dataset を全ペアに。GMTずらし用に cfg.with_gmt_shift(h) で呼び直せる形にする。
def make_split(ds_main: pd.DataFrame, cfg: Config, train_frac: float = 0.6) -> Split
    # cfg.split.train_end があればそれを使う。無ければ全期間の train_frac 位置を月初に丸める。
    # 検証用期間を見てから変更しない(変更したら報告書に明記し、判定は「保留」寄り)。
def run_period(ds: pd.DataFrame, params: Params, cfg: Config, period: str, split: Split,
               df1m=None) -> RunResult
    # period: 'all' | 'train' | 'oos'
    #  train: truncate_dataset(ds, split.train_end) で末尾を切って run_backtest(検証期間の値動きを成績に混ぜない)
    #  oos  : 全期間で run_backtest し、entry_time > split.train_end の取引だけ残す(指標はウォームアップ済み)
    #         ※ oos の funnel は全期間分(参考値)
    #  all  : 全期間

def stage_a(datasets: Datasets, cfg: Config, split: Split, *, pair="USDJPY",
            params: Optional[Params] = None) -> dict
    # 戻り値: {"params": dict, "pair": str,
    #   "all": {"metrics","breakdown_year","breakdown_side","funnel"}, "train": {"metrics"}, "oos": {"metrics"}}
    # 原典準拠の基準設定1本。条件ごとの通過数(funnel)を必ず含める。

def stage_b(datasets, cfg, split, *, pair="USDJPY", base: Optional[Params] = None,
            grid=SENSITIVITY_GRID, pairs_grid=SENSITIVITY_PAIRS) -> pd.DataFrame
    # 学習用期間のみ。他は基準案に固定して1項目ずつ。列: param, value, is_base, params_key,
    #   n_trades, win_rate, pf, avg_r, total_r, max_dd_r
    #   (従属設定 SENSITIVITY_REQUIRES は同時に設定。組の項目は param="a+b", value=(x,y))
    # DataFrame.attrs["n_trials"] = 試した設定数

def select_axes(stage_b_df: pd.DataFrame, top_k: int = 4) -> dict[str, list]
    # 段階Bで avg_r(または pf)の動きが大きい項目 top_k(3〜4)を選び {field: values} を返す。選定理由を attrs に残す。

def stage_c(datasets, cfg, split, *, pair="USDJPY", base=None, axes: dict[str, list]) -> dict
    # 限定グリッド(学習用期間のみ)。戻り値 {"results": DataFrame(各軸+指標), "n_trials": int, "axes": axes,
    #   "chosen_params": dict, "selection_rule": str}
    # chosen: 最高成績の点ではなく「台地の中央」。近傍は自分自身を除く(順序のある軸の隣の水準のみ)。
    #   まず台地の点(近傍の有効な点すべてとPF差が pf_tol 以内・平均Rの符号が同じ)だけを候補にし、その中で近傍平均 avg_r が最大の点を選ぶ。
    #   台地の点が無い/順序のある軸が無いときは選ばない(chosen_params=None, selection_info.no_plateau=True)。
    # n_trials = 段階A+B+Cで試した設定の総数(多重検定の目安としてレポートに載せる)。

def stage_d(raw15: Dict[str, pd.DataFrame], cfg: Config, split: Split, chosen: Params, *,
            main_pair="USDJPY", gmt_shifts=(-1, 0, 1), gate_sets: Optional[dict] = None) -> dict
    # chosen を固定(再調整しない)。区間: (main_pair,'train'), (main_pair,'oos'), 他ペア 'all'(再調整なし),
    #   各ペアの GMT ずらし(-1,+1; 0 は既出)。戻り値:
    #   {"segments": [{"pair","period","gmt_shift","scope","metrics","breakdown_year","breakdown_side",
    #                  "gates": {gate_name: GateResult.to_dict()}}, ...],
    #    "chosen_params": dict}
    # scope: train/oos/pair/gmt_shift。gate_sets 既定 = {"phase0": PHASE0_GATE, "promotion": PROMOTION_GATE}
    # → 基準未転記なら各 gates の verdict は「保留」になる(それが正しい挙動)。

def stage_e(datasets, cfg, split, chosen: Params, *, main_pair="USDJPY", n_runs: int = 100, seed: int = 0) -> dict
    # ベンチマーク: 実戦略の取引を ref_trades として run_benchmark_random を n_runs 回(seed, seed+1, ...)。
    #   区間は stage_d と同じ(GMTずらしなし)。戻り値:
    #   {"segments": [{"pair","period","real": metrics,
    #                  "random": {"avg_r": {"mean","p05","p50","p95"}, "pf": {...}, "win_rate": {...}, "n_runs": int},
    #                  "real_avg_r_percentile": float}]}
    #   real_avg_r_percentile = ランダム n_runs 回のうち実戦略の avg_r を下回った割合(0〜1)
```
- 段階の打ち切り: 段階Cの時点で、ゲートの学習用基準(`scope='train'`)に届く設定が **1つも無い** なら、段階Dは省略してよい(`stage_d` を呼ばず、レポートで「勝てない」の根拠にする)。ただし **ゲート基準が未転記(保留)の間は打ち切り判断をしない**(保留のまま全段階を回す)。
- 段階Aで取引が極端に少ない・大負けでも段階Bまでは進める。
- 学習用期間の結果を見てからパラメータを選ぶのは良いが、**検証用期間・他ペアの結果を見てから選び直さない**。選び直した場合は `meta.reselected = True` を立てる(判定は保留寄り)。

### 6.1 `run_verification.py`(CLI)
```
python run_verification.py --synthetic [--years 3] [--seed 0]          # 合成データで動作確認(結果は『テスト用』と表示)
python run_verification.py --data-dir data --pairs USDJPY EURUSD GBPUSD EURJPY \
        --file-pattern "{pair}_M15.csv" --source-tz ny_close_server [--m1-pattern "{pair}_M1.csv"] \
        [--gates-json phase0.json promotion.json] [--costs-json costs.json] [--train-end 2022-12-31] --out out/
```
- `--synthetic` のときは `synthetic_test_config()` を使い、レポート冒頭に「合成データ・テスト用コスト。判定は保留」を強制表示。
- 実データのとき、コスト(`--costs-json`)が無ければ `NotConfiguredError` ではなく「保留(コスト未設定)」としてレポートを出して終了。
- 出力: `out/report.md`, `out/result.json`(再現用に params・seed・split・n_trials を含む)。

---

## 7. `report.py`(report担当)

```python
def decide_verdict(result: dict) -> dict
    # -> {"verdict": "勝てる"|"勝てない"|"保留", "primary_reason": str, "missing": list[str]}
def build_report(result: dict) -> str          # Markdown(日本語)。第6章の10項目の構成
def write_report(result: dict, path: str) -> None
```

**`result`(入力)の構造**(キーが無い段階は `None` / 省略可。省略は「未実施」と表示):
```python
{
 "meta": {
   "synthetic": bool,                  # True なら冒頭に警告バナーを出し、verdict は必ず「保留」
   "data_source": str, "pairs": [str], "periods": {pair: (first, last)},
   "split": {"train_end": str, "note": str},
   "costs": {"source": str, "is_test_value": bool, "ready": bool},
   "gates": {"phase0": {"n_rules": int, "complete": bool}, "promotion": {...}},   # 未転記なら n_rules=0
   "reselected": bool,                 # 検証期間や他ペアを見てから選び直したか
   "gmt_shifts": [-1, 0, 1],
   "notes": [str],                     # STRATEGY_NOTES など(補完した点)
   "limits": [str],                    # 限界・未確認事項(追加)
 },
 "stage_a": <stage_a の戻り値>,
 "stage_b": DataFrame,
 "stage_c": <stage_c の戻り値>,
 "stage_d": <stage_d の戻り値>,
 "stage_e": <stage_e の戻り値>,
}
```
**`decide_verdict` の規則**:
- 次のどれかなら **保留**(`missing` に理由を列挙): 合成データ / ゲート基準が未転記(いずれかのゲートで `complete=False`)/ コスト未設定 / 実データ無し・OOS期間なし・必要ペア欠け / `reselected=True`。
- 保留条件がなく、段階Cで学習用ゲート(`scope='train'`)を満たす設定が無い → **勝てない**。または段階Dで検証用・横展開・GMTずらしの区間に `不合格` がある(通過が一部の設定・ペアに限られる)→ **勝てない**。
- 保留条件がなく、段階Dの全区間・全ゲートが `合格` → **勝てる**。
- 「一番の理由」(`primary_reason`)は1〜2文で、結論の最初に出す。

**`build_report` の構成**(引継書 第6章。見出し番号を固定):
1. 結論と一番の理由 2. ゲート項目ごとの合否(学習・検証・各ペア・GMTずらし) 3. 段階Aの成績 4. 選んだ設定・選び方・試行総数
5. 主要な成績(取引回数・勝率・PF・平均R・期待値R・最大DD・年別・ペア別・買い売り別) 6. 感度分析(項目ごとの表) 7. ベンチマーク(段階E)比較
8. 条件ごとの通過数(funnel) 9. 原典に無い補完(D9の残り決済など)と影響 10. 限界と未確認事項・追加検証案
- 数値の丸めは小数2〜3桁。PF が `inf`/`None` のときはそのまま「∞」「算出不能」と表示。
- ゲートの閾値は `GateResult.to_dict()` の値をそのまま表示(レポート側で閾値を作らない)。未転記は「未転記」と表示。
- 合成データのとき: 各表の見出し近くに「(合成データ・テスト用)」を付ける。
- D10(追加フィルター)の結果は「原典準拠」と別の節にする。

---

## 8. やってはいけないこと(再掲・引継書 第8章)
- 検証用期間(OOS)や他通貨ペアの結果を見てからパラメータを選び直す(した場合は明記し「保留」寄り)。
- 原典に無いフィルター(D10)を原典準拠の結果と混ぜて報告する。
- 学習用期間だけの好成績で「勝てる」と判定する。
- 最高成績の1点を選ぶ(台地の中央を選ぶ)。
- ゲート基準値・スプレッド・スリッページを自作・推測する(ea-lab から転記するまで placeholder)。
- `ea-lab` の既存ファイルの削除・上書きが必要になったら止まって確認する(このリポジトリには ea-lab は無い)。
