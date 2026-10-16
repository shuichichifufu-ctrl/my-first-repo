"""FX（スワップ込み）と日経225の売買ルールを、費用込みで比較する。

使い方:
  python research.py            # FX + 日経225（ネットに出られる環境、例: GitHub Actions）
  python research.py --fx-only  # FXだけ（為替データのみ取れる環境）

方針:
  - パラメータは文献でよく使われる値に固定し、この期間で最適化しない（過剰最適化を避けるため）
  - シグナルの翌日に売買。スプレッドとスワップの業者マージンを差し引く
  - 期間を分けて、どの時代でも通用するかを見る。最後の期間（2020年以降）を最終確認用にする
"""
from __future__ import annotations

import argparse
import io
import itertools
import json
import sys
import time

import numpy as np
import pandas as pd
import requests

from policy_rates import RATES

FX_URL = "https://raw.githubusercontent.com/datasets/exchange-rates/main/data/daily.csv"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={}"
# OECDの3か月物金利（月次）。取れない月は policy_rates.py の近似値で埋める
# 並び順は MT4 の通貨ペア表記の順（EURUSD, AUDJPY など）に合わせてある
FRED_IDS = {"EUR": "IR3TIB01EZM156N", "GBP": "IR3TIB01GBM156N", "AUD": "IR3TIB01AUM156N",
            "NZD": "IR3TIB01NZM156N", "USD": "IR3TIB01USM156N", "CAD": "IR3TIB01CAM156N",
            "CHF": "IR3TIB01CHM156N", "JPY": "IR3TIB01JPM156N"}
CCYS = list(FRED_IDS)
COUNTRY = {"EUR": "Euro", "GBP": "United Kingdom", "AUD": "Australia", "NZD": "New Zealand",
           "JPY": "Japan", "CAD": "Canada", "CHF": "Switzerland"}

SPREAD_MAJOR = 1.5e-4   # 片道の費用（ドルストレート）
SPREAD_CROSS = 2.5e-4   # 片道の費用（クロス円などのクロス通貨）
SWAP_MARKUP = 0.5       # スワップで業者に抜かれる分（年%、ポジションの向きに関係なく支払い）
NK_SPREAD = 2.5e-4      # 日経225 CFDの片道費用
NK_FIN_MARKUP = 2.5     # CFDの金利調整で業者が上乗せする分（年%）
NK_DIV = 1.7            # 日経平均の配当利回り（年%、近似）
PERIODS = [("2000", "2006"), ("2007", "2012"), ("2013", "2019"), ("2020", "2026")]
NK_PERIODS = [("1990", "1999")] + PERIODS
TARGET_VOL = 0.10


def get(url: str, retries: int = 3) -> str:
    last = None
    for k in range(retries):
        try:
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            return r.text
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (k + 1))
    raise RuntimeError(f"{url}: {last}")


def load_fx() -> pd.DataFrame:
    """各通貨1単位のドル建て価格（USDは1）。"""
    df = pd.read_csv(io.StringIO(get(FX_URL)), parse_dates=["Date"])
    out = {"USD": None}
    for c, country in COUNTRY.items():
        s = df[df.Country == country].set_index("Date")["Exchange rate"].astype(float)
        s = s.replace(0, np.nan).dropna()
        out[c] = 1.0 / s  # 元データはすべて「1ドル=何単位」なので逆数にする
    X = pd.DataFrame({k: v for k, v in out.items() if v is not None}).loc["2000":].ffill().dropna()
    X["USD"] = 1.0
    return X[CCYS]


def table_rates(index: pd.DatetimeIndex) -> pd.DataFrame:
    cols = {}
    for c, steps in RATES.items():
        s = pd.Series({pd.Timestamp(m + "-01"): v for m, v in steps}).sort_index()
        cols[c] = s.reindex(s.index.union(index)).ffill().reindex(index)
    return pd.DataFrame(cols)[CCYS]


def load_rates(index: pd.DatetimeIndex, offline: bool) -> tuple[pd.DataFrame, dict]:
    """年%の短期金利（日次に展開）。FREDが取れた月はFRED、それ以外は近似表。"""
    tab = table_rates(index)
    info = {}
    if offline:
        return tab, {c: "近似表のみ" for c in CCYS}
    out = tab.copy()
    for c, sid in FRED_IDS.items():
        try:
            s = pd.read_csv(io.StringIO(get(FRED.format(sid))), index_col=0, parse_dates=True).iloc[:, 0]
            s = pd.to_numeric(s, errors="coerce").dropna()
            daily = s.reindex(s.index.union(index)).ffill().reindex(index)
            daily[index > s.index[-1] + pd.offsets.MonthEnd(1)] = np.nan  # 公表終了後は近似表へ
            daily[index < s.index[0]] = np.nan
            out[c] = daily.fillna(tab[c])
            gap = (out[c] - tab[c]).abs().mean()
            info[c] = f"FRED {s.index[0]:%Y-%m}〜{s.index[-1]:%Y-%m}、近似表との平均差 {gap:.2f}%"
        except Exception as e:  # noqa: BLE001
            info[c] = f"FRED取得失敗のため近似表: {e}"[:160]
    return out, info


# ---------- 共通の評価 ----------

def stats(r: pd.Series) -> dict:
    r = r.dropna()
    if len(r) < 50 or r.std() == 0:
        return {"ann%": np.nan, "vol%": np.nan, "sharpe": np.nan, "maxDD%": np.nan}
    ann, vol = r.mean() * 252, r.std() * np.sqrt(252)
    eq = r.cumsum()
    return {"ann%": round(ann * 100, 1), "vol%": round(vol * 100, 1), "sharpe": round(ann / vol, 2),
            "maxDD%": round((eq - eq.cummax()).min() * 100, 1)}


def summarize(name: str, r: pd.Series, turnover: float, periods=PERIODS) -> dict:
    row = {"strategy": name}
    for a, b in periods:
        row[f"{a}-{b}"] = stats(r.loc[a:b])["sharpe"]
    s = stats(r)
    yr = r.groupby(r.index.year).sum()
    row.update({"全期間 年率%": s["ann%"], "シャープ": s["sharpe"], "最大DD%": s["maxDD%"],
                "勝ち年": f"{(yr > 0).sum()}/{len(yr)}", "最悪月%": round(r.resample("ME").sum().min() * 100, 1),
                "年間売買回数": round(turnover, 1)})
    return row


def vol_target(r: pd.Series, target: float = TARGET_VOL) -> pd.Series:
    """過去60日の実現変動で、ポートフォリオ全体の振れ幅を年10%にそろえる（翌日から適用）。"""
    v = r.rolling(60).std().shift(1) * np.sqrt(252)
    return r * (target / v).clip(0, 5)


# ---------- FX ----------

def fx_study(X: pd.DataFrame, rates: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    lx = np.log(X)
    dx = lx.diff()
    pairs = list(itertools.combinations(CCYS, 2))
    ret = pd.DataFrame({f"{a}{b}": dx[a] - dx[b] for a, b in pairs})            # 価格の値動き
    diff = pd.DataFrame({f"{a}{b}": rates[a] - rates[b] for a, b in pairs})     # 金利差（年%）
    carry_d = diff.shift(1) / 100 / 252                                          # 1日分のスワップ
    lvl = pd.DataFrame({f"{a}{b}": lx[a] - lx[b] for a, b in pairs})
    spread = pd.Series({f"{a}{b}": SPREAD_MAJOR if "USD" in (a, b) else SPREAD_CROSS for a, b in pairs})
    pv = ret.rolling(60).std().shift(1) * np.sqrt(252)

    def run_pairs(sig: pd.DataFrame, markup: float = SWAP_MARKUP, spread_mult: float = 1.0):
        w = (sig * (TARGET_VOL / pv)).clip(-3, 3) / len(pairs)
        pos = w.shift(1).fillna(0)
        pnl = pos * (ret + carry_d) - pos.abs() * markup / 100 / 252 \
            - pos.diff().abs().fillna(0) * spread * spread_mult
        turnover = (sig.diff().abs() > 0).sum().sum() / len(pairs) / (len(sig) / 252)
        return vol_target(pnl.sum(axis=1)), turnover

    def one_pair(sig: pd.DataFrame, c: str) -> pd.Series:
        pos = (sig[c] * TARGET_VOL / pv[c]).clip(-3, 3).shift(1).fillna(0)
        return pos * (ret[c] + carry_d[c]) - pos.abs() * SWAP_MARKUP / 100 / 252 \
            - pos.diff().abs().fillna(0) * spread[c]

    tsm = np.sign(lvl.diff(252))
    carry = np.sign(diff)
    carry1 = carry.where(diff.abs() >= 1.0, 0.0)
    both = carry.where(carry == tsm, 0.0)

    # 通貨ごとの順位で、金利の高い3通貨を買い・低い3通貨を売り（G8キャリー）
    rank = rates.rank(axis=1)
    cw = (rank >= 6).astype(float) / 3 - (rank <= 3).astype(float) / 3
    cpos = cw.shift(2).fillna(0)  # 金利は当日判明→翌日売買
    xs_raw = (cpos * (dx + rates.shift(1) / 100 / 252)).sum(axis=1) \
        - cpos.abs().sum(axis=1) * SWAP_MARKUP / 100 / 252 - cpos.diff().abs().sum(axis=1) * SPREAD_MAJOR
    xs = vol_target(xs_raw)
    xs_turn = (cw.diff().abs().sum(axis=1) > 0).sum() / (len(cw) / 252)

    # 荒れ相場フィルター: G8キャリー自身の20日変動が過去1年の80%点を超えたら休む
    rv = xs_raw.rolling(20).std()
    calm = (rv <= rv.rolling(252).quantile(0.8)).shift(1).fillna(False)
    xs_calm = vol_target(xs_raw.where(calm, 0.0))

    # トレンド一致のG8キャリー（通貨の12か月トレンドが金利順位と同じ向きの時だけ持つ）
    ctr = np.sign(lx.diff(252).sub(lx.diff(252).mean(axis=1), axis=0))
    cw2 = cw.where(np.sign(cw) == ctr, 0.0)
    cpos2 = cw2.shift(2).fillna(0)
    xs2 = vol_target((cpos2 * (dx + rates.shift(1) / 100 / 252)).sum(axis=1)
                     - cpos2.abs().sum(axis=1) * SWAP_MARKUP / 100 / 252
                     - cpos2.diff().abs().sum(axis=1) * SPREAD_MAJOR)

    results = {
        "FX: 12か月トレンド（スワップ込み・28ペア）": run_pairs(tsm),
        "FX: キャリー（高金利側を持つ・28ペア）": run_pairs(carry),
        "FX: キャリー（金利差1%以上のみ）": run_pairs(carry1),
        "FX: キャリー×12か月トレンド一致": run_pairs(both),
        "FX: G8キャリー（上位3買い・下位3売り）": (xs, xs_turn),
        "FX: G8キャリー＋荒れ相場で休む": (xs_calm, xs_turn),
        "FX: G8キャリー＋トレンド一致": (xs2, xs_turn),
    }
    rows = [summarize(k, *v) for k, v in results.items()]
    # 費用への強さ（スプレッド2倍・スワップのマージン年1.5%）
    sens = {}
    for k, sig in {"12か月トレンド": tsm, "キャリー": carry, "キャリー×トレンド": both}.items():
        r, _ = run_pairs(sig, markup=1.5, spread_mult=2.0)
        sens[k] = stats(r)["sharpe"]
    extra = {"費用が重い場合のシャープ": sens,
             "通貨ペア別 シャープ（キャリー / キャリー×トレンド）": {
                 c: (stats(one_pair(carry, c))["sharpe"], stats(one_pair(both, c))["sharpe"])
                 for c in ["AUDJPY", "NZDJPY", "USDJPY", "EURJPY", "GBPJPY", "CADJPY", "AUDUSD", "NZDUSD",
                           "EURUSD", "GBPUSD", "USDCHF", "USDCAD", "EURCHF", "AUDCHF"]}}
    yearly = pd.DataFrame({k: v[0].groupby(v[0].index.year).sum().round(3) * 100 for k, v in results.items()})
    extra["年別リターン%"] = yearly.round(1).to_dict()
    return pd.DataFrame(rows), extra


# ---------- 日経225 ----------

def load_nikkei() -> pd.DataFrame:
    import yfinance as yf
    df = yf.download("^N225", start="1985-01-01", interval="1d", auto_adjust=False, progress=False,
                     threads=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df[["Open", "High", "Low", "Close"]].dropna()


def nikkei_study(N: pd.DataFrame, rates: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    N = N.loc["1990":]
    c = N["Close"]
    r = np.log(c).diff()
    rj = rates["JPY"].reindex(N.index, method="ffill").fillna(0)
    long_cost = (rj + NK_FIN_MARKUP - NK_DIV) / 100 / 252   # 買い持ちで1日にかかる金利調整
    short_cost = (NK_FIN_MARKUP + NK_DIV - rj) / 100 / 252  # 売り持ちで1日にかかる金利調整
    v = r.rolling(60).std().shift(1) * np.sqrt(252)

    def run(sig: pd.Series, scale: bool = True):
        lev = (TARGET_VOL / v).clip(0, 3) if scale else 1.0
        pos = (sig * lev).shift(1).fillna(0)
        pnl = pos * r - pos.clip(lower=0) * long_cost - (-pos).clip(lower=0) * short_cost \
            - pos.diff().abs().fillna(0) * NK_SPREAD
        turnover = (sig.diff().abs() > 0).sum() / (len(sig) / 252)
        return pnl, turnover

    ones = pd.Series(1.0, index=N.index)
    ts12 = np.sign(np.log(c).diff(252))
    sma200 = (c > c.rolling(200).mean()).astype(float)
    m = c.resample("ME").last()
    faber = (m > m.rolling(10).mean()).astype(float).reindex(N.index, method="ffill").shift(1).fillna(0)
    # 月末最終日と月初3日だけ買い（月替わり効果）
    ym = N.index.to_period("M")
    pos_in_month = pd.Series(1, index=N.index).groupby(ym).cumsum()
    from_end = pd.Series(1, index=N.index)[::-1].groupby(ym[::-1]).cumsum()[::-1]
    tom = ((from_end == 1) | (pos_in_month <= 3)).astype(float).shift(-1).fillna(0)  # シグナル→翌日保有に合わせる

    res = {
        "日経: 買って持つだけ（金利調整込み）": run(ones, scale=False),
        "日経: 買って持つ（振れ幅そろえ）": run(ones),
        "日経: 12か月トレンド 買い/売り": run(ts12),
        "日経: 12か月トレンド 買い/休み": run(ts12.clip(lower=0)),
        "日経: 200日線より上なら買い": run(sma200),
        "日経: 10か月線より上なら買い（月1回判定）": run(faber),
        "日経: 月替わりの4日間だけ買い": run(tom),
    }
    # 夜間（前日終値→当日始値）と日中（始値→終値）。始値が終値と同じ古いデータは除く
    ok = (N["Open"] != N["Close"]) & (N["Open"] > 0)
    on = np.log(N["Open"] / c.shift(1)).where(ok)
    intra = np.log(c / N["Open"]).where(ok)
    first_ok = ok[ok].index[0] if ok.any() else None
    res["日経: 夜間だけ買い（引けで買い寄りで売り）"] = (
        (on - 2 * NK_SPREAD - long_cost).loc[first_ok:].fillna(0), 252.0)
    res["日経: 日中だけ買い（寄りで買い引けで売り）"] = ((intra - 2 * NK_SPREAD).loc[first_ok:].fillna(0), 252.0)

    rows = [summarize(k, *v, periods=NK_PERIODS) for k, v in res.items()]
    extra = {"データ期間": f"{N.index[0]:%Y-%m-%d}〜{N.index[-1]:%Y-%m-%d}",
             "始値が使える最初の日": str(first_ok)[:10] if first_ok is not None else None,
             "夜間/日中 費用ゼロの年率%": {"夜間": round(on.mean() * 252 * 100, 1),
                                     "日中": round(intra.mean() * 252 * 100, 1)},
             "年別リターン%": pd.DataFrame({k: v[0].groupby(v[0].index.year).sum() * 100
                                        for k, v in res.items()}).round(1).to_dict()}
    return pd.DataFrame(rows), extra


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fx-only", action="store_true")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 30)
    pd.set_option("display.unicode.east_asian_width", True)

    X = load_fx()
    rates, rinfo = load_rates(X.index, offline=a.fx_only)
    print("為替データ:", X.index[0].date(), "〜", X.index[-1].date())
    print("金利データ:", json.dumps(rinfo, ensure_ascii=False, indent=1))
    fx_tab, fx_extra = fx_study(X, rates)
    print("\n=== FX（シャープレシオ。期間別と全期間） ===")
    print(fx_tab.set_index("strategy").to_string())
    print("\n", json.dumps({k: v for k, v in fx_extra.items() if k != "年別リターン%"}, ensure_ascii=False))
    import os
    os.makedirs(a.out, exist_ok=True)
    fx_tab.to_csv(f"{a.out}/fx_results.csv", index=False)
    pd.DataFrame(fx_extra["年別リターン%"]).to_csv(f"{a.out}/fx_yearly.csv")
    print("\n=== FX 年別リターン% ===")
    print(pd.DataFrame(fx_extra["年別リターン%"]).to_string())
    if a.fx_only:
        return
    try:
        N = load_nikkei()
    except Exception as e:  # noqa: BLE001
        print("日経225の取得に失敗:", e)
        sys.exit(1)
    nk_tab, nk_extra = nikkei_study(N, rates)
    print("\n=== 日経225（シャープレシオ。期間別と全期間） ===")
    print(nk_tab.set_index("strategy").to_string())
    print("\n", json.dumps({k: v for k, v in nk_extra.items() if k != "年別リターン%"}, ensure_ascii=False))
    print("\n=== 日経 年別リターン% ===")
    print(pd.DataFrame(nk_extra["年別リターン%"]).to_string())
    nk_tab.to_csv(f"{a.out}/nikkei_results.csv", index=False)
    N.to_csv(f"{a.out}/nikkei_daily.csv")
    rates.resample("ME").last().to_csv(f"{a.out}/rates_monthly.csv")


if __name__ == "__main__":
    main()
