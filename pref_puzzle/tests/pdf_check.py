# 使い方: python3 -I tests/pdf_check.py <pdfフォルダ>
# 書き出したPDFを実測する: ページ数・用紙サイズ・スケールバー100mm・合わせマークと県境の隣接ページ間の一致
import json, sys, glob, os, logging, math
logging.disable(logging.CRITICAL)
import pdfplumber

PT = 25.4 / 72.0
def mm(v): return v * PT
ok_all = True
def report(name, ok, detail=''):
    global ok_all
    ok = bool(ok); ok_all &= ok
    print(('OK   ' if ok else 'FAIL ') + name + ('  ' + detail if detail else ''))

def is_red(c):
    return c is not None and len(c) >= 3 and c[0] > 0.8 and c[1] < 0.2 and c[2] < 0.3
def is_land(c):
    return c is not None and len(c) >= 3 and abs(c[0]-0.9647) < .01 and abs(c[1]-0.9451) < .01

for jf in sorted(glob.glob(os.path.join(sys.argv[1], '*.json'))):
    name = os.path.basename(jf)[:-5]
    meta = json.load(open(jf))
    pdf = pdfplumber.open(jf[:-5] + '.pdf')
    printed = [p for p in meta['pages'] if p['printed']]
    print(f"== {name}: {meta['name']} 1/{meta['denom']} {meta['rows']}行×{meta['cols']}列 向き={meta['orient']}")
    report('ページ数', len(pdf.pages) == meta['printCount'], f"PDF {len(pdf.pages)}枚 / 想定 {meta['printCount']}枚")
    wantW, wantH = (210, 297) if meta['orient'] == 'portrait' else (297, 210)
    szs = {(round(mm(p.width), 1), round(mm(p.height), 1)) for p in pdf.pages}
    report('用紙サイズ', all(abs(a - wantW) < 0.3 and abs(b - wantH) < 0.3 for a, b in szs), f"{szs} mm")
    per = {}
    for pm, pg in zip(printed, pdf.pages):
        W, H = meta['W'], meta['H']
        # スケールバー: 水平で長さ約100mmの線
        bars = [l for l in pg.lines if abs(l['y0'] - l['y1']) < 0.01 and abs(mm(l['x1'] - l['x0']) - 100) < 1.5]
        blen = [mm(l['x1'] - l['x0']) for l in bars]
        # 合わせマーク
        reds = [l for l in pg.lines if is_red(l.get('stroking_color'))]
        hs = [l for l in reds if abs(l['top'] - l['bottom']) < 0.01]
        vs = [l for l in reds if abs(l['x0'] - l['x1']) < 0.01]
        centers = []
        for h in hs:
            cx, cy = (h['x0'] + h['x1']) / 2, h['top']
            for v in vs:
                if abs((v['x0'] + v['x1']) / 2 - cx) < 0.05 and abs((v['top'] + v['bottom']) / 2 - cy) < 0.05:
                    centers.append((mm(cx) - 5 + pm['x0'], mm(cy) - 5 + pm['y0'], mm(h['x1'] - h['x0']), mm(v['bottom'] - v['top'])))
        lands = [c for c in pg.curves if is_land(c.get('non_stroking_color'))]
        verts = []
        for c in lands:
            for (x, y) in c['pts']:
                verts.append((mm(x) - 5 + pm['x0'], mm(y) - 5 + pm['y0']))
        per[pm['n']] = dict(pm=pm, bars=blen, centers=centers, verts=verts)
    bad = [(n, v['bars']) for n, v in per.items() if len(v['bars']) != 1 or abs(v['bars'][0] - 100) > 0.5]
    allb = [b for v in per.values() for b in v['bars']]
    report('スケールバー実寸（全ページ）', not bad and allb, f"最小{min(allb):.3f}〜最大{max(allb):.3f}mm（許容 100±0.5）" if allb else '見つからない')
    # マークの長さ
    lens = [(c[2], c[3]) for v in per.values() for c in v['centers']]
    report('＋マークの長さ8mm', all(abs(a - 8) < 0.1 and abs(b - 8) < 0.1 for a, b in lens) if lens else (meta['rows'] * meta['cols'] == 1), f"{len(lens)}個" + (f", {min(a for a,b in lens):.2f}〜{max(a for a,b in lens):.2f}mm" if lens else ''))
    # マークの一致: 全体座標で各点が2ページ以上に、0.05mm以内で一致して載っている
    pts = []
    for n, v in per.items():
        for c in v['centers']: pts.append((n, c[0], c[1]))
    worst = 0; single = 0
    for (n, x, y) in pts:
        others = [math.hypot(x - x2, y - y2) for (n2, x2, y2) in pts if n2 != n and abs(x - x2) < 1 and abs(y - y2) < 1]
        if not others: single += 1
        else: worst = max(worst, min(others))
    if len(printed) > 1:
        report('＋マークが隣のページと同じ地点', single == 0 and worst < 0.05, f"片側だけのマーク{single}個, 最大ずれ{worst:.4f}mm, 総数{len(pts)}")
    # 県境の一致
    byrc = {(p['r'], p['c']): p['n'] for p in printed}
    dmax = 0; npts = 0; pairs = 0; ovl = []
    for (r, c), n in byrc.items():
        for (dr, dc) in ((0, 1), (1, 0)):
            m2 = byrc.get((r + dr, c + dc))
            if not m2: continue
            pairs += 1
            A, B = per[n]['pm'], per[m2]['pm']
            gx0, gx1 = max(A['x0'], B['x0']), min(A['x0'], B['x0']) + meta['W']
            gy0, gy1 = max(A['y0'], B['y0']), min(A['y0'], B['y0']) + meta['H']
            ovl.append(((gx1 - gx0), (gy1 - gy0), dr, dc))
            mg = 0.4
            va = [p for p in per[n]['verts'] if gx0 + mg < p[0] < gx1 - mg and gy0 + mg < p[1] < gy1 - mg]
            vb = per[m2]['verts']
            for (x, y) in va:
                best = min((math.hypot(x - x2, y - y2) for (x2, y2) in vb if abs(x - x2) < 1 and abs(y - y2) < 1), default=None)
                npts += 1
                dmax = max(dmax, best if best is not None else 99)
    if pairs:
        report('隣接ページの重なりの寸法（のりしろ15mm）', all((abs(w - 15) < 0.01 if dc else abs(h - 15) < 0.01) for w, h, dr, dc in ovl), f"{pairs}組の重なり幅 {sorted({round(w if dc else h, 3) for w,h,dr,dc in ovl})}")
        report('隣接ページの県境線の頂点が一致', dmax < 0.05 and npts > 0, f"重なり内の頂点{npts}個, 最大ずれ{dmax:.4f}mm" if npts else '重なり内に県境の頂点なし')
print('総合:', 'すべて合格' if ok_all else '不合格あり')
