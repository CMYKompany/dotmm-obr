"""Register the six sub-maps into one global frame by cross-correlating
their overlapping artwork, then fit global->bookmap transform via OCR labels."""
import json, itertools
import numpy as np
from PIL import Image

DIMS = {'A':(70,64),'B':(65,50),'C':(63,68),'D':(63,62),'E':(73,58),'F':(70,51)}
imgs = {}
for L,(gw,gh) in DIMS.items():
    im = Image.open(f'/mnt/project/Level01_{L}_BG_{gw}x{gh}_FVTT.webp').convert('L')
    # normalize to exactly 16 px/cell for clean integer math
    im = im.resize((gw*16, gh*16), Image.LANCZOS)
    imgs[L] = np.array(im).astype(np.float32)

def phase_corr(a, b):
    """offset of b relative to a (b's origin in a coords), via FFT phase correlation
    on zero-padded canvases."""
    H = max(a.shape[0], b.shape[0]) * 2
    W = max(a.shape[1], b.shape[1]) * 2
    A = np.zeros((H, W), np.float32); A[:a.shape[0], :a.shape[1]] = a - a.mean()
    B = np.zeros((H, W), np.float32); B[:b.shape[0], :b.shape[1]] = b - b.mean()
    FA, FB = np.fft.rfft2(A), np.fft.rfft2(B)
    R = FA * np.conj(FB)
    R /= np.abs(R) + 1e-9
    corr = np.fft.irfft2(R, s=(H, W))
    idx = np.unravel_index(np.argmax(corr), corr.shape)
    dy, dx = idx
    if dy > H//2: dy -= H
    if dx > W//2: dx -= W
    return dx, dy, corr[idx]

pairs = {}
for a, b in itertools.combinations('ABCDEF', 2):
    dx, dy, score = phase_corr(imgs[a], imgs[b])
    pairs[(a, b)] = (dx/16, dy/16, float(score))
    print(f"{a}-{b}: offset of {b} in {a} frame = ({dx/16:+.2f}, {dy/16:+.2f}) cells, score {score:.3f}")
json.dump({f'{a}-{b}': v for (a, b), v in pairs.items()}, open('packs/pairwise_offsets.json', 'w'))
