"""Refine sub-map origins to exact lattice offsets via constrained wall matching.
Search 0.5-cell steps within +/-3 cells of the seam-derived priors, scoring only
wall sample points that fall inside the mutual overlap region."""
import json
import numpy as np

DIMS = {'A':(70,64),'B':(65,50),'C':(63,68),'D':(63,62),'E':(73,58),'F':(70,51)}
PRIOR = {'A':(0.0,0.0),'B':(1.1,-44.6),'C':(61.9,-44.1),
         'D':(0.4,54.5),'E':(54.0,25.4),'F':(41.0,74.4)}

def wall_points(L):
    gw, gh = DIMS[L]
    d = json.load(open(f'/mnt/user-data/uploads/Level1_{L}_BG_{gw}x{gh}_FVTT.dd2vtt'))
    pts = []
    for poly in (d['line_of_sight'] + d.get('objects_line_of_sight', [])):
        for i in range(len(poly)-1):
            p, q = poly[i], poly[i+1]
            seg = np.hypot(q['x']-p['x'], q['y']-p['y'])
            n = max(2, int(seg*4)+1)
            for t in np.linspace(0, 1, n):
                pts.append((p['x']+t*(q['x']-p['x']), p['y']+t*(q['y']-p['y'])))
    return np.array(pts)

P = {L: wall_points(L) for L in DIMS}

PAIRS = [('A','B'),('B','C'),('A','D'),('D','E'),('E','F')]

def score_offset(A_pts, B_pts, off, dimsA, dimsB):
    """B's origin at `off` in A frame. Count B points matching an A point
    within 0.15 cells, restricted to the mutual overlap rectangle."""
    bx = B_pts[:, 0] + off[0]
    by = B_pts[:, 1] + off[1]
    ox0, oy0 = max(0, off[0]), max(0, off[1])
    ox1, oy1 = min(dimsA[0], off[0]+dimsB[0]), min(dimsA[1], off[1]+dimsB[1])
    if ox1 - ox0 < 1 or oy1 - oy0 < 1:
        return 0, 0
    selB = (bx >= ox0) & (bx <= ox1) & (by >= oy0) & (by <= oy1)
    selA = ((A_pts[:, 0] >= ox0) & (A_pts[:, 0] <= ox1) &
            (A_pts[:, 1] >= oy0) & (A_pts[:, 1] <= oy1))
    nB = selB.sum()
    if nB == 0 or selA.sum() == 0:
        return 0, 0
    A_sub = A_pts[selA]
    # grid-hash A points at 0.05 resolution for tolerance matching
    keys = set()
    for x, y in A_sub:
        gx, gy = round(x/0.05), round(y/0.05)
        for dx in (-2,-1,0,1,2):
            for dy in (-2,-1,0,1,2):
                keys.add((gx+dx, gy+dy))
    hits = sum(1 for x, y in zip(bx[selB], by[selB])
               if (round(x/0.05), round(y/0.05)) in keys)
    return hits / nB, int(nB)

results = {}
for a, b in PAIRS:
    pax, pay = PRIOR[a]
    pbx, pby = PRIOR[b]
    prior_off = (pbx - pax, pby - pay)
    best = None
    for dx in np.arange(-3, 3.01, 0.5):
        for dy in np.arange(-3, 3.01, 0.5):
            off = (round(prior_off[0] + dx) if abs((prior_off[0]+dx) % 1) < 0.26 or abs((prior_off[0]+dx) % 1) > 0.74
                   else round((prior_off[0]+dx)*2)/2,
                   round((prior_off[1]+dy)*2)/2)
            # snap to 0.5 lattice
            off = (round((prior_off[0]+dx)*2)/2, round((prior_off[1]+dy)*2)/2)
            frac, n = score_offset(P[a], P[b], off, DIMS[a], DIMS[b])
            if n < 50:
                continue
            if best is None or frac > best[0]:
                best = (frac, n, off)
    results[(a, b)] = best
    print(f"{a}-{b}: best offset {best[2]} match {best[0]*100:.1f}% of {best[1]} overlap points"
          f"  (prior {prior_off[0]:+.1f},{prior_off[1]:+.1f})")

# Build refined global origins anchored at A=(0,0)
off = {k: v[2] for k, v in results.items()}
O = {'A': (0.0, 0.0)}
O['B'] = off[('A','B')]
O['C'] = (O['B'][0] + off[('B','C')][0], O['B'][1] + off[('B','C')][1])
O['D'] = off[('A','D')]
O['E'] = (O['D'][0] + off[('D','E')][0], O['D'][1] + off[('D','E')][1])
O['F'] = (O['E'][0] + off[('E','F')][0], O['E'][1] + off[('E','F')][1])
print("\nRefined ORIGINS:", O)
json.dump({k: list(v) for k, v in O.items()}, open('packs/origins_refined.json', 'w'))
