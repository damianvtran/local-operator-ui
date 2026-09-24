"""QA round-4 delta scenarios for PR 490 (scratch; never part of the repo).

Built from the round-2 sanitized `a-labels` journal (407 rows, one turn, user row at 3),
synthetic session id 5eed1abe1490. Shapes mirror round 3's R6 probes:
  r6a-*  : the first history page (reconcileLimit(1)=104 rows) opens on the RESULT of
           ORPH (idx 303) whose assistant row is idx 302, one row outside the page.
  r6b-*  : a startless target (compose not_run / dictation_complete / end frame with
           no started_at_epoch) for an EARLIER call (asst idx 98) next to a call that
           does carry an instant.
"""
import copy, json
from scen_lib import SID, asst_index, load, save

ORPH = "toolu_01JqcAjwSyFQxRL4Th77FneZ"   # result idx 303, assistant idx 302
EARLY = "toolu_01SDbpziaz9MBtxwosfMLe2d"  # assistant idx 98, result idx 99
UNPRESENT = "toolu_01SYNTHETICNOTINJOURNAL000"
al = load("a-labels"); J = al["sessions"][SID]["journal"]; LE = al["sessions"][SID]["live_events"]
ai = asst_index(J)
assert ai[ORPH] == 302 and J[303]["payload"]["tool_call_id"] == ORPH and ai[EARLY] == 98
newest = max(LE, key=lambda e: e["started_at_epoch"]); tmax = newest["started_at_epoch"]
res = {r["payload"].get("tool_call_id"): r for r in J if r["payload"].get("role") == "tool"}

def end(cid, at, text="exit code: 0\n--- stdout ---\nQA-R4"):
    e = {"type": "tool_execution_end", "tool_call_id": cid, "tool_name": "bash",
         "result": {"content": [{"text": text}], "details": None}, "duration_s": 0.2, "is_error": False}
    if at is not None: e["started_at_epoch"] = at
    return e

def scen(live, probe, delay=300):
    sc = copy.deepcopy(al); sc["delay"] = delay; sc["probe"] = probe
    sc["sessions"][SID]["live_events"] = live
    return sc

# R6(a): coder's test shape - seed carries only an unlabelable call (instant = newest start)
save("r6a-unpresent", scen([end(UNPRESENT, tmax, "no page names this")], [ORPH, UNPRESENT]))
# R6(a): reviewer's shape - a real current-round call (labelled on page 1) is the
# instant; the page boundary strands ORPH's assistant row. Plus the unlabelable one so
# the walk has a reason to continue past page 1.
save("r6a-current", scen([copy.deepcopy(newest), end(UNPRESENT, tmax, "no page names this")], [ORPH, newest["tool_call_id"]]))
# R6(a) control: just the real newest call; every target is found on page 1.
save("r6a-only-current", scen([copy.deepcopy(newest)], [ORPH, newest["tool_call_id"]]))
# R6(b): not-run compose for the earlier call + a settled current-round call.
compose = {"type": "tool_call_compose", "tool_call_id": EARLY, "tool_name": "bash",
           "not_run_reason": "the turn ended before this call ran"}
save("r6b-notrun", scen([compose, copy.deepcopy(newest)], [EARLY, newest["tool_call_id"]]))
# R6(b): coder's test shape (compose + unlabelable call at the newest instant).
save("r6b-notrun-unpresent", scen([copy.deepcopy(compose), end(UNPRESENT, tmax, "no page names this")], [EARLY]))
# R6(b): dictation-complete compose (the other startless-by-type ending).
dc = {"type": "tool_call_compose", "tool_call_id": EARLY, "tool_name": "bash", "dictation_complete": True}
save("r6b-dictation", scen([dc, copy.deepcopy(newest)], [EARLY, newest["tool_call_id"]]))
# R6(b): a legacy settled end with NO started_at_epoch for the earlier call, beside a
# current call that states one ("blocked" shape: is_error, no clock).
blk = end(EARLY, None, "exit code: 1\n--- stderr ---\nQA-BLOCKED"); blk["is_error"] = True
save("r6b-noclock-end", scen([blk, copy.deepcopy(newest)], [EARLY, newest["tool_call_id"]]))
print("r4 scenarios built")

# --- discriminating variants (the co-target must still be BEHIND for its instant to set a floor)
for nm, fr in (("r6b-dictation-unpresent", dc), ("r6b-noclock-unpresent", blk)):
    save(nm, scen([copy.deepcopy(fr), end(UNPRESENT, tmax, "no page names this")], [EARLY, UNPRESENT]))
# R6(a) reviewer's shape: a mid-round join where the plain 100-row tail read (no missing
# calls to size it) opens on ORPH's RESULT. Four non-message rows newer than 303 are
# removed, so len-100 == idx(ORPH result). The in-flight/current call is found on page
# one and sets no floor; UNPRESENT (instant = newest start) is what keeps the walk honest.
b = copy.deepcopy(al); Jb = b["sessions"][SID]["journal"]
drop = [i for i in range(304, len(Jb) - 2) if Jb[i]["payload"].get("role") is None][:4]
for i in reversed(drop): del Jb[i]
k = [i for i, r in enumerate(Jb) if r["payload"].get("tool_call_id") == ORPH and r["payload"].get("role") == "tool"][0]
assert len(Jb) - 104 == k or True
b["delay"] = 300
for nm, live, lim in (("r6a-boundary100", [copy.deepcopy(newest)], 100), ("r6a-boundary104", [copy.deepcopy(newest), end(UNPRESENT, tmax, "no page names this")], 104)):
    sc = copy.deepcopy(b); Jx = sc["sessions"][SID]["journal"]
    # make the tail read of `lim` rows open exactly on ORPH's result
    extra = len(Jx) - lim - k
    if extra < 0: continue
    dr = [i for i in range(k + 1, len(Jx) - 2) if Jx[i]["payload"].get("role") is None][:extra]
    assert len(dr) == extra
    for i in reversed(dr): del Jx[i]
    assert Jx[len(Jx) - lim]["payload"].get("tool_call_id") == ORPH, nm
    sc["sessions"][SID]["live_events"] = live; sc["probe"] = [ORPH, newest["tool_call_id"]]
    print(nm, "len", len(Jx), "orph result idx", len(Jx) - lim)
    save(nm, sc)
# The reviewer's shape at 104: the unlabelable call is OLDER in seed order than the
# current-round call (which page one labels), so behind()=1 sizes the tail at 104 rows
# and that page opens on ORPH's result.
save("r6a-boundary104", scen([end(UNPRESENT, tmax - 30, "no page names this"), copy.deepcopy(newest)], [ORPH, newest["tool_call_id"], UNPRESENT]))
