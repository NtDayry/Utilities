"""เทียบผลของ app/utilities/water/model.py กับ model.ts ของ frontend (ผลจาก run.ts)

    python tests/parity/compare.py /tmp/ts_out.json
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.utilities.water.model import calc_system, guess_level_path, level_to_cm, normalize_system, read_system, scan_payload, validate_system  # noqa: E402


def py(f):
    c = normalize_system(f["cfg"])
    if c is None:
        return None
    rest = {k: v for k, v in c.items() if k not in ("createdAt", "updatedAt")}
    r = read_system(c, f["raw"])
    calc = None if r["levelRaw"] is None else calc_system(c, level_to_cm(c, r["levelRaw"]))
    pts = scan_payload(f["raw"])
    return {"cfg": rest, "reading": r, "calc": calc, "points": pts, "guess": guess_level_path(pts), "errors": validate_system(c)}


def eq(a, b, path=""):
    num = (int, float)
    if isinstance(a, num) and isinstance(b, num) and not isinstance(a, bool) and not isinstance(b, bool):
        return math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12) or print("DIFF", path, a, b)
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            print("KEYS", path, set(a) ^ set(b))
            return False
        return all([eq(a[k], b[k], f"{path}.{k}") for k in a])
    if isinstance(a, list) and isinstance(b, list):
        return (len(a) == len(b) or print("LEN", path)) and all([eq(x, y, f"{path}[{i}]") for i, (x, y) in enumerate(zip(a, b))])
    return a == b or print("DIFF", path, repr(a), repr(b))


fx = json.loads((Path(__file__).parent / "fixtures.json").read_text(encoding="utf-8"))
ts = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
ok = all([eq(py(f), t, f"#{i}") for i, (f, t) in enumerate(zip(fx, ts))])
print("PARITY OK" if ok else "PARITY MISMATCH")
sys.exit(0 if ok else 1)
