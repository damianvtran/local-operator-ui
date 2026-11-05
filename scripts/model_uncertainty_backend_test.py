"""Pure ASGI/source contracts; no core server, Electron, network or install."""
import asyncio
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import io
import os
import signal

spec = importlib.util.spec_from_file_location("model_case", Path(__file__).with_name("model_uncertainty_backend.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Contracts(unittest.IsolatedAsyncioTestCase):
    async def invoke(self, app, gate, *, method="GET", path="/v1/desktop/sessions/aaaaaaaaaaaa", body=b"", sent=None, query=b""):
        sent = [] if sent is None else sent
        async def receive():
            return {"type": "http.request", "body": body}
        async def send(message):
            sent.append(dict(message))
        await module.ModelUncertaintyMiddleware(app, gate=gate)({"type": "http", "method": method, "path": path, "headers": [], "query_string": query}, receive, send)
        return sent

    async def test_transparent_and_attempt_recorded_before_handler(self):
        gate = module.DeliveryGate()
        async def app(scope, receive, send):
            self.assertEqual(len(gate.attempts), 1)
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"original"})
        result = await self.invoke(app, gate)
        self.assertEqual(result[-1]["body"], b"original")

    async def test_causal_first_read_and_empty_terminator_complete(self):
        gate = module.DeliveryGate()
        gate.session_id = "aaaaaaaaaaaa"
        gate.hold_first_snapshot = True
        original = b'{"cold":true,"epoch":"original"}'
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": original, "more_body": True})
            await send({"type": "http.response.body", "body": b"", "more_body": False})
        sent = []
        task = asyncio.create_task(self.invoke(app, gate, sent=sent))
        for _ in range(20):
            if gate.captures:
                break
            await asyncio.sleep(0)
        self.assertEqual(sent, [])
        self.assertTrue(gate.captures[0]["before_b_request"])
        self.assertEqual(gate.captures[0]["body"].encode(), original)
        gate.release([gate.captures[0]["id"]])
        await asyncio.wait_for(task, 1)
        self.assertEqual(b"".join(x.get("body", b"") for x in sent), original)
        self.assertEqual(len(gate.captures), 1)

    async def test_gate_never_polices_default_writes(self):
        gate = module.DeliveryGate()
        gate.hold_reads = True
        gate.session_id = "aaaaaaaaaaaa"
        calls = []
        async def app(scope, receive, send):
            calls.append(json.loads((await receive())["body"]))
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"accepted"})
        await self.invoke(app, gate, method="PATCH", path="/v1/settings/model_name", body=b'{"value":"wrong-old-A","base":null}')
        self.assertEqual(calls[0]["value"], "wrong-old-A")
        self.assertEqual(len(gate.attempts), 1)
        self.assertEqual(gate.captures, [])

    async def test_refused_command_is_not_discarded_as_a_success(self):
        gate = module.DeliveryGate()
        gate.session_id = "aaaaaaaaaaaa"
        gate.drop_b_ack = True
        async def app(scope, receive, send):
            await receive()
            await send({"type": "http.response.start", "status": 401})
            await send({"type": "http.response.body", "body": b"real refusal"})
        result = await self.invoke(app, gate, method="POST", path="/v1/desktop/sessions/aaaaaaaaaaaa/commands", body=b'{"command":"model","args":"test/mock-model-b"}')
        self.assertEqual(result[0]["status"], 401)
        self.assertEqual(result[-1]["body"], b"real refusal")
        self.assertIsNone(gate.commit)

    async def test_parent_eof_targets_only_its_own_pid(self):
        gate = module.DeliveryGate()
        # No actual signal in a unit fixture; calibrate the exact self target.
        with patch.object(module.sys, 'stdin', io.StringIO('')), patch.object(module.os, 'kill') as stop:
            module.control_pipe(gate)
        stop.assert_called_once_with(os.getpid(), signal.SIGTERM)

    async def test_presence_original_chunked_open_body_status_and_lifecycle(self):
        gate = module.DeliveryGate()
        gate.observer_token = "owned-observer"
        ready, finish = asyncio.Event(), asyncio.Event()
        wire = b'data: {"type":"open","payload":{"subscription_id":"owned-feed"}}\r\n\r\n'
        async def feed(scope, receive, send):
            await send({"type": "http.response.start", "status": 200})
            for byte in wire:
                await send({"type": "http.response.body", "body": bytes([byte]), "more_body": True})
            ready.set()
            await finish.wait()
            await send({"type": "http.response.body", "body": b"", "more_body": False})
        sent = []
        task = asyncio.create_task(self.invoke(feed, gate, path="/v1/desktop/events", sent=sent))
        try:
            await asyncio.wait_for(ready.wait(), 1)
            self.assertEqual(b"".join(x.get("body", b"") for x in sent), wire)
            witness = gate.feed_opens[0]
            self.assertTrue(witness["delivered"])
            self.assertIsNone(witness["close_order"])
            body = {"subscription_id": "owned-feed", "can_notify": True, "can_notify_kinds": ["complete", "error"], "session_id": "", "window": {"exists": False, "focused": False, "visible": False, "minimized": False}}
            async def presence(scope, receive, send):
                self.assertEqual(json.loads((await receive())["body"]), body)
                await send({"type": "http.response.start", "status": 200})
                await send({"type": "http.response.body", "body": b"original reply"})
            reply = await self.invoke(presence, gate, method="POST", path="/v1/desktop/presence", body=json.dumps(body).encode())
            attempt = gate.attempts[-1]
            self.assertEqual(attempt["body"], body)
            self.assertTrue(attempt["query_empty"])
            self.assertEqual(attempt["response_status"], 200)
            self.assertLess(witness["open_order"], attempt["order"])
            self.assertEqual(reply[-1]["body"], b"original reply")
        finally:
            finish.set()
            await asyncio.wait_for(task, 1)
        self.assertGreater(witness["close_order"], attempt["order"])
        self.assertNotIn("owned-observer", json.dumps({"attempts": gate.attempts, "feed_opens": gate.feed_opens}))

    async def test_presence_bad_body_is_counted_and_forwarded_without_logging_unknown_values(self):
        gate = module.DeliveryGate()
        body = {"subscription_id": "unknown", "token": "DO_NOT_RETAIN"}
        async def app(scope, receive, send):
            self.assertEqual(json.loads((await receive())["body"]), body)
            await send({"type": "http.response.start", "status": 422})
            await send({"type": "http.response.body", "body": b"rejected"})
        await self.invoke(app, gate, method="POST", path="/v1/desktop/presence", body=json.dumps(body).encode())
        self.assertEqual(len(gate.attempts), 1)
        self.assertTrue(gate.attempts[0]["presence_body_invalid"])
        self.assertEqual(gate.attempts[0]["response_status"], 422)
        self.assertNotIn("DO_NOT_RETAIN", json.dumps(gate.attempts))

    async def test_open_evidence_bound_does_not_change_original_delivery(self):
        gate = module.DeliveryGate()
        original = b"x" * 16385
        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": original})
        sent = await self.invoke(app, gate, path="/v1/desktop/events")
        self.assertEqual(sent[-1]["body"], original)
        self.assertEqual(gate.feed_opens, [])
        self.assertIn("feed_observation_error", gate.attempts[0])

    async def test_non_app_or_rejected_feed_cannot_create_open_witness(self):
        for mode in ("observer", "wrong-path", "rejected", "failed-send"):
            gate = module.DeliveryGate()
            gate.observer_token = "owned-test-observer"
            async def app(scope, receive, send):
                await send({"type": "http.response.start", "status": 401 if mode == "rejected" else 200})
                await send({"type": "http.response.body", "body": b'data: {"type":"open","payload":{"subscription_id":"owned-feed"}}\n\n', "more_body": True})
            async def receive():
                return {"type": "http.request", "body": b""}
            async def send(message):
                if mode == "failed-send" and message["type"] == "http.response.body":
                    raise RuntimeError("original sender failed")
            scope = {"type": "http", "method": "GET", "path": "/wrong" if mode == "wrong-path" else "/v1/desktop/events", "query_string": b"", "headers": [(b"authorization", b"never-retain-this"), *(([(b"x-model-case-observer", b"owned-test-observer")]) if mode == "observer" else [])]}
            if mode == "failed-send":
                with self.assertRaisesRegex(RuntimeError, "original sender failed"):
                    await module.ModelUncertaintyMiddleware(app, gate=gate)(scope, receive, send)
                self.assertFalse(gate.feed_opens[0]["delivered"])
            else:
                await module.ModelUncertaintyMiddleware(app, gate=gate)(scope, receive, send)
                self.assertEqual(gate.feed_opens, [])
            self.assertNotIn("never-retain-this", json.dumps(gate.attempts + gate.feed_opens))

    async def test_original_list_minimization_delivered_before_resident_queries(self):
        gate = module.DeliveryGate()
        gate.scope_id = "owned-scope"
        data = {"result": {"sessions": [{"id": "bbbbbbbbbbbb", "locality": "local", "peer": None, "name": "NEVER_RETAIN_TITLE", "preview": "NEVER_RETAIN_CONTENT"}, {"id": "cccccccccccc"}]}}
        original = json.dumps(data).encode()
        async def listing(scope, receive, send):
            await send({"type": "http.response.start", "status": 200})
            for byte in original:
                await send({"type": "http.response.body", "body": bytes([byte]), "more_body": True})
            await send({"type": "http.response.body", "body": b"", "more_body": False})
        sent = await self.invoke(listing, gate, path="/v1/desktop/sessions")
        self.assertEqual(b"".join(m.get("body", b"") for m in sent), original)
        witness = gate.list_witnesses[0]
        self.assertEqual(witness["rows"], [{"id": "bbbbbbbbbbbb", "local": True, "peer_null": True}, {"id": "cccccccccccc", "local": False, "peer_null": False}])
        self.assertNotIn("NEVER_RETAIN", json.dumps(witness))
        async def read(scope, receive, send):
            await send({"type": "http.response.start", "status": 200})
            await send({"type": "http.response.body", "body": b"{}"})
        await self.invoke(read, gate, path="/v1/desktop/sessions/bbbbbbbbbbbb/command-entities", query=b"command=effort")
        self.assertEqual(gate.attempts[-1]["query"], {"command": "effort"})
        self.assertLess(witness["delivery_order"], gate.attempts[-1]["order"])
        for query in (b"command=effort&command=model", b"name=NEVER_RETAIN_QUERY", b"comm%61nd=effort", b"command=model"):
            await self.invoke(read, gate, path="/v1/desktop/sessions/bbbbbbbbbbbb/command-entities", query=query)
            self.assertTrue(gate.attempts[-1]["query_invalid"])
            self.assertNotIn("NEVER_RETAIN_QUERY", json.dumps(gate.attempts[-1]))

    async def test_undelivered_or_non200_list_never_authorizes_resident(self):
        for failed_send, status in ((True, 200), (False, 401)):
            gate = module.DeliveryGate()
            gate.scope_id = "owned-scope"
            async def app(scope, receive, send):
                await send({"type": "http.response.start", "status": status})
                await send({"type": "http.response.body", "body": b'{"result":{"sessions":[{"id":"bbbbbbbbbbbb","locality":"local","peer":null}]}}'})
            async def receive():
                return {"type": "http.request", "body": b""}
            async def send(message):
                if failed_send and message["type"] == "http.response.body":
                    raise RuntimeError("original delivery failed")
            scope = {"type": "http", "method": "GET", "path": "/v1/desktop/sessions", "query_string": b"", "headers": []}
            if failed_send:
                with self.assertRaisesRegex(RuntimeError, "original delivery failed"):
                    await module.ModelUncertaintyMiddleware(app, gate=gate)(scope, receive, send)
            else:
                await module.ModelUncertaintyMiddleware(app, gate=gate)(scope, receive, send)
            self.assertEqual(gate.list_witnesses, [])

    async def test_preview_exact_owned_cwd_null_selection_and_symlink_escape(self):
        import tempfile
        with tempfile.TemporaryDirectory(dir=os.environ.get("TMPDIR")) as directory:
            owned = Path(directory).resolve() / "fixture"
            owned.mkdir()
            foreign = Path(directory).resolve() / "foreign"
            foreign.mkdir()
            (owned / "escape").symlink_to(foreign, target_is_directory=True)
            gate = module.DeliveryGate()
            gate.fixture_cwd = str(owned)
            gate.scope_id = "owned-scope"
            calls = []
            async def app(scope, receive, send):
                calls.append(await receive())
                await send({"type": "http.response.start", "status": 200})
                await send({"type": "http.response.body", "body": b"{}"})
            neutral = {"request_id": "00000000-0000-0000-0000-000000000003", "cwd": str(owned), "target": None, "model": None}
            await self.invoke(app, gate, method="POST", path="/v1/desktop/sessions/preview", body=json.dumps(neutral).encode())
            self.assertEqual(gate.attempts[-1]["body"], neutral)
            for change in ({"cwd": str(foreign)}, {"cwd": str(owned / "escape")}, {"cwd": "../fixture"}, {"cwd": str(owned / "missing")}, {"target": {"peer": "NEVER_RETAIN_TARGET"}}, {"model": {"provider": "real", "model_id": "NEVER_RETAIN_MODEL"}}, {"extra": "NEVER_RETAIN_EXTRA"}):
                await self.invoke(app, gate, method="POST", path="/v1/desktop/sessions/preview", body=json.dumps(neutral | change).encode())
                self.assertTrue(gate.attempts[-1]["preview_scope_invalid"])
                self.assertNotIn("body", gate.attempts[-1])
                self.assertNotIn("NEVER_RETAIN", json.dumps(gate.attempts[-1]))
            self.assertEqual(len(calls), 8, "recorder must not suppress invalid attempts")

    async def test_bare_model_records_only_exact_original_native_action(self):
        gate = module.DeliveryGate()
        gate.session_id = "aaaaaaaaaaaa"
        body = {"request_id": "00000000-0000-0000-0000-000000000002", "command": "model", "args": "", "images": []}
        for destination in ("session.model", "wrong"):
            original = json.dumps({"result": {"command": "model", "result": {"kind": "native_action", "destination": destination, "session_id": gate.session_id, "args": "", "fields": ["NEVER_RETAIN_FIELDS"]}}}).encode()
            async def app(scope, receive, send):
                await receive()
                await send({"type": "http.response.start", "status": 200})
                await send({"type": "http.response.body", "body": original[:13], "more_body": True})
                await send({"type": "http.response.body", "body": original[13:]})
            await self.invoke(app, gate, method="POST", path=f"/v1/desktop/sessions/{gate.session_id}/commands", body=json.dumps(body).encode())
            self.assertEqual(gate.attempts[-1]["native_action"] is not None, destination == "session.model")
            self.assertNotIn("NEVER_RETAIN", json.dumps(gate.attempts[-1]))

    async def test_wrong_source_and_version_fail_before_app_boot(self):
        with self.assertRaisesRegex(RuntimeError, "borrowed"):
            module.validate_core(Path("/foreign/local_operator/__init__.py"), Path("/owned"), "0.94.15")
        with self.assertRaisesRegex(RuntimeError, "0.94.15"):
            module.validate_core(Path("/owned/local_operator/__init__.py"), Path("/owned"), "0.94.14")


if __name__ == "__main__":
    unittest.main()
