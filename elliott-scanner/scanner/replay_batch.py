"""設定ファイルの全銘柄を過去チャートで検証し、候補の日と「ランダムな日」を比べる。

  python -m scanner.replay_batch --config tickers.yaml --period 15y --out out
"""
from __future__ import annotations

import argparse
import os

import pandas as pd

from .data import fetch_one, load_config
from .replay import baseline_edges, bootstrap_p, replay
from .waves import Params


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="tickers.yaml")
    ap.add_argument("--period", default="15y")
    ap.add_argument("--horizon", type=int, default=20)
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    cfg = load_config(a.config)
    params = Params(**cfg.get("params", {}))
    os.makedirs(a.out, exist_ok=True)
    ins = [i for grp in cfg["instruments"].values() for i in grp]

    rows, base, failed, years = [], {}, {}, 0.0
    for i in ins:
        sym = i["symbol"]
        try:
            df = fetch_one(sym, a.period, retries=2)
        except Exception as e:  # noqa: BLE001
            failed[sym] = str(e)
            continue
        r = replay(df, sym, params, a.horizon)
        rows.append(r)
        b = baseline_edges(df, a.horizon)
        base[(sym, "up")], base[(sym, "down")] = b["up"], b["down"]
        years += len(df) / 252
        print(f"{sym:<10} {len(df):>5}本  候補 {len(r):>3}件")
    cands = pd.concat([r for r in rows if not r.empty], ignore_index=True)
    cands.to_csv(os.path.join(a.out, "candidates.csv"), index=False)

    print(f"\n取得成功 {len(rows)} / 失敗 {len(failed)} {list(failed)}")
    print(f"候補 {len(cands)} 件 / 監視した銘柄・年 {years:.0f} → 1銘柄・1年あたり {len(cands) / years:.2f} 件")
    print(f"無効化価格まで逆行（{a.horizon}日以内）: {cands['failed'].mean() * 100:.0f}%")
    obs, base_mean, p = bootstrap_p(cands, base)
    print("\n【候補の日 vs ランダムな日（同じ銘柄・同じ向き・同じ件数）】")
    print(f"  平均の(最大有利幅−最大不利幅) 候補 {obs:+.2f}ATR / ランダム {base_mean:+.2f}ATR")
    print(f"  ランダムに選んで候補以上になる確率 p = {p:.3f}（小さいほど候補が特別）")
    for label, g in (("向き別", "direction"), ("局面別", "status")):
        print(f"\n【{label}】")
        for k, gg in cands.groupby(g):
            print(f"  {k:<12}{len(gg):>4}件  平均edge {gg['edge_atr'].mean():+.2f}ATR  逆行率 {gg['failed'].mean() * 100:.0f}%")
    print("\n【スコア帯別】")
    cands["band"] = pd.cut(cands["score"], [0, 70, 80, 90, 101], labels=["65-70", "70-80", "80-90", "90-"], right=False)
    for k, gg in cands.groupby("band", observed=True):
        print(f"  {k:<8}{len(gg):>4}件  平均edge {gg['edge_atr'].mean():+.2f}ATR  逆行率 {gg['failed'].mean() * 100:.0f}%")
    print("\n※候補は連続した日に集中しやすく、独立な標本ではありません。p値は目安です。")


if __name__ == "__main__":
    main()
