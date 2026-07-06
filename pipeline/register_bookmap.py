"""OCR room numbers on the printed book map, fit per-submap affine transforms
(scale+offset) from curated anchors -> book pixels, and project ambiguous
clusters into book-map space for direct reading."""
import json, re, subprocess, tempfile, os
import numpy as np
from PIL import Image
from scipy import ndimage

im = np.array(Image.open('/mnt/project/map01_01dungeonlevel.png').convert('L'))
H, W = im.shape
# Text is dark; parchment/hatching mid-gray. Threshold hard.
mask = im < 90
dil = ndimage.binary_dilation(mask, iterations=2)
labels, n = ndimage.label(dil)
sizes = ndimage.sum(mask, labels, range(1, n+1))

def ocr(img):
    p = tempfile.mktemp(suffix='.png')
    Image.fromarray(img).resize((img.shape[1]*6, img.shape[0]*6), Image.LANCZOS).save(p)
    try:
        out = subprocess.run(['tesseract', p, 'stdout', '--psm', '7',
                              '-c', 'tessedit_char_whitelist=0123456789abcd'],
                             capture_output=True, text=True)
        return out.stdout.strip()
    finally:
        os.unlink(p)

found = {}
for i in range(1, n+1):
    ys, xs = np.where(labels == i)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    h, w = y1-y0, x1-x0
    if not (6 <= h <= 20 and 5 <= w <= 45):
        continue
    crop = im[max(0,y0-2):y1+3, max(0,x0-2):x1+3]
    c = np.where(crop < 110, 0, 255).astype(np.uint8)
    t = ocr(c)
    if re.fullmatch(r'\d{1,2}[a-d]?', t):
        found.setdefault(t, []).append(((x0+x1)/2, (y0+y1)/2))

singles = {k: v[0] for k, v in found.items() if len(v) == 1}
print(f"book map OCR: {len(found)} labels, {len(singles)} unique:", sorted(singles))
json.dump({k: list(v) for k, v in singles.items()}, open('packs/bookmap_labels.json', 'w'))
