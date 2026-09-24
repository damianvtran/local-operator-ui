"""Scripted OpenAI-compatible provider for the /btw aside evidence rig.

NOT part of the repository: this lives in the session scratchpad and exists only
so the aside's provider path can be driven end to end without a live key.

What it does, and why each rule is where it is:

* It speaks the OpenAI chat-completions SSE dialect the harness's wire client
  parses (``data: {chunk}\\n\\n`` ... ``data: [DONE]``): ``choices[0].delta``
  carries ``content`` for prose and ``tool_calls`` for a call, and the finish
  chunk carries ``finish_reason`` plus usage.

* WHICH ANSWER IT GIVES IS DECIDED BY THE REQUEST, never by a counter. A real
  model will not emit a bare tool call on demand, so the tool-call case is
  forced by a marker the driver puts in the aside question ("TOOLCALL"), and the
  retry is recognised from the request itself: the second request for that aside
  already carries the assistant ``tool_calls`` turn the guard appended, so the
  stub answers that one with prose. Nothing here has to know it is a "retry".

* Every request body is appended to ``STUB_LOG`` as one JSON line, which is what
  lets the evidence show the retry really carried the rejected call and its
  error result.

Env: ``STUB_PORT`` (default 0 — the OS chooses), ``STUB_PORT_FILE`` (where the
chosen port is written), ``STUB_LOG`` (required), ``STUB_MODEL``.
"""

from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

#: EPHEMERAL BY DEFAULT, and that is a hard rule rather than a preference: a
#: fixed port here once collided with the operator's own desktop backend on 1111
#: (whose app then refused to spawn its own daemon, and quit), so any listener
#: this rig starts is one the OS chose and can prove was free.
PORT = int(os.environ.get("STUB_PORT", "0"))
LOG = os.environ["STUB_LOG"]
MODEL = os.environ.get("STUB_MODEL", "btw-stub")
#: The marker the driver puts in the question to force the tool-call answer.
TOOLCALL_MARKER = "TOOLCALL"
#: The same marker with a trailing 2 makes the stub refuse to give up: every
#: request for that aside is a bare tool call, which is how the driver drives the
#: primitive's SECOND bare call (and so the typed refusal) over real HTTP.
TOOLCALL_FOREVER_MARKER = "TOOLCALL2"
#: design-482-r2 additions (scratch copy only): a LONG answer that overflows the
#: exchange cap, and a SLOW refusal so the panel can be closed before it lands.
LONG_MARKER = "LONGANSWER"
SLOW_MARKER = "SLOW"
SLOW_SECONDS = 2.5
#: The shipped `--scene btw-aside` waits for "Transport failures" mid-stream and
#: "wrong, not the provider" as the tail: 8 chunks, 1.8s to the first, 300ms apart.
RETRY_PIECES = [
    "Transport failures and owner ",
    "**5xx** responses, per provider, ",
    "within a moving window. ",
    "A 4xx never spends it, ",
    "because a 4xx says the request ",
    "itself was malformed, so a retry ",
    "would only repeat a request that is ",
    "wrong, not the provider.",
]
_LONG = (
    "The retry budget is a per-provider allowance, and it is spent only by failures that a "
    "second attempt could plausibly fix. A dropped connection, a reset stream, a timeout "
    "before the first byte and an owner 5xx each spend one unit; a 4xx spends nothing, "
    "because the request itself was refused and sending it again would be refused again. "
    "The window moves, so an allowance spent an hour ago is back by now, and a burst of "
    "failures inside a single minute exhausts it quickly on purpose: at that point the "
    "provider is having a bad time and a fast, honest error is worth more than a slow one. "
    "When the budget is exhausted the next attempt is not made at all, the turn reports the "
    "last failure it saw, and the conversation stays exactly where it was so you can try "
    "again by hand. Nothing in the budget is shared between providers, so a failing "
    "fallback never starves the primary, and a model switch mid-conversation starts from a "
    "full allowance on the new provider rather than inheriting the old one's debt."
)
_LONG = _LONG + "\n\n" + (
    "Two consequences are worth knowing. First, a long tool run can outlive a window, so the "
    "budget a long turn sees is the one in force when each attempt is made, not the one at the "
    "start of the turn. Second, a cancelled turn spends nothing for the attempts it never made, "
    "so stopping a run that is failing is always cheaper than letting it exhaust the allowance."
)
LONG_PIECES = [_LONG[i : i + 110] for i in range(0, len(_LONG), 110)]


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
    if TOOLCALL_FOREVER_MARKER in last_user or (
        TOOLCALL_MARKER in last_user and not already_corrected
    ):
        # A bare tool call and NO text: exactly the shape the guard exists for.
        delay = SLOW_SECONDS if SLOW_MARKER in last_user else 0.05
        return [(delay if i == 0 else 0.05, c) for i, c in enumerate([
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
        ])]
    # design-482-r3 additions: exact line counts (hard breaks, short lines that never
    # wrap), a SLOW-paced long answer (so scroll can be sampled mid-stream), and a
    # thread turn with a long first-chunk delay (so "Waiting for the agent" holds).
    import re as _re
    m = _re.search(r"NLINES(\d+)", last_user)
    if m:
        n = int(m.group(1))
        text = "  \n".join(f"Line {i + 1} of {n}." for i in range(n))
        return [(0.2, _chunk({"role": "assistant", "content": text})), (0.05, _chunk({}, finish="stop")),
                (0.05, _chunk({}, usage={"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10}))]
    if "LONGSLOW" in last_user:
        return [(1.0 if i == 0 else 0.35, _chunk({"role": "assistant", "content": piece} if i == 0 else {"content": piece}))
                for i, piece in enumerate(LONG_PIECES)] + [
            (0.05, _chunk({}, finish="stop")),
            (0.05, _chunk({}, usage={"prompt_tokens": 21, "completion_tokens": 300, "total_tokens": 321})),
        ]
    if "SLOWTURN" in last_user:
        return [(6.0 if i == 0 else 0.3, _chunk({"role": "assistant", "content": piece} if i == 0 else {"content": piece}))
                for i, piece in enumerate(RETRY_PIECES)] + [(0.05, _chunk({}, finish="stop"))]
    if LONG_MARKER in last_user:
        return [(0.1, _chunk({"role": "assistant", "content": piece} if i == 0 else {"content": piece}))
                for i, piece in enumerate(LONG_PIECES)] + [
            (0.05, _chunk({}, finish="stop")),
            (0.05, _chunk({}, usage={"prompt_tokens": 21, "completion_tokens": 300, "total_tokens": 321})),
        ]
    out = []
    for i, piece in enumerate(RETRY_PIECES):
        out.append((1.8 if i == 0 else 0.3, _chunk({"role": "assistant", "content": piece} if i == 0 else {"content": piece})))
    out.append((0.05, _chunk({}, finish="stop")))
    out.append((0.05, _chunk({}, usage={"prompt_tokens": 21, "completion_tokens": 60, "total_tokens": 81})))
    return out


def _content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "") for block in content if isinstance(block, dict)
        )
    return json.dumps(content)


def _projection(body: dict) -> dict:
    """A SMALL, readable view of one request for the evidence log.

    The full body carries the system prompt and the whole tool catalogue, which
    is megabytes of noise; what the evidence needs instead is: what the model saw
    as the question (is the aside instruction there?), whether a rejected call
    came back with its result, and how many messages the request had.
    """
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
        "path": None,  # filled in by the handler
        "model": body.get("model"),
        "n_messages": len(messages),
        "last_user_head": last_user[:260],
        "assistant_tool_calls": calls,
        "tool_results": results,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args) -> None:  # noqa: ANN002 — silence the default access log
        pass

    def _send(self, payload: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802 — http.server's spelling
        if self.path.rstrip("/").endswith("models"):
            # ``max_model_len`` is the ACTIVE serving budget local discovery reads
            # as the window (``max_context_length`` is only the training maximum,
            # and a server that reports neither is assumed to be a 4,096-token
            # default — which an aside's ~16.5k-token context would not fit).
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

    def do_POST(self) -> None:  # noqa: N802 — http.server's spelling
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
        for delay, piece in _script(body):
            time.sleep(delay)  # the first-chunk delay, then gaps so deltas are VISIBLY separate
            self.wfile.write(piece.encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    # The caller learns the port the OS chose from this file: the stub is started
    # with port 0, so nothing here may assume a number.
    port_file = os.environ.get("STUB_PORT_FILE")
    if port_file:
        with open(port_file, "w", encoding="utf-8") as handle:
            handle.write(str(server.server_address[1]))
    server.serve_forever()
