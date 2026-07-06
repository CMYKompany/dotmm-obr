"""Render curated anchors onto BG maps for visual verification."""
import json
from PIL import Image, ImageDraw, ImageFont

anchors = json.load(open('packs/anchors_curated.json'))
DIMS = {'A':(70,64),'B':(65,50),'C':(63,68),'D':(63,62),'E':(73,58),'F':(70,51)}
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
fs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)

for L, data in anchors.items():
    im = Image.open(f'/mnt/project/Level01_{L}_BG_{DIMS[L][0]}x{DIMS[L][1]}_FVTT.webp').convert('RGB')
    W, H = im.size
    gw, gh = DIMS[L]
    px, py = W/gw, H/gh
    d = ImageDraw.Draw(im)
    for room, (gx, gy) in data['rooms'].items():
        x, y = gx*px, gy*py
        d.ellipse([x-3, y-3, x+3, y+3], fill=(255, 40, 40))
        d.text((x+5, y-22), room, fill=(255, 40, 40), font=font,
               stroke_width=2, stroke_fill=(255, 255, 255))
    for gx, gy in data['secret_doors']:
        x, y = gx*px, gy*py
        d.text((x-6, y-9), 'S', fill=(30, 90, 255), font=fs,
               stroke_width=2, stroke_fill=(255, 255, 255))
    for c in data['connectors']:
        x, y = c['grid'][0]*px, c['grid'][1]*py
        d.text((x-15, y-9), '>'+c['to'], fill=(0, 140, 0), font=fs,
               stroke_width=2, stroke_fill=(255, 255, 255))
    im.save(f'debug/verify_{L}.png')
print('done')
