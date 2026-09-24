"""QA round-6 delta scenarios for PR 490 (scratch; never part of the repo).

R16's shape: a call that FINISHED whose `tool_execution_end` frame carries no
`started_at_epoch` (a producer older than v0.57.0, or a viewer that joined after
the call started). Round 5's narrow veto let only a compose with a `not_run_reason`
refuse the floor, so this shape was skipped and its row kept the output stand-in;
round 6's fix refuses the floor for every startless call EXCEPT one still waiting at
a gate (`seedWaitingComposes`). Built from the round-2 sanitized `a-labels` journal
(407 rows, one turn) with the synthetic session id.

  EARLY     = toolu_01SDbpziaz9MBtxwosfMLe2d  assistant idx 98, result idx 99
  UNPRESENT = a clocked call no page names (keeps the walk honest)
  PENDING   = a compose still waiting at a gate (dictation_complete, no not_run_reason)
"""
import copy
from scen_lib import SID, load, save

EARLY = "toolu_01SDbpziaz9MBtxwosfMLe2d"
UNPRESENT = "toolu_01SYNTHETICNOTINJOURNAL000"
PENDING = "toolu_01PENDINGGATECALLNOTRUNYET"
al = load("a-labels")
LE = al["sessions"][SID]["live_events"]
tmax = max(e["started_at_epoch"] for e in LE)
pending = {"type": "tool_call_compose", "tool_call_id": PENDING, "tool_name": "bash",
           "dictation_complete": True}

def end(cid, at, text, is_error):
    e = {"type": "tool_execution_end", "tool_call_id": cid, "tool_name": "bash",
         "result": {"content": [{"text": text}], "details": None}, "duration_s": 0.2,
         "is_error": is_error}
    if at is not None:
        e["started_at_epoch"] = at
    return e

def scen(live, probe):
    sc = copy.deepcopy(al)
    sc["delay"] = 300
    sc["sessions"][SID]["live_events"] = live
    sc["probe"] = probe
    return sc

# R16: the finished call's end states no clock, beside a clocked call no page names.
save("r6-noclock-settled", scen(
    [end(EARLY, None, "exit code: 0\n--- stdout ---\nQA-R6-FINISHED", False),
     end(UNPRESENT, tmax, "no page names this", False)],
    [EARLY, UNPRESENT]))
# The same shape with a gate-waiting compose present: the exemption must not swallow
# the refusal the other startless target makes.
save("r6-noclock-settled-pending", scen(
    [end(EARLY, None, "exit code: 0\n--- stdout ---\nQA-R6-FINISHED", False),
     end(UNPRESENT, tmax, "no page names this", False),
     copy.deepcopy(pending)],
    [EARLY, UNPRESENT, PENDING]))
# The blocked variant (round 5's discriminating shape) with the gate compose present.
save("r6-noclock-blocked-pending", scen(
    [end(EARLY, None, "exit code: 1\n--- stderr ---\nQA-BLOCKED", True),
     end(UNPRESENT, tmax, "no page names this", False),
     copy.deepcopy(pending)],
    [EARLY, UNPRESENT, PENDING]))
print("r6 scenarios built")
