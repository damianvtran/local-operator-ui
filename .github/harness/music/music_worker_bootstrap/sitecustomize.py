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
#
# R18 (run 42727770460): "latest user message" was too narrow. At the provider
# boundary Core's Session._commit_system_state may append a `[session-state]`
# CustomMessage AFTER the prompt (session.py: _context.messages.append) whenever a
# dynamic system section changed -- e.g. a job just went running -- and
# harness/render.py renders that row as a USER turn. The harness's own prompted
# status-cancel turn then had `[session-state]...` as its latest user row, was
# skipped as `turn_without_marker`, ended idle, and the command never emitted
# (20 s `emitted` timeout). The authority is therefore every user row of the
# CURRENT turn: those after the last assistant message. A job follow-up still
# never qualifies -- the prompt that carried a marker was already answered by
# an assistant message, so it sits before the boundary.
MARKER = re.compile(r'MUSIC_QA_TOOL (\S+)')


def _text(message):
    return ' '.join(getattr(part, 'text', '') or '' for part in (getattr(message, 'content', None) or ())
                    if getattr(part, 'type', None) == 'text')


def current_turn_user_texts(messages):
    """User-row texts after the last assistant message, oldest first."""
    texts = []
    for message in reversed(list(messages or ())):
        role = getattr(message, 'role', None)
        if role == 'assistant':
            break
        if role == 'user':
            texts.append(_text(message))
    return texts[::-1]


def prompted_command_ids(messages):
    """Exact marker ids carried by the current turn's user rows."""
    return [m.group(1) for text in current_turn_user_texts(messages) for m in MARKER.finditer(text)]


def turn_shape(messages):
    """Content-free-ish receipt of the current turn's user rows: the first
    token of each (e.g. `[session-state]`, `MUSIC_QA_TOOL`), so the next
    skipped turn names what displaced the marker instead of leaving it to
    inference as run 42727770460 did."""
    return [(text.split() or [''])[0][:32] for text in current_turn_user_texts(messages)]

# Q-1 (local-operator-ui#1893, post-release QA on v0.55.0): a real agent reads
# guide://music-generation and a tool doc or two BEFORE it calls generate_music,
# and in that shape the desktop folded the generating card into a closed
# "3 files · 1 generate_music" action group. A command may therefore carry
# `preface`: read-type calls the scripted model makes FIRST, in one assistant
# message, so the music call lands as the fourth action of the turn exactly as
# in the field. Internal URLs only (guide://, tool://): they resolve inside any
# Core with no fixture files and no filesystem reach outside the owned root.
#
# The continuation request after the reads carries no marker in its tail (the
# tail is the read RESULTS, role `tool`), so it is authorised instead by those
# results answering THIS command's preface ids, which embed the command id:
# a job follow-up turn's tail is a user row, never these results.
def preface_call_ids(command):
    return [command['id'] + '-read-' + str(n) for n in range(len(command.get('preface') or ()))]


def tail_tool_result_ids(messages):
    """tool_call_id of each `tool` row after the last assistant message."""
    ids = []
    for message in reversed(list(messages or ())):
        role = getattr(message, 'role', None)
        if role == 'assistant':
            break
        if role == 'tool':
            ids.append(getattr(message, 'tool_call_id', None))
    return ids[::-1]


def preface_step(command, messages):
    """What the prompted turn emits next: 'preface' (the reads), 'tool' (the
    command's own call), or None when this request is not that turn's."""
    expected = preface_call_ids(command)
    if expected and set(expected) <= set(tail_tool_result_ids(messages)):
        return 'tool'
    if command['id'] in prompted_command_ids(messages):
        return 'preface' if expected else 'tool'
    return None

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
                    marked = prompted_command_ids(request.messages)
                    step = preface_step(command, request.messages)
                    if step is None:
                        # Job follow-up / any turn the harness did not prompt
                        # for THIS command: answer text, leave the command for
                        # the harness's own prompted turn.
                        note('turn_without_marker', command_id=command['id'], marker_ids=marked,
                             turn_user_rows=turn_shape(request.messages))
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
                    if step == 'preface':
                        # Not `tool_emitted`: command_sequencing counts only the
                        # command's own call, so the preface never consumes it.
                        if 'read' not in tool_names:
                            raise RuntimeError('QA preface needs the read tool registered')
                        ids = preface_call_ids(command)
                        for index, (call_id, url) in enumerate(zip(ids, command['preface'])):
                            if not str(url).startswith(('guide://', 'tool://')):
                                raise RuntimeError('QA preface reads internal URLs only')
                            yield StreamToolCallDelta(index=index, id=call_id, name='read',
                                                      argument_delta=json.dumps({'path': url}))
                        note('preface_emitted', call_id=command['id'], reads=ids)
                        yield StreamEndEvent(stop_reason='toolUse')
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
