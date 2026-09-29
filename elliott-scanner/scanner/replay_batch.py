"""設定ファイルの全銘柄を過去チャートで検証し、候補の日と「ランダムな日」を比べる。

  python -m scanner.replay_batch --config tickers.yaml --period 15y --out out
  python -m scanner.replay_batch --grid "7:2.5:65,5:2:65,7:2.5:0"   # 大ATR:小ATR:最低スコア を複数試す
"""
from __future__ import annotations

import argparse
import dataclasses
import os

import pandas as pd

from .data import fetch_one, load_config
from .replay import baseline_edges, bootstrap_p, replay
from .waves import Params


def summarize(label: str, cands: pd.DataFrame, base: dict, years: float, horizon: int) -> None:
    print(f"\n==================== 設定 {label}")
    if cands.empty:
        print("候補なし")
        return
    print(f"候補 {len(cands)} 件 / 1銘柄・1年あたり {len(cands) / years:.2f} 件 / "
          f"無効化価格まで逆行（{horizon}日以内）{cands['failed'].mean() * 100:.0f}%")
    obs, base_mean, p = bootstrap_p(cands, base)
    print(f"候補の平均edge {obs:+.2f}ATR / ランダム {base_mean:+.2f}ATR / p = {p:.3f}（小さいほど候補が特別）")
    for name, col in (("向き別", "direction"), ("局面別", "status")):
        print(f"  [{name}] " + " | ".join(f"{k} {len(g)}件 {g['edge_atr'].mean():+.2f} 逆行{g['failed'].mean() * 100:.0f}%"
                                         for k, g in cands.groupby(col)))
    cands = cands.copy()
    cands["帯"] = pd.cut(cands["score"], [0, 65, 70, 80, 90, 101], labels=["<65", "65-70", "70-80", "80-90", "90-"], right=False)
    print("  [スコア帯] " + " | ".join(f"{k} {len(g)}件 {g['edge_atr'].mean():+.2f}"
                                    for k, g in cands.groupby("帯", observed=True)))
    cands["脚"] = (cands["wave1_legs"] >= 5).map({True: "5本以上", False: "5本未満"})
    print("  [大1波の内側の脚] " + " | ".join(f"{k} {len(g)}件 {g['edge_atr'].mean():+.2f}"
                                          for k, g in cands.groupby("脚")))
    for col in ("score", "r2", "rii", "wi_over_w1", "wave1_legs"):
        print(f"  相関(edgeとの順位相関) {col:<11}{cands[col].corr(cands['edge_atr'], method='spearman'):+.2f}")
    for sub, g in cands.groupby("status"):
        if len(g) >= 10:
            o, b, pp = bootstrap_p(g, base, n_iter=2000)
            print(f"  [{sub}だけ] {len(g)}件 平均edge {o:+.2f} / ランダム {b:+.2f} / p = {pp:.3f}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="tickers.yaml")
    ap.add_argument("--period", default="15y")
    ap.add_argument("--horizon", type=int, default=20)
    ap.add_argument("--out", default="out")
    ap.add_argument("--grid", default="", help="大ATR:小ATR:最低スコア をカンマ区切りで。省略時は設定ファイルの値")
    a = ap.parse_args()
    cfg = load_config(a.config)
    base_params = Params(**cfg.get("params", {}))
    os.makedirs(a.out, exist_ok=True)
    ins = [i for grp in cfg["instruments"].values() for i in grp]

    frames, failed = {}, {}
    for i in ins:
        try:
            frames[i["symbol"]] = fetch_one(i["symbol"], a.period, retries=2)
        except Exception as e:  # noqa: BLE001
            failed[i["symbol"]] = str(e)
    years = sum(len(d) for d in frames.values()) / 252
    print(f"取得成功 {len(frames)} / 失敗 {len(failed)} {list(failed)} / 監視した銘柄・年 {years:.0f}")
    base = {}
    for sym, df in frames.items():
        b = baseline_edges(df, a.horizon)
        base[(sym, "up")], base[(sym, "down")] = b["up"], b["down"]

    combos = ([tuple(float(x) for x in g.split(":")) for g in a.grid.split(",")] if a.grid
              else [(base_params.major_atr, base_params.minor_atr, base_params.min_score)])
    for major, minor, min_score in combos:
        prm = dataclasses.replace(base_params, major_atr=major, minor_atr=minor, min_score=min_score)
        rows = [replay(df, sym, prm, a.horizon) for sym, df in frames.items()]
        rows = [r for r in rows if not r.empty]
        cands = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
        label = f"大{major:g}ATR/小{minor:g}ATR/最低スコア{min_score:g}"
        if not cands.empty:
            cands.to_csv(os.path.join(a.out, f"candidates_{major:g}_{minor:g}_{min_score:g}.csv"), index=False)
        summarize(label, cands, base, years, a.horizon)
    print("\n※候補は連続した日に集中しやすく、独立な標本ではありません。p値は目安です。多くの設定を試すほど、偶然良く見える設定が混じります。")


if __name__ == "__main__":
    main()
