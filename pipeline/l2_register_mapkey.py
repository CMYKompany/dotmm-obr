"""Register each Level 2 map image against the TYCH map key composite.
The key is built from the same art (tinted, downscaled), so normalized
cross-correlation on gradient magnitude gives per-map offsets; offsets
relative to map A become ORIGINS (cells)."""
import numpy as np
from PIL import Image
from scipy.signal import fftconvolve

BASE = '/tmp/claude-0/-home-user-dotmm-obr/5cec9551-4a9c-503d-bc38-cf7b5886b85d/scratchpad/l2assets'
MAPS = {
    'A': ('Level02_A_BG_65x75_FVTT.webp', 65, 75),
    'B': ('Level02_B_BG_53x61_FVTT.webp', 53, 61),
    'C': ('Level02_C_BG_98x51_FVTT.webp', 98, 51),
    'D': ('Level02_D_BG_57x64_FVTT.webp', 57, 64),
    'E': ('Level02_E_Empty_BG_64x69_FVTT.webp', 64, 69),
    'F': ('Level02_F_BG_57x38_FVTT.webp', 57, 38),
}

def gradmag(a):
    gy, gx = np.gradient(a.astype(np.float32))
    return np.hypot(gx, gy)

key_img = Image.open(f'{BASE}/Level02_MK.webp').convert('L')
key = gradmag(np.array(key_img))
KH, KW = key.shape
key2 = key * key
ones_cache = {}

def ncc_peak(template):
    t = template - template.mean()
    tn = np.sqrt((t * t).sum())
    if tn == 0: return None
    corr = fftconvolve(key, t[::-1, ::-1], mode='valid')
    kern = np.ones_like(template)
    local2 = fftconvolve(key2, kern, mode='valid')
    localsum = fftconvolve(key, kern, mode='valid')
    n = template.size
    denom = np.sqrt(np.maximum(local2 - localsum**2 / n, 1e-6)) * tn / np.sqrt(n) * np.sqrt(n)
    ncc = corr / np.maximum(denom, 1e-6)
    ij = np.unravel_index(np.argmax(ncc), ncc.shape)
    return float(ncc[ij]), (int(ij[1]), int(ij[0]))  # (x, y) px

def load_map_gray(fn):
    img = Image.open(f'{BASE}/{fn}')
    if img.mode in ('RGBA', 'LA', 'P'):
        rgba = img.convert('RGBA')
        bg = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, rgba)
    return img.convert('L')

# --- scale search on map A ---
fnA, wA, hA = MAPS['A']
imA = load_map_gray(fnA)
best = None
for s in [x/2 for x in range(28, 45)]:  # 14.0 .. 22.0 px/cell
    tw, th = int(wA*s), int(hA*s)
    if tw >= KW or th >= KH: continue
    t = gradmag(np.array(imA.resize((tw, th), Image.LANCZOS)))
    r = ncc_peak(t)
    if r and (best is None or r[0] > best[0]):
        best = (r[0], s, r[1])
print(f"scale search: best ncc {best[0]:.3f} at {best[1]} px/cell, A at {best[2]}")
s0 = best[1]
for s in [s0-0.25, s0+0.25]:
    tw, th = int(wA*s), int(hA*s)
    t = gradmag(np.array(imA.resize((tw, th), Image.LANCZOS)))
    r = ncc_peak(t)
    if r and r[0] > best[0]:
        best = (r[0], s, r[1])
scale = best[1]
print(f"refined: {best[0]:.3f} at {scale} px/cell")

# --- per-map offsets at the chosen scale ---
results = {}
for L, (fn, w, h) in MAPS.items():
    im = load_map_gray(fn)
    t = gradmag(np.array(im.resize((int(w*scale), int(h*scale)), Image.LANCZOS)))
    ncc, (x, y) = ncc_peak(t)
    results[L] = {'ncc': round(ncc, 3), 'px': [x, y],
                  'cells': [round(x/scale, 2), round(y/scale, 2)]}
    print(f"map {L}: ncc {ncc:.3f} at px ({x}, {y}) = cells ({x/scale:.2f}, {y/scale:.2f})")

ax, ay = results['A']['cells']
print("\nORIGINS_L2 (relative to A, rounded):")
for L in 'ABCDEF':
    cx, cy = results[L]['cells']
    print(f"  {L}: [{round(cx-ax)}, {round(cy-ay)}]   (raw {cx-ax:.2f}, {cy-ay:.2f}, ncc {results[L]['ncc']})")
