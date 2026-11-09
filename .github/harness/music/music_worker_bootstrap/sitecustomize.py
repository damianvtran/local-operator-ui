"""QA-only worker-inherited MODEL-boundary bootstrap, never product code.

Enabled only for this session's isolated root and loopback provider. Mirrors the
real create_stream_fn substitution in test_session_factory.py:7103–7134. It does
NOT replace Session, tools, transport, journal, downloads, or runtime routing.
PYTHONPATH inheritance and load receipts must be observed before native admission.
"""
import json, os, re
from pathlib import Path
from urllib.parse import urlsplit

# R12-M1: a job's completion follow-up turn (job_result delivery) starts AFTER
# music/jobs.py journals state=completed, so the harness can see completed+idle,
# write the NEXT model-command.json, and have that late follow-up turn (which
# carries tools) consume it -- parking a write-tier command on its approval
# gate and blocking the harness's own POST /messages. Settling cannot see a
# turn that has not started yet, so the race is closed here instead: a command
# is emitted only by the turn the harness itself prompted, i.e. when the
# request's LATEST user message carries `MUSIC_QA_TOOL <that command's id>`.
# Exact id match (not substring) so one id can never authorise a prefix-sharing
# sibling. Pure functions so tests drive them without the serving graph.
MARKER = re.compile(r'MUSIC_QA_TOOL (\S+)')


def latest_user_text(messages):
    for message in reversed(list(messages or ())):
        if getattr(message, 'role', None) == 'user':
            return ' '.join(getattr(part, 'text', '') or '' for part in (message.content or ())
                            if getattr(part, 'type', None) == 'text')
    return ''


def prompted_command_id(messages):
    match = MARKER.search(latest_user_text(messages))
    return match.group(1) if match else None

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
                    marked = prompted_command_id(request.messages)
                    if marked != command['id']:
                        # Job follow-up / any turn the harness did not prompt
                        # for THIS command: answer text, leave the command for
                        # the harness's own prompted turn.
                        note('turn_without_marker', command_id=command['id'], marker_id=marked)
                        yield StreamTextDelta(delta='Owned synthetic music QA turn complete.')
                        yield StreamEndEvent(stop_reason='stop')
                        return
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
