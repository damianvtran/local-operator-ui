#!/usr/bin/env python
"""
Measure, against a real gate, whether a 2xx from ``sessions.answer`` can be a LOSS.

    # Run it with an interpreter that can import `local_operator` (the backend
    # checkout's own venv):
    ~/local-operator/.venv/bin/python \\
        docs/evidence/ask-options-live/harness/probe-answer-exclusivity.py 6

Why this is committed rather than a scratch rig: the app's verdict on a press
rests on exactly one backend property — that the answer route answers ``2xx`` only
when the owner applied OUR value — and the property is a claim about a socket
round trip and a future popped on another thread, which is precisely the kind of
claim that reads as true and stops being true. It takes thirty seconds to
re-measure with this script and a review round to discover otherwise.

WHAT IT DRIVES, and what it does not. This is a native client of the SHIPPED
route (bearer token, no ``Origin`` and no ``Sec-Fetch-Site``, which is how the
auth plane tells a non-browser caller from a page), against the same isolated
runtime ``serve-gate.py`` stands up: a real ``Session``, a real
``ServingSessionHandle``, a real ``RuntimeServer``, and a real ``_ask_gate``. No
browser, no renderer, no model. It is the backend half of the question the UI
takes on trust; the UI half is ``docs/evidence/ask-options-live/``'s frames.

Per round, against ONE fresh gate:

  A, B  two answers fired CONCURRENTLY from two threads, with DIFFERENT labels,
        so the two possible outcomes have distinguishable values, not just
        distinguishable statuses;
  C     a third answer once the gate has settled — the stale press no front end
        can win.

and it reports, per round, each request's status, the answer log from
``/rig-state`` (the request's arrival, the route's own answer, and the delivery,
in epoch milliseconds), and ``owner-answer.json`` — the owner's own return value,
which is what says WHICH label was taken.

The property is confirmed when exactly one of A/B is ``2xx``, that request's
label is the one the owner kept, and C is refused. A round where a ``2xx``
carried a label the owner did not keep would be the counterexample — and the
reason the UI could not treat its own outcome as the authority.
"""

from __future__ import annotations

import http.client
import json
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

#: The harness beside this file, and the repository it belongs to. Derived from
#: `__file__` rather than taken from the caller's cwd, so the script runs from
#: anywhere the way a reviewer would run it.
HARNESS = Path(__file__).resolve().parent / "serve-gate.py"
REPO = Path(__file__).resolve().parents[4]
SESSION = "a1a1a1a1a1a1"

#: Distinct labels for the two racing answers. The harness's own gate offers the
#: first two of these as options, so both are answers the card could really have
#: sent — the race this measures is between two plausible presses, not between a
#: valid one and a malformed one.
LABELS = {
    "A": "Popup is open - generate the pairing code",
    "B": "Popup is not open",
    "C": "Something else",
}


def call(port: int, token: str, method: str, path: str, body: dict | None = None):
    """One request to the rig, as a native client of the shipped route."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    payload = None if body is None else json.dumps(body)
    headers = {"Authorization": f"Bearer {token}"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    conn.request(method, path, body=payload, headers=headers)
    response = conn.getresponse()
    raw = response.read().decode("utf-8", "replace")
    conn.close()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = raw
    return response.status, parsed


def gate_state(port: int, token: str) -> dict | None:
    """The pending gate and the epoch an answer must name, from the read route.

    `pending_gate` sits inside the frontend state's own snapshot, and the epoch
    the answer route compares is the FRONTEND epoch — not the snapshot envelope's
    `epoch` one level up. Reading the wrong one is a 409 that looks like the
    exclusivity this script is measuring, which is why the path is spelled out.
    """
    status, body = call(port, token, "GET", f"/v1/desktop/sessions/{SESSION}")
    if status != 200:
        return None
    frontend = body.get("result", {}).get("payload", {}).get("frontend", {})
    return {
        "epoch": frontend.get("epoch"),
        "pending_gate": frontend.get("snapshot", {}).get("pending_gate"),
    }


def answer(port: int, token: str, gate: dict, label: str):
    return call(
        port,
        token,
        "POST",
        f"/v1/desktop/sessions/{SESSION}/answers",
        {
            "epoch": gate["epoch"],
            "request_id": gate["pending_gate"]["request_id"],
            "value": label,
            "question_index": gate["pending_gate"].get("question_index"),
        },
    )


def one_round(index: int) -> dict:
    scratch = Path(tempfile.mkdtemp(prefix="ask-loss-probe."))
    log = scratch / "harness.log"
    proc = subprocess.Popen(
        [
            sys.executable,
            str(HARNESS),
            "--scratch",
            str(scratch),
            "--token-file",
            str(scratch / "token"),
            "--result-file",
            str(scratch / "owner-answer.json"),
        ],
        stdout=log.open("w"),
        stderr=subprocess.STDOUT,
        # Its own process group, so the teardown below takes the whole rig with
        # it and leaves nothing holding this round's port.
        start_new_session=True,
    )
    record: dict = {"round": index, "scratch": str(scratch)}
    try:
        deadline = time.time() + 60
        while time.time() < deadline and not (scratch / "port").exists():
            time.sleep(0.2)
        port = int((scratch / "port").read_text().strip())
        token = (scratch / "token").read_text().strip()
        record["port"] = port

        # Arm first: the gate does not exist until the rig is asked for it, which
        # is what keeps the host's own unanswered-gate timeout out of the run.
        call(port, token, "GET", "/rig-arm")

        gate = None
        deadline = time.time() + 30
        while time.time() < deadline:
            state = gate_state(port, token)
            if state and state["pending_gate"]:
                gate = state
                break
            time.sleep(0.2)
        if gate is None:
            raise RuntimeError("the gate never appeared")
        record["request_id"] = gate["pending_gate"]["request_id"]

        # A and B, released together so the race is a race. A barrier rather than
        # two timers: what is being measured is which request the OWNER settles
        # first, and a scheduling delay between the two would make that a
        # measurement of this script's own start-up instead.
        results: dict[str, tuple] = {}
        barrier = threading.Barrier(2)

        def fire(slot: str) -> None:
            barrier.wait()
            results[slot] = answer(port, token, gate, LABELS[slot])

        threads = [threading.Thread(target=fire, args=(slot,)) for slot in ("A", "B")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        for slot in ("A", "B"):
            status, body = results[slot]
            record[slot] = {"label": LABELS[slot], "status": status, "body": body}

        # Then the stale press, after the gate has settled.
        time.sleep(0.5)
        late_status, late_body = answer(port, token, gate, LABELS["C"])
        record["C"] = {
            "label": LABELS["C"],
            "status": late_status,
            "body": late_body,
        }

        _, state = call(port, token, "GET", "/rig-state")
        record["answer_log"] = state.get("answers") if isinstance(state, dict) else state
        owner = scratch / "owner-answer.json"
        record["owner_answer"] = (
            json.loads(owner.read_text()) if owner.exists() else None
        )

        # The verdict, computed here rather than left to a reader: a round where a
        # 2xx carried a label the owner did not keep is the counterexample, and it
        # has to be impossible to miss.
        kept = json.dumps(record["owner_answer"])
        accepted = [slot for slot in ("A", "B") if 200 <= results[slot][0] < 300]
        record["verdict"] = {
            "accepted_2xx": accepted,
            "owner_kept": record["owner_answer"],
            "a_2xx_was_a_loss": any(LABELS[slot] not in kept for slot in accepted),
            "late_answer_status": late_status,
        }
        return record
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    results = [one_round(index) for index in range(rounds)]
    for result in results:
        verdict = result["verdict"]
        print(
            f"round {result['round']}: A {result['A']['status']} "
            f"B {result['B']['status']} C {result['C']['status']} | "
            f"2xx {verdict['accepted_2xx']} | "
            f"owner kept {verdict['owner_kept']} | "
            f"a 2xx was a loss: {verdict['a_2xx_was_a_loss']}"
        )
    print()
    print(json.dumps(results, indent=2))
