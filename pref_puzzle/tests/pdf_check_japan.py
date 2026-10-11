# 使い方: python3 -I tests/pdf_check_japan.py <pdfフォルダ>
# 全国パズルのPDFを実測する: ページ数・用紙サイズ・スケールバー・ピースの寸法と位置・見本ページ
import json, sys, glob, os, logging
logging.disable(logging.CRITICAL)
import pdfplumber
PT = 25.4 / 72.0
mm = lambda v: v * PT
ok_all = True
def report(name, ok, detail=''):
    global ok_all
    ok = bool(ok); ok_all &= ok
    print(('OK   ' if ok else 'FAIL ') + name + ('  ' + detail if detail else ''))
REGION = [(0.8118,0.9098,0.9686),(0.8392,0.9255,0.7882),(0.9843,0.8902,0.7098),(0.9686,0.8196,0.8196),(0.8902,0.8275,0.9412),(0.8118,0.9333,0.9137),(0.9765,0.9098,0.6510),(0.9647,0.8275,0.7216)]
HEX = lambda h: tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
def is_piece_color(c, palette=None):
    pal = palette or REGION
    return c is not None and len(c) >= 3 and any(all(abs(c[i] - r[i]) < 0.012 for i in range(3)) for r in pal)
for jf in sorted(glob.glob(os.path.join(sys.argv[1], 'jp_*.json')) + glob.glob(os.path.join(sys.argv[1], 'ai_*.json'))):
    meta = json.load(open(jf)); name = os.path.basename(jf)[:-5]
    PAL = [HEX(c) for c in meta['colors']] if meta.get('colors') else REGION
    pdf = pdfplumber.open(jf[:-5] + '.pdf')
    print(f"== {name}: {meta.get('title','日本地図パズル')} 1/{meta['denom']} {meta['paper']} {meta['orient']} なめらかさ={meta['level']}")
    npc = len(meta['pages'])
    report('ページ数（見本1＋ピース）', len(pdf.pages) == npc + 1, f"PDF {len(pdf.pages)}枚 / 想定 {npc + 1}枚")
    pw, ph = (210, 297) if meta['paper'] == 'A4' else (297, 420)
    wantW, wantH = (pw, ph) if meta['orient'] == 'portrait' else (ph, pw)
    szs = {(round(mm(p.width), 1), round(mm(p.height), 1)) for p in pdf.pages}
    report('用紙サイズ', all(abs(a - wantW) < 0.3 and abs(b - wantH) < 0.3 for a, b in szs), f"{szs} mm")
    byid = {q['id']: q for q in meta['pieces']}
    placed = 0; worst = 0; margin_min = 1e9; unmatched = 0; bars = []; overlap = 0
    for pi, items in enumerate(meta['pages']):
        pg = pdf.pages[pi + 1]
        # スケールバー
        bl = [mm(l['x1'] - l['x0']) for l in pg.lines if abs(l['y0'] - l['y1']) < 0.01 and abs(mm(l['x1'] - l['x0']) - 100) < 1.5 and max(l.get('stroking_color') or (0,)) < 0.05]
        bars += bl
        # ピースの図形（地方の色で塗られた図形）
        shapes = []
        for c in pg.curves:
            if is_piece_color(c.get('non_stroking_color'), PAL):
                xs = [p[0] for p in c['pts']]; ys = [p[1] for p in c['pts']]
                shapes.append((mm(min(xs)) - 5, mm(min(ys)) - 5, mm(max(xs)) - mm(min(xs)), mm(max(ys)) - mm(min(ys))))
        # 同じ県が複数の図形（島）になるので、モデルの箱と合う「外側の箱」を探す
        boxes = []
        for it in items:
            q = byid[it['id']]
            boxes.append((it['x'], it['y'], q['w'], q['h'], q['name']))
        # 図形全体の箱をモデルの箱と突き合わせる
        for (bx, by, bw, bh, nm) in boxes:
            inside = [s for s in shapes if s[0] >= bx - 0.15 and s[1] >= by - 0.15 and s[0] + s[2] <= bx + bw + 0.15 and s[1] + s[3] <= by + bh + 0.15]
            if not inside: unmatched += 1; continue
            x0 = min(s[0] for s in inside); y0 = min(s[1] for s in inside); x1 = max(s[0] + s[2] for s in inside); y1 = max(s[1] + s[3] for s in inside)
            d = max(abs(x0 - bx), abs(y0 - by), abs((x1 - x0) - bw), abs((y1 - y0) - bh))
            worst = max(worst, d); placed += 1
            margin_min = min(margin_min, bx, by, (wantW - 10) - (bx + bw), (wantH - 10) - (by + bh))
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if a[0] < b[0] + b[2] + 5.9 and b[0] < a[0] + a[2] + 5.9 and a[1] < b[1] + b[3] + 5.9 and b[1] < a[1] + a[3] + 5.9: overlap += 1
    report('スケールバー実寸（全ピースページ）', bars and all(abs(b - 100) < 0.5 for b in bars) and len(bars) == npc, f"{len(bars)}本 {min(bars):.3f}〜{max(bars):.3f}mm" if bars else 'なし')
    report('ピースの数・寸法（PDF上の図形の箱とモデルの差）', placed == sum(len(i) for i in meta['pages']) and unmatched == 0 and worst < 0.1, f"{placed}個を実測、最大差 {worst:.3f}mm、対応が取れなかった {unmatched}個")
    report('ピースの余白（紙の端・ピースどうし）', margin_min >= 5.9 and overlap == 0, f"描画範囲の端から最小 {margin_min:.1f}mm、近すぎる組 {overlap}")
    # 入りきらないピースは、本当に用紙より大きいものだけ（警告として画面に出る）
    areaW, areaH = wantW - 10 - 12, wantH - 10 - 46
    really = all((byid[i]['w'] > areaW or byid[i]['h'] > areaH) for i in meta['unfit'])
    report('入りきらないピースは、本当に用紙より大きいものだけ', really, f"{len(meta['unfit'])}個 {[byid[i]['name'] + '(' + format(byid[i]['w'], '.0f') + '×' + format(byid[i]['h'], '.0f') + 'mm)' for i in meta['unfit']]}")
    # 見本ページ: 文字と図形があること
    t = pdf.pages[0].extract_text() or ''
    report('見本ページ', '見本' in t and len([c for c in pdf.pages[0].curves if is_piece_color(c.get('non_stroking_color'), PAL)]) >= 40, f"図形{len([c for c in pdf.pages[0].curves if is_piece_color(c.get('non_stroking_color'), PAL)])}個")
    report('UIの文字がPDFに出ない', not any(k in ''.join((p.extract_text() or '') for p in pdf.pages) for k in ['印刷する', '作るもの', 'ニルナーリ']))
print('総合:', 'すべて合格' if ok_all else '不合格あり')
