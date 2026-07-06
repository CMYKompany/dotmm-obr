"""Global frame from connector seams; fit uniform-scale affine to book map px;
project ambiguous anchors into the printed map for direct reading."""
import json
import numpy as np

anchors = json.load(open('packs/anchors_curated.json'))
book = json.load(open('packs/bookmap_labels.json'))

ORIGIN = {  # sub-map origin in global (A-frame) coords, from connector seams
    'A': (0.0, 0.0),
    'B': (1.1, -44.6),
    'C': (61.9, -44.1),
    'D': (0.4, 54.5),
    'E': (54.0, 25.4),
    'F': (41.0, 74.4),
}
def to_global(L, p):
    ox, oy = ORIGIN[L]
    return (p[0]+ox, p[1]+oy)

# Correspondences: room label -> (global xy, book px)
corr = []
for L, data in anchors.items():
    for room, g in data['rooms'].items():
        if room in book:
            corr.append((room, to_global(L, g), book[room]))
# manual fix: C#1 is room 18 not 13 (13 stays on B)
for i, (room, g, b) in enumerate(corr):
    print(f"{room:>4} global ({g[0]:6.1f},{g[1]:6.1f})  book px ({b[0]:6.1f},{b[1]:6.1f})")

G = np.array([c[1] for c in corr])
Bp = np.array([c[2] for c in corr])
# uniform scale + translation: b = s*g + t
n = len(corr)
A_ls = np.zeros((2*n, 4))
y = np.zeros(2*n)
A_ls[0::2, 0] = G[:, 0]; A_ls[0::2, 2] = 1; y[0::2] = Bp[:, 0]
A_ls[1::2, 1] = G[:, 1]; A_ls[1::2, 3] = 1; y[1::2] = Bp[:, 1]
# force sx == sy by combining columns
M = np.column_stack([A_ls[:, 0]+A_ls[:, 1], A_ls[:, 2], A_ls[:, 3]])
sol, res, *_ = np.linalg.lstsq(M, y, rcond=None)
s, tx, ty = sol
pred = np.column_stack([s*G[:, 0]+tx, s*G[:, 1]+ty])
resid = np.linalg.norm(pred-Bp, axis=1)
print(f"\nscale {s:.3f} px/cell, t=({tx:.1f},{ty:.1f})")
for (room, _, _), r in zip(corr, resid):
    print(f"  {room:>4} residual {r:5.1f} px")
print(f"median residual {np.median(resid):.1f}px  ({np.median(resid)/s:.1f} cells)")

def project(L, p):
    g = to_global(L, p)
    return (s*g[0]+tx, s*g[1]+ty)

for tag, L, p in [('D#4', 'D', [41.77, 8.18]), ('D#8', 'D', [52.51, 12.21]),
                  ('C#6=20?', 'C', [47.87, 40.9]), ('E#8=35?', 'E', [40.03, 20.42]),
                  ('E#14=28b?', 'E', [21.03, 31.13]), ('C#1=18?', 'C', [28.07, 8.91])]:
    bx, by = project(L, p)
    print(f"{tag}: book px ({bx:.0f},{by:.0f})")
json.dump({'scale': float(s), 'tx': float(tx), 'ty': float(ty),
           'origins': ORIGIN}, open('packs/global_transform.json', 'w'), indent=1)
