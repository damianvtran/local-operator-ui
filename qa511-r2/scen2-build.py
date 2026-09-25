"""QA round 2, PR 511 (local-operator-ui): scenario builder (scratch; never in the repo).

Data: a COPY of the operator's conversation b747a2c8d3bb (`$SCRATCH/r2/conv/`), read
READ-ONLY from `~/.local-operator/sessions/b747a2c8d3bb/` and never written back. The
journal served to the app is the real transcript CUT at row 1052 (the cut the PR's own
reproduction uses). `sanitize=True` builds a structurally identical twin whose free text
is synthetic, for the frames that get published; the measurements are taken on the real
copy, and the twin reproduced round 1's counts.

Round 1's builder wrote the whole journal into every scenario (nine 3 MB copies). This
round the journal is written ONCE per variant and referenced by `journal_file`, which the
rig resolves - the volume is shared with ~25 sessions and near-full.

Round 2's own scenarios:

* `r1c-step-commits` - R1's shape, in the app: a call settles while its step is still
  open (its assistant row and its result row are NOT in the journal), a re-sync snapshot
  then names the same call in its seed, and finally the step commits (both rows are
  appended) behind a durable round ending (`turn_end`). Phases are measured separately so
  the round can say what each moment spent and whether the row labels once it can.
* `r1d-step-commits-direct` - the same without the middle re-sync: the settle's own spend
  and the retry that must still have an attempt at the durable moment.
* `r3c-unlabelable-settle` - a settle whose call NO page can ever name, with the frame
  stating the call's own (recent) start: the one bounded tail page R2 asks for.
* `r3d-unlabelable-settle-noclock` - the same frame state-less: the residual, one bounded
  walk, then the allowance ends the path for the conversation.
"""
import copy
import json
import os
import random
import time

SCRATCH = os.environ["LOCAL_OPERATOR_SCRATCHPAD"]
BASE = f"{SCRATCH}/r2"
CONV = f"{BASE}/conv/transcript.jsonl"
OUT = f"{BASE}/scen"
SID = "b747a2c8d3bb"
CUT = 1052          # the rows the PR's reproduction cuts at
PAGE_N = 100        # the snapshot's page = the journal tail, 100 rows
END_ROWS_MAX = 100  # LIVE_EVENT_END_ROWS_MAX

# The live settles: real calls of the turn, whose assistant rows sit 313-415 rows above
# the tail (the round-1 targets, kept so the two rounds are comparable).
TARGETS = [
    {"id": "call_00_kuxaxfVWex8EIyAevrmd4900", "label": "T1", "asst_row": 685, "name": "bash"},
    {"id": "call_00_ffxTwvPaLRsXbYGnRVXO3877", "label": "T2", "asst_row": 719, "name": "bash"},
    {"id": "call_00_RLiwFukVEzdOUZ51BvHv1237", "label": "T3", "asst_row": 650, "name": "bash"},
    {"id": "call_00_dVtYB2yHTRo2tTTUG6sv4920", "label": "T4", "asst_row": 647, "name": "bash"},
    {"id": "call_00_qiRADJIHbA8K6eqzsNvD8676", "label": "T5", "asst_row": 679, "name": "hub"},
    {"id": "call_00_uwHevuJeM9Eh1hI8qWd64813", "label": "T6", "asst_row": 694, "name": "hub"},
]

# The open step of rows 1c/1d: a call that settles live while its step is still open.
STEP_ID = "call_00_QA511R2STEP00000000000000"
STEP_ASST_ID = "qa511r2step0000000000000000a1"
STEP_RESULT_ID = "qa511r2step0000000000000000a2"
# A call no page can ever name (row 3c/3d).
GHOST_ID = "call_00_QA511R2UNLABELABLE000000000"
NOARGS_ID = "toolu_QA_NOARGS_NOT_IN_JOURNAL"

_WORDS = "alpha bravo charter delta echo foxtrot golf hotel india juliet kilo lima".split()


def _fake_text(text, seed):
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


def load_rows(sanitize=False):
    rows = [json.loads(line) for line in open(CONV)]
    rows = rows[:CUT]
    if sanitize:
        rows = sanitize_rows(rows)
    return rows


def index(rows):
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
    frame = {"type": "tool_execution_end", "tool_call_id": call["id"], "tool_name": call.get("name") or "bash",
             "result": {"content": [{"text": (call.get("result_text") or "")[:text_limit]}], "details": call.get("details")},
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


def scenario(name, journal_ref, seed, streaming=True, **extra):
    sc = {"open": SID, "delay": 300, "history": "ok",
          "sessions": {SID: {"journal_file": journal_ref, "page_n": PAGE_N, "streaming": streaming,
                             "live_events": seed, "title": "QA 511 r2 - b747a2c8d3bb (copy)"}}}
    sc.update(extra)
    sc["scenario"] = name
    json.dump(sc, open(os.path.join(OUT, f"{name}.json"), "w"))
    return f"{name}.json"


def step_rows(ts):
    """The two rows a step writes when it COMMITS: the assistant row that carries the
    call and its arguments, and the result row - written together (the operator's own
    conversation: 368 of 368 tool-result rows share their assistant row's ts)."""
    asst = {"id": STEP_ASST_ID, "ts": ts, "type": "message",
            "payload": {"kind": "message", "role": "assistant",
                        "tool_calls": [{"id": STEP_ID, "name": "bash",
                                        "arguments": {"command": "QA r2 step commit: the assistant row carrying this call's arguments"}}]}}
    result = {"id": STEP_RESULT_ID, "ts": ts + 0.1, "type": "message",
              "payload": {"kind": "message", "role": "tool", "tool_call_id": STEP_ID, "tool_name": "bash",
                          "content": [{"text": "QA r2 step commit: the result row"}],
                          "provider_payload": {"duration_s": 0.4, "useless": False}}}
    return [asst, result]


def main():
    os.makedirs(OUT, exist_ok=True)
    for sanitize in (False, True):
        suffix = "-san" if sanitize else ""
        rows, idx, journal, seed = build(sanitize)
        jref = os.path.join(OUT, f"journal{suffix}.json")
        json.dump(journal, open(jref, "w"))
        t_ids = [t["id"] for t in TARGETS]
        for t in t_ids:
            assert t in idx, f"target {t} not in the journal"
        now_epoch = time.time()
        tail_ts = journal[-1]["ts"]
        # --- the settles the suite pushes -------------------------------------------
        frames = settle_frames(idx, t_ids)
        frames[STEP_ID] = {"name": "bash", "text": "QA r2: this call's step has not committed yet",
                           "duration_s": 0.4, "started_at_epoch": now_epoch, "details": None}
        frames[GHOST_ID] = {"name": "bash", "text": "QA r2: a settle whose call no page names",
                            "duration_s": 0.3, "started_at_epoch": now_epoch, "details": None}
        frames[NOARGS_ID] = {"name": "bash", "text": "QA: a call no page names", "duration_s": 0.2, "started_at_epoch": None}
        # --- row 1: the reported flow (both heads, A/B) ------------------------------
        scenario(f"r1-live-settle{suffix}", jref, seed, settles=[t_ids[0]], row="r1", settle_frames=frames)
        scenario(f"r1b-live-settle-noclock{suffix}", jref, seed, settles=t_ids[:1], row="r1",
                 settle_frames=settle_frames(idx, t_ids[:1], clockless=t_ids[:1]))
        # --- row 1c/1d: R1's shape, then the step commits ----------------------------
        commit_at = len(journal)
        srows = step_rows(tail_ts + 1)
        step_end = end_frame({"id": STEP_ID, "name": "bash", "ts": now_epoch,
                              "result_text": "QA r2: this call's step has not committed yet", "duration": 0.4})
        scenario(f"r1c-step-commits{suffix}", jref, seed, settles=[STEP_ID], row="r1c", settle_frames=frames,
                 phase_ms=3500, sample_ms=34000,
                 commit={"resync_snapshot": True, "resync_live_events": seed + [step_end],
                         "insert": [{"index": commit_at, "row": srows[0]}, {"index": commit_at + 1, "row": srows[1]}],
                         "turn_end": "turn_end"})
        scenario(f"r1d-step-commits-direct{suffix}", jref, seed, settles=[STEP_ID], row="r1c", settle_frames=frames,
                 phase_ms=3500, sample_ms=26000,
                 commit={"insert": [{"index": commit_at, "row": srows[0]}, {"index": commit_at + 1, "row": srows[1]}],
                         "turn_end": "turn_end"})
        # --- row 2: the long turn, TWO settles in a row, no durable turn_end ---------
        scenario(f"r2-long-turn{suffix}", jref, seed, settles=t_ids[:2], row="r2", gap_ms=2500,
                 settle_frames=settle_frames(idx, t_ids[:2], clockless=t_ids[:2]))
        # --- row 3: the cost over N settles, the open with nothing to label, and the
        #     unlabelable settle with and without its clock --------------------------
        scenario(f"r3-cost{suffix}", jref, seed, settles=t_ids[:6], row="r3",
                 settle_frames=settle_frames(idx, t_ids[:6], clockless=t_ids[:6]))
        in_page = [cid for cid, v in idx.items()
                   if v.get("result_row") and v.get("asst_row", 0) >= len(rows) - PAGE_N]
        labelled_seed = [end_frame({"id": cid, **idx[cid]})
                         for cid in sorted(in_page, key=lambda c: idx[c]["result_row"])]
        scenario(f"r3b-open-nothing-to-label{suffix}", jref, labelled_seed, settles=[], row="r4a", settle_frames=frames)
        scenario(f"r3c-unlabelable-settle{suffix}", jref, seed, settles=[GHOST_ID], row="r3c",
                 settle_frames=frames, phase_ms=6000, sample_ms=14000)
        noclock = dict(frames)
        noclock[GHOST_ID] = {**frames[GHOST_ID], "started_at_epoch": None}
        scenario(f"r3d-unlabelable-settle-noclock{suffix}", jref, seed, settles=[GHOST_ID], row="r3c",
                 settle_frames=noclock, phase_ms=9000, sample_ms=18000)
        # --- row 4: the pinned sweep, unchanged from round 1 -------------------------
        scenario(f"r4a-open-midturn{suffix}", jref, seed, settles=[], row="r4a", settle_frames=frames)
        # A call that genuinely has no arguments anywhere: the seed names it, nothing can.
        scenario(f"r4e-noargs{suffix}", jref, seed, settles=[NOARGS_ID], row="r4e", settle_frames=frames)
        scenario(f"r4c-hung{suffix}", jref, seed, settles=[], row="r4c", history="hang", delay=30000, settle_frames=frames)
        scenario(f"r4d-finished{suffix}", jref, None, streaming=False, settles=[], row="r4d", settle_frames=frames)
        # The edit row: the journal has no edit call, so one is appended in the wire's shape.
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
        jref_edit = os.path.join(OUT, f"journal-edit{suffix}.json")
        json.dump(edit_journal, open(jref_edit, "w"))
        scenario(f"r4f-edit{suffix}", jref_edit, seed, settles=[], row="r4f", mergeRender=f"tool:{eid}", settle_frames=frames)
        # The switch loop: session A is the conversation, B a small frozen one.
        scen = {"open": SID, "delay": 300, "row": "r4b", "settle_frames": {},
                "sessions": {SID: {"journal_file": jref, "page_n": PAGE_N, "streaming": True, "live_events": seed, "title": "A"},
                             "b747a2c8d3bb-other": {"journal": rows[:40], "page_n": 40, "streaming": False, "live_events": [], "title": "B"}}}
        json.dump(scen, open(os.path.join(OUT, f"r4b-switch-loop{suffix}.json"), "w"))
        # --- row 5: the FOLD. A settled conversation, no live settles: the transcript
        #     must paint, and `/btw` must reach #482's aside panel above the composer.
        scenario(f"r5-fold{suffix}", jref, seed, streaming=False, settles=[], row="r5", settle_frames=frames,
                 aside_answer="QA stub: the aside's own authoritative answer.")
        print(f"built the round-2 scenarios ({'sanitized' if sanitize else 'real'}) from {len(rows)} rows; "
              f"journal={os.path.getsize(jref)//1024} KB, seed={len(seed)} ends, page={PAGE_N}")
        if not sanitize:
            for t in TARGETS:
                e = idx[t["id"]]
                print(f"  {t['label']} {t['id']} asst_row={e['asst_row']} result_row={e['result_row']} name={e['name']}")
            settled = sorted([(v["result_row"], cid) for cid, v in idx.items() if v.get("result_row")], key=lambda x: x[0])
            print("  seed window (result rows):", f"{settled[-END_ROWS_MAX:][0][0]}..{settled[-1][0]}")
            print(f"  step commit: rows appended at {commit_at}..{commit_at + 1} (ts {tail_ts + 1:.0f}), "
                  f"frames: {STEP_ID} @{now_epoch:.0f}, ghost {GHOST_ID}")


if __name__ == "__main__":
    main()
