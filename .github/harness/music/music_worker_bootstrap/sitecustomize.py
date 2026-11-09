"""QA-only worker-inherited MODEL-boundary bootstrap, never product code.

Enabled only for this session's isolated root and loopback provider. Mirrors the
real create_stream_fn substitution in test_session_factory.py:7103–7134. It does
NOT replace Session, tools, transport, journal, downloads, or runtime routing.
PYTHONPATH inheritance and load receipts must be observed before native admission.
"""
import json, os
from pathlib import Path
from urllib.parse import urlsplit

scope = os.environ.get('MUSIC_QA_ROOT')
if scope:
    root = Path(scope).resolve()
    allowed = Path(os.environ['MUSIC_QA_ALLOWED_ROOT']).resolve()
    config = Path(os.environ.get('LOCAL_OPERATOR_CONFIG_DIR', '/invalid')).resolve()
    home = Path(os.environ.get('HOME', '/invalid')).resolve()
    upstream = urlsplit(os.environ.get('RADIENT_API_BASE_URL', ''))
    if not root.is_relative_to(allowed) or not config.is_relative_to(root) or not home.is_relative_to(root):
        raise RuntimeError('Music QA bootstrap refused non-owned HOME/config/root')
    if upstream.hostname != '127.0.0.1' or upstream.scheme != 'http' or not upstream.port:
        raise RuntimeError('Music QA bootstrap refused non-loopback upstream')
    root.mkdir(parents=True, exist_ok=True)
    receipt = root / ('bootstrap-' + str(os.getpid()) + '.jsonl')
    def note(event, **facts):
        with receipt.open('a') as log:
            log.write(json.dumps({'event': event, 'pid': os.getpid(), **facts}) + '\n')
    note('loaded', config=str(config), executable=__import__('sys').executable,
         module_argv=__import__('sys').argv[:2], upstream_origin=upstream.netloc)
    from local_operator.harness.types import StreamToolCallDelta, StreamEndEvent, StreamTextDelta
    from local_operator.model import configure
    import local_operator
    expected_module = Path(os.environ['MUSIC_QA_CORE_MODULE']).resolve()
    observed_module = Path(local_operator.__file__).resolve()
    note('source_identity', module=str(observed_module), expected=str(expected_module))
    if observed_module != expected_module:
        raise RuntimeError('QA worker is not importing frozen manager-owned runtime worktree')
    class OwnedModelBoundary:
        def __init__(self): self.emitted = set()
        async def close(self): pass
        def __call__(self, request, signal=None):
            async def events():
                tool_names = [tool.name for tool in request.tools]
                command_path = root / 'model-command.json'
                command = json.loads(command_path.read_text()) if command_path.exists() else None
                note('model_request', registered_tools=tool_names,
                     command_id=command.get('id') if command else None)
                if command and command['id'] not in self.emitted:
                    name = command['tool']
                    if name not in {'generate_music', 'modify_music', 'music_status'}:
                        raise RuntimeError('QA model command tool not allowlisted')
                    if name not in tool_names:
                        # Auxiliary title/catalogue calls have no tools. Do not
                        # consume the command there: the real tool-bearing turn
                        # must later emit it and leave an actual worker receipt.
                        note('auxiliary_call_no_requested_tool', tool=name)
                        yield StreamTextDelta(delta='Owned synthetic session')
                        yield StreamEndEvent(stop_reason='stop')
                        return
                    self.emitted.add(command['id'])
                    note('tool_emitted', tool=name, call_id=command['id'])
                    yield StreamToolCallDelta(index=0, id=command['id'], name=name,
                                              argument_delta=json.dumps(command['args']))
                    yield StreamEndEvent(stop_reason='toolUse')
                else:
                    yield StreamTextDelta(delta='Owned synthetic music QA turn complete.')
                    yield StreamEndEvent(stop_reason='stop')
            return events()
    def owned_stream_factory(*args, **kwargs):
        note('stream_factory_called')
        return OwnedModelBoundary()
    configure.create_stream_fn = owned_stream_factory
    note('model_boundary_installed')
