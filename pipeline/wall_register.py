"""Register sub-maps via wall-vector translation voting."""
import json, itertools
import numpy as np

DIMS = {'A':(70,64),'B':(65,50),'C':(63,68),'D':(63,62),'E':(73,58),'F':(70,51)}

def wall_points(letter):
    gw, gh = DIMS[letter]
    d = json.load(open(f'/mnt/user-data/uploads/Level1_{letter}_BG_{gw}x{gh}_FVTT.dd2vtt'))
    pts = []
    for poly in d['line_of_sight']:
        for i in range(len(poly)-1):
            p, q = poly[i], poly[i+1]
            seg = np.hypot(q['x']-p['x'], q['y']-p['y'])
            n = max(2, int(seg*2)+1)
            for t in np.linspace(0, 1, n):
                pts.append((p['x']+t*(q['x']-p['x']), p['y']+t*(q['y']-p['y'])))
    return np.array(pts)

P = {L: wall_points(L) for L in DIMS}
for L in P: print(L, len(P[L]), 'wall sample points')

def best_offset(a, b, res=0.5):
    """Find translation t such that b+t aligns with a. Vote over pairwise diffs."""
    A, B = P[a], P[b]
    diffs_x = (A[:, 0][:, None] - B[:, 0][None, :]).ravel()
    diffs_y = (A[:, 1][:, None] - B[:, 1][None, :]).ravel()
    qx = np.round(diffs_x/res).astype(np.int32)
    qy = np.round(diffs_y/res).astype(np.int32)
    key = (qx.astype(np.int64) + 500)*2000 + (qy + 500)
    vals, counts = np.unique(key, return_counts=True)
    top = np.argsort(counts)[-3:][::-1]
    out = []
    for t in top:
        k = vals[t]
        ox = (k//2000 - 500)*res
        oy = (k % 2000 - 500)*res
        out.append((ox, oy, int(counts[t])))
    return out

results = {}
for a, b in itertools.combinations('ABCDEF', 2):
    if max(len(P[a]), len(P[b])) * min(len(P[a]), len(P[b])) > 6e7:
        pass
    cands = best_offset(a, b)
    results[f'{a}-{b}'] = cands
    print(f"{a}-{b}: top offsets (of {b} origin in {a} frame):", cands)
json.dump(results, open('packs/wall_offsets.json', 'w'), indent=1)
