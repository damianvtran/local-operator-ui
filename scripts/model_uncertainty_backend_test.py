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
    async def invoke(self, app, gate, *, method="GET", path="/v1/desktop/sessions/aaaaaaaaaaaa", body=b"", sent=None):
        sent = [] if sent is None else sent
        async def receive():
            return {"type": "http.request", "body": body}
        async def send(message):
            sent.append(dict(message))
        await module.ModelUncertaintyMiddleware(app, gate=gate)({"type": "http", "method": method, "path": path, "headers": [], "query_string": b""}, receive, send)
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

    async def test_wrong_source_and_version_fail_before_app_boot(self):
        with self.assertRaisesRegex(RuntimeError, "borrowed"):
            module.validate_core(Path("/foreign/local_operator/__init__.py"), Path("/owned"), "0.94.15")
        with self.assertRaisesRegex(RuntimeError, "0.94.15"):
            module.validate_core(Path("/owned/local_operator/__init__.py"), Path("/owned"), "0.94.14")


if __name__ == "__main__":
    unittest.main()
