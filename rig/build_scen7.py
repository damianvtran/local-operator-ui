"""QA round-7 delta scenarios for PR 490 (scratch; never part of the repo).

R18's shape: the waiting set is per conversation and OUTLIVES the seed that filled
it, so a call an EARLIER seed announced as still waiting at a gate stayed exempt
from the start-instant floor forever. The fix (`seedSettledCalls` + the delete loop
in the seeding block) retracts the exemption when a seed names the call as started,
settled, or a stated verdict - and the delete comes AFTER the add, so one seed
naming a call both ways ends up exempt from nothing.

The measurement is the R16 discriminator, unchanged: EARLY
(`toolu_01SDbpziaz9MBtxwosfMLe2d`, assistant idx 98 / result idx 99) settles with a
frame that carries NO clock, so it is a startless label target; UNPRESENT is a
clocked call no page names, which keeps the walk honest. A stale exemption lets the
floor pass and the walk stops one page short, leaving EARLY unlabelled.

  pass 1 (a previous pass) : a compose for EARLY still waiting at a gate
                             (dictation_complete, no not_run_reason) - the ONLY
                             thing that can put EARLY in the waiting set, and it
                             paints nothing, so pass 1 asks for no label read.
  pass 2 (this pass)       : the same call, now settled with no clock.
  both ways (one seed)     : the compose AND the settling frame in the same seed.

`pass2.live_events` is a RIG key (round 7): the rig serves pass 1, then (switch or
re-attach) serves pass 2 from this key. Nothing else in the harness reads it.
"""
import copy
from scen_lib import SID, load, save

EARLY = "toolu_01SDbpziaz9MBtxwosfMLe2d"       # asst idx 98, result idx 99 (a-labels)
UNPRESENT = "toolu_01SYNTHETICNOTINJOURNAL000"  # clocked call no page names

waiting = {"type": "tool_call_compose", "tool_call_id": EARLY, "tool_name": "bash",
           "dictation_complete": True}
verdict = {"type": "tool_call_compose", "tool_call_id": EARLY, "tool_name": "bash",
           "not_run_reason": "the turn ended before this call ran"}


def end(cid, at, text, is_error=False):
    """The end frame; `at=None` is the clockless shape a pre-v0.57.0 producer or a
    late-joining viewer sends - the frame R16 is about."""
    e = {"type": "tool_execution_end", "tool_call_id": cid, "tool_name": "bash",
         "result": {"content": [{"text": text}], "details": None}, "duration_s": 0.2,
         "is_error": is_error}
    if at is not None:
        e["started_at_epoch"] = at
    return e


al = load("a-labels")
sw = load("e3-return")          # the same conversation plus the switch partner
tmax = max(e["started_at_epoch"] for e in al["sessions"][SID]["live_events"])

# ---------------------------------------------------------------------------
# R18 shape 1: a SECOND PASS. The first seed announces EARLY as waiting at a gate
# AND carries the clocked unlabelable call (the `r6b-dictation-unpresent` shape,
# which paints nothing and stops one page short, so EARLY is left MISSING its
# label rather than labelled); the next pass's seed shows EARLY settled with no
# clock (the `r6-noclock-settled` shape). Everything is identical on both heads
# except the retraction, so the delta IS the retraction.
# ---------------------------------------------------------------------------
pass1 = [copy.deepcopy(waiting), end(UNPRESENT, tmax, "no page names this")]
pass2 = [end(EARLY, None, "exit code: 0\n--- stdout ---\nQA-R7-SECOND-PASS"),
         end(UNPRESENT, tmax, "no page names this")]

for name, base in (("r7-second-pass", "e3-return"), ("r7-reattach", "e3-return")):
    sc = copy.deepcopy(sw if base == "e3-return" else al)
    sc["delay"] = 300
    sc["sessions"][SID]["live_events"] = copy.deepcopy(pass1)
    sc["probe"] = [EARLY, UNPRESENT]
    sc["pass2"] = {"live_events": copy.deepcopy(pass2)}
    save(name, sc)

# ---------------------------------------------------------------------------
# R18 shape 2: ONE SEED naming the same call BOTH ways. At the previous heads the
# add won and the call stayed exempt; the fix's delete runs after the add, so the
# call must end up exempt from nothing and the walk must read on and label it.
# ---------------------------------------------------------------------------
def both_ways(name, settling):
    sc = copy.deepcopy(al)
    sc["delay"] = 300
    sc["sessions"][SID]["live_events"] = [copy.deepcopy(waiting), settling,
                                          end(UNPRESENT, tmax, "no page names this")]
    sc["probe"] = [EARLY, UNPRESENT]
    return save(name, sc)

both_ways("r7-both-ways-end", end(EARLY, None, "exit code: 0\n--- stdout ---\nQA-R7-BOTH-WAYS"))
both_ways("r7-both-ways-verdict", copy.deepcopy(verdict))
both_ways("r7-both-ways-start", {"type": "tool_execution_start", "tool_call_id": EARLY,
                                 "tool_name": "bash", "args": {"command": "echo QA-R7-START"},
                                 "intent": "QA r7 start", "started_at_epoch": tmax - 30})

# ---------------------------------------------------------------------------
# The pinned shapes this round re-runs, materialised from the base journals (the
# round-6/5/4/3 builders write the rest into the same scen3 dir).
# ---------------------------------------------------------------------------
for name in ("a-labels", "a-counts", "b-finished", "d-hang", "f-noargs",
             "c2-short-running", "g-live"):
    save(name, load(name))
# switch away/back x6: the partner session plus the a-labels conversation; the rig
# block (`switch-loop*`) drives the six cycles itself.
sw2 = load("e3-return")
sw2["delay"] = 300
save("switch-loop-r7", sw2)
print("r7 scenarios built")
