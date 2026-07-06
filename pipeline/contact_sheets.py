"""Build per-map contact sheets: each detected cluster cropped and upscaled,
tagged with its index, for reliable visual transcription."""
import json
from PIL import Image, ImageDraw, ImageFont

clusters = json.load(open('packs/clusters.json'))
PATHS = {L: f'/mnt/project/Level01{L}_GMOverlay_FVTT.png' for L in 'ABCDEF'}
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)

for L, clist in clusters.items():
    src = Image.open(PATHS[L]).convert('RGB')
    cells = []
    for c in clist:
        x0, y0, x1, y1 = c['bbox']
        crop = src.crop((max(0, x0-4), max(0, y0-4), x1+4, y1+4))
        s = 4 if max(crop.size) < 80 else 2
        crop = crop.resize((crop.width*s, crop.height*s), Image.LANCZOS)
        cells.append((c['idx'], crop))
    cw = max(c.width for _, c in cells) + 90
    ch = max(c.height for _, c in cells) + 16
    cols = 4
    rows = (len(cells)+cols-1)//cols
    sheet = Image.new('RGB', (cw*cols, ch*rows), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, (idx, crop) in enumerate(cells):
        gx, gy = (i % cols)*cw, (i//cols)*ch
        d.text((gx+6, gy+8), f'#{idx}', fill=(200, 20, 20), font=font)
        sheet.paste(crop, (gx+70, gy+8))
        d.rectangle([gx, gy, gx+cw-1, gy+ch-1], outline=(180, 180, 180))
    sheet.save(f'debug/sheet_{L}.png')
    print(L, sheet.size)
