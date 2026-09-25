"""QA r1 PR 511 — digest every run into the numbers the matrix quotes.
Reads only; prints one block per scenario so a re-run is comparable line for line.
"""
import json, os, sys

S = os.environ["LOCAL_OPERATOR_SCRATCHPAD"] + "/qa511r1"
SCEN = {
    "r1-live-settle": "row 1 (clocked settle)",
    "r1b-live-settle-noclock": "row 1 (clockless settle)",
    "r2-long-turn": "row 2 (two settles in a row)",
    "r3-cost": "row 3 (six settles)",
    "r3b-open-nothing-to-label": "row 3 (open, nothing to label)",
    "r4a-open-midturn": "row 4 (open mid-turn)",
    "r4b-switch-loop": "row 4 (switch x6)",
    "r4c-hung": "row 4 (hung read)",
    "r4d-finished": "row 4 (finished conversation)",
    "r4e-noargs": "row 4 (no arguments anywhere)",
    "r4f-edit": "row 4 (edit row)",
    "r5-adjacency": "row 5 (roster adjacency)",
}


def load(label, scen):
    p = f"{S}/out/{label}-{scen}.json"
    return json.load(open(p)) if os.path.exists(p) else None


def fmt_reads(d):
    return [(h["at"], h["limit"], "before" if h["beforeId"] else "tail", h.get("rows_from"), h.get("rows_to"),
             len(h.get("has_target") or []), h.get("answeredAt")) for h in d.get("historyAll", [])]


def block(label, scen):
    d = load(label, scen)
    if not d:
        print(f"--- {label} {scen}: (no run)")
        return
    print(f"--- {label:4s} {scen}  [{SCEN.get(scen,'')}]  err={(d.get('error') or 'none')[:90]}")
    f = d.get("first") or {}
    so = d.get("settledOpen") or {}
    print(f"    open: reads={d.get('readsAtOpen')} first(t={f.get('t')} rows={f.get('rows')} standIns={f.get('standIns')} blank={f.get('blank')})"
          f" settled(rows={so.get('rows')} standIns={so.get('standIns')} blank={so.get('blank')})")
    for r in d.get("settleResults") or []:
        row = r.get("row") or {}
        print(f"    settle {r['id'][-14:]}: reads={r.get('readsWhileLabelPending')} dom(mounted={row.get('mounted')} "
              f"labelled={row.get('labelled')} standIn={row.get('standIn')} summary={(row.get('summary') or '')[:60]!r})")
    if d.get("latency"):
        print("    latency:", [(x["id"][-10:], x.get("msToStandIn"), x.get("msToLabelled")) for x in d["latency"]])
    print("    reads:", fmt_reads(d))
    if d.get("settleFrames"):
        print("    target frame-runs:", json.dumps(d["settleFrames"])[:240])
    if d.get("openFrames"):
        print("    open frame-runs:", json.dumps(d["openFrames"])[:240])
    if d.get("switchLoop"):
        cy = d["switchLoop"]["cycles"]
        print(f"    switch cycles: {len(cy)} | blank/standIn per return: "
              + ", ".join(f"{c['backOnA'].get('blank')}/{c['backOnA'].get('standIns')}" for c in cy)
              + f" | readsDuringCycles={d['switchLoop']['readsDuringCycles']}")
        print("    switch frames:", json.dumps(d.get("switchLoopFrames"))[:190])
    if d.get("openTimeline") and scen == "r4c-hung":
        tl = d["openTimeline"]
        fall = next((s["t"] for s in tl if s["blank"] == 0 and s["standIns"] > 0), None)
        print(f"    hung: first sample t={tl[0]['t'] if tl else None} | fallback-to-stand-ins t={fall} | samples={len(tl)} | reads={fmt_reads(d)}")
    if scen == "r4d-finished":
        print("    standIn rows:", (so.get("standInRows") or [])[:3])
    if d.get("postScroll"):
        ps = d["postScroll"]
        print(f"    post-scroll: reads={len(ps.get('readsFromScroll') or [])} rows="
              + json.dumps([{k: r.get(k) for k in ("id", "mounted", "labelled", "standIn")} for r in (ps.get("rows") or [])])[:200])
    if d.get("standInsAfterSettle"):
        print("    stand-ins after settle:", json.dumps(d["standInsAfterSettle"])[:190])
    if d.get("editRow"):
        print(f"    edit row: {json.dumps(d['editRow'])[:190]}")
        print(f"    edit expanded: {json.dumps(d.get('editRowExpanded'))[:190]}")


if __name__ == "__main__":
    only = sys.argv[1:] or None
    for scen in SCEN:
        if only and scen not in only:
            continue
        for label in ("head", "prev"):
            block(label, scen)
        print()
