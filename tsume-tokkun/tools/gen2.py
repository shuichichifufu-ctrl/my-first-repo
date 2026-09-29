"""構成的な問題生成。
1手詰(頭金・腹金・尻金): 金を打つ位置から逆算して、玉の逃げ道を金の利き・味方の駒・玉方の駒でふさぐ。
3手詰: 1手詰の詰み上がり局面から、直前の王手を1つ付け足して作る。
最後は必ず tsume.py の探索で「詰む・手数・初手が一意」を確認し、gen.py の判定と無駄駒検査を通す。"""
import random, sys, json, time, os
import shogi, tsume
import gen
from multiprocessing import Pool

DIRS = {
    "P": [(0, -1)], "N": [(-1, -2), (1, -2)],
    "S": [(0, -1), (-1, -1), (1, -1), (-1, 1), (1, 1)],
    "G": [(0, -1), (-1, -1), (1, -1), (-1, 0), (1, 0), (0, 1)],
    "K": [(a, b) for a in (-1, 0, 1) for b in (-1, 0, 1) if (a, b) != (0, 0)],
}
for pr in "PLNS":
    DIRS["+" + pr] = DIRS["G"]
RAYS = {
    "L": [(0, -1)], "B": [(-1, -1), (1, -1), (-1, 1), (1, 1)], "R": [(0, -1), (0, 1), (-1, 0), (1, 0)],
    "+B": [(-1, -1), (1, -1), (-1, 1), (1, 1)], "+R": [(0, -1), (0, 1), (-1, 0), (1, 0)],
}
DIRS["+B"] = [(0, -1), (0, 1), (-1, 0), (1, 0)]
DIRS["+R"] = [(-1, -1), (1, -1), (-1, 1), (1, 1)]


def inb(f, r):
    return 1 <= f <= 9 and 0 <= r <= 8


def attacks(piece, sq):
    """攻方の駒 piece が sq から利く升（間の駒は無視）"""
    f, r = sq
    out = set()
    for df, dr in DIRS.get(piece, []):
        if inb(f + df, r + dr):
            out.add((f + df, r + dr))
    for df, dr in RAYS.get(piece, []):
        x, y = f + df, r + dr
        while inb(x, y):
            out.add((x, y))
            x, y = x + df, y + dr
    return out


def ok_black_place(piece, sq):
    p = piece.lstrip("+")
    r = sq[1]
    if piece[0] != "+":
        if p in "PL" and r == 0:
            return False
        if p == "N" and r <= 1:
            return False
    return True


def ok_white_place(piece, sq):
    r = sq[1]
    if piece == "p" and r == 8:
        return False
    if piece == "l" and r == 8:
        return False
    if piece == "n" and r >= 7:
        return False
    return True


def neighbors(sq):
    f, r = sq
    return [(f + a, r + b) for a in (-1, 0, 1) for b in (-1, 0, 1) if (a or b) and inb(f + a, r + b)]


def shape_position(cat, rng):
    """1手詰の骨格（頭金・腹金・尻金）を作る。返り値: (bm, hand) または None"""
    kf = rng.choice([1, 2, 3, 4, 5, 5, 6, 7, 8, 9])
    kr = {"atama": rng.choice([0, 0, 1]), "hara": rng.choice([0, 0, 1]), "shiri": rng.choice([1, 2])}.get(cat, 0)
    if cat == "atama":
        T = (kf, kr + 1)
    elif cat == "hara":
        T = (kf + rng.choice([-1, 1]), kr)
    elif cat == "shiri":
        T = (kf, kr - 1)
    else:
        return None
    if not inb(*T):
        return None
    bm = {(kf, kr): "k", (5, 8): "K"}
    if T in bm:
        return None
    gold_att = attacks("G", T)
    covered = set()  # 攻方の駒（金以外）の利き
    placed_black = []

    def put_black(piece, sq):
        bm[sq] = piece
        placed_black.append((piece, sq))
        covered.update(attacks(piece, sq))

    def cover(sq, avoid):
        """sq に利く攻方の駒を1つ置く。置けたら True"""
        cands = []
        for piece in ["P", "S", "G", "B", "R", "L", "N", "+P", "+S", "+B", "+R"]:
            for x in range(1, 10):
                for y in range(0, 9):
                    L = (x, y)
                    if L in bm or L == T or L in avoid or L == sq:
                        continue
                    if not ok_black_place(piece, L):
                        continue
                    if abs(x - kf) > 4 or y > kr + 5:
                        continue
                    if sq in attacks(piece, L):
                        # 玉に直接王手になる配置は避ける
                        if (kf, kr) in attacks(piece, L):
                            continue
                        cands.append((piece, L))
        if not cands:
            return False
        # 近い・単純な駒を好む
        piece, L = rng.choice(cands)
        put_black(piece, L)
        return True

    # 金の支え
    if not cover(T, set()):
        return None
    for n in neighbors((kf, kr)):
        if n == T:
            continue
        if n in gold_att or n in covered:
            # 一定確率で玉方の駒を置いて「詰み形の飾り」にする（後の無駄駒検査で落ちる）
            continue
        if n in bm:
            continue
        r = rng.random()
        if r < 0.45:
            piece = rng.choice(["g", "s", "p", "p", "l", "n"])
            if ok_white_place(piece, n):
                bm[n] = piece
                continue
        if not cover(n, {n}):
            return None
    return bm, ["G"]


def build_k1(cat, rng):
    sp = shape_position(cat, rng)
    if not sp:
        return None
    bm, hand = sp
    # 玉方の駒の二歩を避ける・配置検査
    if not gen.legal_placement(bm):
        return None
    return bm, hand


def reverse_k2(cat, rng):
    """1手詰の骨格から、直前の王手を足して3手詰の候補を作る"""
    base = "atama" if rng.random() < .5 else rng.choice(["hara", "atama"])
    sp = None
    for _ in range(3):
        sp = build_k1(base, rng)
        if sp:
            break
    if not sp:
        return None
    bm, hand = sp
    (kf, kr) = [k for k, v in bm.items() if v == "k"][0]
    if cat == "shita" and kr != 0:
        return None
    # 玉を隣の升 K1 へ動かした局面を作る（玉方の応手は K1→K0 とする）
    K0 = (kf, kr)
    if cat == "shita":
        cand = [(kf + a, 1) for a in (-1, 0, 1)]
    else:
        cand = [n for n in neighbors(K0)]
    cand = [c for c in cand if inb(*c) and c not in bm]
    if not cand:
        return None
    K1 = rng.choice(cand)
    bm2 = dict(bm)
    del bm2[K0]
    bm2[K1] = "k"
    # 王手をかける駒 X を持駒から打つ or 盤上に置く（手番の最初の王手は持駒を打つ形）
    X = rng.choice(["S", "N", "B", "R", "L", "P", "S", "G" if cat == "shita" else "S"])
    hand2 = list(hand) + [X]
    # 3手詰では、持駒の金はとどめ用
    return bm2, hand2


def attempt(args):
    cat, seed = args
    rng = random.Random(seed)
    if cat in ("atama", "hara", "shiri"):
        sp = build_k1(cat, rng)
        k = 1
    else:
        sp = reverse_k2(cat, rng)
        k = 2
    if not sp:
        return None
    bm, hand = sp
    if not gen.legal_placement(bm):
        return None
    try:
        sfen = tsume.sfen_from(bm, hand)
        b = shogi.Board(sfen)
    except Exception:
        return None
    b.turn = 1
    if b.is_check():
        return None
    b.turn = 0
    try:
        u = gen.check_pred(cat, sfen, bm, hand)
    except Exception:
        return None
    if not u:
        return None
    if not gen.no_waste(sfen, bm, hand, cat, k, u):
        return None
    return {"cat": cat, "sfen": sfen, "k": k, "first": u}


if __name__ == "__main__":
    cat, secs, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    t0 = time.time()
    found = {}
    with Pool(os.cpu_count()) as pool:
        while time.time() - t0 < secs:
            batch = [(cat, seed + i) for i in range(400)]
            seed += 400
            for r in pool.imap_unordered(attempt, batch, chunksize=10):
                if r:
                    found[r["sfen"]] = r
            print(cat, "seed", seed, "found", len(found), round(time.time() - t0), flush=True)
            json.dump(list(found.values()), open(out, "w"), ensure_ascii=False, indent=1)
