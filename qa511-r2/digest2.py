#!/usr/bin/env python3
"""QA round 2, PR 511: read the rig's run JSONs and print the numbers the matrix quotes.

    digest2.py <out-dir> [label-scen ...]

Prints one compact block per run: the open's own cost, the per-row settle reading, the
phase table for rows 1c/3c, and the scenario's own arm (switch loop, hung read, edit row,
aside). Every number is read from the run file the rig wrote - nothing is recomputed.
"""
import json
import os
import sys


def read_cost(reads):
    return {"requests": len(reads), "rows": sum(r.get("rows") or 0 for r in reads)}


def show(path):
    d = json.load(open(path))
    name = f"{d.get('label')}-{d.get('scen')}"
    print(f"\n=== {name} ===  tree={os.path.basename(d.get('tree') or '')}")
    if d.get("error"):
        print("  ERROR:", d["error"][:400])
    reads = d.get("historyAll") or []
    print(f"  requests total: {len(reads)} (rows {sum(r.get('rows') or 0 for r in reads)})")
    push = next((e for e in (d.get("events") or []) if e.get("what") == "settle-pushed"), None)
    if push:
        naming = next((h for h in reads if h.get("has_target")), None)
        print(f"  settle pushed at t={push.get('t')}ms; first page that NAMED the call: "
              f"at t={naming.get('at') if naming else None}ms, answered t={naming.get('answeredAt') if naming else None}ms "
              f"({(naming.get('answeredAt') - push.get('t')) if naming and naming.get('answeredAt') is not None else None}ms after the push)")
    first = d.get("first")
    if first:
        print(f"  first paint: {first.get('rows')} rows, standIns={first.get('standIns')} blank={first.get('blank')} at t={first.get('t')}ms")
    settled = d.get("settledOpen")
    if settled:
        print(f"  settled open: rows={settled.get('rows')} standIns={settled.get('standIns')} blank={settled.get('blank')}")
    oreads = d.get("openReads")
    if oreads is not None:
        rc = read_cost(d.get("openReads") or [])
        print(f"  open reads: {rc['requests']} requests / {rc['rows']} rows  {[(r.get('limit'), r.get('rows'), r.get('before')) for r in (d.get('openReads') or [])]}")
    if d.get("settleResults"):
        for r in d["settleResults"]:
            print(f"  settle {str(r.get('id'))[-10:]} labelled={r.get('labelled')} mounted={r.get('mountedAtPush')} readsAdded={[(x['limit'], x['rows'], x.get('has_target')) for x in (r.get('readsAdded') or [])]} row={str(r.get('row', {}).get('summary'))[:60]!r}")
    if d.get("latency"):
        lat = d["latency"]
        lat = lat if isinstance(lat, list) else [lat]
        for l in lat:
            print(f"  latency: msToStandIn={l.get('msToStandIn')} msToLabelled={l.get('msToLabelled')} frames={l.get('framesSampled')}")
    if d.get("phases"):
        for p in d["phases"]:
            print(f"  phase {p['phase']:<7} requests={p['requests']} rowsSpent={p['rowsSpent']} "
                  f"pages={[(r.get('limit'), r.get('rows'), r.get('before'), r.get('has_target')) for r in p['reads']]}")
            rw = p['row']
            print(f"          row: mounted={rw.get('mounted')} labelled={rw.get('labelled')} "
                  f"standIn={rw.get('standIn')} blank={rw.get('blank')} name={rw.get('name')!r} summary={str(rw.get('summary'))[:60]!r}")
    if d.get("settleFrames"):
        print(f"  frame runs (state per sampled frame): {[(f['k'], f['frames'], f.get('from'), f.get('to')) for f in d['settleFrames']][:12]}")
    if d.get("standInsAfter"):
        print(f"  stand-ins after: {[s['id'] for s in d['standInsAfter']][:6]}")
    if d.get("standInRows"):
        print(f"  stand-in rows: {len(d['standInRows'])} {d['standInRows'][:4]}")
    if d.get("switchLoop"):
        print(f"  switch loop: readsDuringCycles={d['switchLoop']['readsDuringCycles']}")
        for c in d["switchLoop"]["cycles"]:
            print(f"    cycle {c['i']}: onOther={c['onOther']} backOnA={c['backOnA']}")
        print(f"  switch frames: {[(f['k'], f['frames']) for f in (d.get('switchLoopFrames') or [])][:8]}")
    if d.get("editRow") is not None:
        print(f"  edit row: {d['editRow']}")
        print(f"  edit expanded: {d.get('editRowExpanded')}")
    if d.get("postScroll"):
        print(f"  post-scroll: readsFromScroll={d['postScroll']['readsFromScroll'] and [(x['limit'], x['rows']) for x in d['postScroll']['readsFromScroll']]}")
    if d.get("aside"):
        a = d["aside"]
        print(f"  aside: transcriptBefore={a.get('transcript')}")
        print(f"  aside: beforeBareBtw={a.get('beforeBareBtw')}")
        print(f"  aside: afterBareBtw={a.get('afterBareBtw')}")
        print(f"  aside: ask={a.get('ask')}")
        print(f"  aside: midAsk={a.get('midAsk')}")
        print(f"  aside: afterAsk={a.get('afterAsk')}")
        print(f"  aside: readsDuringAside={a.get('readsDuringAside')} posts={a.get('posts')}")
        print(f"  aside: transcriptAfter={a.get('transcriptAfterAside')}")
    if d.get("readsAfterSettle") is not None:
        print(f"  reads after settle: {d['readsAfterSettle']}")


if __name__ == "__main__":
    out = sys.argv[1]
    names = sys.argv[2:] or sorted(f for f in os.listdir(out) if f.endswith(".json"))
    for n in names:
        p = os.path.join(out, n if n.endswith(".json") else f"{n}.json")
        if os.path.exists(p):
            show(p)
        else:
            print(f"\n=== {n} === MISSING")
