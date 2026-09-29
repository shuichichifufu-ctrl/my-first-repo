"""検証済みの問題から、アプリに埋め込むデータ(JSON)を作る。
全ての合法手を「正解 / 王手だが逃げられる / 王手ではない / 合駒の余地あり」に分類し、
日本語の棋譜表記と、機械で確認できた事実だけの解説を付ける。"""
import json, sys
import shogi, tsume, tsume_full

BLACK, WHITE = 0, 1
ZEN = "０１２３４５６７８９"
KAN = "〇一二三四五六七八九"
NAME = {"P": "歩", "L": "香", "N": "桂", "S": "銀", "G": "金", "B": "角", "R": "飛", "K": "玉",
        "+P": "と", "+L": "成香", "+N": "成桂", "+S": "成銀", "+B": "馬", "+R": "龍"}


def sq_index(f, r):  # r: 0..8 (一段=0)
    return r * 9 + (9 - f)


def parse_sq(s):
    return int(s[0]), "abcdefghi".index(s[1])


def sq_name(f, r):
    return ZEN[f] + KAN[r + 1]


def piece_key(p):
    sym = p.symbol().upper()
    return sym


def notate(board, usi, prev_to):
    """board: 指す直前の盤面。返り値: 「▲５二金打」などの文字列"""
    mover = "▲" if board.turn == BLACK else "△"
    legal = {m.usi() for m in board.legal_moves}
    if "*" in usi:
        pt = usi[0]
        f, r = parse_sq(usi[2:4])
        amb = any(
            (not "*" in u) and u[2:4] == usi[2:4] and
            board.piece_at(sq_index(*parse_sq(u[0:2]))).symbol().upper() == pt
            for u in legal)
        return f"{mover}{sq_name(f, r)}{NAME[pt]}{'打' if amb else ''}"
    f0, r0 = parse_sq(usi[0:2])
    f, r = parse_sq(usi[2:4])
    piece = board.piece_at(sq_index(f0, r0))
    key = piece.symbol().upper()
    promote = usi.endswith("+")
    can_promote = (usi.rstrip("+") + "+") in legal
    amb = [u for u in legal
           if "*" not in u and u.rstrip("+")[2:4] == usi[2:4] and u.rstrip("+")[0:2] != usi[0:2]
           and board.piece_at(sq_index(*parse_sq(u[0:2]))) is not None
           and board.piece_at(sq_index(*parse_sq(u[0:2]))).symbol().upper() == key]
    dest = "同" if prev_to == usi[2:4] else sq_name(f, r)
    s = f"{mover}{dest}{NAME[key]}"
    if amb:
        s += f"({f0}{r0 + 1})"
    if promote:
        s += "成"
    elif can_promote and not key.startswith("+") and key not in ("G", "K"):
        s += "不成"
    return s


def classify_node(board, k, prev_to):
    """攻方手番の盤面（玉方の持駒は正式な規則どおり）。全合法手を分類し、ノードを返す。"""
    node = {}
    wins = set(tsume.solve(board, k))
    assert len(wins) == 1
    for m in list(board.legal_moves):
        u = m.usi()
        n = notate(board, u, prev_to)
        board.push(m)
        if not board.is_check():
            node[u] = {"t": "nocheck", "n": n}
            board.pop()
            continue
        defs = list(board.legal_moves)
        if u[0] == "P" and "*" in u and not defs:
            node[u] = {"t": "uchifu", "n": n}
            board.pop()
            continue
        if u in wins:
            entry = {"t": "ok", "n": n}
            if not defs:
                entry["mate"] = True
            else:
                reps = []
                for d in defs:
                    rt = notate(board, d.usi(), u[2:4])
                    board.push(d)
                    sub = classify_node(board, k - 1, d.usi()[2:4])
                    board.pop()
                    reps.append({"u": d.usi(), "rt": rt, "next": sub})
                entry["rep"] = reps
            node[u] = entry
        else:
            # 王手だが詰まない: 逃げ（合駒を含む）を1つ探す。玉が動く・取る手を先に探す。
            esc = None
            for want_drop in (False, True):
                for d in defs:
                    is_drop = d.from_square is None
                    if is_drop != want_drop:
                        continue
                    board.push(d)
                    ok = (k <= 1) or not tsume_full.solve_full(board, k - 1)
                    board.pop()
                    if ok:
                        esc = d
                        break
                if esc:
                    break
            assert esc is not None, (u, "王手だが詰まないのに逃げが見つからない")
            entry = {"t": "fail", "n": n, "esc": esc.usi(), "et": notate(board, esc.usi(), u[2:4])}
            if esc.from_square is None:
                entry["aigoma"] = True
            node[u] = entry
        board.pop()
    return node


def notate_before(board_after, move, prev_to):
    """board は push 後。notate は指す前の盤面が必要なので pop して計算し戻す。"""
    m = board_after.pop()
    s = notate(board_after, m.usi(), prev_to)
    board_after.push(m)
    return s


def main_lines(board, k, prev_to=None):
    """正解手順と変化を棋譜表記で返す: (主手順[str], 変化[[str]])"""
    w = tsume.solve(board, k)
    u = w[0]
    text = [notate(board, u, prev_to)]
    board.push(shogi.Move.from_usi(u))
    defs = list(board.legal_moves)
    variations = []
    main = text
    if defs:
        first = True
        for d in defs:
            dtxt = notate(board, d.usi(), u[2:4])
            board.push(d)
            sub_main, sub_vars = main_lines(board, k - 1, d.usi()[2:4])
            board.pop()
            if first:
                main = text + [dtxt] + sub_main
                variations += sub_vars
                first = False
            else:
                variations.append([text[0]] + [dtxt] + sub_main)
    board.pop()
    return main, variations


def neighbor_lines(board):
    """王手の直後の盤面（玉方手番）で、玉の周りの各マスがどうなっているかを説明する。
    機械で確認できた事実だけを書く。"""
    ksq = tsume.king_sq(board, WHITE)
    kf, kr = 9 - (ksq % 9), ksq // 9
    flights = {}
    for d in board.legal_moves:
        if d.from_square is not None and d.from_square == ksq:
            flights[d.usi()[2:4]] = True
    lines = []
    for df in (-1, 0, 1):
        for dr in (-1, 0, 1):
            if df == 0 and dr == 0:
                continue
            f, r = kf + df, kr + dr
            if not (1 <= f <= 9 and 0 <= r <= 8):
                continue
            p = board.piece_at(sq_index(f, r))
            name = sq_name(f, r)
            if f"{f}{'abcdefghi'[r]}" in flights:
                lines.append({"sq": name, "ok": True, "t": f"{name}: 玉が逃げられる（ここが玉の逃げ道）"})
            elif p is not None and p.color == WHITE:
                lines.append({"sq": name, "ok": False, "t": f"{name}: 玉方自身の駒があって動けない"})
            elif p is not None:
                nm = NAME[p.symbol().upper()]
                lines.append({"sq": name, "ok": False, "t": f"{name}: 攻方の{nm}がいて、取っても別の駒の利きがあるので取れない"})
            elif board.is_attacked_by(BLACK, sq_index(f, r)):
                lines.append({"sq": name, "ok": False, "t": f"{name}: 攻方の駒の利きがあって逃げられない"})
            else:
                # 王手をかけた飛・角・香の利きが玉の後ろへ延びていて、玉が動くとその線上に入る場合など
                # （合法手として玉が動けない事実は、探索プログラムの合法手の一覧で確認済み）
                lines.append({"sq": name, "ok": False, "t": f"{name}: 王手をかけている駒の利きの線上にあたり、逃げられない"})
    return lines


def explain_sections(sfen, k, first_u, main):
    """解説の節。k=1: 詰み上がり。k=2: 1手目のあと＋詰み上がり。"""
    b = shogi.Board(sfen)
    tsume_full.set_white_hand(b)
    secs = []
    if k == 1:
        b.push(shogi.Move.from_usi(first_u))
        secs.append({"h": "詰み上がりの局面：玉の逃げ道の確認", "lines": neighbor_lines(b)})
        return secs
    b.push(shogi.Move.from_usi(first_u))
    secs.append({"h": f"1手目 {main[0]} のあと：玉の逃げ道", "lines": neighbor_lines(b)})
    reply = next(iter(b.legal_moves))
    b.push(reply)
    w2 = tsume.solve(b, 1)
    b.push(shogi.Move.from_usi(w2[0]))
    secs.append({"h": f"詰み上がり（{main[2]}）：玉の逃げ道", "lines": neighbor_lines(b)})
    return secs


def board_json(bm):
    out = []
    for (f, r), p in bm.items():
        if p == "K":
            continue  # 攻方の玉は詰将棋では表示しない
        out.append([f, r, p])
    return out


def build_problem(item, pid, verify=True):
    sfen = item["sfen"]
    k = item["k"]
    if verify:
        tsume_full.check_full(sfen, k)      # 余詰・合駒を含む正式な規則で確認（不合格なら AssertionError）
    b = shogi.Board(sfen)
    tsume_full.set_white_hand(b)
    bm = {}
    for r_i, row in enumerate(sfen.split()[0].split("/")):
        f = 9
        i = 0
        while i < len(row):
            c = row[i]
            if c.isdigit():
                f -= int(c)
            elif c == "+":
                bm[(f, r_i)] = "+" + row[i + 1]
                i += 1
                f -= 1
            else:
                bm[(f, r_i)] = c
                f -= 1
            i += 1
    hand_str = sfen.split()[2]
    hand = {}
    if hand_str != "-":
        n = ""
        for c in hand_str:
            if c.isdigit():
                n += c
            else:
                hand[c] = int(n or 1)
                n = ""
    root = classify_node(b, k, None)
    bm_board = shogi.Board(sfen)
    tsume_full.set_white_hand(bm_board)
    main, variations = main_lines(bm_board, k)
    first_u = item["first"]
    cat = item["cat"]
    # 詰まない王手の例（金の型では金打ち、それ以外はすべて）
    bb = shogi.Board(sfen)
    tsume_full.set_white_hand(bb)
    fails = []
    for u, e in root.items():
        if e["t"] == "fail":
            fails.append((u, e))
    if cat == "kin_todome":
        fails = [(u, e) for u, e in fails if u.startswith("G*")]
    fails.sort(key=lambda t: (0 if t[0].startswith("G*") else 1, t[0]))
    misses = []
    for u, e in fails[:3]:
        line = f"{e['n']} には {e['et']} と{'合駒で' if e.get('aigoma') else ''}逃げられます"
        misses.append(line)
    secs = explain_sections(sfen, k, first_u, main)
    reps = root[first_u].get("rep")
    if cat == "shita":
        why = (f"最初の王手 {main[0]} で、玉が動けるマスは1つだけです（{main[1]}）。"
               f"玉は一段目に落ちるしかなく、そこを {main[2]} で詰ませます。"
               "（最後に金を打つ形でもありますが、この問題で注目したいのは、玉を一段目に落とすところです。）")
    elif cat == "kin_todome":
        why = (f"{main[0]} で玉の逃げ道を減らしてから、最後に {main[2]} と金を打って詰ませます。"
               "金を先に打つと、下の例のように詰みません。")
    else:
        why = {"atama": "玉の真正面に金を打つ形です。", "hara": "玉の真横に金を打つ形です。",
               "shiri": "玉の後ろ側に金を打つ形です。"}[cat] + (
            f"{main[0]} で詰みです。この金には別の駒の利き（紐）が付いていて玉は取れず、"
            "玉の周りの逃げ道もすべてふさがれています（下の一覧で確認できます）。")
    checks = sum(1 for e in root.values() if e["t"] in ("ok", "fail"))
    return {
        "id": pid, "cat": cat, "k": k, "moves": 2 * k - 1,
        "board": board_json(bm), "hand": hand, "root": root,
        "main": main, "vars": variations[:4], "misses": misses, "secs": secs, "why": why, "checks": checks,
    }
