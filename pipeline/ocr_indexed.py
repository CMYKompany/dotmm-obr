"""OCR each indexed cluster so index -> text -> grid pos can be curated."""
import json, subprocess, tempfile, os
import numpy as np
from PIL import Image

clusters = json.load(open('packs/clusters.json'))
PATHS = {L: f'/mnt/project/Level01{L}_GMOverlay_FVTT.png' for L in 'ABCDEF'}

def ocr(im):
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        im.save(f.name); p = f.name
    try:
        out = subprocess.run(['tesseract', p, 'stdout', '--psm', '7'],
                             capture_output=True, text=True)
        return out.stdout.strip()
    finally:
        os.unlink(p)

report = {}
for L, clist in clusters.items():
    src = np.array(Image.open(PATHS[L]).convert('L'))
    rows = []
    for c in clist:
        x0, y0, x1, y1 = c['bbox']
        crop = src[max(0,y0-4):y1+4, max(0,x0-4):x1+4]
        cb = np.where(crop < 100, 0, 255).astype(np.uint8)
        im = Image.fromarray(cb)
        im = im.resize((im.width*6, im.height*6), Image.LANCZOS)
        txt = ocr(im)
        rows.append({'idx': c['idx'], 'text': txt, 'grid': c['grid'],
                     'wh': [x1-x0, y1-y0]})
    report[L] = rows
    for r in rows:
        print(f"{L}#{r['idx']:>2} {r['grid']} {r['wh']} -> {r['text']!r}")

json.dump(report, open('packs/ocr_indexed.json', 'w'), indent=1)
