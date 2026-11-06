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

    async def test_resident_original_recorder_trace_reaches_real_policy(self):
        # Cross-language integration: pass the ACTUAL proxy attempts/list evidence
        # unchanged to the production policy. Hand-built delivery stamps let the
        # prior unit fixture pass while the real recorder omitted this field.
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory).resolve() / "config"
            config.mkdir()
            for mode in ("complete", "failed-final", "headers-only"):
                with self.subTest(mode=mode), patch.dict(os.environ, {"LOCAL_OPERATOR_CONFIG_DIR": str(config)}):
                    gate = module.DeliveryGate()
                    async def upstream(scope, receive, send):
                        await receive()
                        await send({"type": "http.response.start", "status": 200})
                        data = (b'{"result":{"sessions":[{"id":"bbbbbbbbbbbb","locality":"local","peer":null}]}}'
                                if scope["path"] == "/v1/desktop/sessions" else b'{"result":{}}')
                        await send({"type": "http.response.body", "body": data, "more_body": True})
                        if mode != "headers-only" or scope["path"] == "/v1/desktop/sessions":
                            await send({"type": "http.response.body", "body": b"", "more_body": False})
                    await self.invoke(upstream, gate, path="/v1/desktop/sessions")
                    for suffix, query in (("", b""), ("/command-entities", b"command=effort")):
                        if mode == "failed-final":
                            async def failed_send(message):
                                if message["type"] == "http.response.body" and not message.get("more_body", False):
                                    raise OSError("inert downstream failure")
                            async def receive():
                                return {"type": "http.request", "body": b""}
                            with self.assertRaises(OSError):
                                await module.ModelUncertaintyMiddleware(upstream, gate=gate)({"type": "http", "method": "GET", "path": "/v1/desktop/sessions/bbbbbbbbbbbb" + suffix, "headers": [], "query_string": query}, receive, failed_send)
                        else:
                            await self.invoke(upstream, gate, path="/v1/desktop/sessions/bbbbbbbbbbbb" + suffix, query=query)
                    trace = {"attempts": gate.attempts, "listWitnesses": gate.list_witnesses, "scopeId": gate.scope_id}
                    script = ("import { assertModelTraffic } from " + json.dumps(Path(__file__).with_name("model-uncertainty-native.mjs").as_uri())
                              + ";let text='';for await(const c of process.stdin)text+=c;const t=JSON.parse(text);assertModelTraffic(t.attempts,'aaaaaaaaaaaa',[],[],t);console.log('original-recorder-to-policy PASS');")
                    result = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(trace), capture_output=True, text=True, timeout=15)
                    if mode == "complete":
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(result.stdout.strip(), "original-recorder-to-policy PASS")
                    else:
                        self.assertNotEqual(result.returncode, 0, "undelivered resident response must never satisfy policy")

    async def test_preview_invalid_diagnostic_is_only_enums_and_booleans(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory).resolve())
            neutral = {"request_id": "00000000-0000-0000-0000-000000000002", "cwd": root}
            for change, field, expected in (
                ({}, "cwd_fixture_match", True),
                ({"cwd": root + "/missing"}, "cwd_existing_directory", False),
                ({"cwd": "NEVER_RETAIN_PATH"}, "cwd_absolute", False),
                ({"cwd": 7}, "cwd_type", "other"),
                ({"request_id": "NEVER_RETAIN_UUID"}, "request_id_valid", False),
                ({"target": {"agent": "NEVER_RETAIN_AGENT"}}, "target", "nonneutral"),
                ({"model": {"provider": "NEVER_RETAIN_MODEL"}}, "model", "nonneutral"),
                ({"NEVER_RETAIN_KEY": True}, "unknown_keys_present", True),
                ({"target": None}, "target", "null"),
            ):
                with self.subTest(field=field):
                    gate = module.DeliveryGate()
                    gate.fixture_cwd = root
                    async def upstream(scope, receive, send):
                        await receive()
                        await send({"type": "http.response.start", "status": 200})
                        await send({"type": "http.response.body", "body": b"{}"})
                    await self.invoke(upstream, gate, method="POST", path="/v1/desktop/sessions/preview", body=json.dumps(neutral | change).encode())
                    attempt = gate.attempts[-1]
                    diagnostic = attempt["preview_diagnostic"]
                    self.assertEqual(diagnostic[field], expected)
                    self.assertNotIn("NEVER_RETAIN", json.dumps(diagnostic))
                    self.assertNotIn(root, json.dumps(diagnostic))
                    self.assertTrue(all(type(v) is bool or v in {"omitted", "string", "null", "other", "nonneutral"} for v in diagnostic.values()))
                    self.assertEqual(attempt["response_status"], 200)
                    self.assertTrue(attempt["query_empty"])
            for invalid in (None, [], "NEVER_RETAIN_BODY"):
                diagnostic = module.preview_diagnostic(invalid, root)
                self.assertFalse(diagnostic["schema_object"])
                self.assertFalse(diagnostic["required_keys_present"])
                self.assertNotIn("NEVER_RETAIN", json.dumps(diagnostic))

    async def test_actual_neutral_home_builder_recorder_policy_and_identity_negatives(self):
        import hashlib
        import subprocess
        import tempfile
        # Actual source functions, including hydration/transitive query filtering.
        # Only transport is inert; returned raw body drives the actual recorder.
        builder = r"""
const fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const store=read('src/renderer/src/shared/store/canonical-sessions-store.ts'),selection=read('src/renderer/src/features/chat/draft-selection.ts'),page=read('src/renderer/src/features/chat/components/chat-page.tsx'),contract=read('src/shared/desktop-contract.ts');
function fn(s,n){const m=[...s.matchAll(new RegExp('^(?:export )?(?:async )?function '+n+'\\(','gm'))];assert.equal(m.length,1,n);const e=/^\}(?=\r?$)/gm;e.lastIndex=m[0].index;const end=e.exec(s);assert(end);return s.slice(m[0].index,end.index+1)}
const initial=store.slice(store.indexOf('export const useCanonicalSessionsStore ='),store.indexOf('setCwd:',store.indexOf('export const useCanonicalSessionsStore =')));
const props=['cwd','drafts','activeDraftKey','activeSessionId','forgotten'].map(k=>{const a=[...initial.matchAll(new RegExp('^[\\t ]+'+k+':[^\\n]+','gm'))];assert.equal(a.length,1,k);return a[0][0].trim().replace(/,$/,'')});
const target=[...page.matchAll(/const draftTarget: DraftSelectionTarget = (\{[\s\S]*?\n\t\});/g)];assert.equal(target.length,1);
let source=['launchTarget','launchSession','launchDraftSeed','draftsWithoutTombstonedPointers','mergePersistedSession','paneDraftKey'].map(n=>fn(store,n)).join('\n')+'\n'+['selectionSelector','draftModelForWire','draftPreviewKey','fetchDraftPreview','draftPreviewQuery'].map(n=>fn(selection,n)).join('\n')+'\n'+fn(contract,'desktopEndpoint');
source+='\nthis.run=async function(){const state=mergePersistedSession(undefined,{'+props.join(',')+'});const key=paneDraftKey(state.activeDraftKey,state.activeSessionId,state.drafts);const draft=state.drafts[key],cwd=state.cwd;const target='+target[0][1]+';await draftPreviewQuery(target,false).queryFn();await draftPreviewQuery(target,true).queryFn();};this.endpoint=desktopEndpoint;';
let result;const c={crypto:require('node:crypto').webcrypto,window:{api:{desktop:{}}},keepPreviousData:require('@tanstack/react-query').keepPreviousData,desktopResult:async command=>{result=c.endpoint(command);return {frontend:{}}}};
vm.createContext(c);vm.runInContext(esbuild.transformSync(source.replace(/^export /gm,''),{loader:'ts',target:'es2022'}).code,c);c.run().then(()=>{assert.equal(result.method,'POST');assert.equal(result.path,'/v1/desktop/sessions/preview');process.stdout.write(JSON.stringify(result.body))}).catch(e=>{console.error(e);process.exitCode=1});
"""
        repo = Path(__file__).resolve().parent.parent
        built = subprocess.run(["node", "-e", builder], cwd=repo, capture_output=True, text=True, timeout=15)
        self.assertEqual(built.returncode, 0, built.stderr)
        body = json.loads(built.stdout)
        self.assertEqual(set(body), {"cwd", "request_id"})
        self.assertEqual(body["cwd"], "~")
        policy_script = ("import {assertModelTraffic} from " + json.dumps(Path(__file__).with_name("model-uncertainty-native.mjs").as_uri())
                         + ";let t='';for await(const c of process.stdin)t+=c;const p=JSON.parse(t);assertModelTraffic(p.attempts,'aaaaaaaaaaaa',[],[],p.proof);")
        modes = ("happy", "null-selections", "absolute-case", "other-user", "slash", "suffix", "traversal", "relative", "foreign-absolute", "absolute-home", "whitespace", "wrong-home", "wrong-declared-home", "wrong-config", "wrong-scope", "missing-home-authority", "missing-scope-authority", "missing-fixture", "nonexistent-home", "symlink-escape", "nonnull-target", "nonnull-model", "unknown-key", "bad-uuid", "query", "non200", "undelivered", "unfinished", "duplicate", "wrong-default", "target-false", "target-empty", "target-list", "model-false", "model-zero", "model-list", "wrong-policy-home", "missing-policy-home", "wrong-policy-scope")
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory).resolve()
            home = fixture / "home"
            config = home / ".local-operator"
            config.mkdir(parents=True)
            foreign = fixture / "foreign"
            (foreign / ".local-operator").mkdir(parents=True)
            escape = fixture / "escape"
            escape.mkdir()
            (escape / "home").symlink_to(foreign, target_is_directory=True)
            expected_default = "values:\n  hosting: test\n  model_name: mock-model\n  language: en\n"
            scope_id = hashlib.sha256(str(config).encode()).hexdigest()
            home_id = hashlib.sha256(str(home).encode()).hexdigest()
            for mode in modes:
                with self.subTest(mode=mode):
                    (config / "config.yml").write_text(expected_default if mode != "wrong-default" else "values: {}\n")
                    env = {"HOME": str(home), "LOCAL_OPERATOR_CONFIG_DIR": str(config), "MODEL_CASE_FIXTURE_CWD": str(fixture), "MODEL_CASE_EXPECTED_SERVER_HOME": str(home), "MODEL_CASE_EXPECTED_SERVER_SCOPE": scope_id}
                    data = dict(body)
                    if mode == "null-selections": data.update(target=None, model=None)
                    paths = {"absolute-case": str(fixture), "other-user": "~otheruser", "slash": "~/", "suffix": "~/child", "traversal": "~/../foreign", "relative": "home", "foreign-absolute": str(foreign), "absolute-home": str(home), "whitespace": " ~"}
                    if mode in paths: data["cwd"] = paths[mode]
                    if mode == "wrong-home": env["HOME"] = str(foreign)
                    if mode == "wrong-declared-home": env["MODEL_CASE_EXPECTED_SERVER_HOME"] = str(foreign)
                    if mode == "wrong-config": env["LOCAL_OPERATOR_CONFIG_DIR"] = str(foreign / ".local-operator")
                    if mode == "wrong-scope": env["MODEL_CASE_EXPECTED_SERVER_SCOPE"] = "0" * 64
                    if mode == "missing-home-authority": env["MODEL_CASE_EXPECTED_SERVER_HOME"] = ""
                    if mode == "missing-scope-authority": env["MODEL_CASE_EXPECTED_SERVER_SCOPE"] = ""
                    if mode == "missing-fixture": env["MODEL_CASE_FIXTURE_CWD"] = ""
                    if mode == "nonexistent-home": env["HOME"] = str(fixture / "absent")
                    if mode == "symlink-escape":
                        env.update(HOME=str(foreign), MODEL_CASE_EXPECTED_SERVER_HOME=str(foreign), MODEL_CASE_FIXTURE_CWD=str(escape), LOCAL_OPERATOR_CONFIG_DIR=str(foreign / ".local-operator"), MODEL_CASE_EXPECTED_SERVER_SCOPE=hashlib.sha256(str(foreign / ".local-operator").encode()).hexdigest())
                    if mode == "nonnull-target": data["target"] = {"kind": "agent", "name": "synthetic-but-unapproved"}
                    if mode == "nonnull-model": data["model"] = {"provider": "test", "model_id": "mock-model-a"}
                    if mode == "unknown-key": data["extra"] = True
                    if mode == "bad-uuid": data["request_id"] = "invalid"
                    if mode == "target-false": data["target"] = False
                    if mode == "target-empty": data["target"] = ""
                    if mode == "target-list": data["target"] = []
                    if mode == "model-false": data["model"] = False
                    if mode == "model-zero": data["model"] = 0
                    if mode == "model-list": data["model"] = []
                    original = json.dumps(data).encode()
                    seen = []
                    with patch.dict(os.environ, env):
                        gate = module.DeliveryGate()
                        async def upstream(scope, receive, send):
                            request = await receive()
                            self.assertEqual(request["body"], original, "recorder must not rewrite raw home shorthand or rejected input")
                            seen.append(True)
                            await send({"type": "http.response.start", "status": 401 if mode == "non200" else 200})
                            await send({"type": "http.response.body", "body": b"{}", "more_body": True})
                            if mode != "unfinished": await send({"type": "http.response.body", "body": b"", "more_body": False})
                        async def receive(): return {"type": "http.request", "body": original}
                        async def send(message):
                            if mode == "undelivered" and message["type"] == "http.response.body" and not message.get("more_body", False): raise OSError("inert delivery failure")
                        scope = {"type": "http", "method": "POST", "path": "/v1/desktop/sessions/preview", "headers": [], "query_string": b"unknown=1" if mode == "query" else b""}
                        for _ in range(2 if mode == "duplicate" else 1):
                            try: await module.ModelUncertaintyMiddleware(upstream, gate=gate)(scope, receive, send)
                            except OSError:
                                self.assertEqual(mode, "undelivered")
                    proof = {"scopeId": scope_id, "serverHomeId": home_id, "fixtureCwd": str(fixture), "defaultSynthetic": (config / "config.yml").read_text() == expected_default}
                    if mode == "wrong-policy-home": proof["serverHomeId"] = "0" * 64
                    if mode == "missing-policy-home": proof.pop("serverHomeId")
                    if mode == "wrong-policy-scope": proof["scopeId"] = "0" * 64
                    result = subprocess.run(["node", "--input-type=module", "-e", policy_script], input=json.dumps({"attempts": gate.attempts, "proof": proof}), cwd=repo, capture_output=True, text=True, timeout=15)
                    expected = mode in {"happy", "null-selections", "absolute-case"}
                    self.assertEqual(result.returncode == 0, expected, f"{mode}: {result.stderr}")
                    self.assertEqual(len(seen), 2 if mode == "duplicate" else 1, "all attempts must reach the actual upstream")
                    if mode in {"happy", "null-selections"}:
                        self.assertEqual(gate.attempts[0]["body"]["cwd"], "~")
                        self.assertEqual(gate.attempts[0]["server_home_id"], home_id)
                    if mode in {"wrong-home", "wrong-declared-home", "wrong-config", "wrong-scope", "missing-home-authority", "missing-scope-authority", "missing-fixture", "nonexistent-home", "symlink-escape"}:
                        self.assertIsNone(gate.server_home_id, "invalid authority must not mint a root witness")

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
