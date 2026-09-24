"""Rebuild every QA round-3 scenario for PR 490 from the round-2 sanitized set.

Input: `scen/` from `evidence/qa490-r2-frames` (length-preserving sanitized
copies of the PR fixture). Output: `scen3/`. The session id is the synthetic
`5eed1abe1490`; nothing here comes from a live session.
"""
import copy, json
from scen_lib import SC, SID, asst_index, load, save

# Verbatim round-2 scenarios (only the session id key changes).
for n in ["f-noargs", "a-labels", "a-counts", "b-finished", "c-short", "c2-short-running", "d-hang",
          "e-switch", "g-live", "g2-roundend", "switch-loop", "hold-across-switch", "n1-refind",
          "n1-refind-noframe", "e4-return-running"]:
    save(n, load(n))

# Row 1a: the round-2 FAIL shape (one seeded call with no assistant row anywhere),
# with its start instant moved to the newest / median seed start / the journal's first row.
bf = load("f-noargs"); J = bf["sessions"][SID]["journal"]; LE = bf["sessions"][SID]["live_events"]
seed = sorted(e["started_at_epoch"] for e in LE if "phantom" not in e["tool_call_id"])
def phantom_at(start):
    sc = copy.deepcopy(bf)
    for e in sc["sessions"][SID]["live_events"]:
        if "phantom" in e["tool_call_id"]:
            e["started_at_epoch"] = start
    return sc
save("f-noargs-newest", phantom_at(seed[-1]))
save("f-noargs-median", phantom_at(seed[len(seed) // 2]))
save("f-noargs-first", phantom_at(J[0]["ts"]))

# Row 1b: the reviewer's stray-oldest shape: a-labels' real 100-call seed plus one
# stray unlabelable call placed OLDEST, its start 1 s before the oldest seed start.
al = load("a-labels"); oldest = min(e["started_at_epoch"] for e in al["sessions"][SID]["live_events"])
st = copy.deepcopy(al); st["delay"] = 300; st["probe"] = ["toolu_QA_stray_oldest"]
st["sessions"][SID]["live_events"].insert(0, {"type": "tool_execution_end", "tool_call_id": "toolu_QA_stray_oldest",
    "tool_name": "bash", "result": {"content": [{"text": "exit code: 0\n--- stdout ---\nQA-STRAY"}], "details": None},
    "duration_s": 0.01, "is_error": False, "started_at_epoch": oldest - 1})
save("stray-oldest", st)

# Row 1c: the tight floor. A call C deep in the journal is seeded with a start
# instant LATER than its own assistant row's ts by `lead` seconds (the adversarial
# direction: the row predates the start). `tight-*`: C at index 131, mid-page.
# `edge-*`: C at index 196 and the page boundary moved so the second page's OLDEST
# row sits 20 ms after C's row, i.e. the floor is tested on the exact page that holds it.
res = {r["payload"].get("tool_call_id"): r for r in J if r["payload"].get("role") == "tool"}
def seeded(sc, iC, lead):
    s = sc["sessions"][SID]; Jx = s["journal"]; le = s["live_events"]
    le[:] = [e for e in le if "phantom" not in e["tool_call_id"]]
    C = Jx[iC]["payload"]["tool_calls"][0]
    le.insert(0, {"type": "tool_execution_end", "tool_call_id": C["id"], "tool_name": "bash",
        "result": {"content": res[C["id"]]["payload"]["content"]}, "details": None, "duration_s": 0.1,
        "is_error": False, "started_at_epoch": Jx[iC]["ts"] + lead})
    sc["delay"] = 300; sc["probe"] = [C["id"]]
    return sc
for lead in (0.9, 1.37, 4.9, 5.5):
    save("tight-" + str(lead).replace(".", "p"), seeded(copy.deepcopy(bf), 131, lead))
for lead in (0.0, 0.9, 1.37, 4.9, 5.5):
    sc = copy.deepcopy(bf); Jx = sc["sessions"][SID]["journal"]; t = Jx[196]["ts"]
    Jx[197]["ts"] = t + 0.01; Jx[198]["ts"] = t + 0.02
    assert all(Jx[i]["ts"] <= Jx[i + 1]["ts"] for i in range(len(Jx) - 1))
    save("edge-" + str(lead).replace(".", "p"), seeded(sc, 196, lead))

# Row 2b: N1 on a TRIMMED paint. Every seeded result is ~29 KB, so the paint cache's
# 1 MiB per-conversation cap drops the older rows at the switch and the return
# re-derives them as missing (the reviewer's harness condition, reached in the app).
n = load("n1-refind-noframe"); s = n["sessions"][SID]; seedids = {e["tool_call_id"] for e in s["live_events"]}
big = lambda k: "exit code: 0\n--- stdout ---\n" + ("QA-BIG-%03d " % k) * 2600
k = 0
for r in s["journal"]:
    p = r["payload"]
    if p.get("role") == "tool" and p.get("tool_call_id") in seedids:
        p["content"] = [{"text": big(k)}]; k += 1
for i, e in enumerate(s["live_events"]):
    e["result"]["content"] = [{"text": big(i)}]
n["delay"] = 800
save("n1-refind-big", n)
nb = copy.deepcopy(n); nb["benign"] = True
save("n1-refind-big-benign", nb)

# Row 6: the merge render, on a-counts' shape (edit row with +91 -19 and a diff).
mr = load("a-counts"); mr["mergeRender"] = "tool:toolu_01U3Y21CrbaP1HVMGcKMapJu"; mr["delay"] = 300
save("merge-render", mr)
print("built into", SC)
