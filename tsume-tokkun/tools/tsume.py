"""詰将棋の検証用プログラム（攻方=先手、玉方=後手、玉方の持駒なし）。
合駒が発生する王手（離れた飛・角・香の王手）は扱わない前提で、そういう問題は除外する。
"""
import shogi

BLACK, WHITE = 0, 1


def sfen_from(board_map, hand):
    """board_map: {(file, rank_index): 'K'/'g'...}, hand: 攻方の持駒 'GS' など"""
    rows = []
    for r in range(9):
        row, empty = "", 0
        for f in range(9, 0, -1):
            p = board_map.get((f, r))
            if p is None:
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += p
        if empty:
            row += str(empty)
        rows.append(row)
    h = ""
    if hand:
        # 持駒表記: 種類ごとに枚数
        from collections import Counter
        c = Counter(hand)
        for k in "RBGSNLP":
            if c[k]:
                h += (str(c[k]) if c[k] > 1 else "") + k
    return "/".join(rows) + " b " + (h or "-") + " 1"


def sq_of(usi_part):
    return int(usi_part[0]), "abcdefghi".index(usi_part[1])


def king_sq(board, color):
    for sq in shogi.SQUARES:
        p = board.piece_at(sq)
        if p and p.piece_type == shogi.KING and p.color == color:
            return sq
    return None


def has_interposition(b):
    """王手直後の盤面で、玉方が駒を打って王手を防げる余地があるか。
    玉方に仮の金を1枚持たせ、打つ手が合法手に出るかで判定する。"""
    hand = b.pieces_in_hand[WHITE]
    old = hand[shogi.GOLD]
    hand[shogi.GOLD] = old + 1
    try:
        return any(m.from_square is None for m in b.legal_moves)
    finally:
        if old:
            hand[shogi.GOLD] = old
        else:
            hand.pop(shogi.GOLD, None)


def checking_moves(board):
    """攻方の王手になる合法手（打ち歩詰め除外）。合駒の余地がある王手は None を含めず除外リストへ。"""
    res, skipped = [], []
    for m in list(board.legal_moves):
        board.push(m)
        if board.is_check():
            # 打ち歩詰め
            is_pawn_drop = m.from_square is None and m.drop_piece_type == shogi.PAWN
            if is_pawn_drop and not any(True for _ in board.legal_moves):
                board.pop()
                continue
            if has_interposition(board):
                skipped.append(m.usi())
            else:
                res.append(m.usi())
        board.pop()
    return res, skipped


def solve(board, n):
    """攻方手番。n手以内に詰ませられる王手の初手を返す（リスト）。"""
    wins = []
    moves, _ = checking_moves(board)
    for u in moves:
        m = shogi.Move.from_usi(u)
        board.push(m)
        defs = list(board.legal_moves)
        if not defs:
            wins.append(u)
        elif n > 1:
            ok = True
            for d in defs:
                board.push(d)
                if not solve(board, n - 1):
                    ok = False
                board.pop()
                if not ok:
                    break
            if ok:
                wins.append(u)
        board.pop()
    return wins


def mate_length(board, maxk=2):
    """攻方の着手回数 k で詰む最小の k と初手候補（手数は 2k-1）"""
    for k in range(1, maxk + 1):
        w = solve(board, k)
        if w:
            return k, w
    return None, []


def tree(board, k):
    """正解手順の木（攻方の着手回数 k）。初手が一意でなければ AssertionError。"""
    w = solve(board, k)
    assert len(w) == 1, w
    u = w[0]
    board.push(shogi.Move.from_usi(u))
    replies = []
    for d in list(board.legal_moves):
        board.push(d)
        sub = tree(board, k - 1) if k > 1 else None
        board.pop()
        replies.append((d.usi(), sub))
    board.pop()
    return {"move": u, "replies": replies}
