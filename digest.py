"""Digest QA r3 run JSONs into compact rows (scratch)."""
import json, os, sys

OUT = os.environ["LOCAL_OPERATOR_SCRATCHPAD"] + "/r3/out"


def R(label, name):
    p = f"{OUT}/{label}-{name}.json"
    return json.load(open(p)) if os.path.exists(p) else None


def reads(d, key="historyOnOpen"):
    return [
        (h["limit"], "before" if h["beforeId"] else "tail", h.get("rows", h.get("status", "-")), h.get("answeredAt", "pending"))
        for h in d.get(key) or []
    ]


def pick(d, k, keys):
    v = d.get(k)
    return {x: v.get(x) for x in keys} if isinstance(v, dict) else v


def runs(fr, n=10):
    return [(r["k"], r["frames"]) for r in (fr or [])][:n]


if __name__ == "__main__":
    label = sys.argv[1]
    for name in sys.argv[2:]:
        d = R(label, name)
        if d is None:
            print(label, name, "MISSING")
            continue
        out = {"open": reads(d), "err": (d.get("error") or "")[:200] or None}
        if d.get("first"):
            out["first"] = pick(d, "first", ("t", "rows", "standIns", "blank", "readsAnsweredYet"))
        if d.get("settled"):
            out["settled"] = pick(d, "settled", ("rows", "standIns", "blank", "blankRows"))
        for k in ("probe", "firstShot", "revealed", "switchLoopSettled", "holdSettled", "refindMid", "refindAfter", "live", "backOnA", "onB", "onBLater", "returnMid", "mergeRender"):
            if d.get(k) is not None:
                v = d[k]
                if isinstance(v, dict):
                    v = {x: y for x, y in v.items() if x not in ("sample", "standInRows", "rows") or k == "live"}
                out[k] = v
        for k in ("openFrames", "switchLoopFrames", "holdFrames", "refindFrames", "roundEndFrames", "returnFrames"):
            if d.get(k):
                out[k] = runs(d[k])
        for k in ("roundEndReads", "returnReads"):
            if d.get(k):
                out[k] = reads(d, k)
        if d.get("switchLoop"):
            out["switchLoopReads"] = d["switchLoop"]["readsDuringCycles"]
            out["cycles"] = [(c["backOnA"]["rows"], c["backOnA"]["standIns"], c["backOnA"]["blank"]) for c in d["switchLoop"]["cycles"]]
        print(f"== {label} {name}")
        print(json.dumps(out, default=str)[:2400])
