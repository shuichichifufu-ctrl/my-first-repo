"""過去チャートでの検証（実データ）。各日について、その日までのデータだけで検出し、
その後の値動きを見る。未来のデータは判定に使わない。

  python -m scanner.replay --symbol "USDJPY=X" [--period 10y] [--csv file.csv] [--horizon 20]

出力: 検出した日、向き、局面、確度、その後 horizon 日での最大有利幅/最大不利幅（ATR倍数）。
同じ数え方（銘柄|向き|L2の日付）は最初に現れた日だけ数える。
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from .waves import Params, atr, clean_frame, find_candidates


def replay(df: pd.DataFrame, symbol: str = "X", params: Params | None = None, horizon: int = 20,
           warmup: int = 150) -> pd.DataFrame:
    df = clean_frame(df)
    seen = set()
    rows = []
    for t in range(warmup, len(df) - 1):
        for c in find_candidates(symbol, symbol, df.iloc[: t + 1], params):
            if c.key() in seen:
                continue
            seen.add(c.key())
            fut = df.iloc[t + 1: t + 1 + horizon]
            if fut.empty:
                continue
            a = atr(df["High"].to_numpy()[: t + 1], df["Low"].to_numpy()[: t + 1], df["Close"].to_numpy()[: t + 1], 60)
            sign = 1.0 if c.direction == "up" else -1.0
            fav = (fut["High"].max() - c.close) if sign > 0 else (c.close - fut["Low"].min())
            adv = (c.close - fut["Low"].min()) if sign > 0 else (fut["High"].max() - c.close)
            rows.append(dict(symbol=symbol, date=str(df.index[t])[:10], direction=c.direction, status=c.status,
                             score=c.score, edge_atr=round(float(fav - adv) / a, 2),
                             favorable_atr=round(fav / a, 2), adverse_atr=round(adv / a, 2),
                             failed=bool(adv >= abs(c.close - c.invalidation_minor))))
    return pd.DataFrame(rows)


def baseline_edges(df: pd.DataFrame, horizon: int = 20, warmup: int = 150) -> dict:
    """全ての日に「その日の終値で入った」と仮定した場合の (最大有利幅 − 最大不利幅)（ATR倍数）。

    候補の日の成績が、何もしなくても出る値動きと違うのかを比べるための基準。
    """
    df = clean_frame(df)
    h, l, c = (df[k].to_numpy(dtype=float) for k in ("High", "Low", "Close"))
    up, down = [], []
    for t in range(warmup, len(df) - horizon - 1):
        a = atr(h[: t + 1], l[: t + 1], c[: t + 1], 60)
        if not a > 0:
            continue
        hi, lo = h[t + 1: t + 1 + horizon].max(), l[t + 1: t + 1 + horizon].min()
        up.append(((hi - c[t]) - (c[t] - lo)) / a)
        down.append(((c[t] - lo) - (hi - c[t])) / a)
    return {"up": np.array(up), "down": np.array(down)}


def bootstrap_p(cands: pd.DataFrame, base: dict, n_iter: int = 5000, seed: int = 0) -> tuple:
    """候補と同じ銘柄・同じ向き・同じ件数の日をランダムに選んだとき、候補の平均以上になる確率。"""
    rng = np.random.default_rng(seed)
    groups = [(g["edge_atr"].to_numpy(), base[(sym, d)]) for (sym, d), g in cands.groupby(["symbol", "direction"])
              if len(base.get((sym, d), [])) > 0]
    total = sum(len(g[0]) for g in groups)
    observed = sum(g[0].sum() for g in groups) / total
    sims = np.empty(n_iter)
    for i in range(n_iter):
        sims[i] = sum(rng.choice(b, size=len(e)).sum() for e, b in groups) / total
    return observed, float(sims.mean()), float((sims >= observed).mean())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="USDJPY=X")
    ap.add_argument("--period", default="10y")
    ap.add_argument("--csv", help="Yahoo形式のCSV（Date,Open,High,Low,Close）を使う")
    ap.add_argument("--horizon", type=int, default=20)
    a = ap.parse_args()
    if a.csv:
        df = pd.read_csv(a.csv, index_col=0, parse_dates=True)
    else:
        from .data import fetch_one
        df = fetch_one(a.symbol, a.period)
    r = replay(df, a.symbol, horizon=a.horizon)
    if r.empty:
        print("候補は1件も出ませんでした。")
        return
    print(r.to_string(index=False))
    print(f"\n件数 {len(r)} / 無効化価格まで逆行した割合 {r['failed'].mean() * 100:.0f}% / "
          f"平均の最大有利幅 {r['favorable_atr'].mean():.1f}ATR / 平均の最大不利幅 {r['adverse_atr'].mean():.1f}ATR")
    print("※件数が少ないうちは統計として意味がありません。")


if __name__ == "__main__":
    main()
