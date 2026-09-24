"""QA round-3 scenario helpers for PR 490 (scratch; never part of the repo)."""
import copy, json, os

S = os.environ["LOCAL_OPERATOR_SCRATCHPAD"] + "/r4"
SC = f"{S}/scen3"
os.makedirs(SC, exist_ok=True)
SID = "5eed1abe1490"  # synthetic session id; the sanitized scenarios carry "<session>"


def load(n):
    sc = json.load(open(f"{S}/scen/{n}.json"))
    if "<session>" in sc["sessions"]:
        sc["sessions"][SID] = sc["sessions"].pop("<session>")
    if sc.get("open") == "<session>":
        sc["open"] = SID
    return sc


def save(name, sc):
    json.dump(sc, open(f"{SC}/{name}.json", "w"))
    return name


def asst_index(j):
    idx = {}
    for i, r in enumerate(j):
        for c in r["payload"].get("tool_calls") or []:
            idx[c["id"]] = i
    return idx
