"""Compact per-row digest for QA r6 (scratch). Prints one line per (label, scenario)."""
import json, os, sys

OUT = os.environ["LOCAL_OPERATOR_SCRATCHPAD"] + "/r6/out"


def row(label, name):
    p = f"{OUT}/{label}-{name}.json"
    if not os.path.exists(p):
        return f"{label:5s} {name:32s} MISSING"
    d = json.load(open(p))
    h = d.get("historyOnOpen") or []
    reads = [(x["limit"], "before" if x["beforeId"] else "tail", x.get("rows", x.get("status", "-"))) for x in h]
    total = sum(x[2] for x in reads if isinstance(x[2], int))
    probe = [(p["id"][-12:], "MOUNTED:" + (p.get("summary", "")[:12] or "-") if p.get("mounted") else "absent") for p in (d.get("probe") or [])]
    anyid = [(a["id"][-12:], a["ids"]) for a in (d.get("probeAnyId") or []) if not a["ids"]]
    stands = [s["id"].split(":")[-1][-12:] for s in (d.get("standInsAll") or [])]
    st = d.get("settled") or {}
    mr = d.get("mergeRender") or {}
    out = (f"{label:5s} {name:32s} reads={len(reads)} rows={total} {reads}"
           f" | settled rows={st.get('rows')} standIns={st.get('standIns')} blank={st.get('blank')}")
    if probe:
        out += f" | probe={probe}"
    if stands:
        out += f" | stand-in rows={stands}"
    if anyid:
        out += f" | not painted at all={[a[0] for a in anyid]}"
    if d.get("error"):
        out += f" | ERROR={d['error'][:160]}"
    if mr:
        out += (f" | mergeRender pre={ {k: mr['pre'][k] for k in ('mounted', 'expanded', 'h', 'working')} }"
                f" post={mr.get('post')}")
    return out


if __name__ == "__main__":
    for label in sys.argv[1].split(","):
        for name in sys.argv[2:]:
            print(row(label, name))
