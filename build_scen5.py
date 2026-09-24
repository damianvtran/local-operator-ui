"""QA round-5 delta scenarios for PR 490 (scratch; never part of the repo).

R11's three veto shapes, each with and without the pending (dictation_complete, no
not_run_reason) compose that R11 is about, on the round-2 sanitized journals and the
synthetic session id. PENDING is placed NEWEST in seed order, as in the coder's test.
"""
import copy
from scen_lib import SID, load, save

PENDING = "toolu_01PENDINGGATECALLNOTRUNYET"
UNPRESENT = "toolu_01SYNTHETICNOTINJOURNAL000"
ORPH107 = "toolu_014TGCtWm8PFXDecV1fpz9n8"  # result idx 300, assistant idx 299 (a-labels)
pending = {"type": "tool_call_compose", "tool_call_id": PENDING, "tool_name": "bash", "dictation_complete": True}

def stray(sc, name, with_pending):
    sc = copy.deepcopy(sc); le = sc["sessions"][SID]["live_events"]
    oldest = min(e["started_at_epoch"] for e in le)
    le.insert(0, {"type": "tool_execution_end", "tool_call_id": "toolu_QA_stray_oldest", "tool_name": "bash",
        "result": {"content": [{"text": "exit code: 0\n--- stdout ---\nQA-STRAY"}], "details": None},
        "duration_s": 0.01, "is_error": False, "started_at_epoch": oldest - 1})
    if with_pending: le.append(copy.deepcopy(pending))
    sc["delay"] = 300; sc["probe"] = ["toolu_QA_stray_oldest"] + ([PENDING] if with_pending else [])
    return save(name, sc)

al = load("a-labels"); ac = load("a-counts")
stray(al, "r5-labels-stray", False)
stray(al, "r5-labels-stray-pending", True)
stray(ac, "r5-counts-stray", False)
stray(ac, "r5-counts-stray-pending", True)

tmax = max(e["started_at_epoch"] for e in al["sessions"][SID]["live_events"])
def lone(name, with_pending):
    sc = copy.deepcopy(al); sc["delay"] = 300
    end = {"type": "tool_execution_end", "tool_call_id": UNPRESENT, "tool_name": "bash",
        "result": {"content": [{"text": "no page names this"}], "details": None}, "duration_s": 0.2,
        "is_error": False, "started_at_epoch": tmax}
    sc["sessions"][SID]["live_events"] = ([copy.deepcopy(pending)] if with_pending else []) + [end]
    sc["probe"] = [ORPH107, UNPRESENT] + ([PENDING] if with_pending else [])
    return save(name, sc)
lone("r5-lone", False)
lone("r5-lone-pending", True)
print("r5 scenarios built")

# Lone startless target for the EARLIER call (asst idx 98), nothing else in the seed:
# behind()=1 sizes the tail at 104 rows, which opens on ORPH's result (R6a), so the
# orphan's instant is the only floor candidate. Which startless kinds still refuse it?
EARLY = "toolu_01SDbpziaz9MBtxwosfMLe2d"
ORPH = "toolu_01JqcAjwSyFQxRL4Th77FneZ"
def lone_early(name, frame):
    sc = copy.deepcopy(al); sc["delay"] = 300
    sc["sessions"][SID]["live_events"] = [frame]; sc["probe"] = [EARLY, ORPH]
    return save(name, sc)
lone_early("r5-early-notrun", {"type": "tool_call_compose", "tool_call_id": EARLY, "tool_name": "bash",
    "not_run_reason": "the turn ended before this call ran"})
lone_early("r5-early-dictation", {"type": "tool_call_compose", "tool_call_id": EARLY, "tool_name": "bash", "dictation_complete": True})
lone_early("r5-early-noclock-end", {"type": "tool_execution_end", "tool_call_id": EARLY, "tool_name": "bash",
    "result": {"content": [{"text": "exit code: 1\n--- stderr ---\nQA-BLOCKED"}], "details": None},
    "duration_s": 0.2, "is_error": True})
lone_early("r5-early-noclock-end-ok", {"type": "tool_execution_end", "tool_call_id": EARLY, "tool_name": "bash",
    "result": {"content": [{"text": "exit code: 0\n--- stdout ---\nQA-LEGACY"}], "details": None},
    "duration_s": 0.2, "is_error": False})
print("r5 lone-early built")

# The only runtime that emits a clockless end (pre-3e1bb4cb8, 2026-09-17) emits NO end
# with a clock: EARLY's blocked end and the unlabelable call's end, both clockless.
def clockless_pair(name):
    sc = copy.deepcopy(al); sc["delay"] = 300
    sc["sessions"][SID]["live_events"] = [
        {"type": "tool_execution_end", "tool_call_id": EARLY, "tool_name": "bash",
         "result": {"content": [{"text": "exit code: 1\n--- stderr ---\nQA-BLOCKED"}], "details": None}, "duration_s": 0.2, "is_error": True},
        {"type": "tool_execution_end", "tool_call_id": UNPRESENT, "tool_name": "bash",
         "result": {"content": [{"text": "no page names this"}], "details": None}, "duration_s": 0.2, "is_error": False}]
    sc["probe"] = [EARLY, UNPRESENT]
    return save(name, sc)
clockless_pair("r5-oldruntime-noclock-pair")
print("r5 old-runtime built")
