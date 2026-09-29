import random, sys, json, time, os
import shogi, tsume
from multiprocessing import Pool

FILES = list(range(1, 10))


def rnd_position(cat, rng):
    kf = rng.choice([1, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9])
    kr = 1 if cat in ("shita",) else rng.choice([0, 0, 1]) if cat in ("atama", "hara", "kin_todome", "naname") else 0
    if cat == "shiri":
        kr = rng.choice([1, 2])
    if cat == "naname":
        kr = rng.choice([0, 1])
    bm = {(kf, kr): 'k', (5, 8): 'K'}
    hand = []
    # 攻方の駒
    def free_sq(rmin, rmax):
        for _ in range(30):
            f, r = rng.choice(FILES), rng.randint(rmin, rmax)
            if (f, r) not in bm and abs(f - kf) <= 3:
                return f, r
        return None
    if cat in ("atama", "hara", "shiri"):
        hand = ['G']
        for _ in range(rng.choice([0, 1, 1, 2])):
            hand.append(rng.choice('SNBRLP'))
        for _ in range(rng.choice([1, 2, 2, 3])):
            sq = free_sq(max(0, kr - 1), min(5, kr + 3))
            if sq:
                bm[sq] = rng.choice('PSGNLBR'.replace('N', 'N'))
    elif cat == "shita":
        for _ in range(rng.choice([1, 2, 3])):
            hand.append(rng.choice('GSNBRLP'))
        for _ in range(rng.choice([1, 2, 3])):
            sq = free_sq(kr - 1, 5)
            if sq:
                bm[sq] = rng.choice('PSGNLBR')
    elif cat == "kin_todome":
        hand = ['G', rng.choice('SNBRLP')]
        if rng.random() < .3:
            hand.append(rng.choice('SNBRLP'))
        for _ in range(rng.choice([0, 1, 2, 3])):
            sq = free_sq(max(0, kr - 1), 5)
            if sq:
                bm[sq] = rng.choice('PSGNLBR')
    elif cat == "naname":
        hand = [rng.choice('GSNBRLP') for _ in range(rng.choice([1, 2]))]
        for _ in range(rng.choice([1, 2, 3])):
            sq = free_sq(max(0, kr - 1), 5)
            if sq:
                bm[sq] = rng.choice('PSGNLBR')
    # 玉方の駒
    for _ in range(rng.choice([0, 1, 1, 2, 2, 3])):
        f, r = kf + rng.choice([-2, -1, 0, 1, 2]), kr + rng.choice([-1, 0, 0, 1, 1, 2])
        if 1 <= f <= 9 and 0 <= r <= 3 and (f, r) not in bm:
            bm[(f, r)] = rng.choice('gggsspppnl')
    # 成駒（攻方）を少し混ぜる
    for k in list(bm):
        p = bm[k]
        if p in 'PSNL' and rng.random() < .1:
            bm[k] = '+' + p
    return bm, hand


def legal_placement(bm):
    files_pawn = {}
    for (f, r), p in bm.items():
        if p == 'P' and r == 0:
            return False
        if p in 'NL' and (r == 0 or (p == 'N' and r <= 1)):
            return False
        if p == 'p' and r == 8:
            return False
        if p == 'n' and r >= 7:
            return False
        if p == 'l' and r == 8:
            return False
        if p in 'Pp':
            files_pawn.setdefault((f, p), 0)
            files_pawn[(f, p)] += 1
            if files_pawn[(f, p)] > 1:
                return False
    return True


def check_pred(cat, sfen, bm, hand):
    b = shogi.Board(sfen)
    kf, kr = [k for k, v in bm.items() if v == 'k'][0]
    k, wins = tsume.mate_length(b, 2)
    if k is None or len(wins) != 1:
        return None
    u = wins[0]
    if cat in ("atama", "hara", "shiri"):
        if k != 1 or not u.startswith('G*'):
            return None
        f, r = tsume.sq_of(u[2:4])
        if cat == "atama" and (f, r) != (kf, kr + 1):
            return None
        if cat == "hara" and not (r == kr and abs(f - kf) == 1):
            return None
        if cat == "shiri" and (f, r) != (kf, kr - 1):
            return None
        return u
    if k != 2:
        return None
    b.push(shogi.Move.from_usi(u))
    replies = [d.usi() for d in b.legal_moves]
    if not replies:
        return None
    if cat == "shita":
        if kr != 1 or len(replies) != 1:
            return None
        d = replies[0]
        if tsume.sq_of(d[2:4])[1] != 0 or tsume.sq_of(d[0:2]) != (kf, kr):
            return None
        b.push(shogi.Move.from_usi(d))
        w2 = tsume.solve(b, 1)
        b.pop()
        if len(w2) != 1:
            return None
        return u
    if cat == "kin_todome":
        if u.startswith('G*'):
            return None
        # 2手目はすべて金打ち
        for d in replies:
            b.push(shogi.Move.from_usi(d))
            w2 = tsume.solve(b, 1)
            b.pop()
            if not (len(w2) == 1 and w2[0].startswith('G*')):
                return None
        b.pop()
        # 初手に金の王手があり、それは詰まない（誘惑の手）
        cm, _ = tsume.checking_moves(b)
        if not any(m.startswith('G*') for m in cm):
            return None
        return u
    if cat == "naname":
        # 玉方の全応手が「金の斜め移動」（玉は動かない）
        gold_diag = 0
        for d in replies:
            (f1, r1), (f2, r2) = tsume.sq_of(d[0:2]), tsume.sq_of(d[2:4])
            if (f1, r1) == (kf, kr):
                return None
            piece = shogi.Board(sfen).piece_at(shogi.SQUARES[(r1) * 9 + (9 - f1)]) if False else None
            if abs(f1 - f2) == 1 and abs(r1 - r2) == 1 and bm.get((f1, r1)) == 'g':
                gold_diag += 1
            else:
                return None
        if gold_diag == 0:
            return None
        return u
    return None


def no_waste(sfen, bm, hand, cat, k, u):
    """各駒を取り除いたとき、同じ手数・同じ初手で詰みが一意に成立するなら無駄駒。"""
    def still(bm2, hand2):
        try:
            b = shogi.Board(tsume.sfen_from(bm2, hand2))
        except Exception:
            return False
        if b.turn != 0:
            return False
        kk, w = tsume.mate_length(b, k)
        return kk is not None and kk <= k and len(w) == 1 and w[0] == u
    for sq, p in bm.items():
        if p in 'kK':
            continue
        bm2 = dict(bm)
        del bm2[sq]
        if still(bm2, hand):
            return False
    for i in range(len(hand)):
        h2 = hand[:i] + hand[i + 1:]
        if still(bm, h2):
            return False
    return True


def attempt(args):
    cat, seed = args
    rng = random.Random(seed)
    bm, hand = rnd_position(cat, rng)
    if not legal_placement(bm):
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
        u = check_pred(cat, sfen, bm, hand)
    except Exception:
        return None
    if not u:
        return None
    k = 1 if cat in ("atama", "hara", "shiri") else 2
    if not no_waste(sfen, bm, hand, cat, k, u):
        return None
    return {"cat": cat, "sfen": sfen, "k": k, "first": u}


if __name__ == "__main__":
    cat = sys.argv[1]
    secs = int(sys.argv[2])
    out = sys.argv[3]
    t0 = time.time()
    found = {}
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    with Pool(os.cpu_count()) as pool:
        while time.time() - t0 < secs:
            batch = [(cat, seed + i) for i in range(2000)]
            seed += 2000
            for r in pool.imap_unordered(attempt, batch, chunksize=20):
                if r:
                    found[r["sfen"]] = r
            print(cat, "seed", seed, "found", len(found), round(time.time() - t0), flush=True)
    json.dump(list(found.values()), open(out, "w"), ensure_ascii=False, indent=1)
