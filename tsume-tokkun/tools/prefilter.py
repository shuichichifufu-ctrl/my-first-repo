import json, sys, shogi, tsume
from multiprocessing import Pool
def ok(it):
    try:
        b = shogi.Board(it["sfen"]); tsume.tree(b, it["k"]); return it
    except AssertionError:
        return None
    except Exception as e:
        return None
if __name__ == "__main__":
    for src, dst in [("out_atama.json","v_atama.json"),("out_hara.json","v_hara.json"),("out_shiri.json","v_shiri.json"),("out_shita.json","v_shita.json"),("out_todome.json","v_todome.json")]:
        items = json.load(open(src))
        with Pool(4) as p:
            good = [x for x in p.map(ok, items, chunksize=8) if x]
        json.dump(good, open(dst,"w"), ensure_ascii=False)
        print(src, len(items), "->", len(good))
