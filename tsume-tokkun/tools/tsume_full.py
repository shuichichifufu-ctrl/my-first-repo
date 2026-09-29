"""合駒を含む正式な規則での検証。
玉方の持駒 = 全40枚（玉を除く）から、盤上と攻方の持駒を引いた残り。
離れた飛・角・香の王手も検討し、余詰（別の詰まし方）が1つでもあれば失格にする。"""
import shogi, tsume

BLACK, WHITE = 0, 1
TOTAL = {"P": 18, "L": 4, "N": 4, "S": 4, "G": 4, "B": 2, "R": 2}
TYPE = {"P": shogi.PAWN, "L": shogi.LANCE, "N": shogi.KNIGHT, "S": shogi.SILVER, "G": shogi.GOLD,
        "B": shogi.BISHOP, "R": shogi.ROOK}


def set_white_hand(board):
    used = {k: 0 for k in TOTAL}
    for sq in shogi.SQUARES:
        p = board.piece_at(sq)
        if p is None:
            continue
        sym = p.symbol().upper().lstrip("+")
        if sym in used:
            used[sym] += 1
    for k, t in TYPE.items():
        used[k] += board.pieces_in_hand[BLACK].get(t, 0)
    for k, t in TYPE.items():
        n = TOTAL[k] - used[k]
        if n > 0:
            board.pieces_in_hand[WHITE][t] = n
        else:
            board.pieces_in_hand[WHITE].pop(t, None)


def full_checking_moves(board):
    res = []
    for m in list(board.legal_moves):
        board.push(m)
        if board.is_check():
            if m.from_square is None and m.drop_piece_type == shogi.PAWN and not any(True for _ in board.legal_moves):
                board.pop()
                continue
            res.append(m.usi())
        board.pop()
    return res


def solve_full(board, k):
    wins = []
    for u in full_checking_moves(board):
        board.push(shogi.Move.from_usi(u))
        defs = list(board.legal_moves)
        if not defs:
            wins.append(u)
        elif k > 1 and all(_after(board, d, k - 1) for d in defs):
            wins.append(u)
        board.pop()
        continue
    return wins


def _after(board, d, k):
    board.push(d)
    ok = bool(solve_full(board, k))
    board.pop()
    return ok


def check_full(sfen, k):
    """全ての節で、正式な規則の詰み手が『1つだけ』で、かつ近接王手だけの検証と一致することを確かめる。
    一致しなければ AssertionError（余詰の疑い）。"""
    b = shogi.Board(sfen)
    set_white_hand(b)

    def rec(b, k):
        full = set(solve_full(b, k))
        near = set(tsume.solve(b, k))
        assert full == near and len(near) == 1, (sorted(full), sorted(near))
        u = next(iter(near))
        b.push(shogi.Move.from_usi(u))
        if k > 1:
            for d in list(b.legal_moves):
                b.push(d)
                rec(b, k - 1)
                b.pop()
        b.pop()
    rec(b, k)
    return True
