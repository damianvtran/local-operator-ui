"""Read one rig record and print the facts round 2 is about, compactly.

Nothing here is a judgement: it reports the object column's state changes over
time (blank -> stand-in -> label), which rows changed at which sample, the
arrival histogram that answers "en masse or per row", and the geometry at the
frames either side of a transition (reflow or not).
"""

import json
import sys
from collections import Counter


def load(path):
    with open(path) as fh:
        return json.load(fh)


def transitions(timeline):
    """Every sample where blank/standIns differs from the previous one."""
    out = []
    prev = None
    for s in timeline:
        cur = (s["blank"], s["standIns"], s["rows"])
        if cur != prev:
            out.append({"t": s["t"], "blank": s["blank"], "standIns": s["standIns"], "rows": s["rows"]})
            prev = cur
    return out


def geometry_at(record):
    """(blank, standIns) -> the geometry that sample carried, for the frames."""
    out = []
    for s in record["timeline"]:
        g = s.get("geom")
        if not g:
            continue
        out.append(
            {
                "t": s["t"],
                "blank": s["blank"],
                "standIns": s["standIns"],
                "st": g["st"],
                "sh": g["sh"],
                "n": len(g["rows"]),
                "tops": [r["top"] for r in g["rows"]][:6],
                "heights": sorted({r["h"] for r in g["rows"]}),
                "sumW": sorted({r["sumW"] for r in g["rows"]}),
            }
        )
    return out


def row_life(record):
    """Per row: the classes it passed through and when, in order."""
    life = []
    for row in record.get("trace", []):
        life.append(
            {
                "id": row["id"].replace("tool:", "")[:14],
                "first": row["first"],
                "firstT": row["firstT"],
                "last": row["lastCls"],
                "lastT": row["lastT"],
                "changes": row["changes"],
                "text": row["text"][:26],
            }
        )
    return life


def main(path):
    r = load(path)
    print(f"# {path}")
    print(f"label={r['label']} scene={r.get('scene', 'open')} mode={r['windowMode']!r}")
    print(f"history={[[h['at'], h['limit'], 'before' if h['beforeId'] else 'tail', h.get('rows'), h.get('answeredAt'), h.get('failed', False)] for h in r['history']]}")
    print(f"unknownRoutes={len(r['unknownRoutes'])} {r['unknownRoutes'][:3]}")
    tl = r["timeline"]
    print(f"timeline: {len(tl)} samples over {tl[-1]['t']} ms; interval "
          f"{round(sum(b['t'] - a['t'] for a, b in zip(tl, tl[1:])) / max(1, len(tl) - 1))} ms (mean)")
    print(f"first frame: {r['frames'][0]['name']} t={r['frames'][0]['t']} blank={r['frames'][0]['blank']} standIns={r['frames'][0]['standIns']} rows={r['frames'][0]['rows']}")
    print("state transitions (blank, standIns, rows):")
    for t in transitions(tl):
        print(f"   t={t['t']:>6}  blank={t['blank']:>3} standIns={t['standIns']:>3} rows={t['rows']:>3}")
    print("arrival buckets (first time a row entered the class, 50 ms bins):")
    for cls in ("standin", "label"):
        buckets = r["arrival"][cls]
        items = sorted((int(k), v) for k, v in buckets.items())
        print(f"   {cls:>7}: {items}")
        if items:
            print(f"            {sum(v for _, v in items)} rows across {len(items)} bin(s); "
                  f"span {items[0][0]}..{items[-1][0]} ms")
    life = row_life(r)
    print(f"rows traced: {len(life)}; class paths: {Counter((x['first'], x['last']) for x in life)}")
    print(f"changes per row: {Counter(x['changes'] for x in life)}")
    print("per-row detail (rows that changed more than once, plus any stand-in row):")
    for x in sorted(life, key=lambda y: y["firstT"]):
        if x["changes"] > 1 or x["first"] == "standin" or x["last"] == "standin":
            print(f"   {x['id']} {x['first']}@{x['firstT']} -> {x['last']}@{x['lastT']} "
                  f"changes={x['changes']} {x['text']!r}")
    geo = geometry_at(r)
    if geo:
        first, last = geo[0], geo[-1]
        print("geometry: first sampled", {k: first[k] for k in ("t", "blank", "standIns", "st", "sh", "n", "sumW", "heights")})
        print("geometry: last  sampled", {k: last[k] for k in ("t", "blank", "standIns", "st", "sh", "n", "sumW", "heights")})
        tops = [(g["t"], g["blank"], g["standIns"], g["tops"][0] if g["tops"] else None, g["sh"], g["st"]) for g in geo]
        uniq = Counter((x[3], x[4], x[5]) for x in tops)
        print(f"distinct (first row top, scrollHeight, scrollTop) across {len(tops)} geometry samples: {dict(uniq)}")
    if r.get("shots"):
        for s in r["shots"]:
            print(f"shot {s['shot']}: sampled t={s['t']} blank={s['blank']} standIns={s['standIns']} rows={s['rows']}")
    if r.get("switchback"):
        sb = r["switchback"]
        print(f"switchback: away rows={sb['away']}")
        print(f"switchback first paint: {sb['firstPaint']}")
        back = sb["back"]
        print(f"switchback back: {len(back)} samples; blankSamples={sb['blankSamples']}; "
              f"states={Counter((s['rows'], s['blank'], s['standIns']) for s in back).most_common(8)}")
        print(f"switchback settled-vs-returned differences: {len(sb['differences'])}")
        for d in sb["differences"][:10]:
            print(f"   {d['id']} was={d['was']!r} now={d['now']!r}")
    err = r.get("error")
    if err:
        print(f"ERROR: {err[:400]}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        main(p)
        print()
