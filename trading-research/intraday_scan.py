"""「この通貨ペアを、この時間に、この向きで持つ」ルールを1時間足で総当たりする。

勝率6割以上の組み合わせを前半（発見用）で探し、後半（確認用）でも通用するかを見る。
総当たりは偶然の当たりを大量に拾うので、前半の成績だけでは判断しない。

使い方: python intraday_scan.py  （Yahoo Finance に出られる環境。GitHub Actions で実行）
"""
from __future__ import annotations

import sys
import time

import numpy as np
import pandas as pd

# 往復のスプレッド（pips、国内業者の通常時の目安。推測を含む）
PAIRS = {"USDJPY": 0.3, "EURUSD": 0.3, "GBPUSD": 0.6, "AUDUSD": 0.5, "NZDUSD": 0.8, "USDCAD": 0.8,
         "USDCHF": 0.8, "EURJPY": 0.6, "GBPJPY": 1.0, "AUDJPY": 0.7, "EURGBP": 0.8}
HOLDS = [1, 2, 3, 4]
ROLLOVER_HOURS = {20, 21, 22, 23}   # 日付の切り替わり前後（UTC）はスプレッドが広がるので費用3倍
DISCOVERY_SHARE = 0.6
MIN_TRADES = 40


def fetch(pair: str) -> pd.DataFrame:
    import yfinance as yf
    last = None
    for k in range(3):
        try:
            df = yf.download(f"{pair}=X", period="730d", interval="1h", progress=False, threads=False,
                             auto_adjust=False)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df[["Open", "Close"]].dropna()
            df.index = pd.DatetimeIndex(df.index).tz_convert("UTC")
            if len(df) > 1000:
                return df
            raise ValueError(f"本数が少ない: {len(df)}")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (k + 1))
    raise RuntimeError(f"{pair}: {last}")


def gotobi(d: pd.Timestamp) -> bool:
    """日本の五十日（5・10日と月末。土日なら前の平日）。祝日は考えない（近似）。"""
    def adjusted(day: pd.Timestamp) -> pd.Timestamp:
        while day.weekday() >= 5:
            day -= pd.Timedelta(days=1)
        return day
    month_end = d + pd.offsets.MonthEnd(0)
    targets = [pd.Timestamp(d.year, d.month, x) for x in (5, 10, 15, 20, 25)] + [month_end]
    return any(adjusted(t.normalize()).date() == d.date() for t in targets)


def trades(df: pd.DataFrame, pair: str) -> pd.DataFrame:
    """すべての「H時に入ってh時間持つ」取引の、費用込みリターン（買いの場合）。"""
    pip = 0.01 if pair.endswith("JPY") else 0.0001
    rows = []
    idx = df.index
    o, c = df["Open"].values, df["Close"].values
    for h in HOLDS:
        end = np.arange(len(df)) + h - 1
        ok = end < len(df)
        s = np.where(ok)[0]
        e = end[ok]
        span = (idx[e] - idx[s]) == pd.Timedelta(hours=h - 1)  # 途中に欠けた足がない
        s, e = s[span], e[span]
        gross = c[e] / o[s] - 1
        cost = PAIRS[pair] * pip / o[s]
        hours = idx[s].hour
        cost = np.where(np.isin(hours, list(ROLLOVER_HOURS)), cost * 3, cost)
        rows.append(pd.DataFrame({"entry": idx[s], "exit": idx[e], "hour": hours, "hold": h,
                                  "gross": gross, "cost": cost}))
    t = pd.concat(rows, ignore_index=True)
    jst_exit = (t["exit"] + pd.Timedelta(hours=9)).dt.tz_localize(None)
    t["dow"] = jst_exit.dt.weekday
    days = jst_exit.dt.normalize().drop_duplicates()
    gmap = {d: gotobi(d) for d in days}
    t["gotobi"] = jst_exit.dt.normalize().map(gmap)
    t = t[t["dow"] < 5]
    return t


def evaluate(t: pd.DataFrame, pair: str, split: pd.Timestamp) -> pd.DataFrame:
    out = []
    filters = {"毎日": None, "月": 0, "火": 1, "水": 2, "木": 3, "金": 4}
    if pair.endswith("JPY"):
        filters["五十日"] = "gotobi"
    for (hour, hold), g in t.groupby(["hour", "hold"]):
        for fname, f in filters.items():
            gg = g if f is None else (g[g["gotobi"]] if f == "gotobi" else g[g["dow"] == f])
            for side, sign in (("買い", 1), ("売り", -1)):
                net = sign * gg["gross"] - gg["cost"]
                d, v = net[gg["entry"] < split], net[gg["entry"] >= split]
                if len(d) < MIN_TRADES or len(v) < 15:
                    continue
                out.append({"ペア": pair, "時間(日本時間)": f"{(hour + 9) % 24}時から{hold}時間", "曜日": fname,
                            "向き": side, "前半 回数": len(d), "前半 勝率%": round((d > 0).mean() * 100, 1),
                            "前半 平均pips換算": d.mean(), "後半 回数": len(v),
                            "後半 勝率%": round((v > 0).mean() * 100, 1), "後半 平均": v.mean(),
                            "全期間 勝率%": round((net > 0).mean() * 100, 1), "全期間 平均": net.mean()})
    return pd.DataFrame(out)


def scan(dfs: dict) -> pd.DataFrame:
    res = []
    for pair, df in dfs.items():
        split = df.index[int(len(df) * DISCOVERY_SHARE)]
        res.append(evaluate(trades(df, pair), pair, split))
    R = pd.concat(res, ignore_index=True)
    for col in ["前半 平均pips換算", "後半 平均", "全期間 平均"]:
        R[col] = (R[col] * 1e4).round(2)  # 0.01% 単位
    return R.rename(columns={"前半 平均pips換算": "前半 平均(0.01%)", "後半 平均": "後半 平均(0.01%)",
                             "全期間 平均": "全期間 平均(0.01%)"})


def counts(R: pd.DataFrame) -> dict:
    found = R[(R["前半 勝率%"] >= 60) & (R["前半 平均(0.01%)"] > 0)]
    both55 = found[(found["後半 勝率%"] >= 55) & (found["後半 平均(0.01%)"] > 0)]
    both60 = found[(found["後半 勝率%"] >= 60) & (found["後半 平均(0.01%)"] > 0)]
    return {"組み合わせ": len(R), "前半で勝率60%以上": len(found), "後半も55%以上": len(both55),
            "後半も60%以上": len(both60)}


def shuffled(df: pd.DataFrame, rng: np.random.Generator) -> pd.DataFrame:
    """同じペアの1時間ごとの値動きを時間順にシャッフルした偽データ（時間帯のクセは消える）。"""
    r = np.log(df["Close"] / df["Open"]).values.copy()
    rng.shuffle(r)
    close = df["Open"].iloc[0] * np.exp(np.cumsum(r))
    opn = np.r_[df["Open"].iloc[0], close[:-1]]
    return pd.DataFrame({"Open": opn, "Close": close}, index=df.index)


def main() -> None:
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 30)
    pd.set_option("display.max_rows", 200)
    pd.set_option("display.unicode.east_asian_width", True)
    dfs = {}
    for pair in PAIRS:
        try:
            dfs[pair] = fetch(pair)
            d = dfs[pair]
            print(f"{pair}: {d.index[0]:%Y-%m-%d}〜{d.index[-1]:%Y-%m-%d} {len(d)}本 / 境目 "
                  f"{d.index[int(len(d) * DISCOVERY_SHARE)]:%Y-%m-%d}")
        except Exception as e:  # noqa: BLE001
            print("取得失敗", pair, e)
    if not dfs:
        sys.exit(1)
    R = scan(dfs)
    real = counts(R)
    rng = np.random.default_rng(0)
    nulls = [counts(scan({p: shuffled(d, rng) for p, d in dfs.items()})) for _ in range(5)]
    print("\n=== 本物のデータ vs 時間帯のクセを消した偽データ（5回の平均） ===")
    print(pd.DataFrame({"本物": real, "偽データ平均": pd.DataFrame(nulls).mean().round(1),
                        "偽データ最大": pd.DataFrame(nulls).max()}).to_string())
    found = R[(R["前半 勝率%"] >= 60) & (R["前半 平均(0.01%)"] > 0)]
    print(f"\n全組み合わせの後半勝率の平均: {R['後半 勝率%'].mean():.1f}% / 候補の後半勝率の平均: "
          f"{found['後半 勝率%'].mean():.1f}%")
    surv = found[(found["後半 勝率%"] >= 55) & (found["後半 平均(0.01%)"] > 0)]
    print("\n=== 前半・後半とも条件を満たした組み合わせ（全期間の平均順） ===")
    print(surv.sort_values("全期間 平均(0.01%)", ascending=False).head(40).to_string(index=False))
    print("\n=== 全期間で勝率60%以上・平均プラス・回数80以上（参考、上位30） ===")
    w = R[(R["全期間 勝率%"] >= 60) & (R["全期間 平均(0.01%)"] > 0) & (R["前半 回数"] + R["後半 回数"] >= 80)]
    print(f"件数 {len(w)}")
    print(w.sort_values("全期間 平均(0.01%)", ascending=False).head(30).to_string(index=False))
    print("\n=== 有名な仮説: 五十日のドル円（日本時間7〜9時台に入る買い） ===")
    print(R[(R["ペア"] == "USDJPY") & (R["曜日"].isin(["五十日", "毎日"])) & (R["向き"] == "買い")
            & (R["時間(日本時間)"].str.match(r"^(7|8|9)時"))].to_string(index=False))
    import os
    os.makedirs("out", exist_ok=True)
    R.to_csv("out/intraday_scan.csv", index=False)


if __name__ == "__main__":
    main()
