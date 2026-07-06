"""Extract room-number anchors, secret-door markers, and map connectors
from DotMM GM overlay PNGs. Outputs anchors_raw.json keyed by sub-map letter."""
import json, re, subprocess, tempfile, os
import numpy as np
from PIL import Image
from scipy import ndimage

MAPS = {
    'A': ('/mnt/project/Level01A_GMOverlay_FVTT.png', 70, 64),
    'B': ('/mnt/project/Level01B_GMOverlay_FVTT.png', 65, 50),
    'C': ('/mnt/project/Level01C_GMOverlay_FVTT.png', 63, 68),
    'D': ('/mnt/project/Level01D_GMOverlay_FVTT.png', 63, 62),
    'E': ('/mnt/project/Level01E_GMOverlay_FVTT.png', 73, 58),
    'F': ('/mnt/project/Level01F_GMOverlay_FVTT.png', 70, 51),
}

def ocr_cluster(img_arr):
    im = Image.fromarray(img_arr)
    w, h = im.size
    im = im.resize((w*6, h*6), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        im.save(f.name)
        path = f.name
    try:
        out = subprocess.run(
            ['tesseract', path, 'stdout', '--psm', '7',
             '-c', 'tessedit_char_whitelist=0123456789abcdefStomapABCDEF '],
            capture_output=True, text=True)
        return out.stdout.strip()
    finally:
        os.unlink(path)

def process(letter, path, gw, gh):
    im = np.array(Image.open(path).convert('L'))
    H, W = im.shape
    px, py = W/gw, H/gh
    mask = im < 100
    dil = ndimage.binary_dilation(mask, iterations=6)
    labels, n = ndimage.label(dil)
    results = {'rooms': {}, 'secret_doors': [], 'connectors': [], 'other': []}
    for i in range(1, n+1):
        ys, xs = np.where(labels == i)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        h, w = y1-y0, x1-x0
        if h*w < 20:
            continue
        if h*w > 40000:
            results['other'].append({'kind': 'large', 'bbox_px': [int(x0),int(y0),int(x1),int(y1)]})
            continue
        pad = 4
        crop = im[max(0,y0-pad):y1+pad, max(0,x0-pad):x1+pad]
        c = np.where(crop < 100, 0, 255).astype(np.uint8)
        text = ocr_cluster(c).strip()
        cx, cy = round((x0+x1)/2/px, 2), round((y0+y1)/2/py, 2)
        if re.fullmatch(r'\d{1,2}[a-f]?', text):
            results['rooms'][text] = [cx, cy]
        elif re.fullmatch(r'[Ss5]', text) and h < py*1.3:
            results['secret_doors'].append([cx, cy])
        elif 'to' in text.lower() and 'map' in text.lower():
            m = re.search(r'map\s*([A-F])', text, re.I)
            results['connectors'].append({'to': m.group(1).upper() if m else '?', 'pos': [cx, cy], 'raw': text})
        else:
            results['other'].append({'text': text, 'pos': [cx, cy], 'bbox_px': [int(x0),int(y0),int(x1),int(y1)]})
    return results

all_out = {}
for letter, (path, gw, gh) in MAPS.items():
    all_out[letter] = process(letter, path, gw, gh)
    r = all_out[letter]
    print(f"Map {letter}: {len(r['rooms'])} rooms {sorted(r['rooms'])}, "
          f"{len(r['secret_doors'])} S, {len(r['connectors'])} connectors, {len(r['other'])} other")

with open('packs/anchors_raw.json', 'w') as f:
    json.dump(all_out, f, indent=1)
