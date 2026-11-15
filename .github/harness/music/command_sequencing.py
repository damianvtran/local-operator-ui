"""Sequence serving-preflight model commands through the worker's own receipts.

Why: the owned mock model (music_worker_bootstrap/sitecustomize.py) reads ONE
shared ``model-command.json`` on every model request. Run 42675368995 admitted
the ``music_status`` prompt (200) and the harness immediately overwrote that
file with the ``modify_music`` command. The status turn ran late (queued behind
the generate job's follow-up turn), read the modify command, emitted
modify_music, parked on its approval gate, and the harness's own modify POST then
blocked behind that busy session past the client timeout. No ``tool_emitted``
receipt ever carried the status call id. Admission is not consumption.

Constraints:
- Truth is the worker's append-only ``bootstrap-<pid>.jsonl`` receipts, never
  the harness's own bookkeeping: a command counts as consumed only once the
  model boundary wrote ``tool_emitted`` for its id.
- Pure file reads, no Core import and no HTTP, so the unit test runs against
  synthetic receipts without a serving graph.
- Raising, not waiting longer, is the answer to a mismatch: a wrong tool under
  our id or an unconsumed predecessor means the turns are out of order.
"""
import json
from pathlib import Path


class SequencingError(AssertionError):
    """Model commands were consumed out of order or by the wrong tool."""


def receipts(root):
    events = []
    for path in sorted(Path(root).glob('bootstrap-*.jsonl')):
        for line in path.read_text().splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                # A worker may be mid-append; the next poll sees the full line.
                continue
    return events


def emitted_tools(root, cid):
    return [e.get('tool') for e in receipts(root)
            if e.get('event') == 'tool_emitted' and e.get('call_id') == cid]


def own_emission(root, cid, tool):
    """Tool name once THIS call id was emitted, None before; raise on mismatch."""
    names = emitted_tools(root, cid)
    if not names:
        return None
    if names != [tool]:
        raise SequencingError('call %s emitted %r, requested %r' % (cid, names, tool))
    return tool


def assert_previous_consumed(root):
    """Refuse to overwrite a command no model turn has emitted yet."""
    path = Path(root) / 'model-command.json'
    if not path.exists():
        return
    previous = json.loads(path.read_text())
    if not emitted_tools(root, previous['id']):
        raise SequencingError('previous command %s (%s) never emitted; refusing to overwrite'
                              % (previous['id'], previous['tool']))


def receipts_tail(root, limit=30):
    """Sanitized worker receipt tail for diagnostics (drops paths/tool lists)."""
    # marker_ids/turn_user_rows (first token per current-turn user row) say
    # WHAT displaced a marker on a skipped turn (R18, run 42727770460).
    keep = ('event', 'pid', 'command_id', 'tool', 'call_id', 'marker_ids', 'turn_user_rows')
    return [{k: e[k] for k in keep if k in e} for e in receipts(root)][-limit:]
