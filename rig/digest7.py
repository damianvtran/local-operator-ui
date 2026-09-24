"""Compact per-row digest for QA r7 (scratch). One block per (label, scenario)."""
import json, os, sys

OUT = os.environ["LOCAL_OPERATOR_SCRATCHPAD"] + "/r7/out"


def short(x, n=14):
    return (x or "")[-n:]


def reads(h):
    return [(f"{x['limit']}{'B' if x['beforeId'] else 'T'}", x.get("rows", x.get("status", "-")),
             "ans" if x.get("answeredAt") is not None else "PENDING") for x in (h or [])]


def row(label, name):
    p = f"{OUT}/{label}-{name}.json"
    if not os.path.exists(p):
        return f"{label} {name}: MISSING ({p})"
    d = json.load(open(p))
    h = d.get("historyOnOpen") or []
    total = sum(x[1] for x in reads(h) if isinstance(x[1], int))
    st = d.get("settled") or {}
    lines = [f"== {label} {name}"]
    if d.get("error"):
        lines.append(f"  ERROR {d['error'][:300]}")
    lines.append(f"  reads={len(h)} rows={total} {reads(h)}")
    lines.append(f"  settled rows={st.get('rows')} standIns={st.get('standIns')} blank={st.get('blank')}")
    probe = d.get("probe") or []
    if probe:
        lines.append("  probe: " + "; ".join(
            f"{short(x['id'])} -> " + (f"MOUNTED summary={x.get('summary')!r}" if x.get("mounted") else "absent")
            for x in probe))
    sa = d.get("probeAnyId") or []
    notpainted = [short(a["id"]) for a in sa if not a["ids"]]
    if notpainted:
        lines.append(f"  not painted under any record id: {notpainted}")
    stands = [x["id"] for x in (d.get("standInsAll") or [])]
    if stands:
        lines.append(f"  mounted rows still holding a stand-in: {stands}")
    for k in ("pass1", "pass2", "pass2Settled", "pass2Mounted", "reattachNoStream"):
        if k in d:
            lines.append(f"  {k}: {json.dumps(d[k])}")
    if d.get("switchLoop"):
        sl = d["switchLoop"]
        lines.append(f"  switchLoop readsDuringCycles={sl.get('readsDuringCycles')} "
                     f"frames={json.dumps(d.get('switchLoopFrames'))}")
        lines.append(f"  switchLoopSettled={json.dumps(d.get('switchLoopSettled'))}")
        for c in sl["cycles"]:
            lines.append(f"    cycle {c['i']}: onOther={c['onOther']} backOnA={c['backOnA']}")
    if d.get("refindMid"):
        lines.append(f"  refindMid={json.dumps(d['refindMid'])[:300]}")
    if d.get("mergeRender"):
        mr = d["mergeRender"]
        lines.append(f"  mergeRender pre={json.dumps({k: mr['pre'].get(k) for k in ('mounted', 'expanded', 'h', 'working', 'workingText')})}")
        lines.append(f"  mergeRender post={json.dumps({k: mr.get('post', {}).get(k) for k in ('expanded', 'h', 'plusLines', 'minusLines', 'hunk')})}")
    if d.get("roundEndReads"):
        lines.append(f"  roundEndReads={json.dumps(d['roundEndReads'])[:200]} roundEndFrames={json.dumps(d.get('roundEndFrames'))[:200]}")
    if d.get("holdSettled"):
        lines.append(f"  holdSettled={json.dumps(d['holdSettled'])}")
    return "\n".join(lines)


if __name__ == "__main__":
    labels = sys.argv[1].split(",")
    for name in sys.argv[2:]:
        for label in labels:
            print(row(label, name))
