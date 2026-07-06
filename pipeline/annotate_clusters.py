"""Render each overlay with numbered cluster indices for visual transcription."""
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

MAPS = {
    'A': ('/mnt/project/Level01A_GMOverlay_FVTT.png', 70, 64),
    'B': ('/mnt/project/Level01B_GMOverlay_FVTT.png', 65, 50),
    'C': ('/mnt/project/Level01C_GMOverlay_FVTT.png', 63, 68),
    'D': ('/mnt/project/Level01D_GMOverlay_FVTT.png', 63, 62),
    'E': ('/mnt/project/Level01E_GMOverlay_FVTT.png', 73, 58),
    'F': ('/mnt/project/Level01F_GMOverlay_FVTT.png', 70, 51),
}
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
except OSError:
    font = ImageFont.load_default()

clusters_out = {}
for letter, (path, gw, gh) in MAPS.items():
    im = np.array(Image.open(path).convert('L'))
    H, W = im.shape
    px, py = W/gw, H/gh
    mask = im < 100
    dil = ndimage.binary_dilation(mask, iterations=6)
    labels, n = ndimage.label(dil)
    rgb = Image.open(path).convert('RGB')
    draw = ImageDraw.Draw(rgb)
    clist = []
    idx = 0
    for i in range(1, n+1):
        ys, xs = np.where(labels == i)
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
        if (y1-y0)*(x1-x0) < 20:
            continue
        idx += 1
        clist.append({'idx': idx, 'bbox': [x0, y0, x1, y1],
                      'grid': [round((x0+x1)/2/px, 2), round((y0+y1)/2/py, 2)]})
        draw.rectangle([x0-2, y0-2, x1+2, y1+2], outline=(220, 30, 30), width=2)
        draw.text((x1+5, y0-8), str(idx), fill=(220, 30, 30), font=font)
    clusters_out[letter] = clist
    rgb.save(f'debug/clusters_{letter}.png')
    print(letter, idx, 'clusters')

with open('packs/clusters.json', 'w') as f:
    json.dump(clusters_out, f, indent=1)
