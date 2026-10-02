import json

import numpy as np
import pandas as pd
import pytest

from scanner import notify, state as st
from scanner.pivots import zigzag
from scanner.synth import planted_third_of_third, random_walk, range_bound
from scanner.waves import Params, check_impulse_rules, check_partial_rules, find_candidates
from datetime import date


# 鉄則ルール（1つずつ） -------------------------------------------------
def test_rule_wave2_below_origin_rejected():
    assert not check_impulse_rules([100, 130, 95, 150, 140, 170])["wave2_not_below_origin"]


def test_rule_wave3_shortest_rejected():
    assert not check_impulse_rules([100, 130, 110, 125, 120, 160])["wave3_not_shortest"]


def test_rule_wave4_overlap_rejected():
    assert not check_impulse_rules([100, 130, 110, 160, 125, 170])["wave4_not_in_wave1"]


def test_rules_valid_impulse_all_pass():
    assert all(check_impulse_rules([100, 130, 112, 165, 150, 180]).values())


def test_rules_down_direction_mirrored():
    assert all(check_impulse_rules([180, 150, 168, 115, 130, 100], up=False).values())
    assert not check_impulse_rules([180, 150, 185, 115, 130, 100], up=False)["wave2_not_below_origin"]


def test_partial_rules():
    assert not check_partial_rules(100, 130, 112, 120, 111)["sub2_not_below_sub_origin"]
    assert all(check_partial_rules(100, 130, 112, 122, 116).values())


# ジグザグ --------------------------------------------------------------
def test_zigzag_basic():
    h = [1, 3, 5, 4, 2, 3, 6, 5]
    l = [0, 2, 4, 3, 1, 2, 5, 4]
    piv, prov = zigzag(h, l, 3)
    assert [p[0] for p in piv] == ["L", "H", "L"] and prov[0] == "H"


def test_zigzag_empty():
    assert zigzag([], [], 1) == ([], None)


# 検出 ------------------------------------------------------------------
@pytest.mark.parametrize("direction", ["up", "down"])
def test_detects_planted_pattern(direction):
    hits = sum(any(c.direction == direction and c.status == "started"
                   for c in find_candidates("X", "x", planted_third_of_third(s, direction)))
               for s in range(20))
    assert hits >= 14


def test_noise_and_range_mostly_silent():
    fp = sum(bool(find_candidates("X", "x", random_walk(s))) for s in range(100))
    fp += sum(bool(find_candidates("X", "x", range_bound(s))) for s in range(100))
    assert fp <= 6


def test_short_or_broken_data_does_not_crash():
    assert find_candidates("X", "x", random_walk(1, n=50)) == []
    df = random_walk(1)
    df.iloc[10:20] = np.nan
    find_candidates("X", "x", df)
    flat = pd.DataFrame({"High": [1.0] * 200, "Low": [1.0] * 200, "Close": [1.0] * 200},
                        index=pd.bdate_range("2025-01-01", periods=200))
    assert find_candidates("X", "x", flat) == []


def test_candidate_levels_are_consistent():
    c = [x for x in find_candidates("X", "x", planted_third_of_third(3)) if x.direction == "up"][0]
    assert c.invalidation_major < c.invalidation_minor < c.entry < c.target
    assert 0 <= c.score <= 100


# 状態・重複抑止・取り下げ -----------------------------------------------
def test_dedup_and_upgrade_and_withdraw(tmp_path):
    c = [x for x in find_candidates("X", "x", planted_third_of_third(3, end="approaching"))
         if x.direction == "up"][0]
    s = {}
    assert st.select_new([c], s) == [c]
    st.remember(s, c, date(2026, 9, 1))
    assert st.select_new([c], s) == []  # 同じ局面は再通知しない
    c2 = type(c)(**{**c.__dict__, "status": "started"})
    assert st.select_new([c2], s) == [c2]  # 準備→入口は再通知
    assert st.find_withdrawn(s, {"X": c.invalidation_minor + 1}, date(2026, 9, 2)) == []
    w = st.find_withdrawn(s, {"X": c.invalidation_minor - 1}, date(2026, 9, 2))
    assert len(w) == 1 and st.find_withdrawn(s, {"X": 0}, date(2026, 9, 3)) == []
    st.save(str(tmp_path / "s.json"), s)
    assert st.load(str(tmp_path / "s.json")) == json.loads(json.dumps(s))
    assert st.load(str(tmp_path / "none.json")) == {}


def test_state_old_entries_expire():
    s = {"k": {"status": "started", "symbol": "X", "name": "x", "direction": "up", "inv": 1, "date": "2025-01-01",
               "withdrawn": False}}
    st.find_withdrawn(s, {}, date(2026, 9, 1))
    assert s == {}


def test_message_contains_required_parts():
    c = [x for x in find_candidates("X", "テスト", planted_third_of_third(3)) if x.direction == "up"][0]
    t = notify.format_candidate(c)
    for w in ("テスト", "上昇", "形の整い具合", "無効になる価格", "突破の目安", "戻り率", "統計的に区別できませんでした"):
        assert w in t
    assert len(t) < 1900


# 実行入口（ネットワーク無しで） -----------------------------------------
def test_run_dry_run_with_failures(tmp_path, monkeypatch, capsys):
    from scanner import run, data
    cfg = tmp_path / "t.yaml"
    cfg.write_text("instruments:\n  a:\n    - {symbol: OK, name: 正常}\n    - {symbol: BAD, name: 失敗}\n",
                   encoding="utf-8")
    df = planted_third_of_third(3)
    monkeypatch.setattr(data, "fetch_all", lambda ins, period="2y": ({"OK": df}, {"BAD": "RuntimeError: x"}))
    rc = run.main(["--config", str(cfg), "--dry-run", "--state", str(tmp_path / "s.json"), "--out", str(tmp_path / "o")])
    out = capsys.readouterr().out
    assert rc == 0 and "失敗 1" in out and "サードオブサード候補" in out and "取得に失敗した銘柄" in out
    assert list((tmp_path / "o").glob("*.png"))


def test_run_requires_webhook_when_not_dry(monkeypatch, tmp_path):
    from scanner import run
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    assert run.main(["--config", "tickers.yaml", "--state", str(tmp_path / "s.json")]) == 2


# 範囲外の波形は出さない（関門の否定テスト） ---------------------------------
def _ups(**kw):
    return [c for s in range(20) for c in find_candidates("X", "x", planted_third_of_third(s, "up", **kw))
            if c.direction == "up"]


def test_gate_deep_retrace_wave2_rejected():
    assert len(_ups(r2=0.90)) <= 1  # 戻りすぎ（78.6%超）


def test_gate_shallow_retrace_wave2_rejected():
    assert len(_ups(r2=0.25)) <= 1  # 浅すぎ（38.2%未満）


def test_gate_deep_and_shallow_sub_wave2_rejected():
    assert len(_ups(rii=0.92)) <= 1
    # 雑音で戻りの測定値は0.1〜0.15ほど深く出るため、埋め込みは十分に浅い0.10にする
    assert len(_ups(rii=0.10)) <= 1


def test_gate_tiny_sub_wave1_rejected():
    # 小1波が大1波に比べて小さすぎ、(iii)が伸びても大1波の頂点に届かない
    assert len(_ups(w1=40.0, wi=6.0)) <= 1


def test_detects_all_wave_shapes():
    for v in ("linear", "curved", "abc"):
        hits = sum(any(c.direction == "up" for c in find_candidates("X", "x", planted_third_of_third(s, "up", variant=v)))
                   for s in range(20))
        assert hits >= 8, v


def test_nan_rows_do_not_shift_chart_positions(tmp_path):
    from scanner.chart import draw
    from scanner.waves import clean_frame
    df = planted_third_of_third(3)
    df.iloc[5:9] = np.nan
    c = [x for x in find_candidates("X", "x", df) if x.direction == "up"][0]
    cf = clean_frame(df)
    assert str(cf.index[c.points["L0"][0]])[:10] == c.dates["L0"]
    assert draw(cf, c, str(tmp_path / "a.png"))


# 上位の文脈・表示・検出経路への接続 ---------------------------------------
@pytest.mark.parametrize("direction", ["up", "down"])
def test_bounce_inside_big_counter_trend_is_rejected(direction):
    hits = sum(any(c.direction == direction for c in
                   find_candidates("X", "x", planted_third_of_third(s, direction, lead_drop=300)))
               for s in range(30))
    assert hits <= 1


def test_same_pattern_without_big_counter_trend_is_detected():
    hits = sum(any(c.direction == "up" for c in find_candidates("X", "x", planted_third_of_third(s, "up")))
               for s in range(30))
    assert hits >= 24


def test_impulse_rules_are_part_of_detection_path():
    c = [x for x in find_candidates("X", "x", planted_third_of_third(3)) if x.direction == "up"][0]
    assert any(k.startswith("projected_") for k in c.checks) and all(c.checks.values())


def test_message_says_wave3_already_started_when_past_wave1_top():
    from dataclasses import replace
    c = [x for x in find_candidates("X", "x", planted_third_of_third(3)) if x.direction == "up"][0]
    assert "本格化する価格" in notify.format_candidate(replace(c, close=c.wave1_top - 1))
    t = notify.format_candidate(replace(c, close=c.wave1_top + 1))
    assert "既に超えており" in t and "本格化する価格" not in t


def test_withdrawn_message_distinguishes_minor_and_major():
    minor = notify.format_withdrawn("X", "x", 105, 106, "up", major=100)
    major = notify.format_withdrawn("X", "x", 99, 106, "up", major=100)
    assert "(ii)" in minor and "第3波の見立て自体が崩れ" in major


def test_send_failure_keeps_candidate_unrecorded_and_saves_state(tmp_path, monkeypatch):
    from scanner import run, data
    cfg = tmp_path / "t.yaml"
    cfg.write_text("instruments:\n  a:\n    - {symbol: OK, name: 正常}\n", encoding="utf-8")
    monkeypatch.setattr(data, "fetch_all", lambda ins, period="2y": ({"OK": planted_third_of_third(3)}, {}))
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "http://example.invalid")

    def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(notify, "send_discord", boom)
    sp = tmp_path / "s.json"
    rc = run.main(["--config", str(cfg), "--state", str(sp), "--out", str(tmp_path / "o")])
    assert rc == 3 and sp.exists() and st.load(str(sp)) == {}  # 送れなかったので記録しない = 翌日再送


def test_baseline_and_bootstrap_run_offline():
    from scanner.replay import baseline_edges, bootstrap_p, replay
    df = planted_third_of_third(3)
    r = replay(df, "X")
    b = baseline_edges(df)
    assert len(b["up"]) > 50 and len(b["up"]) == len(b["down"])
    assert {"symbol", "edge_atr"} <= set(r.columns)
    obs, base_mean, p = bootstrap_p(r, {("X", "up"): b["up"], ("X", "down"): b["down"]}, n_iter=50)
    assert 0.0 <= p <= 1.0


def test_approaching_goes_to_watch_digest_only(tmp_path, monkeypatch, capsys):
    from scanner import run, data
    cfg = tmp_path / "t.yaml"
    cfg.write_text("instruments:\n  a:\n    - {symbol: OK, name: 正常}\n", encoding="utf-8")
    monkeypatch.setattr(data, "fetch_all", lambda ins, period="2y": ({"OK": planted_third_of_third(3, end="approaching")}, {}))
    rc = run.main(["--config", str(cfg), "--dry-run", "--state", str(tmp_path / "s.json"), "--out", str(tmp_path / "o")])
    out = capsys.readouterr().out
    assert rc == 0 and "ウォッチリスト" in out and "サードオブサード候補】" not in out
    assert not list((tmp_path / "o").glob("*.png"))  # 準備の局面は画像・個別通知なし


def test_watch_digest_text():
    c = [x for x in find_candidates("X", "テスト", planted_third_of_third(3, end="approaching")) if x.direction == "up"][0]
    t = notify.format_watch_digest([c])
    assert "テスト" in t and "統計的な優位性" in t
