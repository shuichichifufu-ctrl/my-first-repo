"""通知文の作成とDiscord送信。"""
from __future__ import annotations

import json
import os
from typing import Dict, List, Optional

import requests

from .waves import Candidate

STATUS_JA = {"started": "入口（小3波が小1波の端を突破）", "approaching": "準備（小3波の直前）"}


def format_candidate(c: Candidate) -> str:
    d = "上昇" if c.direction == "up" else "下降"
    ex = "高値" if c.direction == "up" else "安値"
    return (
        f"【サードオブサード候補】{c.name}（{c.symbol}） {d}\n"
        f"局面: {STATUS_JA[c.status]}　確度: {c.score:.0f}/100\n"
        f"現在値: {c.close:.5g}\n"
        f"・大きな波: 0={c.points['L0'][1]:.5g}（{c.dates['L0']}）→ 1={c.points['H1'][1]:.5g} → "
        f"2={c.points['L2'][1]:.5g}（戻り率{c.r2 * 100:.0f}%）\n"
        f"・小さな波: (i)={c.points['i'][1]:.5g} → (ii)={c.points['ii'][1]:.5g}（戻り率{c.rii * 100:.0f}%）\n"
        f"・突破の目安: {c.entry:.5g}（(i)の{ex}）\n"
        f"・大3波が本格化する価格: {c.wave1_top:.5g}（大1の{ex}を超えたら）\n"
        f"・無効になる価格: {c.invalidation_minor:.5g}（(ii)を割る/超えると小さな数え方が失敗）、"
        f"{c.invalidation_major:.5g}（2を割る/超えると大きな数え方が失敗）\n"
        f"・(iii)の目安: {c.target:.5g}\n"
        f"※機械的な判定です。チャートを見て最終判断してください。売買の助言ではありません。"
    )


def format_withdrawn(symbol: str, name: str, close: float, level: float, direction: str,
                    major: Optional[float] = None) -> str:
    d = "上昇" if direction == "up" else "下降"
    beyond = major is not None and ((close < major) if direction == "up" else (close > major))
    why = ("大きな数え方（大2波の起点）も割れたため、第3波の見立て自体が崩れました。" if beyond
           else "小さな数え方（(ii)）が失敗しました。大きな数え方は残っている可能性があります。")
    return (f"【取り下げ】{name}（{symbol}） {d}候補\n"
            f"現在値 {close:.5g} が無効化価格 {level:.5g} を超えて逆行しました。{why}")


def format_failures(failed: Dict[str, str]) -> str:
    lines = [f"・{s}: {m}" for s, m in list(failed.items())[:20]]
    return "【取得に失敗した銘柄】\n" + "\n".join(lines)


def send_discord(webhook: str, text: str, image_path: Optional[str] = None) -> None:
    text = text[:1900]
    if image_path:
        with open(image_path, "rb") as f:
            r = requests.post(webhook, data={"payload_json": json.dumps({"content": text})},
                              files={"file": (os.path.basename(image_path), f, "image/png")}, timeout=30)
    else:
        r = requests.post(webhook, json={"content": text}, timeout=30)
    r.raise_for_status()
