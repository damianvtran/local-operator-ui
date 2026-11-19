"""Owned synthetic Radient MUSIC HTTP boundary, not a product/service substitute.

Wire fields mirror the independently exercised R2 HTTP carrier. This fixture
controls observation timing only; real MusicClient/tool/job/journal/download code
must consume it. No provider network access or invoice claim is made.
"""
import copy, hashlib, json, threading, urllib.parse, os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

class MusicUpstream:
    def __init__(self, bearer='synthetic-serving-music'):
        self.bearer = bearer
        self.lock = threading.RLock()
        self.controls = {'enabled': True, 'complete': False, 'partial': False,
                         'failed': False, 'billed_after_cancel': True}
        self.requests = []
        self.tracks = {}
        self.keys = {}
        self.cancel_count = 0
        self.generate_count = 0
        # The real facade requests MP3. Require actual pre-generated MP3 bytes;
        # never relabel WAV. Preparation is explicit and NOT run on import.
        asset = Path(os.environ['MUSIC_QA_MP3'])
        self.audio = asset.read_bytes()
        if not (self.audio.startswith(b'ID3') or self.audio[:1] == b'\xff'):
            raise ValueError('Owned fixture asset is not an MP3 bitstream')
        self.digest = hashlib.sha256(self.audio).hexdigest()
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def send(self, status, payload):
                raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'audio/mpeg' if isinstance(payload, bytes) else 'application/json')
                self.send_header('Content-Length', str(len(raw))); self.end_headers()
                self.wfile.write(raw)
            def run_request(self):
                parsed = urllib.parse.urlsplit(self.path)
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'null')
                with owner.lock:
                    if parsed.path == '/_qa/control':
                        if not isinstance(body, dict): return self.send(400, {'error': 'object_required'})
                        unknown = set(body) - set(owner.controls)
                        if unknown: return self.send(400, {'error': 'unknown_controls'})
                        owner.controls.update(body); return self.send(200, owner.facts())
                    if parsed.path == '/_qa/facts': return self.send(200, owner.facts())
                    owner.requests.append({'method': self.command, 'path': parsed.path,
                                           'body': body, 'has_auth': bool(self.headers.get('Authorization'))})
                    if '/artifacts/' in parsed.path:
                        if self.headers.get('Authorization'): return self.send(400, {'error': 'bearer_leaked'})
                        return self.send(200, owner.audio)
                    if self.headers.get('Authorization') != 'Bearer ' + owner.bearer:
                        return self.send(401, {'code': 'unauthorized'})
                    action = parsed.path.rsplit('/', 1)[-1]
                    if action == 'models':
                        enabled = owner.controls['enabled']
                        return self.send(200, {'models': [{'id': 'radient/music', 'enabled': enabled,
                            'operations': {'compose': enabled, 'upload_reference': False, 'separate_stems': False},
                            'disabled_reason': '' if enabled else 'commercial_authorization_required'}]})
                    if action == 'generate':
                        if not owner.controls['enabled']: return self.send(403, {'code': 'commercial_authorization_required'})
                        owner.generate_count += 1
                        key = self.headers.get('Idempotency-Key')
                        if not key: return self.send(400, {'code': 'idempotency_key_required'})
                        if key not in owner.keys:
                            ids = []
                            for index in range(body.get('variations', 1)):
                                tid = 'aud_serving_' + str(len(owner.tracks) + 1)
                                ids.append(tid)
                                owner.tracks[tid] = {'id': tid, 'variant_index': index,
                                    'title': 'Owned silent music fixture', 'duration_ms': body['duration_ms'],
                                    'will_fail': owner.controls['failed'] or (owner.controls['partial'] and index == 1),
                                    'cancelled': False}
                            owner.keys[key] = ids
                        return self.send(200, owner.envelope(owner.keys[key], terminal=False))
                    if action == 'cancel':
                        owner.cancel_count += 1
                        tid = body['request_id']
                        if tid in owner.tracks: owner.tracks[tid]['cancelled'] = True
                        return self.send(200, {'request_id': tid, 'requested': True, 'vendor_stopped': False, 'tracks': []})
                    tid = urllib.parse.parse_qs(parsed.query).get('request_id', [''])[0]
                    if tid not in owner.tracks: return self.send(404, {'code': 'audio_not_found'})
                    return self.send(200, owner.envelope([tid], terminal=owner.controls['complete'], artifacts=action == 'result'))
            do_GET = run_request
            do_POST = run_request
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.base_url = f'http://127.0.0.1:{self.server.server_port}/v1'
    def start(self): self.thread.start(); return self
    def close(self): self.server.shutdown(); self.server.server_close(); self.thread.join(3)
    def facts(self):
        return {'controls': copy.deepcopy(self.controls), 'generate_count': self.generate_count,
                'cancel_count': self.cancel_count, 'requests': copy.deepcopy(self.requests),
                'track_ids': list(self.tracks), 'audio_sha256': self.digest, 'audio_duration_seconds': 3}
    def envelope(self, ids, terminal=False, artifacts=False):
        tracks = []
        for tid in ids:
            src = self.tracks[tid]
            failed = terminal and src['will_fail']
            billed_zero = failed or (src['cancelled'] and not self.controls['billed_after_cancel'])
            cost = {'v': 1, 'amount_usd': 0 if billed_zero else src['duration_ms'] * .0000025,
                    'basis': 'billed' if terminal else 'quote', 'units': 0 if billed_zero else src['duration_ms'],
                    'unit': 'millisecond', 'provider': 'radient', 'model': 'radient/music',
                    'tool_type': 'music_generation', 'usage_record_id': 'synthetic_usage_' + tid,
                    'price_version': 'music-fixed-requested-ms@2026-11-08'}
            track = {k: src[k] for k in ['id', 'title', 'variant_index']}
            track.update(status='COMPLETED' if terminal else 'IN_PROGRESS', settled=terminal,
                         error_type='audio_failed' if failed else None, error=None, cost=cost, artifacts=[])
            if artifacts and terminal and not failed:
                track['artifacts'] = [{'id': 'artifact_' + tid, 'role': 'full_mix',
                    'url': self.base_url + '/tools/audio/artifacts/artifact_' + tid,
                    'content_type': 'audio/mpeg', 'format': 'mp3', 'duration_seconds': 3,
                    'sample_rate_hz': 44100, 'channels': 1, 'bitrate_kbps': 64,
                    'size_bytes': len(self.audio), 'sha256': self.digest}]
            tracks.append(track)
        return {'request_id': ids[0], 'model': 'radient/music', 'provider': 'radient',
                'status': 'COMPLETED' if terminal else 'IN_PROGRESS', 'settled': terminal,
                'tracks': tracks, 'attribution': 'Synthetic QA upstream; no resale authorization',
                'cost': tracks[0]['cost'] if len(tracks) == 1 else None}
