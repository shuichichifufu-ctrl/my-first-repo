import json, sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data

NS = int(os.environ.get("N_SHAPE", "16"))   # 頭金・腹金・尻金
NO = int(os.environ.get("N_OTHER", "10"))   # 格言（3手詰）
ORDER = ["atama", "hara", "shiri", "shita", "kin_todome"]
FILES = {"atama": "v_atama.json", "hara": "v_hara.json", "shiri": "v_shiri.json",
         "shita": "v_shita.json", "kin_todome": "v_todome.json"}

TOTAL = {"P": 18, "L": 4, "N": 4, "S": 4, "G": 4, "B": 2, "R": 2}

def counts_ok(sfen):
    """駒数が実際の将棋の駒の枚数を超えていないか（例: 角が3枚は不可）"""
    board, _, hand = sfen.split()[:3]
    cnt = {k: 0 for k in TOTAL}
    for c in board.replace("+", ""):
        if c.upper() in cnt:
            cnt[c.upper()] += 1
    n = ""
    if hand != "-":
        for c in hand:
            if c.isdigit():
                n += c
            elif c.upper() in cnt:
                cnt[c.upper()] += int(n or 1)
                n = ""
    return all(cnt[k] <= TOTAL[k] for k in TOTAL)

def sig2(it):
    return ("".join(sorted(it["sfen"].split()[0].replace("/", "").replace("+", "")
                            .translate(str.maketrans("", "", "0123456789"))))
            , it["sfen"].split()[2])

def npieces(sfen):
    return sum(1 for c in sfen.split()[0] if c.isalpha()) + sum(1 for c in sfen.split()[2] if c.isalpha())

def king_of(sfen):
    rows = sfen.split()[0].split("/")
    for r, row in enumerate(rows):
        f = 9
        for c in row:
            if c.isdigit():
                f -= int(c)
            elif c == "k":
                return f, r
            elif c != "+":
                f -= 1
    return None

def pick(items, n):
    """易しい順（駒の数が少ない順）に n 問。玉の位置・初手が重なりにくいように選ぶ。"""
    items = sorted(items, key=lambda it: (npieces(it["sfen"]), it["sfen"]))
    if len(items) <= n:
        return items
    tiers = [items[int(i * len(items) / n):int((i + 1) * len(items) / n)] for i in range(n)]
    chosen, used, used2 = [], set(), set()
    for tier in tiers:
        best = None
        for strict in (True, False):
            for it in tier:
                kf, kr = king_of(it["sfen"])
                sig = (kf, kr, it["first"][:2] if "*" in it["first"] else it["first"][:1])
                if sig in used or (strict and sig2(it) in used2):
                    continue
                best = it
                used.add(sig)
                used2.add(sig2(it))
                break
            if best:
                break
        chosen.append(best or tier[0])
    return chosen

def crop_width(prob):
    files = [f for f, r, ch in prob["board"]]
    def walk(node):
        for u, e in node.items():
            if e["t"] != "ok":
                continue
            files.append(int(u[2]) if "*" in u else int(u[0]))
            files.append(int(u[2 if "*" not in u else 2]) if False else int(u[2]) if "*" in u else int(u[2]))
            for r in e.get("rep", []):
                files.append(int(r["u"][0])) if "*" not in r["u"] else None
                files.append(int(r["u"][2]) if "*" in r["u"] else int(r["u"][2]))
                walk(r["next"])
    walk(prob["root"])
    lo, hi = min(files), max(files)
    left, right = min(9, hi + 1), max(1, lo - 1)
    while left - right + 1 < 6 and not (left == 9 and right == 1):
        if left < 9: left += 1
        if left - right + 1 < 6 and right > 1: right -= 1
    return left - right + 1

CACHE = "verified_cache.json"
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

def _verify(it):
    import tsume_full
    try:
        tsume_full.check_full(it["sfen"], it["k"])
        return it["sfen"], True
    except AssertionError:
        return it["sfen"], False

def prevalidate(cands):
    from multiprocessing import Pool
    todo = [it for it in cands if it["sfen"] not in cache]
    if todo:
        with Pool(os.cpu_count()) as p:
            for sfen, ok in p.imap_unordered(_verify, todo):
                cache[sfen] = ok
        json.dump(cache, open(CACHE, "w"))

problems = []
meta = []
rejected = 0
for cat in ORDER:
    path = FILES[cat]
    if not os.path.exists(path):
        continue
    items = [it for it in json.load(open(path)) if counts_ok(it["sfen"])]
    if cat == "shita":   # 「金はとどめに残せ」と矛盾しないよう、初手が金打の問題は除く
        items = [it for it in items if not it["first"].startswith("G*")]
    if cat == "kin_todome":   # 「玉は下段に落とせ」と型が重なる問題（玉が一段目へ落ちる応手を含む）は後回し
        def falls(it):
            import shogi
            b = shogi.Board(it["sfen"]); b.push(shogi.Move.from_usi(it["first"]))
            for d in b.legal_moves:
                if d.from_square is not None and d.usi()[3] == "a":
                    return True
            return False
        pure = [it for it in items if not falls(it)]
        print("金はとどめ: 型が重ならない問題", len(pure), "/", len(items))
        if len(pure) >= NO + 4:
            items = pure
    N = NS if cat in ("atama", "hara", "shiri") else NO
    first = pick(items, N)
    rest = [it for it in sorted(items, key=lambda it: (npieces(it["sfen"]), it["sfen"])) if it not in first]
    got, chosen, used = 0, [], set()
    cands = first + rest
    prevalidate(cands[: N * 8])
    cap = 4 if cat in ("shita", "kin_todome") else None      # 同じ駒の初手は4問まで（型の幅を保つため）
    kinds = {}
    def kind(it):
        return it["first"][0] if "*" in it["first"] else "盤上"
    # 盤の幅が狭い問題（6列以内）を先に選び、足りなければゆるめる（マスを大きく保つため）
    for limit, cp in ((6, cap), (6, None), (7, cap), (7, None)):   # マスの大きさを優先し、そのうえで初手の偏りを抑える
        for it in cands:
            if got >= N:
                break
            if it["sfen"] in used:
                continue
            if not cache.get(it["sfen"], False):        # 合駒を含む正式な規則の検証に不合格（余詰など）
                if it["sfen"] in cache and limit == 6 and cp == cap:
                    rejected += 1
                continue
            if cp is not None and kinds.get(kind(it), 0) >= cp:
                continue
            pr = build_data.build_problem(it, f"{cat}-{got + 1}", verify=False)
            if crop_width(pr) > limit:
                continue
            used.add(it["sfen"])
            kinds[kind(it)] = kinds.get(kind(it), 0) + 1
            got += 1
            chosen.append((it, pr))
    chosen.sort(key=lambda t: (npieces(t[0]["sfen"]) + t[1]["checks"], t[0]["sfen"]))   # 易しい順（駒の数＋王手の候補の数）
    for i, (it, pr) in enumerate(chosen, 1):
        pr["id"] = f"{cat}-{i}"
        pr["level"] = 1 + (i - 1) * 3 // len(chosen)
        problems.append(pr)
        meta.append({"id": pr["id"], "cat": cat, "sfen": it["sfen"], "claimed_moves": 2 * it["k"] - 1,
                     "claimed_first_move": it["first"], "claimed_main_line": pr["main"]})
data = json.dumps(problems, ensure_ascii=False, separators=(",", ":"))
tmpl = open("app.tmpl.html", encoding="utf-8").read()
out = tmpl.replace("/*__PROBLEMS__*/[]", data)
assert out != tmpl
dest = sys.argv[1]
open(dest, "w", encoding="utf-8").write(out)
json.dump(meta, open(dest.replace(".html", "_meta.json"), "w"), ensure_ascii=False, indent=1)
print("rejected (余詰など):", rejected)
print("problems:", len(problems), "bytes:", len(out.encode()), "->", dest)
