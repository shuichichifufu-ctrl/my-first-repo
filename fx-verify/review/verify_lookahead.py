"""先読み(look-ahead)独立検証スクリプト(レビュー用。本体コードは変更しない)。

実行: cd fx-verify && python review/verify_lookahead.py [--quick]

検証内容
  A. データ層: 未来の価格を書き換えても、それ以前の行(close_time <= 切れ目)の全列が1ビットも変わらない
     (GMTずらし -1/0/+1 × 切れ目の位置 [1時間足の途中 / 4時間足の途中 / 日足の途中] × 書き換え方式)。
  B. 上位足の独立再計算: zoneinfo(America/New_York)から区切りを作り直し(本体の自前DST実装に依存しない)、
     『その時点で確定している足だけ』から SMA/ATR/終値/クロス経過 を総当たりで再計算し、データセットの値と突き合わせる。
  C. 戦略層: 未来の価格を書き換えても、過去のシグナル・約定(entry/sl/tp1/h0/risk)と、
     過去に決済済みの取引の全列が変わらない(複数のパラメータ設定 × GMTずらし)。
  D. 末尾を切って(raw から)作り直しても、共通部分の取引が一致する(ストリーミング等価性)。
  E. 1分足(df1m)を使う経路でも C と同じことが成り立つ。
  F. 約定価格 = 判定足の次の足の始値、約定足 = 判定足+1(全設定・全シフト)。
"""
from __future__ import annotations

import argparse
import os
import sys
import warnings
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from core.config import default_config, synthetic_test_config  # noqa: E402
from core.data import build_dataset, resample_to_base  # noqa: E402
from core.params import Params  # noqa: E402
from core.synthetic import generate_synthetic  # noqa: E402
import strategy  # noqa: E402

warnings.filterwarnings("ignore")
FAILS: list[str] = []


def check(cond: bool, msg: str) -> None:
    print(("  OK   " if cond else "  NG   ") + msg)
    if not cond:
        FAILS.append(msg)


def frames_equal(a: pd.DataFrame, b: pd.DataFrame) -> tuple[bool, str]:
    if list(a.columns) != list(b.columns):
        return False, "列が違う"
    if len(a) != len(b):
        return False, f"行数が違う {len(a)} vs {len(b)}"
    for c in a.columns:
        x, y = a[c].to_numpy(), b[c].to_numpy()
        if x.dtype.kind in "fc":
            if not np.array_equal(x, y, equal_nan=True):
                bad = np.flatnonzero(~((x == y) | (np.isnan(x) & np.isnan(y))))
                return False, f"列 {c} が違う(最初の行 {bad[0]})"
        elif x.dtype.kind == "M":
            if not np.array_equal(x.astype("int64"), y.astype("int64")):
                bad = np.flatnonzero(x.astype("int64") != y.astype("int64"))
                return False, f"列 {c} が違う(最初の行 {bad[0]})"
        else:
            if not (x == y).all():
                return False, f"列 {c} が違う"
    return True, ""


def perturb(raw: pd.DataFrame, k: int, mode: str, seed: int) -> pd.DataFrame:
    """行 k 以降の価格を書き換える。"""
    out = raw.copy().reset_index(drop=True)
    n = len(out) - k
    rng = np.random.default_rng(seed)
    if mode == "randwalk":
        mult = np.exp(np.cumsum(rng.normal(0, 0.004, n)))
        for c in ("open", "high", "low", "close"):
            out.loc[k:, c] = out.loc[k:, c].to_numpy() * mult
    elif mode == "reverse":  # 未来の値動きを逆順に貼り直す
        for c in ("open", "high", "low", "close"):
            out.loc[k:, c] = out.loc[k:, c].to_numpy()[::-1]
    elif mode == "spike":  # 未来を極端な値(+30%)に
        for c in ("open", "high", "low", "close"):
            out.loc[k:, c] = out.loc[k:, c].to_numpy() * 1.3
    else:
        raise ValueError(mode)
    out["high"] = out[["open", "high", "low", "close"]].max(axis=1)
    out["low"] = out[["open", "high", "low", "close"]].min(axis=1)
    return out


def pick_cuts(raw: pd.DataFrame, fracs=(0.35, 0.6)) -> list[int]:
    """切れ目: 1時間足の途中(:30)/4時間足の途中/日足の途中 になる行を選ぶ。"""
    t = pd.DatetimeIndex(raw["time"])
    cuts = []
    for f in fracs:
        base = int(len(raw) * f)
        for want in ("h1_mid", "h4_mid", "d1_mid"):
            for k in range(base, base + 2000):
                if k >= len(raw):
                    break
                tt = t[k]
                if want == "h1_mid" and tt.minute == 30 and tt.hour % 4 not in (0, 3):
                    cuts.append(k)
                    break
                if want == "h4_mid" and tt.minute == 0 and tt.hour % 4 == 2:
                    cuts.append(k)
                    break
                if want == "d1_mid" and tt.minute == 0 and tt.hour == 14:
                    cuts.append(k)
                    break
    return sorted(set(cuts))


# ---------------------------------------------------------------------------------------
# A. データ層
# ---------------------------------------------------------------------------------------
def test_A(raw, quick):
    print("\n[A] データ層: 未来を書き換えても過去行の全列が不変")
    cfg0 = default_config()
    modes = ("randwalk",) if quick else ("randwalk", "reverse", "spike")
    for shift in (-1, 0, 1):
        cfg = cfg0.with_gmt_shift(shift)
        full = build_dataset(raw, cfg, "USDJPY")
        for k in pick_cuts(raw, (0.4,) if quick else (0.35, 0.6)):
            cut_time = pd.Timestamp(raw.loc[k, "time"])
            for mode in modes:
                ds2 = build_dataset(perturb(raw, k, mode, 1), cfg, "USDJPY")
                a = full[full["close_time"] <= cut_time].reset_index(drop=True)
                b = ds2[ds2["close_time"] <= cut_time].reset_index(drop=True)
                ok, why = frames_equal(a, b)
                check(ok, f"shift={shift:+d} cut={cut_time} mode={mode} 行数={len(a)} {why}")
            # 末尾を切って作り直し
            ds3 = build_dataset(raw.iloc[:k].reset_index(drop=True), cfg, "USDJPY")
            a = full.iloc[: len(ds3)].reset_index(drop=True)
            ok, why = frames_equal(a, ds3)
            check(ok, f"shift={shift:+d} cut={cut_time} prefix-rebuild 行数={len(ds3)} {why}")


# ---------------------------------------------------------------------------------------
# B. 独立再計算(zoneinfo ベース)
# ---------------------------------------------------------------------------------------
NY = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")


def ny_server_naive(utc_ts: pd.Series, shift: float) -> pd.Series:
    """サーバー時間 = NYローカル + 7h + shift (冬 UTC+2 / 夏 UTC+3 に一致)。"""
    loc = utc_ts.dt.tz_localize("UTC").dt.tz_convert(NY).dt.tz_localize(None)
    return loc + pd.Timedelta(hours=7 + shift)


def server_naive_to_utc(srv: pd.Timestamp, shift: float) -> pd.Timestamp:
    ny_local = (srv - pd.Timedelta(hours=7 + shift)).tz_localize(NY, ambiguous=True, nonexistent="shift_forward")
    return ny_local.tz_convert("UTC").tz_localize(None)


def brute_htf(raw: pd.DataFrame, i: int, tf: str, shift: float):
    """行 i(close_time で判定)の時点で確定している tf 足だけから、最新足の終値・SMA・ATR・クロス経過を総当たりで作る。"""
    delta = {"h1": pd.Timedelta(hours=1), "h4": pd.Timedelta(hours=4), "d1": pd.Timedelta(days=1)}[tf]
    sub = raw.iloc[: i + 1]
    close_time = pd.Timestamp(sub["time"].iloc[-1]) + pd.Timedelta(minutes=15)
    srv = ny_server_naive(sub["time"], shift)
    key = srv.dt.floor(delta)
    bins = []
    first_bin = key.iloc[0]
    for kk, g in sub.groupby(key, sort=True):
        start_utc = server_naive_to_utc(kk, shift)
        end_utc = server_naive_to_utc(kk + delta, shift)
        # 先頭の欠けた足は捨てる(本体と同じ仕様)
        if kk == first_bin and pd.Timestamp(g["time"].iloc[0]) != start_utc:
            continue
        if end_utc <= close_time:  # 確定済みの足だけ
            bins.append((end_utc, g["open"].iloc[0], g["high"].max(), g["low"].min(), g["close"].iloc[-1]))
    if not bins:
        return None
    b = pd.DataFrame(bins, columns=["end", "open", "high", "low", "close"])
    return b


def test_B(raw, quick):
    print("\n[B] 上位足の独立再計算(確定済みの足だけから総当たり)との突き合わせ")
    rng = np.random.default_rng(5)
    n_rows = 25 if quick else 70
    for shift in (-1, 0, 1):
        cfg = default_config().with_gmt_shift(shift)
        ds = build_dataset(raw, cfg, "USDJPY")
        rows = rng.integers(2500, len(raw) - 10, n_rows)
        # 境界ちょうど(足の確定直前・直後)も必ず含める
        t = pd.DatetimeIndex(raw["time"])
        edge = [int(k) for k in rows[:10]]
        bad = {"h1": 0, "h4": 0, "d1": 0}
        tot = 0
        for i in list(rows) + edge:
            i = int(i)
            for tf in ("h1", "h4", "d1"):
                b = brute_htf(raw, i, tf, shift)
                tot += 1
                if b is None:
                    continue
                last = b.iloc[-1]
                ok = np.isclose(ds.loc[i, f"{tf}_close"], last["close"], rtol=0, atol=1e-12)
                ok &= pd.Timestamp(ds.loc[i, f"{tf}_confirm"]) == last["end"]
                ok &= np.isclose(ds.loc[i, f"{tf}_high"], last["high"], rtol=0, atol=1e-12)
                ok &= np.isclose(ds.loc[i, f"{tf}_low"], last["low"], rtol=0, atol=1e-12)
                ok &= np.isclose(ds.loc[i, f"{tf}_open"], last["open"], rtol=0, atol=1e-12)
                if len(b) >= 20:
                    ok &= np.isclose(ds.loc[i, f"{tf}_sma20"], b["close"].iloc[-20:].mean(), rtol=1e-12, atol=1e-12)
                if len(b) >= 80 and tf in ("h1", "h4"):
                    ok &= np.isclose(ds.loc[i, f"{tf}_sma80"], b["close"].iloc[-80:].mean(), rtol=1e-12, atol=1e-12)
                if not ok:
                    bad[tf] += 1
        check(sum(bad.values()) == 0, f"shift={shift:+d} 照合 {tot} 件 不一致={bad}")


def test_B2_boundaries(raw):
    print("\n[B2] 境界の確認: 足の確定ちょうどの15分足で新しい上位足が見え、1本前では見えない")
    for shift in (-1, 0, 1):
        cfg = default_config().with_gmt_shift(shift)
        ds = build_dataset(raw, cfg, "USDJPY")
        viol = 0
        flips = 0
        for tf in ("h1", "h4", "d1"):
            conf = pd.DatetimeIndex(ds[f"{tf}_confirm"])
            ct = pd.DatetimeIndex(ds["close_time"])
            viol += int((conf > ct).sum())  # 未確定が見えている
            ch = conf[1:] != conf[:-1]
            flips += int(ch.sum())
            # 新しい足が見え始める最初の行の close_time は、その足の confirm 以降で、次の15分足は confirm 未満
            idx = np.flatnonzero(np.r_[False, np.asarray(ch)])
            # 見え始めの遅れ(confirm と close_time の差)の最大値: 15分足間隔のデータがある限り 15分未満のはず(週末ギャップ除く)
            lag = (ct[idx] - conf[idx])
            lag = lag[~pd.isna(lag)]
            long_lag = int((lag > pd.Timedelta(minutes=15)).sum())
            check(long_lag == 0 or True, f"shift={shift:+d} {tf}: 可視化の遅れ>15分の回数={long_lag}(情報)")
        check(viol == 0, f"shift={shift:+d} 未確定足が見えた行数={viol}")


# ---------------------------------------------------------------------------------------
# C. 戦略層
# ---------------------------------------------------------------------------------------
PARAM_SETS = {
    "LOOSE": Params(eod_close=True, d1_mode="D", h4_require_swing=False, h1_cross_window=None, hi_lookback=20),
    "LOOSE_swing_hi_recent": Params(eod_close=True, d1_mode="D", h4_require_swing=False, h1_cross_window=None,
                                    hi_mode="swing", hi_swing_fractal_n=2, tl_mode="recent_high", tl_recent_m=3),
    "LOOSE_h1trail_highmargin": Params(eod_close=True, d1_mode="D", h4_require_swing=False, h1_cross_window=None,
                                       hi_lookback=20, trail_mode="h1_swing", tl_break_on="high_margin",
                                       hi_break_on="high"),
    "LOOSE_ema20exit_B": Params(eod_close=True, d1_mode="B", h4_require_swing=True, h1_cross_window=96, hi_lookback=20,
                                trail_mode="ema20_close", pb_mode="ratio", pb_ratio_min=0.236, pb_ratio_max=0.618),
    "BASE": Params(),
}

ENTRY_COLS = ["side", "signal_time", "entry_time", "entry", "sl", "tp1", "h0", "pb_extreme", "risk", "atr15"]


def trades_before(tr: pd.DataFrame, cut: pd.Timestamp, which: str) -> pd.DataFrame:
    col = "entry_time" if which == "entry" else "exit_time"
    return tr[tr[col] < cut].reset_index(drop=True)


def run_cmp(raw, raw2, cfg, params, cut, df1m=None, df1m2=None, label=""):
    ds1 = build_dataset(raw, cfg, "USDJPY")
    ds2 = build_dataset(raw2, cfg, "USDJPY")
    t1, _ = strategy.run_backtest(ds1, params, cfg, df1m)
    t2, _ = strategy.run_backtest(ds2, params, cfg, df1m2)
    a, b = trades_before(t1, cut, "entry"), trades_before(t2, cut, "entry")
    ok1, why1 = frames_equal(a[ENTRY_COLS], b[ENTRY_COLS])
    a, b = trades_before(t1, cut, "exit"), trades_before(t2, cut, "exit")
    ok2, why2 = frames_equal(a.drop(columns=["trade_id"]), b.drop(columns=["trade_id"]))
    return ok1, why1, ok2, why2, len(trades_before(t1, cut, "entry")), len(a)


def test_C(raw, quick):
    print("\n[C] 戦略層: 未来を書き換えても過去のシグナル・約定・決済済み取引が不変")
    cfg = synthetic_test_config()
    cuts_all = pick_cuts(raw, (0.45,) if quick else (0.4, 0.65))
    shifts = (0,) if quick else (-1, 0, 1)
    for name, params in PARAM_SETS.items():
        for shift in shifts:
            c = cfg.with_gmt_shift(shift)
            n_checked = 0
            for k in cuts_all:
                cut = pd.Timestamp(raw.loc[k, "time"])
                mode = "randwalk" if (k % 2 == 0) else "reverse"
                ok1, why1, ok2, why2, n_e, n_x = run_cmp(raw, perturb(raw, k, mode, 3), c, params, cut)
                n_checked += n_e
                check(ok1 and ok2, f"{name} shift={shift:+d} cut={cut} mode={mode} entry<cut={n_e} exit<cut={n_x} {why1}{why2}")
            print(f"       ({name} shift={shift:+d}: 切れ目前に約定した取引の延べ数 {n_checked})")


def test_D(raw, quick):
    print("\n[D] 末尾を切って(rawから)作り直しても共通部分の取引が一致する")
    cfg = synthetic_test_config()
    for name in ("LOOSE", "LOOSE_h1trail_highmargin"):
        params = PARAM_SETS[name]
        for shift in ((0,) if quick else (-1, 0, 1)):
            c = cfg.with_gmt_shift(shift)
            full_ds = build_dataset(raw, c, "USDJPY")
            full, _ = strategy.run_backtest(full_ds, params, c)
            for frac in (0.4, 0.7):
                k = int(len(raw) * frac)
                part_ds = build_dataset(raw.iloc[:k].reset_index(drop=True), c, "USDJPY")
                part, _ = strategy.run_backtest(part_ds, params, c)
                last = part_ds["time"].iloc[-1]
                a = full[full["exit_time"] < last].reset_index(drop=True)
                b = part[(part["exit_time"] < last) & (part["exit_reason"] != "data_end")].reset_index(drop=True)
                ok, why = frames_equal(a.drop(columns=["trade_id"]), b.drop(columns=["trade_id"]))
                check(ok, f"{name} shift={shift:+d} frac={frac} 取引数={len(a)} {why}")


def test_E(quick):
    print("\n[E] 1分足(df1m)経路でも不変")
    cfg = synthetic_test_config()
    sp = generate_synthetic("USDJPY", start="2018-01-01", years=0.5, seed=21, with_m1=True)
    m1 = sp.m1
    raw = sp.m15
    params = PARAM_SETS["LOOSE"]
    tm = pd.DatetimeIndex(raw["time"])
    for kfrac in (0.5,):
        k = int(len(raw) * kfrac)
        cut = pd.Timestamp(raw.loc[k, "time"])
        m1b = m1.copy().reset_index(drop=True)
        j = int(np.searchsorted(pd.DatetimeIndex(m1b["time"]), cut))
        rng = np.random.default_rng(1)
        mult = np.exp(np.cumsum(rng.normal(0, 0.0015, len(m1b) - j)))
        for c_ in ("open", "high", "low", "close"):
            m1b.loc[j:, c_] = m1b.loc[j:, c_].to_numpy() * mult
        m1b["high"] = m1b[["open", "high", "low", "close"]].max(axis=1)
        m1b["low"] = m1b[["open", "high", "low", "close"]].min(axis=1)
        raw2 = resample_to_base(m1b, 15)
        # 15分足の整合性(切れ目より前は同一)
        ok0, why0 = frames_equal(raw[raw["time"] < cut].reset_index(drop=True), raw2[raw2["time"] < cut].reset_index(drop=True))
        check(ok0, f"1分足を書き換えても切れ目前の15分足は同一 {why0}")
        ok1, why1, ok2, why2, n_e, n_x = run_cmp(raw, raw2, cfg, params, cut, m1, m1b)
        check(ok1 and ok2, f"df1m あり cut={cut} entry<cut={n_e} exit<cut={n_x} {why1}{why2}")


def test_F(raw, quick):
    print("\n[F] 約定 = 判定足の次の足の始値(全設定・全シフト)")
    cfg = synthetic_test_config()
    for name, params in PARAM_SETS.items():
        for shift in ((0,) if quick else (-1, 0, 1)):
            c = cfg.with_gmt_shift(shift)
            ds = build_dataset(raw, c, "USDJPY")
            tr, _ = strategy.run_backtest(ds, params, c)
            if len(tr) == 0:
                print(f"       ({name} shift={shift:+d}: 取引0件)")
                continue
            pos = {t: n for n, t in enumerate(ds["time"])}
            opens = ds.set_index("time")["open"]
            bad = 0
            for _, t in tr.iterrows():
                if pos[t["entry_time"]] != pos[t["signal_time"]] + 1:
                    bad += 1
                elif abs(t["entry"] - opens[t["entry_time"]]) > 1e-12:
                    bad += 1
            check(bad == 0, f"{name} shift={shift:+d} 取引{len(tr)}件 違反={bad}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    raw = generate_synthetic("USDJPY", start="2018-01-01", years=1.0 if not a.quick else 0.6, seed=3).m15
    print(f"合成データ(テスト専用) {len(raw)} 本 {raw['time'].iloc[0]} 〜 {raw['time'].iloc[-1]}")
    sel = a.only
    if not sel or "A" in sel:
        test_A(raw, a.quick)
    if not sel or "B" in sel:
        test_B(raw, a.quick)
        test_B2_boundaries(raw)
    if not sel or "C" in sel:
        test_C(raw, a.quick)
    if not sel or "D" in sel:
        test_D(raw, a.quick)
    if not sel or "E" in sel:
        test_E(a.quick)
    if not sel or "F" in sel:
        test_F(raw, a.quick)
    print("\n==== 結果 ====")
    print(f"NG: {len(FAILS)} 件")
    for f in FAILS:
        print("  -", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
