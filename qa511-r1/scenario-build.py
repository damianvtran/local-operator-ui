"""QA round 1, PR 511 (local-operator-ui): scenario builder (scratch; never in the repo).

Data: a COPY of the operator's conversation b747a2c8d3bb (`$SCRATCH/qa511r1/conv/`),
taken read-only from `~/.local-operator/sessions/b747a2c8d3bb/` and never written back.
The journal served to the app is the real transcript, CUT at row 1052 (the cut the PR's
own reproduction uses: "1052 rows, turn opening at row 540").  `sanitize=True` builds a
byte-for-byte structurally identical twin whose free text is synthetic, for the frames
that get published; the measurements are taken on the real copy.

The seed (`live_events`) is built the way the backend builds it
(`local_operator/session/frontend_state.py`):
  * the newest LIVE_EVENT_END_ROWS_MAX (100) `tool_execution_end` frames survive, oldest
    first; an `end` REPLACES its call's start and carries the call's own start instant
    (`started_at_epoch`) when the runtime saw the start;
  * a start with no end (a call still running) is always kept - there is none in this
    cut, because every call in it has settled.
The end frames carry NO args: they are exactly the argument-less carrier the PR is about.
"""
import copy
import json
import os
import random
import re
import sys

SCRATCH = os.environ["LOCAL_OPERATOR_SCRATCHPAD"]
BASE = f"{SCRATCH}/qa511r1"
CONV = f"{BASE}/conv/transcript.jsonl"
OUT = f"{BASE}/scen511"
SID = "b747a2c8d3bb"
CUT = 1052          # the rows the PR's reproduction cuts at
PAGE_N = 100        # the snapshot's page = the journal tail, 100 rows
END_ROWS_MAX = 100  # LIVE_EVENT_END_ROWS_MAX

# The live settles. Chosen from the turn's OWN calls (assistant rows deep in the journal,
# far outside the page and outside the seed window), so the read the fix fires has a real
# durable assistant row to find, at the depth the PR's reproduction measures.
TARGETS = [
    # Chosen INSIDE the label walk's own bound: the app holds the tail 312 rows
    # (journal rows 741..1052 - measured, not assumed), and the walk reads back at most
    # 500 rows / 6 requests, so a target whose assistant row sits more than 500 rows above
    # the tail is unreachable BY DESIGN (QA round 1 measured exactly that on a first cut:
    # the walk stopped one row short and the row kept its stand-in on both heads).
    # These assistant rows are 313..415 rows back: one page past what the open holds.
    {"id": "call_00_kuxaxfVWex8EIyAevrmd4900", "label": "T1", "asst_row": 685, "name": "bash"},
    {"id": "call_00_ffxTwvPaLRsXbYGnRVXO3877", "label": "T2", "asst_row": 719, "name": "bash"},
    {"id": "call_00_RLiwFukVEzdOUZ51BvHv1237", "label": "T3", "asst_row": 650, "name": "bash"},
    {"id": "call_00_dVtYB2yHTRo2tTTUG6sv4920", "label": "T4", "asst_row": 647, "name": "bash"},
    {"id": "call_00_qiRADJIHbA8K6eqzsNvD8676", "label": "T5", "asst_row": 679, "name": "hub"},
    {"id": "call_00_uwHevuJeM9Eh1hI8qWd64813", "label": "T6", "asst_row": 694, "name": "hub"},
]


def load_rows(sanitize=False):
    rows = [json.loads(line) for line in open(CONV)]
    rows = rows[:CUT]
    if sanitize:
        rows = sanitize_rows(rows)
    return rows


_WORDS = "alpha bravo charter delta echo foxtrot golf hotel india juliet kilo lima".split()


def _fake_text(text, seed):
    """Same shape, same line count, no operator content: a synthetic twin."""
    rnd = random.Random(seed)
    out = []
    for line in str(text).split("\n"):
        if not line.strip():
            out.append(line)
            continue
        n = len(line)
        words = " ".join(rnd.choice(_WORDS) for _ in range(max(1, n // 6)))
        out.append(("  " if line.startswith(("  ", "\t")) else "") + words[:n])
        if line.startswith(("exit code", "---", "@@", "+", "-")):
            out[-1] = line[:12] + " " + words[: max(0, n - 14)]
    return "\n".join(out)


def sanitize_rows(rows):
    out = []
    for i, r in enumerate(rows):
        r = copy.deepcopy(r)
        p = r.get("payload") or {}
        if isinstance(p.get("content"), list):
            for c in p["content"]:
                if isinstance(c, dict) and isinstance(c.get("text"), str):
                    c["text"] = _fake_text(c["text"], i)
        for c in p.get("tool_calls") or []:
            if isinstance(c, dict) and isinstance(c.get("arguments"), dict):
                args = {}
                for k, v in c["arguments"].items():
                    args[k] = _fake_text(v, i + hash(k) % 97) if isinstance(v, str) else v
                c["arguments"] = args
        out.append(r)
    return out


def index(rows):
    """call id -> {asst_row, name, args, ts, result_row, result_text, duration, details}"""
    idx = {}
    for i, r in enumerate(rows):
        p = r.get("payload") or {}
        for c in p.get("tool_calls") or []:
            if isinstance(c, dict) and c.get("id"):
                e = idx.setdefault(c["id"], {})
                e.update(asst_row=i + 1, name=c.get("name"), args=c.get("arguments"), ts=r["ts"])
        if r.get("type") == "message" and p.get("role") == "tool" and p.get("tool_call_id"):
            e = idx.setdefault(p["tool_call_id"], {})
            e.update(result_row=i + 1, name=p.get("tool_name"), duration=p.get("provider_payload", {}).get("duration_s"),
                     details=p.get("provider_payload", {}).get("details"),
                     result_text=(p.get("content") or [{}])[0].get("text", ""))
    return idx


def end_frame(call, text_limit=400):
    """The argument-less carrier: tool_call_id, tool_name, result, duration_s, is_error,
    and (since the runtime stamps it) the call's own start instant."""
    frame = {"type": "tool_execution_end", "tool_call_id": call["id"], "tool_name": call.get("name") or "bash",
             "result": {"content": [{"text": call["result_text"][:text_limit]}], "details": call.get("details")},
             "duration_s": call.get("duration"), "is_error": False}
    if call.get("ts") is not None:
        frame["started_at_epoch"] = call["ts"]
    return frame


def build(sanitize=False, page_n=PAGE_N):
    rows = load_rows(sanitize)
    idx = index(rows)
    settled = sorted([(v["result_row"], cid) for cid, v in idx.items() if v.get("result_row")], key=lambda x: x[0])
    seed_ids = [cid for _, cid in settled[-END_ROWS_MAX:]]
    seed = [end_frame({"id": cid, **idx[cid]}) for cid in seed_ids]
    journal = copy.deepcopy(rows)
    return rows, idx, journal, seed


def settle_frames(idx, ids, clockless=()):
    """The live frames this round pushes, built from the journal's own result rows.

    The wire shape is `frontend_state._fold_live_event`'s: the end REPLACES the start,
    carries the result text and duration, and carries the call's own start instant when
    the runtime saw the start (it did - the call is in the journal).
    """
    out = {}
    for cid in ids:
        e = idx.get(cid)
        if not e:
            out[cid] = {"name": "bash", "text": "QA: a call no page names", "duration_s": 0.2, "started_at_epoch": None}
            continue
        details = (e.get("details") or None) if isinstance(e.get("details"), dict) else None
        out[cid] = {"name": e.get("name"), "text": (e.get("result_text") or "")[:400],
                    "duration_s": e.get("duration"), "started_at_epoch": None if cid in clockless else e.get("ts"),
                    "details": details, "asst_row": e.get("asst_row"), "result_row": e.get("result_row")}
    return out


def scenario(name, journal, seed, streaming=True, **extra):
    sc = {"open": SID, "delay": 300, "history": "ok",
          "sessions": {SID: {"journal": journal, "page_n": PAGE_N, "streaming": streaming,
                             "live_events": seed, "title": "QA 511 — b747a2c8d3bb (copy)"}}}
    sc.update(extra)
    sc["scenario"] = name
    path = os.path.join(OUT, f"{name}.json")
    with open(path, "w") as fh:
        json.dump(sc, fh)
    return path


def main():
    os.makedirs(OUT, exist_ok=True)
    for sanitize in (False, True):
        suffix = "-san" if sanitize else ""
        rows, idx, journal, seed = build(sanitize)
        # targets T1/T2 must be real calls of the turn, deep in the journal
        t_ids = [t["id"] for t in TARGETS]
        for t in t_ids:
            assert t in idx, f"target {t} not in the journal"
        frames = settle_frames(idx, t_ids + ["toolu_QA_NOARGS_NOT_IN_JOURNAL"])
        # row (1): a re-open mid-turn + ONE live settle; the reported flow.
        scenario(f"r1-live-settle{suffix}", journal, seed, settles=[t_ids[0]], row="r1", settle_frames=frames)
        # row (1), the observable half: the SAME settle with no clock on the frame - the
        # shape frontend_state._fold_live_event produces for a call whose start the runtime
        # never saw (a runtime restart mid-call, which this conversation's own
        # .runtime-stop.json records). A clockless row is painted unplaced, i.e. at the live
        # end, so the object column can be read WITHOUT a scroll.
        noclock = settle_frames(idx, t_ids[:1], clockless=t_ids[:1])
        scenario(f"r1b-live-settle-noclock{suffix}", journal, seed, settles=t_ids[:1], row="r1",
                 settle_frames=noclock)
        # row (2): the long turn, TWO settles in a row, no durable turn_end anywhere.
        # row (2): the long turn, TWO settles in a row, no durable turn_end anywhere.
        # Clockless frames, so both rows stay at the live end where the object column can
        # be read without a scroll - the requirement this row states.
        scenario(f"r2-long-turn{suffix}", journal, seed, settles=t_ids[:2], row="r2", gap_ms=2500,
                 settle_frames=settle_frames(idx, t_ids[:2], clockless=t_ids[:2]))
        # row (3): the cost — N settles live; plus an open with nothing left to label.
        scenario(f"r3-cost{suffix}", journal, seed, settles=t_ids[:6], row="r3",
                 settle_frames=settle_frames(idx, t_ids[:6], clockless=t_ids[:6]))
        # row (5): the adjacency - the same conversation with a job roster in the snapshot
        # and NO job frames afterwards (what a dropped frame leaves the app holding).
        roster = json.load(open(f"{BASE}/conv/subagent-roster.v1.json"))
        jobs = roster.get("jobs") if isinstance(roster, dict) else None
        if not jobs:
            jobs = [{"job_id": f"qa-job-{i}", "label": f"subagent-{i}", "state": "running",
                     "trajectory": [{"role": "assistant", "text": "x" * 20000}]} for i in range(60)]
        roster_bytes = len(json.dumps(jobs))
        scenario(f"r5-adjacency{suffix}", journal, seed, settles=t_ids[:2], row="r5", gap_ms=2500,
                 settle_frames=settle_frames(idx, t_ids[:2], clockless=t_ids[:2]), jobs=jobs)
        print(f"  row5 roster: {len(jobs)} jobs, {roster_bytes} bytes serialized")
        scenario(f"r4a-open-midturn{suffix}", journal, seed, settles=[], row="r4a", settle_frames=frames)
        # row (3), second half: an open with NOTHING left to label. The seed names only
        # calls whose assistant rows the snapshot's own page carries, so the seed path has
        # nothing to ask for and the open's read count is the conversation's own cost.
        in_page = [cid for cid, v in idx.items()
                   if v.get("result_row") and v.get("asst_row", 0) >= len(rows) - PAGE_N]
        labelled_seed = [end_frame({"id": cid, **idx[cid]})
                         for cid in sorted(in_page, key=lambda c: idx[c]["result_row"])]
        scenario(f"r3b-open-nothing-to-label{suffix}", journal, labelled_seed, settles=[], row="r4a",
                 settle_frames=frames)
        print(f"  r3b: seed = {len(labelled_seed)} ends whose assistant rows the page carries")
        # row (4): an edit row - the journal has no edit call, so one is appended in the
        # shape the wire carries it (details: path/added/removed/diff), inside the tail page.
        eid = "call_00_QA511EDITROW0000000000000"
        edit_journal = copy.deepcopy(journal)
        t = edit_journal[-1]["ts"]
        edit_journal.append({"id": "qa0000000000000000000000000000e1", "ts": t + 1, "type": "message",
                            "payload": {"kind": "message", "role": "assistant",
                                        "tool_calls": [{"id": eid, "name": "edit", "arguments": {"path": "~/qa/edited-file.py", "edits": "[QA edit]"}}]}})
        edit_journal.append({"id": "qa0000000000000000000000000000e2", "ts": t + 1.1, "type": "message",
                             "payload": {"kind": "message", "role": "tool", "tool_call_id": eid, "tool_name": "edit",
                                         "content": [{"text": "Edited ~/qa/edited-file.py: 1 hunk"}],
                                         "provider_payload": {"duration_s": 0.3, "useless": False,
                                                              "details": {"path": "~/qa/edited-file.py", "added": 91, "removed": 19,
                                                                          "diff": ["--- ~/qa/edited-file.py", "+++ ~/qa/edited-file.py", "@@ -1,3 +1,7 @@", "-old line one", "-old line two", "+new line one", "+new line two", "+new line three", "+new line four"]}}}})
        scenario(f"r4f-edit{suffix}", edit_journal, seed, settles=[], row="r4f", mergeRender=f"tool:{eid}", settle_frames=frames)
        # row (4): hung read -> the columns must fall back within ~3 s
        scenario(f"r4c-hung{suffix}", journal, seed, settles=[], row="r4c", history="hang", delay=30000, settle_frames=frames)
        # row (4): a finished conversation: no seed, no live frames, tail page only.
        scenario(f"r4d-finished{suffix}", journal, seed=None, streaming=False, settles=[], row="r4d", settle_frames=frames)
        # row (4): a call that genuinely has no arguments anywhere.
        scenario(f"r4e-noargs{suffix}", journal, seed, settles=["toolu_QA_NOARGS_NOT_IN_JOURNAL"], row="r4e",
                 settle_frames=settle_frames(idx, ["toolu_QA_NOARGS_NOT_IN_JOURNAL"], clockless=["toolu_QA_NOARGS_NOT_IN_JOURNAL"]))
        # row (4): the switch-away/back loop, history frozen after the open.
        sc = {"open": SID, "delay": 300,
              "sessions": {SID: {"journal": journal, "page_n": PAGE_N, "streaming": True, "live_events": seed, "title": "A"},
                           "b747a2c8d3bb-other": {"journal": rows[:40], "page_n": 40, "streaming": False, "live_events": [], "title": "B"}}}
        sc["row"] = "r4b"
        sc["settle_frames"] = {}  # no live settles in this scenario
        json.dump(sc, open(os.path.join(OUT, f"r4b-switch-loop{suffix}.json"), "w"))
        print(f"built 7 scenarios ({'sanitized' if sanitize else 'real'}) from {len(rows)} rows; seed={len(seed)} ends")
        if not sanitize:
            # targets for the runner: the labels the matrix names
            ids = {t["label"]: t["id"] for t in TARGETS}
            for lbl, cid in ids.items():
                e = idx[cid]
                print(f"  {lbl} {cid} asst_row={e['asst_row']} result_row={e['result_row']} name={e['name']}")
            print("  seed window (result rows):", settled_window(idx))


def settled_window(idx):
    settled = sorted([(v["result_row"], cid) for cid, v in idx.items() if v.get("result_row")], key=lambda x: x[0])
    win = settled[-END_ROWS_MAX:]
    return f"{win[0][0]}..{win[-1][0]}"


if __name__ == "__main__":
    main()
