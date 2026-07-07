"""Level 2 overlay OCR - adapted from pipeline/ocr_overlays.py.
Grid sizes from the dd2vtt filenames (WxH in cells)."""
import json, re, subprocess, tempfile, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

BASE = os.path.dirname(os.path.abspath(__file__)) + '/l2assets'
MAPS = {
    'A': (f'{BASE}/Level2A_DMOverlay_FVTT.png', 65, 75),
    'B': (f'{BASE}/Level2B_DMOverlay_FVTT.png', 53, 61),
    'C': (f'{BASE}/Level2C_DMOverlay_FVTT.png', 98, 51),
    'D': (f'{BASE}/Level2D_DMOverlay_FVTT.png', 57, 64),
    'E': (f'{BASE}/Level2E_DMOverlay_FVTT.png', 64, 69),
    'F': (f'{BASE}/Level2F_DMOverlay_FVTT.png', 57, 38),
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
             '-c', 'tessedit_char_whitelist=0123456789abcdefStomapelvABCDEF '],
            capture_output=True, text=True)
        return out.stdout.strip()
    finally:
        os.unlink(path)

def process(letter, path, gw, gh):
    img = Image.open(path)
    print(f"-- map {letter}: image {img.size}, mode {img.mode}, grid {gw}x{gh}, px/cell ({img.size[0]/gw:.1f}, {img.size[1]/gh:.1f})")
    # Overlays may be RGBA with transparent bg - composite onto white first
    if img.mode in ('RGBA', 'LA', 'P'):
        rgba = img.convert('RGBA')
        bg = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, rgba)
    im = np.array(img.convert('L'))
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
            # duplicate label on one map -> keep both, suffix a variant marker
            key = text
            k = 2
            while key in results['rooms']:
                key = f"{text}#{k}"; k += 1
            results['rooms'][key] = [cx, cy]
        elif re.fullmatch(r'[Ss5]', text) and h < py*1.3:
            results['secret_doors'].append([cx, cy])
        elif 'to' in text.lower() and ('map' in text.lower() or 'level' in text.lower()):
            m = re.search(r'map\s*([A-F])', text, re.I)
            results['connectors'].append({'to': m.group(1).upper() if m else '?', 'pos': [cx, cy], 'raw': text})
        else:
            results['other'].append({'text': text, 'pos': [cx, cy],
                                     'bbox_px': [int(x0),int(y0),int(x1),int(y1)],
                                     'grid': [cx, cy]})
    return results

all_out = {}
for letter, (path, gw, gh) in MAPS.items():
    all_out[letter] = process(letter, path, gw, gh)
    r = all_out[letter]
    print(f"Map {letter}: {len(r['rooms'])} rooms {sorted(r['rooms'])}")
    print(f"   {len(r['secret_doors'])} S, {len(r['connectors'])} connectors, {len(r['other'])} other")
    for o in r['other']:
        if o.get('text') is not None:
            print(f"   other: {o['text']!r} at {o.get('grid')}")

with open(f'{os.path.dirname(BASE)}/l2_anchors_raw.json', 'w') as f:
    json.dump(all_out, f, indent=1)
print("wrote l2_anchors_raw.json")
