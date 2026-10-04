"""データ読込・リサンプル・上位足の結合(先読み防止の中核)。

時刻の約束(全モジュール共通):
- すべての時刻は「タイムゾーンなしのUTC」(datetime64[ns])で持つ。
- 15分足の `time` は『足の始値時刻(open time)』、`close_time` = time + 15分 は『その足が確定する時刻』。
- 上位足(d1/h4/h1)は `time`(始値時刻) と `confirm_time`(確定時刻 = 区切りの終わり)を持つ。
- 15分足の判定は close_time に行う。その時点で見えてよい上位足は confirm_time <= close_time のものだけ。
  (例: 10:00開始の1時間足は11:00に確定。15分足 10:30 の足(close 10:45)からは見えない。10:45の足(close 11:00)からは見える)
- エントリーは判定足の次の足の始値で約定する(strategy側の責務)。

サーバー時間(日足・4時間足の区切り):
- 既定は ニューヨーククローズ式 = 冬 GMT+2 / 米国夏時間中 GMT+3(NY 17:00 で日足が切り替わる)。
- config.DayBoundaryConfig.gmt_shift_hours で ±1h ずらせる(区切りの位置が動く)。
"""
from __future__ import annotations

import calendar
import datetime as _dt
import re
from typing import Iterable, Optional

import numpy as np
import pandas as pd

from .config import Config, DayBoundaryConfig, FeatureSpec
from .indicators import atr, cross_ages, ema, fractal_swings, sma

HTF_DELTA = {
    "d1": pd.Timedelta(days=1),
    "h4": pd.Timedelta(hours=4),
    "h1": pd.Timedelta(hours=1),
}
OHLC = ["open", "high", "low", "close"]
BASE_COLS = ["time", "open", "high", "low", "close", "volume"]


# ---------------------------------------------------------------------------
# 時刻ユーティリティ
# ---------------------------------------------------------------------------
def to_naive_utc(x) -> pd.DatetimeIndex:
    """任意の時刻列を『tzなしUTC, ns精度』の DatetimeIndex にそろえる。"""
    idx = pd.DatetimeIndex(pd.to_datetime(x))
    if idx.tz is not None:
        idx = idx.tz_convert("UTC").tz_localize(None)
    return idx.as_unit("ns")


def _nth_sunday(year: int, month: int, n: int) -> int:
    """月の n 番目(0始まり)の日曜の日付。n=-1 で最終日曜。"""
    sundays = [w[6] for w in calendar.monthcalendar(year, month) if w[6] != 0]
    return sundays[n]


def _us_dst_bounds_utc(year: int):
    """米国夏時間の開始・終了(UTC)。いずれも現地 2:00 切替。2007年以降の規則 / それ以前の規則。"""
    if year >= 2007:
        s = _dt.datetime(year, 3, _nth_sunday(year, 3, 1), 7)  # 3月第2日曜 2:00 EST = 07:00 UTC
        e = _dt.datetime(year, 11, _nth_sunday(year, 11, 0), 6)  # 11月第1日曜 2:00 EDT = 06:00 UTC
    else:
        s = _dt.datetime(year, 4, _nth_sunday(year, 4, 0), 7)  # 4月第1日曜
        e = _dt.datetime(year, 10, _nth_sunday(year, 10, -1), 6)  # 10月最終日曜
    return np.datetime64(s, "ns"), np.datetime64(e, "ns")


def us_dst_active(utc: pd.DatetimeIndex) -> np.ndarray:
    """各UTC時刻が米国夏時間中か(tzdata に依存しない自前実装)。"""
    idx = to_naive_utc(utc)
    years = idx.year.to_numpy()
    uy, inv = np.unique(years, return_inverse=True)
    bounds = [_us_dst_bounds_utc(int(y)) for y in uy]
    st = np.array([b[0] for b in bounds], dtype="datetime64[ns]")[inv]
    en = np.array([b[1] for b in bounds], dtype="datetime64[ns]")[inv]
    t = idx.to_numpy()
    return (t >= st) & (t < en)


def server_offset(utc: pd.DatetimeIndex, day: DayBoundaryConfig) -> np.ndarray:
    """UTC時刻ごとの『サーバー時間 - UTC』(timedelta64[ns]配列)。gmt_shift_hours を加算済み。"""
    idx = to_naive_utc(utc)
    if day.mode == "fixed":
        hrs = np.full(len(idx), day.fixed_offset_hours, dtype=float)
    else:
        hrs = np.where(us_dst_active(idx), day.summer_offset_hours, day.winter_offset_hours).astype(float)
    hrs = hrs + day.gmt_shift_hours
    return (hrs * 3600e9).astype("int64").astype("timedelta64[ns]")


def server_to_utc(server_time: pd.DatetimeIndex, day: DayBoundaryConfig) -> pd.DatetimeIndex:
    """サーバー時間(tzなし)をUTCに戻す。夏冬の切替直前後の曖昧な1時間は夏時間側を優先。"""
    st = to_naive_utc(server_time)
    if day.mode == "fixed":
        return st - pd.Timedelta(hours=day.fixed_offset_hours + day.gmt_shift_hours)
    shift = day.gmt_shift_hours
    utc_w = st - pd.Timedelta(hours=day.winter_offset_hours + shift)
    utc_s = st - pd.Timedelta(hours=day.summer_offset_hours + shift)
    use_s = us_dst_active(utc_s)
    return pd.DatetimeIndex(np.where(use_s, utc_s.to_numpy(), utc_w.to_numpy())).as_unit("ns")


# ---------------------------------------------------------------------------
# CSV 読込
# ---------------------------------------------------------------------------
_TIME_NAMES = ("time", "datetime", "timestamp", "date_time", "gmt time", "local time")
_VOL_NAMES = ("volume", "vol", "tick_volume", "tickvol", "tickvolume")
_OHLC_ALIASES = {"o": "open", "h": "high", "l": "low", "c": "close"}


def _looks_numeric(x) -> bool:
    try:
        float(x)
        return True
    except (TypeError, ValueError):
        return False


def _parse_times(s: pd.Series) -> pd.DatetimeIndex:
    s = s.astype(str).str.strip()
    s = s.str.replace(r"^(\d{4})\.(\d{2})\.(\d{2})", r"\1-\2-\3", regex=True)  # MT4形式 2020.01.01
    return to_naive_utc(pd.to_datetime(s, utc=True, format="mixed"))


def load_ohlc_csv(
    path: str,
    *,
    source_tz: str = "utc",
    source_fixed_offset_hours: float = 0.0,
    source_day: Optional[DayBoundaryConfig] = None,
) -> pd.DataFrame:
    """OHLC の CSV を読み、列 [time, open, high, low, close, volume](time はtzなしUTC)で返す。

    対応形式: ヘッダあり(time/datetime, date+time, open..., volume 等。<DATE> 形式も可)、
              ヘッダなし(MT4形式: date,time,o,h,l,c[,v] または datetime,o,h,l,c[,v])。
              '#' で始まる行はコメントとして無視(合成データの注意書き用)。
    source_tz: CSV の時刻の基準。
      'utc'             : そのままUTC
      'fixed'           : UTC + source_fixed_offset_hours(例: GMT+2固定なら 2.0)
      'ny_close_server' : NYクローズ式サーバー時間(冬+2/夏+3。source_day で変更可。gmt_shift は0にして渡すこと)
    """
    raw = pd.read_csv(path, comment="#", header=None, dtype=str, skip_blank_lines=True)
    if raw.empty:
        raise ValueError(f"空のCSVです: {path}")
    first = [str(x).strip().strip("<>").lower() for x in raw.iloc[0]]
    has_header = any(x in ("open", "high", "low", "close", "o", "h", "l", "c") for x in first)
    if has_header:
        raw.columns = first
        raw = raw.iloc[1:].reset_index(drop=True)
        raw = raw.rename(columns=_OHLC_ALIASES)
        tcol = next((c for c in _TIME_NAMES if c in raw.columns), None)
        if "date" in raw.columns and "time" in raw.columns:
            times = _parse_times(raw["date"].astype(str) + " " + raw["time"].astype(str))
        elif tcol is not None:
            times = _parse_times(raw[tcol])
        elif "date" in raw.columns:
            times = _parse_times(raw["date"])
        else:
            raise ValueError("時刻列(time/datetime/date)が見つかりません")
        vcol = next((c for c in _VOL_NAMES if c in raw.columns), None)
        vol = pd.to_numeric(raw[vcol], errors="coerce") if vcol else pd.Series(0.0, index=raw.index)
    else:
        ncol = raw.shape[1]
        if ncol >= 7 or (ncol == 6 and not _looks_numeric(raw.iloc[0, 1])):
            times = _parse_times(raw[0].astype(str) + " " + raw[1].astype(str))
            ohlc_start = 2
        else:
            times = _parse_times(raw[0])
            ohlc_start = 1
        raw = raw.rename(columns={ohlc_start + i: c for i, c in enumerate(OHLC)})
        vi = ohlc_start + 4
        vol = pd.to_numeric(raw[vi], errors="coerce") if vi in raw.columns else pd.Series(0.0, index=raw.index)

    df = pd.DataFrame({"time": times})
    for c in OHLC:
        df[c] = pd.to_numeric(raw[c], errors="coerce").to_numpy()
    df["volume"] = vol.fillna(0.0).to_numpy()

    if source_tz == "fixed":
        df["time"] = to_naive_utc(df["time"]) - pd.Timedelta(hours=source_fixed_offset_hours)
    elif source_tz == "ny_close_server":
        day = source_day or DayBoundaryConfig(gmt_shift_hours=0.0)
        df["time"] = server_to_utc(pd.DatetimeIndex(df["time"]), day)
    elif source_tz != "utc":
        raise ValueError(f"source_tz は 'utc' / 'fixed' / 'ny_close_server': {source_tz!r}")
    return normalize_ohlc(df)


def normalize_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    """時刻をtzなしUTC(ns)に統一し、NaN行除去・時刻ソート・重複除去(先頭を残す)を行う。"""
    out = df.copy()
    if "volume" not in out.columns:
        out["volume"] = 0.0
    out["time"] = to_naive_utc(out["time"])
    out = out[BASE_COLS].dropna(subset=["time"] + OHLC)
    out = out.sort_values("time", kind="stable").drop_duplicates("time", keep="first")
    return out.reset_index(drop=True)


def validate_ohlc(df: pd.DataFrame, freq_minutes: int = 15) -> dict:
    """データ品質の簡易レポート(読み込み後に必ず確認すること)。"""
    t = pd.DatetimeIndex(df["time"])
    d = t.to_series().diff().dropna()
    f = pd.Timedelta(minutes=freq_minutes)
    bad = (
        (df["high"] < df[["open", "close"]].max(axis=1) - 1e-12)
        | (df["low"] > df[["open", "close"]].min(axis=1) + 1e-12)
        | (df["high"] < df["low"])
    )
    return {
        "n_bars": int(len(df)),
        "first": t[0] if len(t) else None,
        "last": t[-1] if len(t) else None,
        "n_bad_ohlc": int(bad.sum()),
        "n_gaps_over_freq": int((d > f).sum()),
        "n_gaps_intraday": int(((d > f) & (d < pd.Timedelta(hours=24))).sum()),
        "max_gap": d.max() if len(d) else None,
    }


# ---------------------------------------------------------------------------
# リサンプル
# ---------------------------------------------------------------------------
def resample_to_base(df_fine: pd.DataFrame, minutes: int = 15, drop_edge_partial: bool = True) -> pd.DataFrame:
    """1分足などを `minutes` 分足にまとめる(UTC基準)。先頭・末尾の欠けた足は既定で捨てる。"""
    d = normalize_ohlc(df_fine)
    step = pd.Timedelta(minutes=minutes).value
    t = d["time"].to_numpy().astype("int64")
    key = (t // step) * step
    g = d.assign(_k=key, _t=t).groupby("_k", sort=True)
    out = g.agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"),
        close=("close", "last"), volume=("volume", "sum"), _first=("_t", "min"), _last=("_t", "max"),
    )
    out.insert(0, "time", pd.to_datetime(out.index.to_numpy(), unit="ns"))
    if drop_edge_partial and len(out) > 0:
        src_step = d["time"].diff().dropna().min()
        src_ns = src_step.value if pd.notna(src_step) else step
        keep = np.ones(len(out), dtype=bool)
        if out["_first"].iloc[0] != out.index[0]:
            keep[0] = False
        if out["_last"].iloc[-1] + src_ns != out.index[-1] + step:
            keep[-1] = False
        out = out[keep]
    out = out.drop(columns=["_first", "_last"]).reset_index(drop=True)
    out["time"] = to_naive_utc(out["time"])
    return out[BASE_COLS]


def resample_htf(
    df_base: pd.DataFrame, tf: str, cfg: Config, drop_edge_partial: bool = True
) -> pd.DataFrame:
    """15分足から上位足(tf='d1'|'h4'|'h1')を作る。区切りはサーバー時間(cfg.day)。

    返す列: time(始値時刻,UTC), open, high, low, close, volume, n_base(材料の足数), confirm_time(確定時刻,UTC)
    confirm_time は『名目上の区切りの終わり』。途中の足が欠けていても早めには確定させない(保守的)。
    データ先頭・末尾の欠けた足は既定で捨てる。
    """
    if tf not in HTF_DELTA:
        raise ValueError(f"tf は {list(HTF_DELTA)} のどれか: {tf!r}")
    delta_ns = HTF_DELTA[tf].value
    base_ns = pd.Timedelta(minutes=cfg.base_minutes).value
    t_idx = to_naive_utc(df_base["time"])
    off = server_offset(t_idx, cfg.day).astype("int64")
    t = t_idx.to_numpy().astype("int64")
    bin_start = ((t + off) // delta_ns) * delta_ns  # サーバー時間での区切り開始
    work = pd.DataFrame(
        {
            "_bin": bin_start,
            "open": df_base["open"].to_numpy(), "high": df_base["high"].to_numpy(),
            "low": df_base["low"].to_numpy(), "close": df_base["close"].to_numpy(),
            "volume": df_base["volume"].to_numpy() if "volume" in df_base else 0.0,
            "_t": t,
            "_open_utc": bin_start - off,
            "_confirm": bin_start + delta_ns - off,
        }
    )
    g = work.groupby("_bin", sort=True)
    out = g.agg(
        open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last"),
        volume=("volume", "sum"), n_base=("_t", "count"),
        _first=("_t", "min"), _last=("_t", "max"),
        _open_utc=("_open_utc", "min"), _confirm=("_confirm", "max"),
    )
    if drop_edge_partial and len(out) > 0:
        keep = np.ones(len(out), dtype=bool)
        if out["_first"].iloc[0] != out["_open_utc"].iloc[0]:
            keep[0] = False
        if out["_last"].iloc[-1] + base_ns != out["_confirm"].iloc[-1]:
            keep[-1] = False
        out = out[keep]
    res = out[["open", "high", "low", "close", "volume", "n_base"]].reset_index(drop=True)
    res.insert(0, "time", pd.to_datetime(out["_open_utc"].to_numpy(), unit="ns"))
    res["confirm_time"] = pd.to_datetime(out["_confirm"].to_numpy(), unit="ns")
    res["time"] = to_naive_utc(res["time"])
    res["confirm_time"] = to_naive_utc(res["confirm_time"])
    return res.sort_values("confirm_time", kind="stable").reset_index(drop=True)


# ---------------------------------------------------------------------------
# 特徴量
# ---------------------------------------------------------------------------
def _swing_cols(prefix: str, sw: pd.DataFrame, with_pos: bool) -> dict:
    cols = {}
    for tag in ("sh", "sl"):
        cols[f"{prefix}{tag}_last"] = sw[f"{tag}_last"]
        cols[f"{prefix}{tag}_prev"] = sw[f"{tag}_prev"]
        if with_pos:
            cols[f"{prefix}{tag}_last_pos"] = sw[f"{tag}_last_pos"]
            cols[f"{prefix}{tag}_prev_pos"] = sw[f"{tag}_prev_pos"]
    return cols


def add_htf_features(htf: pd.DataFrame, kind: str, spec: FeatureSpec) -> pd.DataFrame:
    """上位足(その足の確定値のみで計算)にSMA・傾き・ATR・スイング・クロス経過を追加する。

    追加列(attach 後は d1_ / h4_ / h1_ が前に付く):
      sma{n}, sma{n}_chg{k}(=sma - sma.shift(k) ; k は spec.slope_lags)
      atr{period}
      fr{n}_sh_last, fr{n}_sh_prev, fr{n}_sl_last, fr{n}_sl_prev  (n は spec.htf_fractal_n。確定済みスイングのみ)
      fr{n}_hh / fr{n}_lh / fr{n}_hl / fr{n}_ll  (bool: 高値切上/高値切下/安値切上/安値切下。last と prev の比較)
      gc_age, dc_age (kind='h1' のみ。spec.h1_cross の SMA クロスからの経過本数。クロス足=0)
    """
    periods = {"d1": spec.d1_sma, "h4": spec.h4_sma, "h1": spec.h1_sma}[kind]
    out = htf.copy()
    new: dict = {}
    for n in periods:
        s = sma(out["close"], n)
        new[f"sma{n}"] = s
        for k in spec.slope_lags:
            new[f"sma{n}_chg{k}"] = s - s.shift(k)
    new[f"atr{spec.atr_period}"] = atr(out["high"], out["low"], out["close"], spec.atr_period)
    for fn in spec.htf_fractal_n:
        sw = fractal_swings(out["high"], out["low"], fn)
        new.update(_swing_cols(f"fr{fn}_", sw, with_pos=False))
        new[f"fr{fn}_hh"] = sw["sh_last"] > sw["sh_prev"]
        new[f"fr{fn}_lh"] = sw["sh_last"] < sw["sh_prev"]
        new[f"fr{fn}_hl"] = sw["sl_last"] > sw["sl_prev"]
        new[f"fr{fn}_ll"] = sw["sl_last"] < sw["sl_prev"]
    if kind == "h1":
        fast, slow = spec.h1_cross
        if fast not in periods or slow not in periods:
            raise ValueError(f"h1_cross {spec.h1_cross} は h1_sma {periods} に含めること")
        gc, dc = cross_ages(new[f"sma{fast}"], new[f"sma{slow}"])
        new["gc_age"], new["dc_age"] = gc, dc
    return pd.concat([out, pd.DataFrame(new, index=out.index)], axis=1)


def add_m15_features(df: pd.DataFrame, spec: FeatureSpec) -> pd.DataFrame:
    """15分足自身の指標: ema{n}, atr{period}, fr{n}_(sh|sl)_(last|prev)[_pos]。

    *_pos は df の行番号(0始まり)。df を先頭側から切ると位置がずれるので、切るのは末尾側(truncate_dataset)だけにする。
    """
    new: dict = {}
    for n in spec.m15_ema:
        new[f"ema{n}"] = ema(df["close"], n)
    new[f"atr{spec.atr_period}"] = atr(df["high"], df["low"], df["close"], spec.atr_period)
    for fn in spec.m15_fractal_n:
        sw = fractal_swings(df["high"], df["low"], fn)
        new.update(_swing_cols(f"fr{fn}_", sw, with_pos=True))
        new[f"fr{fn}_sh_new"] = sw["sh_new"]
        new[f"fr{fn}_sl_new"] = sw["sl_new"]
    return pd.concat([df, pd.DataFrame(new, index=df.index)], axis=1)


# ---------------------------------------------------------------------------
# 上位足の結合(先読みなし)
# ---------------------------------------------------------------------------
def attach_htf(
    df15: pd.DataFrame,
    htf: pd.DataFrame,
    *,
    prefix: str,
    lag: str = "confirmed",
    columns: Optional[Iterable[str]] = None,
    base_minutes: int = 15,
) -> pd.DataFrame:
    """15分足の各行に『確定済みの最新の上位足』だけを asof で結合する。

    結合キー: 15分足側は close_time(= time + base_minutes)、上位足側は confirm_time。
    lag='confirmed' : confirm_time <= close_time の最新の上位足(同時刻の確定は可視)。既定。
    lag='strict'    : confirm_time <  close_time のみ(さらに1本遅らせた保守版)。
    上位足の値は『その上位足の確定値』なので、進行中の足の高値・安値・終値は絶対に出てこない。
    付与する列は f"{prefix}{列名}"、加えて {prefix}time(上位足の始値時刻) と {prefix}confirm(確定時刻)。
    まだ確定した上位足が無い行は NaN(bool列は False)。
    """
    if lag not in ("confirmed", "strict"):
        raise ValueError("lag は 'confirmed' か 'strict'(未確定の足を見せる指定は存在しない)")
    base = pd.Timedelta(minutes=base_minutes)
    key = (to_naive_utc(df15["time"]) + base).to_numpy()
    if len(key) > 1 and not (key[1:] >= key[:-1]).all():
        raise ValueError("df15 は time 昇順であること")
    skip = {"time", "confirm_time", "n_base", "volume"}
    cols = [c for c in (columns if columns is not None else htf.columns) if c not in skip]
    right = htf[["confirm_time", "time"] + cols].copy()
    right["confirm_time"] = to_naive_utc(right["confirm_time"])
    right = right.rename(columns={"time": "_htf_time"}).sort_values("confirm_time", kind="stable")
    right = right.drop_duplicates("confirm_time", keep="last")
    left = pd.DataFrame({"_key": pd.DatetimeIndex(key).as_unit("ns")})
    merged = pd.merge_asof(
        left, right, left_on="_key", right_on="confirm_time",
        direction="backward", allow_exact_matches=(lag == "confirmed"),
    )
    add = {}
    for c in cols:
        col = merged[c]
        if htf[c].dtype == bool:
            col = col.fillna(False).astype(bool)
        add[f"{prefix}{c}"] = col.to_numpy()
    add[f"{prefix}time"] = merged["_htf_time"].to_numpy()
    add[f"{prefix}confirm"] = merged["confirm_time"].to_numpy()
    out = df15.copy()
    for k, v in add.items():
        out[k] = v
    return out


def build_dataset(df15: pd.DataFrame, cfg: Config, pair: str) -> pd.DataFrame:
    """15分足 + 15分足指標 + 確定済み上位足(d1/h4/h1)指標を結合した、バックテスト入力を作る。

    列: pair, time, close_time, open, high, low, close, volume, server_time, day_end,
        ema*, atr14, fr{n}_*(15分足), d1_* / h4_* / h1_*(上位足。attach_htf の規約)
    day_end = その15分足が属するサーバー日の終わり(UTC)。デイトレ時間切れ判定用。
    index は 0..N-1 の RangeIndex。
    """
    spec = cfg.features
    base = normalize_ohlc(df15)
    if cfg.base_minutes <= 0:
        raise ValueError("base_minutes は正")
    ds = base.copy()
    ds.insert(0, "pair", pair)
    t_idx = to_naive_utc(ds["time"])
    base_td = pd.Timedelta(minutes=cfg.base_minutes)
    ds.insert(2, "close_time", (t_idx + base_td).to_numpy())
    off = server_offset(t_idx, cfg.day)
    ds["server_time"] = (t_idx.to_numpy() + off)
    day_ns = HTF_DELTA["d1"].value
    st = ds["server_time"].to_numpy().astype("int64")
    day_start_s = (st // day_ns) * day_ns
    ds["day_end"] = pd.to_datetime(day_start_s + day_ns - off.astype("int64"), unit="ns")
    ds["day_end"] = to_naive_utc(ds["day_end"])
    ds["server_time"] = to_naive_utc(ds["server_time"])
    ds = add_m15_features(ds, spec)
    for kind in ("d1", "h4", "h1"):
        htf = add_htf_features(resample_htf(base, kind, cfg), kind, spec)
        ds = attach_htf(ds, htf, prefix=f"{kind}_", lag="confirmed", base_minutes=cfg.base_minutes)
    return ds


def truncate_dataset(ds: pd.DataFrame, end_time) -> pd.DataFrame:
    """末尾側を切る(close_time <= end_time の行だけ残す)。指標は因果的なので、切っても値は変わらない。

    学習用期間のバックテストはこれで切ったデータで回すこと(検証期間の値動きが成績に混ざらないように)。
    """
    end = pd.Timestamp(end_time).as_unit("ns")
    return ds[ds["close_time"] <= end].copy()
