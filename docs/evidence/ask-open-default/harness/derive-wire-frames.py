#!/usr/bin/env python
"""What the SHIPPED core publishes for an ask queue, derived rather than recalled.

The open policy's dismissal record has to decide whether a frame's ask list is COMPLETE
(names every outstanding ask). Two wire facts bear on that, and both were first believed
from reading code and were WRONG until this script ran the shipped functions:

  1. `asks_truncated` is STICKY. The core's text budget drops whole rows past
     `ASK_WIRE_TEXT_BUDGET_CHARS`, and the flag is set whenever ANY row is dropped - an
     answered one included - and stays set for as long as those rows ride the projection
     (until `LATE_WINDOW_S`, seven days past their deadlines). A client that read it as
     "this frame's list is a prefix of the OUTSTANDING asks" would read it as true forever.
     The tally (`asks_open`) is counted over outstanding rows BEFORE the budget drops any,
     so `tally > outstanding rows named` is the per-frame evidence of an unnamed ask.
  2. `PROJECTION_CAP` (20) clips the rows BEFORE the tally is counted, so past 20 rows an
     outstanding ask that the clip drops is on NEITHER field. No client can name it.

Run it with the INSTALLED runtime's interpreter, the same one the rig uses, under a scratch
HOME (the queue writes its log under the config dir it is given and nothing else):

    GEN="$(readlink "$HOME/.local/share/lop/current")"
    ISO="$(mktemp -d)"
    env -i HOME="$ISO" TMPDIR="$ISO" PATH=/usr/bin:/bin LANG=en_US.UTF-8 PYTHONDONTWRITEBYTECODE=1 \\
        "$GEN/tools/local-operator/bin/python" docs/evidence/ask-open-default/harness/derive-wire-frames.py "$ISO/cfg"

Its output, for the generation this set was captured with, is committed as `wire-frames.txt`.
Nothing here starts a turn or reaches a provider: the session handed to the queue is a mock
that is never asked for anything.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

from local_operator.asks import policy, store
from local_operator.asks.queue import AskQueue
from local_operator.session.frontend_state import (
    ASK_WIRE_TEXT_BUDGET_CHARS,
    ask_wire,
    bound_ask_rows,
)

CONFIG_DIR = sys.argv[1]
BODY = "x" * 900


def wire_line(label: str, session) -> None:
    """One line: what `ask_wire` + `bound_ask_rows` publish for the queue as it stands."""
    rows, tally = ask_wire(session)
    kept, dropped = bound_ask_rows(rows)
    outstanding = sum(1 for row in kept if store.is_outstanding(row["status"]))
    print(
        f"{label:<46} rows carried={len(kept):<3} outstanding among them={outstanding:<3} "
        f"asks_open={tally!s:<3} asks_truncated={dropped}"
    )


def queue_for(session_id: str, clock):
    queue = AskQueue(MagicMock(), config_dir=CONFIG_DIR, session_id=session_id, clock=clock)

    class Session:
        def ask_queue(self):
            return queue

    return queue, Session()


def main() -> None:
    print(
        f"core constants: PROJECTION_CAP={policy.PROJECTION_CAP}  OPEN_ASK_CAP={policy.OPEN_ASK_CAP}  "
        f"ASK_WIRE_TEXT_BUDGET_CHARS={ASK_WIRE_TEXT_BUDGET_CHARS}  LATE_WINDOW_S={store.LATE_WINDOW_S}"
    )

    print("\n(1) eight ~900-character asks: the text budget keeps a PREFIX, and the flag never clears")
    now = [1_800_000_000_000]
    queue, session = queue_for("budget-probe", lambda: now[0])
    ids = []
    for i in range(policy.OPEN_ASK_CAP):
        question = {
            "id": f"batch-{i + 1}",
            "question": f"Batch {i + 1}: {BODY}"[:900],
            "options": [{"label": "Commit"}, {"label": "Skip"}],
        }
        receipt = queue.enqueue([question], 3600)
        assert receipt.get("ok"), receipt
        ids.append((receipt["details"]["ask_id"], f"batch-{i + 1}"))
        now[0] += 1000
    wire_line("8 long asks, all open", session)
    for ask_id, question_id in ids[:-1]:
        assert queue.respond(ask_id, {question_id: ["Commit"]}, by="probe").get("ok")
    wire_line("7 answered, 1 open", session)
    ask_id, question_id = ids[-1]
    assert queue.respond(ask_id, {question_id: ["Commit"]}, by="probe").get("ok")
    wire_line("ALL answered: nothing outstanding", session)
    receipt = queue.enqueue(
        [{"id": "followup", "question": "Batch 9 is ready: should I go ahead with it?", "options": [{"label": "Commit"}, {"label": "Skip"}]}],
        3600,
    )
    assert receipt.get("ok"), receipt
    wire_line("all answered + one new short ask", session)

    print("\n(2) PROJECTION_CAP: more than 20 outstanding rows, the clip precedes the tally")
    now = [1_800_000_000_000]
    queue, session = queue_for("cap-probe", lambda: now[0])
    made = 0
    for _ in range(3):  # eight open asks, let them time out (still OUTSTANDING), repeat
        for _ in range(policy.OPEN_ASK_CAP):
            receipt = queue.enqueue(
                [{"id": f"q{made}", "question": f"Question {made}?", "options": [{"label": "Yes"}, {"label": "No"}]}],
                policy.MIN_TIMEOUT_S,
            )
            assert receipt.get("ok"), receipt
            made += 1
        now[0] += (policy.MIN_TIMEOUT_S + 1) * 1000
    receipt = queue.enqueue(
        [{"id": f"q{made}", "question": f"Question {made}?", "options": [{"label": "Yes"}, {"label": "No"}]}],
        3600,
    )
    assert receipt.get("ok"), receipt
    made += 1
    truly = sum(1 for r in queue.records() if store.is_outstanding(r["status"]))
    print(f"enqueued {made}; outstanding in the log = {truly}")
    wire_line(f"{truly} outstanding asks (24 timed out, 1 open)", session)


if __name__ == "__main__":
    main()
