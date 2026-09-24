"""Emit the QA r7 matrix rows straight from the run JSONs (scratch).

Every cell is a reading, not a transcription: the read log split per pass, the
settled tally, and the probe verdict for each named call.
"""
import json, os

S = os.environ["LOCAL_OPERATOR_SCRATCHPAD"] + "/r7"
OUT = f"{S}/out"
EARLY_LONG = "toolu_01SDbpziaz9MBtxwosfMLe2d"
E = EARLY_LONG[-12:]
U = "SYNTHETICNOTINJOURNAL000"[-12:]


def D(label, name):
    p = f"{OUT}/{label}-{name}.json"
    return json.load(open(p)) if os.path.exists(p) else None


def rd(x):
    if x is None:
        return "MISSING"
    r = x.get("rows")
    if isinstance(r, int):
        return f"{x['limit']}{'B' if x.get('beforeId') else 'T'}={r}"
    return f"{x['limit']}{'B' if x.get('beforeId') else 'T'}={x.get('status','-')}"


def probe_of(d, cid12):
    for p in (d.get("probe") or []):
        if p["id"].endswith(cid12):
            if not p["mounted"]:
                return "absent"
            s = p.get("summary") or ""
            return "labelled" if not s.startswith("… ") else "stand-in"
    for a in (d.get("probeAnyId") or []):
        if a["id"].endswith(cid12) and not a["ids"]:
            return "not painted"
    return "-"


def line(label, name, extra=""):
    d = D(label, name)
    if d is None:
        return f"| `{name}` | **MISSING** |"
    h = d.get("historyOnOpen") or []
    st = d.get("settled") or {}
    first = d.get("first") or {}
    out = [f"`{' '.join(rd(x) for x in h)}` = **{sum(x['rows'] for x in h if isinstance(x.get('rows'), int))}**"]
    p2 = d.get("pass2") or {}
    if p2.get("reads"):
        out.append("pass 2: `" + " ".join(rd(x) for x in p2["reads"]) + "` = **"
                   + str(sum(x["rows"] for x in p2["reads"] if isinstance(x.get("rows"), int))) + "**")
    firstf = f"first frame {first.get('rows')} rows/{first.get('standIns')} stand-ins/{first.get('blank')} blank"
    out.append(f"settled {st.get('rows')} rows/{st.get('standIns')} stand-ins/{st.get('blank')} blank")
    if d.get("probe"):
        out.append(f"{E} {probe_of(d,E)}; {U} {probe_of(d,U)}")
    return "| `%s` | %s |" % (name, " · ".join(out) + extra)


print("### R18 A/B (head dd589d577 vs prev 486351dbd)\n")
for n in ("r7-second-pass", "r7-reattach", "r7-both-ways-end", "r7-both-ways-verdict", "r7-both-ways-start"):
    print(f"**{n}**")
    for L in ("head", "prev"):
        d = D(L, n)
        h = d.get("historyOnOpen") or []
        st = d.get("settled") or {}
        p2 = (d.get("pass2") or {}).get("reads") or []
        tot = sum(x["rows"] for x in h if isinstance(x.get("rows"), int))
        tot2 = sum(x["rows"] for x in p2 if isinstance(x.get("rows"), int))
        print(f"- `{L}`: pass 1 `{' '.join(rd(x) for x in h)}` = {tot}"
              + (f" | pass 2 `{' '.join(rd(x) for x in p2)}` = {tot2}" if p2 else "")
              + f" | settled {st.get('rows')}/{st.get('standIns')}/{st.get('blank')}"
              + f" | {E}={probe_of(d,E)} {U}={probe_of(d,U)}"
              + (f" | streams {d['pass2'].get('streamsBefore')}->{d['pass2'].get('streamsAfter')}" if d.get("pass2") else ""))
    print()

print("\n### Pinned sweep (head dd589d577)\n")
for n in ("r6-noclock-settled", "r6b-notrun-unpresent", "r5-lone-pending", "r6a-boundary104",
          "r5-labels-stray-pending", "f-noargs", "stray-oldest", "d-hang", "c2-short-running",
          "b-finished", "a-labels", "a-counts"):
    print(line("head", n))
sl = D("head", "switch-loop-r7")
frames = sl.get("switchLoopFrames") or []
empty = sum(f["k"].split(",")[2:4] != ["0", "0"] and 0 or 0 for f in frames)
print("| `switch-loop-r7` | sampled frames: " + ", ".join(f"{f['k']}x{f['frames']}" for f in frames[:6])
      + f" ... ({len(frames)} runs, {sum(f['frames'] for f in frames)} frames) · reads during cycles {sl['switchLoop']['readsDuringCycles']}"
      + f" · settled {sl['switchLoopSettled']['rows']}/{sl['switchLoopSettled']['standIns']}/{sl['switchLoopSettled']['blank']} |")
mr = D("head", "merge-render")
pre, post = mr["mergeRender"]["pre"], mr["mergeRender"]["post"]
print(f"| `merge-render` | `{' '.join(rd(x) for x in mr['historyOnOpen'])}` = {sum(x['rows'] for x in mr['historyOnOpen'])} · "
      f"edit row collapsed aria-expanded={pre['expanded']} h={pre['h']} text={pre['text'][:40]!r} · working line {pre['working']} {pre['workingText']!r} · "
      f"after a real click expanded={post['expanded']} h={post['h']} +lines={post['plusLines']} -lines={post['minusLines']} |")
