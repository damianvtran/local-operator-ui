"""Measure how many journal entries a seed's unlabelled calls span (read-only).

For every real transcript under ~/.local-operator/sessions, replay the moment a
viewer joins at many journal lengths: seed = last 100 calls of the current turn,
page = last 100 entries, missing = seed calls older than the page. The needed
tail read is the distance from the journal's end back to the oldest missing
call's assistant row; k = (needed - 100) / missing is the ratio the client's
`reconcileLimit` must use to finish in one request.
"""
import glob, json, math, os, statistics

base = os.path.expanduser("~/.local-operator/sessions")
files = sorted(glob.glob(f"{base}/*/transcript.jsonl"), key=os.path.getmtime, reverse=True)[:2000]


def load(p):
    out = []
    with open(p) as f:
        for line in f:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def calls_of(r):
    pl = r.get("payload") or {}
    return [c.get("id") for c in (pl.get("tool_calls") or []) if isinstance(c, dict)]


samples, sessions, whole = [], set(), []
for p in files:
    rows = load(p)
    n = sum(len(calls_of(r)) for r in rows)
    if n >= 30:
        whole.append(len(rows) / n)
    if len(rows) < 150:
        continue
    for tail in range(150, len(rows) + 1, 40):
        view = rows[:tail]
        start = 0
        for i in range(len(view) - 1, -1, -1):
            pl = view[i].get("payload") or {}
            if view[i].get("type") == "message" and pl.get("role") == "user":
                start = i
                break
        callpos = [i for i in range(start, len(view)) for _ in calls_of(view[i])]
        seed = callpos[-100:]
        page_start = max(0, len(view) - 100)
        missing = [i for i in seed if i < page_start]
        if len(missing) < 10:
            continue
        samples.append((len(view) - min(missing), len(missing)))
        sessions.add(p)

ks = [(d - 100) / m for d, m in samples]
q = statistics.quantiles(ks, n=100)
print("samples", len(samples), "sessions", len(sessions))
print("k", {f"p{i}": round(q[i - 1], 2) for i in (10, 25, 50, 75, 90, 95, 99)}, "max", round(max(ks), 2))
for k in (2, 2.5, 3, 3.25, 3.5, 4):
    lim = lambda m: min(500, 100 + math.ceil(k * m))
    one = sum(1 for d, m in samples if lim(m) >= d) / len(samples)
    print(f"k={k}: one-request {one:.1%} mean-limit {round(statistics.mean(lim(m) for d, m in samples))}")
print("needs >500 entries:", f"{sum(1 for d, m in samples if d > 500) / len(samples):.2%}")
print("missing median", statistics.median(m for d, m in samples), "max", max(m for d, m in samples))
q2 = statistics.quantiles(whole, n=100)
print("whole-journal entries/call", len(whole), {f"p{i}": round(q2[i - 1], 2) for i in (10, 50, 90, 95)})
