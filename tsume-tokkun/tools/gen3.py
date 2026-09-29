"""「玉は下段に落とせ」用: 玉を二段目→一段目に追い込む3手詰を逆算で組み立てる。"""
import random, sys, json, time, os
import shogi, tsume, gen, gen2
from gen2 import attacks, inb, neighbors, ok_black_place, ok_white_place
from multiprocessing import Pool


def cover(bm, sq, avoid, forbid, rng, kf, kr):
    cands = []
    for piece in ["P", "S", "G", "B", "R", "L", "N", "+P", "+S", "+B", "+R"]:
        for x in range(1, 10):
            for y in range(0, 9):
                L = (x, y)
                if L in bm or L in avoid or L == sq:
                    continue
                if not ok_black_place(piece, L):
                    continue
                if abs(x - kf) > 4 or y > kr + 5:
                    continue
                att = attacks(piece, L)
                if sq in att and not (att & forbid):
                    if piece == "P" and any(v == "P" and k[0] == x for k, v in bm.items()):
                        continue
                    cands.append((piece, L))
    if not cands:
        return None
    return rng.choice(cands)


def make(rng):
    base = rng.choice(["atama", "hara"])
    sp = None
    for _ in range(6):
        sp = gen2.build_k1(base, rng)
        if sp and [k for k, v in sp[0].items() if v == "k"][0][1] == 0:
            break
        sp = None
    if not sp:
        return None
    bm, hand = sp
    K0 = [k for k, v in bm.items() if v == "k"][0]
    kf = K0[0]
    cov = set()
    for sq, p in bm.items():
        if (p.isupper() or p.startswith("+")) and p != "K":
            cov |= attacks(p, sq)
    K1c = [(kf + a, 1) for a in (-1, 0, 1) if inb(kf + a, 1) and (kf + a, 1) not in bm and (kf + a, 1) not in cov]
    if not K1c:
        return None
    K1 = rng.choice(K1c)
    bm2 = dict(bm)
    del bm2[K0]
    bm2[K1] = "k"
    X = rng.choice(["S", "B", "R", "N", "L", "P", "S", "S"])
    Cs = []
    for x in range(1, 10):
        for y in range(0, 9):
            C = (x, y)
            if C in bm2 or C == K0:
                continue
            if not ok_black_place(X, C):
                continue
            if X == "P" and any(v == "P" and k[0] == x for k, v in bm2.items()):
                continue
            if K1 in attacks(X, C):
                Cs.append(C)
    if not Cs:
        return None
    C = rng.choice(Cs)
    cov2 = cov | attacks(X, C)
    if K0 in cov2:
        return None
    forbid = {K1, K0}
    avoid = {C, K0, K1}
    for n in neighbors(K1):
        if n == K0:
            continue
        pc = bm2.get(n)
        if pc is not None and pc.islower():
            continue
        if n in cov2:
            continue
        if pc is None and rng.random() < 0.4:
            w = rng.choice(["g", "s", "p", "p", "l", "n"])
            if ok_white_place(w, n):
                bm2[n] = w
                continue
        res = cover(bm2, n, avoid | {n}, forbid, rng, K1[0], K1[1])
        if not res:
            return None
        piece, L = res
        bm2[L] = piece
        cov2 |= attacks(piece, L)
        if K0 in cov2:
            return None
    if C in neighbors(K1) and C not in cov:
        res = cover(bm2, C, avoid, forbid, rng, K1[0], K1[1])
        if not res:
            return None
        piece, L = res
        bm2[L] = piece
        cov2 |= attacks(piece, L)
        if K0 in cov2:
            return None
    return bm2, ["G", X] if X != "G" else ["G", "G"]


def attempt(args):
    cat, seed = args
    rng = random.Random(seed)
    sp = make(rng)
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
        u = gen.check_pred("shita", sfen, bm, hand)
    except Exception:
        return None
    if not u:
        return None
    if not gen.no_waste(sfen, bm, hand, "shita", 2, u):
        return None
    return {"cat": "shita", "sfen": sfen, "k": 2, "first": u}


if __name__ == "__main__":
    secs, out = int(sys.argv[1]), sys.argv[2]
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    t0 = time.time()
    found = {}
    with Pool(os.cpu_count()) as pool:
        while time.time() - t0 < secs:
            batch = [("shita", seed + i) for i in range(400)]
            seed += 400
            for r in pool.imap_unordered(attempt, batch, chunksize=10):
                if r:
                    found[r["sfen"]] = r
            print("shita3 seed", seed, "found", len(found), round(time.time() - t0), flush=True)
            json.dump(list(found.values()), open(out, "w"), ensure_ascii=False, indent=1)
