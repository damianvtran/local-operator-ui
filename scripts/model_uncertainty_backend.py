"""Owned real-core transport seam for the native model-uncertainty case.

The fault must live inside the real serve listener: desktop discovery rejects an
external proxy without a truthful serve record, or selects the un-gated upstream.
This launcher keeps the published core app, lifespan, authentication and handlers
intact and wraps only ASGI delivery. It is never imported by production code.
"""
from __future__ import annotations

import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading
import hashlib
from typing import Any

CORE_VERSION = "0.94.15"
CORE_REF = "a8c96c2ac1d71b776f40ed68ae5a2322bbe3c1ed"


class DeliveryGate:
    """Observe all attempts; withholding replies must not authorize mutations.

    A gate captures original ASGI messages, not replacement JSON authority. Its
    release only resumes the original sender, retaining the request's causality.
    No path policy here blocks a replay or settings write to manufacture zeroes.
    """

    def __init__(self) -> None:
        self.attempts: list[dict[str, Any]] = []
        self.held: dict[int, asyncio.Event] = {}
        self.captures: list[dict[str, Any]] = []
        self.hold_reads = False
        self.session_id: str | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.drop_b_ack = False
        self.expected_b = "mock-model-b"
        self.observer_token = os.environ.get("MODEL_CASE_OBSERVER_TOKEN", "")
        # Core consumes its bootstrap bearer from environ. Retain only this
        # private in-memory copy for independent authenticated owner reads.
        self.bearer = os.environ.get("LOCAL_OPERATOR_DESKTOP_TOKEN", "")
        self.commit: dict[str, Any] | None = None
        self.hold_first_snapshot = False
        self.hold_live_catalogue = False
        self.b_request_index: int | None = None
        self.captured_bytes = 0
        self.feed_opens: list[dict[str, Any]] = []
        self.evidence_order = 0

    def next_order(self) -> int:
        self.evidence_order += 1
        return self.evidence_order

    def release(self, indices: list[int] | None = None) -> None:
        if indices is None:
            self.hold_reads = False
            self.hold_first_snapshot = False
            self.hold_live_catalogue = False
        for index, event in self.held.items():
            if indices is None or index in indices:
                event.set()


class ModelUncertaintyMiddleware:
    def __init__(self, app: Any, *, gate: DeliveryGate) -> None:
        self.app = app
        self.gate = gate

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # Recorded before auth/routing, so refused and replayed attempts count.
        self.gate.loop = asyncio.get_running_loop()
        index = len(self.gate.attempts)
        path = scope.get("path", "")
        headers = dict(scope.get("headers", []))
        observer = bool(self.gate.observer_token) and headers.get(b"x-model-case-observer", b"").decode() == self.gate.observer_token
        attempt: dict[str, Any] = {"index": index, "method": scope["method"], "path": path, "observer": observer}
        if index >= 4096:
            raise RuntimeError("model case attempt bound exceeded")
        attempt["order"] = self.gate.next_order()
        self.gate.attempts.append(attempt)
        is_presence = path == "/v1/desktop/presence"
        if is_presence:
            attempt["query_empty"] = not bool(scope.get("query_string", b""))
        # Observe original bytes on the existing app feed only. No extra stream,
        # body rewrite, auth-header retention, or observation await is introduced.
        is_app_feed = not observer and scope["method"] == "GET" and path == "/v1/desktop/events"
        feed_open: dict[str, Any] | None = None
        feed_buffer = b""
        feed_done = False
        response_status: int | None = None
        downstream_send = send

        async def observed_send(message: dict[str, Any]) -> None:
            nonlocal feed_open, feed_buffer, feed_done, response_status
            if message["type"] == "http.response.start":
                response_status = message["status"]
                if is_presence:
                    attempt["response_status"] = response_status
            if is_app_feed and response_status == 200 and not feed_done and message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                if len(feed_buffer) + len(chunk) > 16_384:
                    # Missing evidence fails policy later, never changes delivery.
                    attempt["feed_observation_error"] = "open event evidence bound exceeded"
                    feed_done, feed_buffer = True, b""
                else:
                    feed_buffer = (feed_buffer + chunk).replace(b"\r\n", b"\n")
                    while b"\n\n" in feed_buffer:
                        event, feed_buffer = feed_buffer.split(b"\n\n", 1)
                        data = b"\n".join(line[5:].lstrip(b" ") for line in event.split(b"\n") if line.startswith(b"data:"))
                        try:
                            frame = json.loads(data)
                        except (ValueError, UnicodeDecodeError, RecursionError):
                            continue
                        if isinstance(frame, dict) and frame.get("type") == "open":
                            payload = frame.get("payload")
                            subscription = payload.get("subscription_id") if isinstance(payload, dict) else None
                            if isinstance(subscription, str) and 0 < len(subscription) <= 64 and len(self.gate.feed_opens) < 64:
                                feed_open = {"request_index": index, "subscription_id": subscription,
                                             "open_order": self.gate.next_order(), "close_order": None,
                                             "response_status": response_status, "delivered": False}
                                self.gate.feed_opens.append(feed_open)
                            feed_done, feed_buffer = True, b""
                            break
            if is_app_feed and feed_open is not None and message["type"] == "http.response.body" and not message.get("more_body", False) and feed_open["close_order"] is None:
                feed_open["close_order"] = self.gate.next_order()
            await downstream_send(message)
            if feed_open is not None:
                feed_open["delivered"] = True

        send = observed_send
        incoming: list[dict[str, Any]] = []
        body = b""
        if scope["method"] in {"POST", "PATCH"}:
            while True:
                message = await receive()
                incoming.append(message)
                body += message.get("body", b"")
                if len(body) > 900_000:
                    raise RuntimeError("model case input exceeded its reviewed payload bound")
                if not message.get("more_body", False):
                    break
            try:
                parsed = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                parsed = None
            if isinstance(parsed, dict):
                if path.endswith("/commands") or path in {"/v1/settings/hosting", "/v1/settings/model_name"}:
                    attempt["body"] = parsed
                elif is_presence and scope["method"] == "POST":
                    # Only the reviewed nonsecret shape is retained. Invalid
                    # bodies still count/hash, but unknown fields/values never
                    # turn the evidence file into a credential/payload sink.
                    safe = (set(parsed) == {"subscription_id", "can_notify", "can_notify_kinds", "session_id", "window"}
                            and isinstance(parsed["subscription_id"], str) and 0 < len(parsed["subscription_id"]) <= 64
                            and type(parsed["can_notify"]) is bool
                            and isinstance(parsed["can_notify_kinds"], list) and len(parsed["can_notify_kinds"]) <= 8
                            and all(kind in ("complete", "error") for kind in parsed["can_notify_kinds"])
                            and isinstance(parsed["session_id"], str) and len(parsed["session_id"]) <= 12
                            and isinstance(parsed["window"], dict) and set(parsed["window"]) == {"exists", "focused", "visible", "minimized"}
                            and all(type(value) is bool for value in parsed["window"].values()))
                    if safe:
                        attempt["body"] = parsed
                    else:
                        attempt["presence_body_invalid"] = True
                        attempt["body_sha256"] = hashlib.sha256(body).hexdigest()
                else:
                    attempt["body_sha256"] = hashlib.sha256(body).hexdigest()
            elif is_presence:
                attempt["presence_body_invalid"] = True
                attempt["body_sha256"] = hashlib.sha256(body).hexdigest()
        async def original_receive() -> dict[str, Any]:
            message = incoming.pop(0) if incoming else await receive()
            if message["type"] == "http.disconnect" and feed_open is not None and feed_open["close_order"] is None:
                feed_open["close_order"] = self.gate.next_order()
            return message

        session_path = f"/v1/desktop/sessions/{self.gate.session_id}"
        is_authority_read = (not observer and scope["method"] == "GET" and (path in {session_path, session_path + "/events", "/v1/desktop/events", "/v1/desktop/sessions"} or (path == "/v1/desktop/models" and b"live=true" in scope.get("query_string", b""))))
        first_snapshot = (self.gate.hold_first_snapshot and not observer and scope["method"] == "GET" and path == session_path)
        authority_success = True

        buffered_start: dict[str, Any] | None = None
        drop_ack = (self.gate.drop_b_ack and not observer and path == f"/v1/desktop/sessions/{self.gate.session_id}/commands" and isinstance(attempt.get("body"), dict) and attempt["body"].get("command") == "model" and attempt["body"].get("args") == f"test/{self.gate.expected_b}")

        if drop_ack:
            self.gate.b_request_index = index
        ack_discarded = False

        async def deliver(message: dict[str, Any]) -> None:
            nonlocal buffered_start, first_snapshot, authority_success, ack_discarded
            if ack_discarded:
                return
            # Re-evaluate on every chunk: a watch opened before arming is
            # still an authority carrier after the mutation.
            selected_read = authority_success and (first_snapshot or (is_authority_read and (self.gate.hold_reads or (self.gate.hold_live_catalogue and path == "/v1/desktop/models"))))
            gated = selected_read or drop_ack
            if gated and message["type"] == "http.response.start":
                if message["status"] != 200:
                    authority_success = False
                    first_snapshot = False
                    await send(message)
                    return
                if first_snapshot:
                    self.gate.hold_first_snapshot = False
                buffered_start = dict(message)
                attempt["upstream_status"] = message["status"]
                return
            if gated and message["type"] == "http.response.body" and message.get("body"):
                data = message.get("body", b"")
                if len(data) > 2_000_000 or len(self.gate.captures) >= 64 or self.gate.captured_bytes + len(data) > 8_000_000:
                    raise RuntimeError("model case capture bound exceeded")
                capture_id = len(self.gate.captures)
                event = asyncio.Event()
                self.gate.held[capture_id] = event
                capture = {"id": capture_id, "request_index": index, "path": path, "before_b_request": self.gate.b_request_index is None, "body": data.decode("utf-8"), "sha256": hashlib.sha256(data).hexdigest()}
                self.gate.captured_bytes += len(data)
                self.gate.captures.append(capture)
                if drop_ack and buffered_start is not None and buffered_start["status"] == 200:
                    await self.verify_b_commit()
                    self.gate.drop_b_ack = False
                    # Lose only this downstream ACK. Raising after a 500 lets
                    # Uvicorn reset a pooled socket underneath the NEXT GET;
                    # an explicit gateway fault/close avoids poisoning that read.
                    # This is transport data, never a fabricated owner notice.
                    ack_discarded = True
                    attempt["downstream_fault"] = 504
                    await send({"type": "http.response.start", "status": 504, "headers": [(b"content-type", b"text/plain"), (b"connection", b"close")]})
                    await send({"type": "http.response.body", "body": b"owned test gateway discarded the committed ACK", "more_body": False})
                    return
                if selected_read:
                    await asyncio.wait_for(event.wait(), timeout=90)
                    self.gate.held.pop(capture_id, None)
                if buffered_start is not None:
                    await send(buffered_start)
                    buffered_start = None
            await send(message)

        try:
            await self.app(scope, original_receive, deliver)
        finally:
            if feed_open is not None and feed_open["close_order"] is None:
                feed_open["close_order"] = self.gate.next_order()

    async def verify_b_commit(self) -> None:
        import httpx
        from local_operator.session.model_selection import selection_from_payloads
        sid = self.gate.session_id
        async with httpx.AsyncClient(trust_env=False) as client:
            response = await client.get(f"http://127.0.0.1:8080/v1/desktop/sessions/{sid}", headers={"authorization": "Bearer " + self.gate.bearer, "x-model-case-observer": self.gate.observer_token})
            response.raise_for_status()
            real = response.json()["result"]
        payload = real["payload"]
        state = payload["frontend"]["snapshot"]
        if payload["cold"] or any(state[key]["model_id"] != self.gate.expected_b for key in ("selected_model", "effective_model")):
            raise RuntimeError("model ACK fault refused: real owner is not live B")
        journal = Path(os.environ["LOCAL_OPERATOR_CONFIG_DIR"]) / "sessions" / str(sid) / "transcript.jsonl"
        rows = [json.loads(line) for line in journal.read_text().splitlines()]
        saved = selection_from_payloads(row["payload"] for row in rows if row["type"] == "custom")
        if saved is None or (saved.provider, saved.model_id) != ("test", self.gate.expected_b):
            raise RuntimeError("model ACK fault refused: journal does not independently select B")
        self.gate.commit = {"epoch": real["epoch"], "seq": real["seq"], "selected": state["selected_model"]["model_id"], "effective": state["effective_model"]["model_id"], "durable": saved.model_id}


def control_pipe(gate: DeliveryGate) -> None:
    """Private parent pipe, never an HTTP route the app could invoke."""
    for line in sys.stdin:
        command: dict[str, Any] = {}
        try:
            if len(line) > 4096:
                raise ValueError("control input exceeded its bound")
            command = json.loads(line)
            if not isinstance(command, dict):
                raise ValueError("control input must be an object")
            if command["op"] == "configure":
                sid = command["session_id"]
                if len(sid) != 12 or any(c not in "0123456789abcdef" for c in sid):
                    raise ValueError("invalid owned session id")
                gate.session_id = sid
                gate.hold_reads = bool(command.get("hold_reads", False))
                gate.drop_b_ack = bool(command.get("drop_b_ack", False))
                gate.hold_first_snapshot = bool(command.get("hold_first_snapshot", False))
                gate.hold_live_catalogue = bool(command.get("hold_live_catalogue", gate.hold_live_catalogue))
                if gate.drop_b_ack and not gate.observer_token:
                    raise ValueError("ACK fault requires the private observer token")
            elif command["op"] == "release":
                if gate.loop is None:
                    raise RuntimeError("no observed event loop")
                gate.loop.call_soon_threadsafe(gate.release, command.get("indices"))
            elif command["op"] == "seed":
                seed_catalogue()
            elif command["op"] != "state":
                raise ValueError("unsupported control operation")
            result = {"id": command["id"], "ok": True, "attempts": gate.attempts, "captures": gate.captures, "feed_opens": gate.feed_opens, "commit": gate.commit, "identity": {"prefix": sys.prefix, "version": importlib.metadata.version("local-operator")}}
        except (ValueError, KeyError, RuntimeError) as error:
            result = {"id": command.get("id") if isinstance(command, dict) else None, "ok": False, "error": str(error)}
        print("MODEL_CASE_CONTROL " + json.dumps(result), flush=True)
    # The parent owns the private pipe. An unexpected parent exit must not
    # strand a real daemon/listener, even when no JS finally block can run.
    if gate.loop is not None:
        gate.loop.call_soon_threadsafe(gate.release)
    import signal
    os.kill(os.getpid(), signal.SIGTERM)


def restrict_network() -> None:
    """No provider, DNS, native helper or operator unix service may escape this rig."""
    import socket
    import subprocess
    original_connect = socket.socket.connect
    original_lookup = socket.getaddrinfo
    original_popen = subprocess.Popen
    def refused(kind: str) -> None:
        target = os.environ.get("MODEL_CASE_GUARD_LOG")
        if target:
            with open(target, "a", encoding="utf-8") as stream:
                stream.write(json.dumps({"blocked": kind}) + "\n")
        raise OSError("owned model case refuses " + kind)
    def connect(sock: Any, address: Any) -> Any:
        if sock.family in (socket.AF_INET, socket.AF_INET6) and str(address[0]) not in {"127.0.0.1", "::1", "localhost"}:
            refused("external-network")
        if sock.family == socket.AF_UNIX and not str(address).startswith(os.environ["HOME"]):
            refused("external-unix-service")
        return original_connect(sock, address)
    def lookup(host: Any, *args: Any, **kwargs: Any) -> Any:
        if str(host) not in {"127.0.0.1", "::1", "localhost", "None"}:
            refused("external-dns")
        return original_lookup(host, *args, **kwargs)
    def popen(args: Any, *rest: Any, **kwargs: Any) -> Any:
        words = list(map(str, args)) if isinstance(args, (tuple, list)) else [str(args)]
        if words and (Path(words[0]).name in {"security", "osascript", "defaults", "open"} or any("keyagent" in word for word in words)):
            refused("native-helper")
        child = original_popen(args, *rest, **kwargs)
        ledger = os.environ.get("MODEL_CASE_CHILD_PIDS")
        if ledger:
            with open(ledger, "a", encoding="utf-8") as stream:
                stream.write(str(child.pid) + "\n")
        return child
    socket.socket.connect = connect
    socket.getaddrinfo = lookup
    subprocess.Popen = popen


def seed_catalogue() -> None:
    import dataclasses
    from local_operator.model import catalogue, discovery
    rows = [discovery.DiscoveredModel(id=name, name=name, context_window=8192) for name in ("mock-model-a", "mock-model-b")]
    # Use the production writer/parser/capture format, never HTTP inventory.
    payload = {"capture": discovery.listing_capture_version("test"), "models": [dataclasses.asdict(row) for row in rows]}
    catalogue._write_cache(catalogue._cache_path(discovery._cache_key("test"), None), payload)


def validate_core(origin: Path, prefix: Path, version: str) -> None:
    if version != CORE_VERSION:
        raise RuntimeError("model case requires the published core 0.94.15")
    if not origin.resolve().is_relative_to(prefix.resolve()):
        raise RuntimeError("model case refuses an editable/borrowed source winner")


def main() -> int:
    import importlib.util
    spec = importlib.util.find_spec("local_operator")
    if spec is None or spec.origin is None:
        raise RuntimeError("published core package missing")
    validate_core(Path(spec.origin), Path(sys.prefix), importlib.metadata.version("local-operator"))
    from local_operator import cli
    from local_operator.server.app import app
    if not os.environ.get("LOCAL_OPERATOR_DESKTOP_TOKEN"):
        raise RuntimeError("model case requires its owned environment-only bearer")
    gate = DeliveryGate()
    app.add_middleware(ModelUncertaintyMiddleware, gate=gate)
    threading.Thread(target=control_pipe, args=(gate,), daemon=True).start()
    # The real CLI owns bind, advertised address, authenticated serve record,
    # lifespan and graceful teardown. Never publish a proxy-shaped fake record.
    sys.argv = ["lop", "serve", "--host", "127.0.0.1", "--port", "8080"]
    return cli.main()


if __name__ == "__main__":
    raise SystemExit(main())
