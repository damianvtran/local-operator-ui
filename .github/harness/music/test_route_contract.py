"""Pin every HTTP call the serving preflight makes to the pinned Core's real app.

Why: hosted preflight 3 (run 42650801966) reached a healthy, warm Core and then
posted ``/prompt`` — the Python NAME of Core's turn handler — and got a 404,
after ~20 minutes of macOS lease. Nothing local could catch that because the
harness talks to Core over HTTP with hand-written paths. This test closes the gap
without starting Core: it extracts the calls from the preflight's own AST (so a
future edit is checked, not a hand-copied list), then asks the pinned Core
interpreter to resolve each one through ``local_operator.server.app.app``'s
actual Starlette matching, validate each literal JSON body against the matched
route's request model, check query-parameter names, and walk the response keys
the harness reads (``r.json()['result']['session_id']`` ...) through the route's
``response_model``.

Constraints:
- The Core side runs in a subprocess under ``LOCAL_OPERATOR_CORE_PYTHON`` (the
  same variable the CI job exports for the preflight). With no Core interpreter
  the test SKIPS, loudly; it never falls back to a static route list.
- Importing the app executes no handler and opens no socket.
- Bodies the harness itself expects to be refused (``assert X.status_code==422``)
  must FAIL validation, so the negative probe stays a real negative.
- ``MUSIC_ROUTE_CONTRACT_SOURCE`` may point at another preflight revision; it
  exists for the negative control (the pre-fix ``/prompt`` source must fail).
"""
import ast
import json
import os
from pathlib import Path
import subprocess
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('MUSIC_ROUTE_CONTRACT_SOURCE') or HERE / 'music-serving-core-preflight.py')
VERBS = {'get', 'post', 'put', 'patch', 'delete', 'stream'}


class _Stub(dict):
    """Locals for evaluating body expressions: unknown names become strings.

    ``str(uuid.uuid4())`` stays a genuine UUID (RequestID validates it), while
    run-time values such as ``ROOT`` or ``cid`` only need to be strings.
    """
    def __missing__(self, name):
        return 'stub-' + name


def _template(node, names):
    # A path is a literal, a Name bound to a template, or Name + literal suffix.
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Name):
        return names.get(node.id)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _template(node.left, names), _template(node.right, names)
        if left is not None and right is not None:
            return left + right
        if left is not None and isinstance(node.right, ast.Name):
            # A run-time segment (e.g. ``sid``) is a path parameter.
            return left + '{' + node.right.id + '}'
    return None


def _parents(tree):
    out = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            out[child] = parent
    return out


def _scope(node, parents):
    while node in parents:
        node = parents[node]
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return node
    return node


def _key_chain(node, parents):
    # Constant subscripts / ``.get('k', ...)`` applied to ``node``; returns the
    # keys and the outermost expression they form.
    chain, cur = [], node
    while cur in parents:
        up = parents[cur]
        if isinstance(up, ast.Subscript) and up.value is cur and isinstance(up.slice, ast.Constant):
            chain.append(up.slice.value); cur = up; continue
        if (isinstance(up, ast.Attribute) and up.value is cur and up.attr == 'get'
                and up in parents and isinstance(parents[up], ast.Call)
                and parents[up].args and isinstance(parents[up].args[0], ast.Constant)):
            chain.append(parents[up].args[0].value); cur = parents[up]; continue
        break
    return chain, cur


def _bound_name(expr, parents):
    # ``x = <expr>`` or ``x = <expr> if cond else {}`` -> 'x'.
    up = parents.get(expr)
    if isinstance(up, ast.IfExp) and up.body is expr:
        expr, up = up, parents.get(up)
    if isinstance(up, ast.Assign) and up.value is expr and len(up.targets) == 1 \
            and isinstance(up.targets[0], ast.Name):
        return up.targets[0].id
    return None


def _json_keys(scope, var):
    # Key chains read off ``var.json()`` via subscripts or ``.get('k', ...)``,
    # FOLLOWED through intermediate variables in the same scope. R10-B1: the
    # approval wait bound ``v = r.json()...['payload']`` and then read
    # ``v.get('pending_gate')`` / ``v['epoch']`` — keys Core's SnapshotPayload
    # does not have — and a direct-chain-only walk never saw those reads.
    parents = _parents(scope)

    def follow(prefix, name, depth):
        found = []
        for use in ast.walk(scope):
            if not (isinstance(use, ast.Name) and use.id == name and isinstance(use.ctx, ast.Load)):
                continue
            chain, end = _key_chain(use, parents)
            if not chain:
                continue
            found.append(prefix + chain)
            rebound = _bound_name(end, parents)
            if rebound and depth < 4:
                found.extend(follow(prefix + chain, rebound, depth + 1))
        return found

    chains = []
    for node in ast.walk(scope):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == 'json' and isinstance(node.func.value, ast.Name)
                and node.func.value.id == var):
            continue
        chain, end = _key_chain(node, parents)
        if chain:
            chains.append(chain)
            name = _bound_name(end, parents)
            if name:
                chains.extend(follow(chain, name, 0))
    return chains


def harness_calls(source=SOURCE):
    tree = ast.parse(Path(source).read_text())
    parents = _parents(tree)
    names = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            value = _template(node.value, names)
            if value is not None and value.startswith('/'):
                names[node.targets[0].id] = value
    refused = {n.test.left.value.id for n in ast.walk(tree)
               if isinstance(n, ast.Assert) and isinstance(n.test, ast.Compare)
               and isinstance(n.test.left, ast.Attribute) and n.test.left.attr == 'status_code'
               and isinstance(n.test.left.value, ast.Name)
               and any(isinstance(c, ast.Constant) and c.value == 422 for c in n.test.comparators)}
    calls = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in VERBS and isinstance(node.func.value, ast.Name)
                and node.func.value.id == 'client'):
            continue
        args = list(node.args)
        method = node.func.attr.upper()
        if method == 'STREAM':
            method = args.pop(0).value
        path = _template(args[0], names)
        kw = {k.arg: k.value for k in node.keywords}
        body = eval(compile(ast.Expression(kw['json']), str(source), 'eval'),
                    {}, _Stub(str=str, uuid=__import__('uuid'))) if 'json' in kw else None
        params = sorted(k.value for k in kw['params'].keys) if 'params' in kw else []
        holder = parents.get(node)
        while isinstance(holder, ast.Await):
            holder = parents.get(holder)
        var = (holder.targets[0].id if isinstance(holder, ast.Assign) and isinstance(holder.targets[0], ast.Name)
               else None)
        calls.append({'line': node.lineno, 'method': method, 'path': path, 'body': body,
                      'params': params, 'expect_invalid': var in refused,
                      'json_keys': _json_keys(_scope(node, parents), var) if var else []})
    return calls


# Runs INSIDE the pinned Core interpreter. Path parameters are filled with a
# probe segment and resolved by the app's own matcher, the dispatch path a real
# request takes (FastAPI 0.16x nests routers as lazy _IncludedRouter wrappers).
CORE_PROBE = r'''
import json, re, sys, typing
from pydantic import BaseModel, TypeAdapter, ValidationError
from starlette.routing import Match
from local_operator.server.app import app

def leaf(routes, scope):
    for route in routes:
        match, _ = route.matches(scope)
        if match != Match.FULL:
            continue
        inner = getattr(route, 'original_router', None)
        if inner is None:
            return route
        found = leaf(inner.routes, scope)
        if found is not None:
            return found
    return None

def walk(model, chain):
    for key in chain:
        fields = getattr(model, 'model_fields', None)
        if fields is None:
            return None   # beyond a declared model (a dict payload): stop
        if key not in fields:
            return 'response model %s has no field %r' % (getattr(model, '__name__', model), key)
        model = fields[key].annotation
        # CRUDResponse.result is ``T | None``: descend into the one model arm,
        # otherwise every key under ``result`` would go unchecked.
        arms = [a for a in typing.get_args(model) if hasattr(a, 'model_fields')]
        if not hasattr(model, 'model_fields') and len(arms) == 1:
            model = arms[0]
    return None

out = []
for call in json.load(sys.stdin):
    concrete = re.sub(r'\{[^}]+\}', 'probe-segment', call['path'])
    scope = {'type': 'http', 'method': call['method'], 'path': concrete, 'root_path': '',
             'headers': [], 'query_string': b''}
    route = leaf(app.router.routes, scope)
    row = dict(call, route=getattr(route, 'path', None), problems=[])
    if route is None:
        row['problems'].append('no registered %s route matches %s' % (call['method'], call['path']))
        out.append(row); continue
    module = sys.modules.get(route.endpoint.__module__)
    row['where'] = '%s:%s' % (route.endpoint.__module__, route.endpoint.__code__.co_firstlineno)
    row['status_code'] = route.status_code
    dependant = getattr(route, 'dependant', None)
    if call['params']:
        known = {p.name for p in dependant.query_params} if dependant else set()
        for name in call['params']:
            if name not in known:
                row['problems'].append('query parameter %r not declared' % name)
    if call['body'] is not None:
        field = getattr(route, 'body_field', None)
        if field is None:
            row['problems'].append('route takes no JSON body')
        else:
            try:
                TypeAdapter(field.field_info.annotation).validate_python(call['body'])
                valid = True
            except ValidationError as error:
                valid, row['validation'] = False, str(error).splitlines()[0]
            if valid == call['expect_invalid']:
                row['problems'].append('body validity %s, harness expects %s' % (valid, not call['expect_invalid']))
    for chain in call['json_keys']:
        problem = walk(route.response_model, chain)
        if problem:
            row['problems'].append(problem)
    out.append(row)
print(json.dumps(out, default=str))
'''


class RouteContract(unittest.TestCase):
    def test_extraction_sees_every_client_call(self):
        # Guard the extractor itself: every ``client.<verb>(`` in the source is
        # parsed into a concrete path, so an unparseable new call fails here.
        calls = harness_calls()
        text = Path(SOURCE).read_text()
        self.assertEqual(len(calls), sum(text.count('client.' + v + '(') for v in VERBS))
        for call in calls:
            self.assertIsNotNone(call['path'], call)

    def test_every_harness_call_matches_pinned_core(self):
        python = os.environ.get('LOCAL_OPERATOR_CORE_PYTHON')
        if not python or not Path(python).exists():
            self.skipTest('LOCAL_OPERATOR_CORE_PYTHON absent: cannot import the pinned Core app')
        env = {k: v for k, v in os.environ.items() if not k.startswith('CMUX_')}
        probe = subprocess.run([python, '-c', CORE_PROBE], input=json.dumps(harness_calls()),
                               capture_output=True, text=True, timeout=180, env=env)
        self.assertEqual(probe.returncode, 0, probe.stderr[-4000:])
        rows = json.loads(probe.stdout)
        for row in rows:
            print('%-4s line %-3s %-6s %-45s -> %s %s' % ('FAIL' if row['problems'] else 'PASS',
                  row['line'], row['method'], row['path'], row.get('where'), row['problems'] or ''))
        self.assertEqual([r for r in rows if r['problems']], [])

    # Run 42668407732: generate_music (approval_tier="write") parked on Core's
    # approval gate because the harness never answered it. The harness now posts
    # the APPROVAL shape {epoch, request_id, approved} to /answers; Core's Answer
    # validator refuses a gate answer without epoch/request_id, so these pin the
    # body to that model and prove the probe would catch a malformed one.
    def _probe(self, calls):
        python = os.environ.get('LOCAL_OPERATOR_CORE_PYTHON')
        if not python or not Path(python).exists():
            self.skipTest('LOCAL_OPERATOR_CORE_PYTHON absent: cannot import the pinned Core app')
        env = {k: v for k, v in os.environ.items() if not k.startswith('CMUX_')}
        probe = subprocess.run([python, '-c', CORE_PROBE], input=json.dumps(calls),
                               capture_output=True, text=True, timeout=180, env=env)
        self.assertEqual(probe.returncode, 0, probe.stderr[-4000:])
        return json.loads(probe.stdout)

    def _answers(self, calls):
        return [c for c in calls if c['path'] and c['path'].endswith('/answers')]

    def test_approval_answer_is_extracted_with_gate_shape(self):
        answers = self._answers(harness_calls())
        self.assertEqual(len(answers), 1, answers)
        self.assertEqual(answers[0]['method'], 'POST')
        self.assertEqual(sorted(answers[0]['body']), ['approved', 'epoch', 'request_id'])
        self.assertIs(answers[0]['body']['approved'], True)
        rows = self._probe(answers)
        self.assertEqual(rows[0]['problems'], [], rows)
        self.assertTrue(rows[0]['where'].startswith('local_operator.server.routes.desktop_sessions'), rows)

    def test_malformed_approval_answer_fails_against_core(self):
        import tempfile
        text = Path(SOURCE).read_text()
        for good, bad in [("{'epoch':epoch,'request_id':rid,'approved':True}", "{'request_id':rid,'approved':True}"),
                          ("{'epoch':epoch,'request_id':rid,'approved':True}", "{'epoch':epoch,'approved':True}"),
                          ("{'epoch':epoch,'request_id':rid,'approved':True}", "{'epoch':epoch,'request_id':rid,'approve':True}")]:
            self.assertEqual(text.count(good), 1)
            with tempfile.TemporaryDirectory() as tmp:
                mutated = Path(tmp) / 'preflight.py'
                mutated.write_text(text.replace(good, bad))
                rows = self._probe(self._answers(harness_calls(mutated)))
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0]['problems'], (bad, rows))

    # R10-B1: the approval wait and the timeout diagnostics read the gate and the
    # session-state epoch off the snapshot through intermediate variables. Core's
    # SessionSnapshot keeps them at payload.frontend.snapshot.{pending_gate,epoch}
    # (FrontendSessionState); /answers compares against that epoch. These pin
    # the extracted nested reads to Core's models and prove the old flat
    # payload.pending_gate / payload.epoch reads are rejected.
    SNAP = ['result', 'payload', 'frontend', 'snapshot']

    def _snapshot_reads(self, calls):
        return [c for c in calls if c['method'] == 'GET' and c['path'] and c['path'].endswith('{sid}')
                and any(k[:2] == ['result', 'payload'] for k in c['json_keys'])]

    def test_snapshot_reads_follow_intermediate_variables(self):
        reads = self._snapshot_reads(harness_calls())
        chains = [k for c in reads for k in c['json_keys']]
        for leafkey in (['pending_gate'], ['epoch'], ['pending_gate', 'kind'], ['streaming']):
            self.assertIn(self.SNAP + leafkey, chains, chains)
        self.assertIn(['result', 'payload', 'cold'], chains)   # is_live: a real top-level field
        flat = [k for k in chains if k[:2] == ['result', 'payload'] and len(k) > 2
                and k[2] in ('pending_gate', 'epoch', 'streaming')]
        self.assertEqual(flat, [], 'gate/epoch read off the payload, not payload.frontend.snapshot')
        rows = self._probe(reads)
        self.assertEqual([r['problems'] for r in rows if r['problems']], [], rows)

    def test_flat_payload_gate_reads_fail_against_core(self):
        import tempfile
        text = Path(SOURCE).read_text()
        nested = ".get('payload',{}).get('frontend',{}).get('snapshot',{})"
        self.assertEqual(text.count(nested), 2)
        with tempfile.TemporaryDirectory() as tmp:
            mutated = Path(tmp) / 'preflight.py'
            mutated.write_text(text.replace(nested, ".get('payload',{})"))
            rows = self._probe(self._snapshot_reads(harness_calls(mutated)))
        problems = ' '.join(p for r in rows for p in r['problems'])
        for key in ('pending_gate', 'epoch', 'streaming'):
            self.assertIn("SnapshotPayload has no field %r" % key, problems, rows)


if __name__ == '__main__':
    unittest.main()
