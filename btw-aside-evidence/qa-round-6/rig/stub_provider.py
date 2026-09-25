"""Scripted OpenAI-compatible provider for the /btw aside UI evidence rig.

Derived from the coordinator's `~/workspace/btw-evidence/stub_provider.py` with
ONE change and one addition, both of which exist because THIS rig photographs
the answer's states rather than only asserting them:

* PACING. The original streams two chunks 50ms apart, which is a window too
  short to photograph a `thinking` state or a partially-written answer. Here the
  first chunk waits `STUB_FIRST_DELAY` seconds (so `thinking…` is a stable frame
  rather than a race) and every later chunk waits `STUB_CHUNK_DELAY` (so
  `mid-stream` is a real state with partial text, not a guess).
* A LONGER answer, split into more chunks, so a mid-stream frame has partial
  prose and a settled frame has the whole of it — a single-chunk answer makes
  those two the same picture.

Everything else is the coordinator's, including the marker rules that let a
question drive the tool-call path and the never-answers (typed refusal) path:
those are what produce the aside's ERROR state in the panel.
"""

from __future__ import annotations

import json
import re
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("STUB_PORT", "0"))
LOG = os.environ["STUB_LOG"]
MODEL = os.environ.get("STUB_MODEL", "btw-stub")
#: How long the FIRST chunk waits. This is the `thinking…` window.
FIRST_DELAY = float(os.environ.get("STUB_FIRST_DELAY", "1.6"))
#: The gap between later chunks. This is the visible-streaming window.
CHUNK_DELAY = float(os.environ.get("STUB_CHUNK_DELAY", "0.30"))
TOOLCALL_MARKER = "TOOLCALL"
TOOLCALL_FOREVER_MARKER = "TOOLCALL2"
EMPTY_MARKER = "EMPTYANS"
SILENT_MARKER = "TOOLSILENT"
#: QA round 3 addition: a LONG answer (for D6) that overflows the exchange cap.
LONG_MARKER = "LONGANSWER"
_LONG = (
    "The retry budget is a per-provider allowance, and it is spent only by failures that a "
    "second attempt could plausibly fix. A dropped connection, a reset stream, a timeout "
    "before the first byte and an owner 5xx each spend one unit; a 4xx spends nothing, "
    "because the request itself was refused and sending it again would be refused again. "
    "The window moves, so an allowance spent an hour ago is back by now, and a burst of "
    "failures inside a single minute exhausts it quickly on purpose. When the budget is "
    "exhausted the next attempt is not made at all, the turn reports the last failure it saw, "
    "and the conversation stays exactly where it was so you can try again by hand.\n\n"
    "Two consequences are worth knowing. First, a long tool run can outlive a window, so the "
    "budget a long turn sees is the one in force when each attempt is made. Second, a "
    "cancelled turn spends nothing for the attempts it never made, so stopping a run that is "
    "failing is always cheaper than letting it exhaust the allowance. LONG-END."
)
_LONG = (_LONG.replace(" LONG-END.", "") + "\n\n") * 2 + _LONG
LONG_PIECES = [_LONG[i : i + 300] for i in range(0, len(_LONG), 300)]

#: The settled answer, in the pieces the stream delivers. Chosen to look like a
#: real aside answer (a sentence plus a short list) so a mid-stream frame shows
#: partial PROSE rather than a truncated word, and to be long enough that the
#: mid-stream and settled frames are obviously different pictures.
CHUNKS = [
    "Transport failures and owner ",
    "**5xx** responses, per provider, ",
    "inside a moving window.\n\n",
    "- each transport failure spends one\n",
    "- each owner 5xx spends one\n",
    "- a retry that succeeds resets the window\n\n",
    "A **4xx** never spends it: ",
    "the request was wrong, not the provider.",
]


def _text_of(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text") or "")
    return "\n".join(parts)


def _chunk(delta: dict, finish: str | None = None, usage: dict | None = None) -> str:
    body = {
        "id": "chatcmpl-btw-stub",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": MODEL,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if usage is not None:
        body["usage"] = usage
    return "data: " + json.dumps(body) + "\n\n"


def _script(body: dict) -> list[str]:
    """The SSE chunks for this request — decided by what the request contains."""
    messages = body.get("messages") or []
    last_user = ""
    for message in reversed(messages):
        if message.get("role") == "user":
            last_user = _text_of(message)
            break
    already_corrected = any(
        message.get("role") == "assistant" and message.get("tool_calls") for message in messages
    )
    # QA round 2 additions (this rig only): EMPTYANS answers with no text and no
    # call (the route's 409 aside_empty_answer); TOOLSILENT makes a bare call and
    # then answers the corrected retry with nothing (a call then silence, the
    # route's 409 aside_unanswered on its second shape).
    if EMPTY_MARKER in last_user or (SILENT_MARKER in last_user and already_corrected):
        return [
            _chunk({"role": "assistant", "content": ""}),
            _chunk({}, finish="stop"),
            _chunk({}, usage={"prompt_tokens": 11, "completion_tokens": 0, "total_tokens": 11}),
        ]
    if SILENT_MARKER in last_user or TOOLCALL_FOREVER_MARKER in last_user or (
        TOOLCALL_MARKER in last_user and not already_corrected
    ):
        return [
            _chunk(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call_stub_1",
                            "type": "function",
                            "function": {"name": "read", "arguments": '{"path": "README.md"}'},
                        }
                    ],
                }
            ),
            _chunk({}, finish="tool_calls"),
            _chunk({}, usage={"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14}),
        ]
    # QA round 4 addition: PARAGRID<k> answers with a first paragraph of k sentences,
    # then two more paragraphs, so the D12 row-grid claim can be swept over the first
    # paragraph's row count (the cap's cut lands at a different row for each k).
    m = re.search(r"PARAGRID(\d+)", last_user)
    if m:
        k = int(m.group(1))
        sent = "Sentence {n} of this paragraph runs about this long, on purpose. "
        first = "".join(sent.format(n=i + 1) for i in range(k)).strip()
        rest = "".join(sent.format(n=i + 1) for i in range(6)).strip()
        text = first + "\n\n" + rest + "\n\n" + rest + " GRID-END."
        pieces = [text[i : i + 220] for i in range(0, len(text), 220)]
        out = [_chunk({"role": "assistant", "content": pieces[0]})]
        out += [_chunk({"content": piece}) for piece in pieces[1:]]
        out.append(_chunk({}, finish="stop"))
        out.append(_chunk({}, usage={"prompt_tokens": 21, "completion_tokens": 90, "total_tokens": 111}))
        return out
    # UX round 3 addition: MERMAIDANS answers with one short line and a mermaid
    # block, so a diagram that renders AFTER the settle (a dynamic import) grows a
    # finished answer without changing its length or phase (R7-3).
    if "MERMAIDANS" in last_user:
        text = ("Here is the flow.\n\n```mermaid\nflowchart TD\n  A[Ask] --> B{Answered?}\n"
                "  B -- yes --> C[Adopt]\n  B -- no --> D[Ask again]\n  D --> B\n  C --> E[Conversation]\n```\n\nMERMAID-END.")
        return [_chunk({"role": "assistant", "content": text}), _chunk({}, finish="stop"),
                _chunk({}, usage={"prompt_tokens": 21, "completion_tokens": 40, "total_tokens": 61})]
    if LONG_MARKER in last_user:
        out = [_chunk({"role": "assistant", "content": LONG_PIECES[0]})]
        out += [_chunk({"content": piece}) for piece in LONG_PIECES[1:]]
        out.append(_chunk({}, finish="stop"))
        out.append(_chunk({}, usage={"prompt_tokens": 21, "completion_tokens": 300, "total_tokens": 321}))
        return out
    pieces = [_chunk({"role": "assistant", "content": CHUNKS[0]})]
    pieces += [_chunk({"content": piece}) for piece in CHUNKS[1:]]
    pieces.append(_chunk({}, finish="stop"))
    pieces.append(
        _chunk({}, usage={"prompt_tokens": 21, "completion_tokens": 48, "total_tokens": 69})
    )
    return pieces


def _content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "") for block in content if isinstance(block, dict)
        )
    return json.dumps(content)


def _projection(body: dict) -> dict:
    messages = body.get("messages") or []
    last_user = ""
    for message in reversed(messages):
        if message.get("role") == "user":
            last_user = _content_text(message.get("content"))
            break
    calls, results = [], []
    for message in messages:
        if message.get("role") == "assistant" and message.get("tool_calls"):
            calls.append(
                [
                    {
                        "id": call.get("id"),
                        "name": (call.get("function") or {}).get("name"),
                        "arguments": (call.get("function") or {}).get("arguments"),
                    }
                    for call in message["tool_calls"]
                ]
            )
        elif message.get("role") == "tool":
            results.append(
                {
                    "tool_call_id": message.get("tool_call_id"),
                    "content": _content_text(message.get("content"))[:240],
                }
            )
    return {
        "at": time.time(),
        "path": None,
        "model": body.get("model"),
        "n_messages": len(messages),
        "last_user_head": last_user[:260],
        "assistant_tool_calls": calls,
        "tool_results": results,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args) -> None:
        pass

    def _send(self, payload: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/").endswith("models"):
            payload = json.dumps(
                {
                    "object": "list",
                    "data": [
                        {
                            "id": MODEL,
                            "object": "model",
                            "owned_by": "stub",
                            "max_model_len": 200_000,
                            "max_context_length": 200_000,
                            "supports_tools": True,
                        }
                    ],
                }
            ).encode()
            self._send(payload, "application/json")
        else:
            self._send(b"{}", "application/json")

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = {"unparsed": raw.decode("utf-8", "replace")}
        with open(LOG, "a", encoding="utf-8") as handle:
            projection = _projection(body)
            projection["path"] = self.path
            handle.write(json.dumps(projection) + "\n")
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.send_header("cache-control", "no-cache")
        self.send_header("connection", "close")
        self.end_headers()
        first = True
        # UX round 3: a THREAD turn whose last user line carries SLOWTURN streams at
        # 2 s a chunk, so "the conversation is working" lasts long enough to drive.
        _msgs = body.get("messages") or []
        _last = next((_text_of(m) for m in reversed(_msgs) if m.get("role") == "user"), "")
        # UX round 3: 1.0 s a chunk, not 2.0 - the APP stops waiting at 20 s and leaves
        # a held message behind, which poisons every later step of a pass. 8 chunks at
        # 1.0 s is a ~9 s window: long enough to press into, well inside the app's own
        # timeout.
        gap = 1.0 if ("SLOWTURN" in _last or "SLOWANS" in _last) else CHUNK_DELAY
        for piece in _script(body):
            time.sleep(FIRST_DELAY if first else gap)
            first = False
            self.wfile.write(piece.encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    port_file = os.environ.get("STUB_PORT_FILE")
    if port_file:
        with open(port_file, "w", encoding="utf-8") as handle:
            handle.write(str(server.server_address[1]))
    server.serve_forever()
