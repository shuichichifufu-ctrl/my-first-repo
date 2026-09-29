"""通知済み候補の記録（重複通知の抑止と取り下げ判定）。"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from typing import Dict, List, Tuple

from .waves import Candidate

RANK = {"approaching": 1, "started": 2}


def load(path: str) -> dict:
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}
    return {}


def save(path: str, state: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)


def select_new(cands: List[Candidate], state: dict) -> List[Candidate]:
    """未通知、または局面が進んだ（準備→入口）候補だけを返す。"""
    out = []
    for c in cands:
        old = state.get(c.key())
        if old is None or (not old.get("withdrawn") and RANK[c.status] > RANK[old["status"]]):
            out.append(c)
    return out


def remember(state: dict, c: Candidate, today: date) -> None:
    state[c.key()] = {"status": c.status, "symbol": c.symbol, "name": c.name, "direction": c.direction,
                      "inv": c.invalidation_minor, "date": today.isoformat(), "withdrawn": False}


def find_withdrawn(state: dict, closes: Dict[str, float], today: date, keep_days: int = 60) -> List[Tuple[str, dict, float]]:
    """無効化価格を逆行して抜けた候補を返し、記録を更新する。古い記録は捨てる。"""
    out = []
    for k in list(state):
        e = state[k]
        if (today - date.fromisoformat(e["date"])) > timedelta(days=keep_days):
            del state[k]
            continue
        if e.get("withdrawn"):
            continue
        cl = closes.get(e["symbol"])
        if cl is None:
            continue
        broken = cl < e["inv"] if e["direction"] == "up" else cl > e["inv"]
        if broken:
            e["withdrawn"] = True
            out.append((k, e, cl))
    return out
