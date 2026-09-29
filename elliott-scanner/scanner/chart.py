"""根拠チャート画像。英数字のみで描く（日本語フォントが無い環境でも崩れない）。"""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from .waves import Candidate  # noqa: E402


def draw(df, cand: Candidate, path: str, tail: int = 40) -> str:
    l0 = cand.points["L0"][0]
    start = max(0, l0 - 20)
    d = df.iloc[start:]
    fig, ax = plt.subplots(figsize=(9, 5), dpi=110)
    x = range(len(d))
    for i, (_, r) in enumerate(d.iterrows()):
        up = r["Close"] >= r.get("Open", r["Close"])
        col = "#2a9d8f" if up else "#e76f51"
        ax.vlines(i, r["Low"], r["High"], color=col, lw=0.8)
        ax.vlines(i, min(r.get("Open", r["Close"]), r["Close"]), max(r.get("Open", r["Close"]), r["Close"]),
                  color=col, lw=2.4)
    labels = {"L0": "0", "H1": "1", "L2": "2", "i": "(i)", "ii": "(ii)"}
    for k, lab in labels.items():
        bi, pr = cand.points[k]
        ax.annotate(lab, (bi - start, pr), textcoords="offset points",
                    xytext=(0, 9 if k in ("H1", "i") and cand.direction == "up" else -14 if cand.direction == "up" else 9),
                    ha="center", fontsize=11, fontweight="bold", color="#264653")
    ax.axhline(cand.entry, color="#e9c46a", ls="--", lw=1, label=f"entry {cand.entry:.4g}")
    ax.axhline(cand.invalidation_minor, color="#f4a261", ls=":", lw=1, label=f"invalid (ii) {cand.invalidation_minor:.4g}")
    ax.axhline(cand.invalidation_major, color="#e63946", ls=":", lw=1, label=f"invalid (2) {cand.invalidation_major:.4g}")
    ax.axhline(cand.target, color="#457b9d", ls="-.", lw=1, label=f"target {cand.target:.4g}")
    ax.set_title(f"{cand.symbol}  {'UP' if cand.direction == 'up' else 'DOWN'}  {cand.status}  score {cand.score:.0f}")
    ax.legend(loc="best", fontsize=8)
    ax.set_xticks([0, len(d) // 2, len(d) - 1])
    ax.set_xticklabels([str(d.index[i])[:10] for i in (0, len(d) // 2, len(d) - 1)])
    ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    return path
