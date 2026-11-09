"""Real desktop Core + inherited production Session factory acceptance preflight.
CI-only synthetic serving graph. Native launch requires explicit admission AFTER
all Core assertions pass; never imports a paid provider or replaces Session.
"""
import asyncio, json, os, subprocess, sys, time, uuid
from pathlib import Path

S = Path(__file__).resolve().parent
ROOT = Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD']).resolve() / ('serving-core-' + str(time.time_ns()))
def configured_launcher(name):
    # Python discovers pyvenv.cfg relative to the invoked launcher. Resolving a
    # venv's interpreter symlink selects the base install and drops its packages.
    # Keep executable identity lexical; sandbox/data paths still resolve below.
    path = Path(os.environ[name]).absolute()
    if not path.is_file() or not os.access(path, os.X_OK):
        raise RuntimeError('Configured executable unavailable: ' + name)
    return path


CORE = configured_launcher('LOCAL_OPERATOR_CORE_BIN')
CORE_PYTHON = configured_launcher('LOCAL_OPERATOR_CORE_PYTHON')
UI_ROOT = Path(os.environ['MUSIC_UI_WORKTREE']).resolve()
import shutil
from owned_cleanup import OwnedProcesses, cleanup_all, cancel_listener, run_signalled
FFMPEG = Path(shutil.which('ffmpeg') or '/missing-ffmpeg')

async def main():
    import httpx
    from music_serving_upstream import MusicUpstream
    ROOT.mkdir(); home=ROOT/'home'; config=home/'.local-operator'; config.mkdir(parents=True)
    (config/'config.yml').write_text('values:\n  hosting: test\n  model_name: mock-model\n')
    mp3=ROOT/'silent-3s.mp3'
    subprocess.run([str(FFMPEG),'-v','error','-f','lavfi','-i','anullsrc=r=44100:cl=mono','-t','3',
                    '-c:a','libmp3lame','-b:a','64k','-f','mp3',str(mp3)],check=True,timeout=15)
    os.environ['MUSIC_QA_MP3']=str(mp3)
    upstream=None;watcher=None;log=None;core=None;listener=None;native=None;native_log=None
    owned=OwnedProcesses(ROOT)
    facts={'root':str(ROOT),'stages':[]}
    def record(stage,value):
        facts['stages'].append({'stage':stage,'value':value});(ROOT/'receipt.json').write_text(json.dumps(facts,indent=2,default=str));print(stage,json.dumps(value,default=str),flush=True)
    try:
        upstream=MusicUpstream().start()
        watcher=asyncio.create_task(owned.watch())
        bearer=uuid.uuid4().hex
        env={'PATH':os.environ['PATH'],'HOME':str(home),
             'LOCAL_OPERATOR_CONFIG_DIR':str(config),'LOCAL_OPERATOR_LOG_DIR':str(ROOT/'logs'),
             'LOCAL_OPERATOR_DESKTOP_TOKEN':bearer,'LOCAL_OPERATOR_NO_NOTIFICATIONS':'1',
             'TMPDIR':str(ROOT/'tmp'),'MUSIC_QA_ROOT':str(ROOT),
             'PYTHONPATH':str(S/'music_worker_bootstrap'),
              'MUSIC_QA_ALLOWED_ROOT':str(ROOT.parent),
              'MUSIC_QA_CORE_MODULE':os.environ['MUSIC_QA_CORE_MODULE'],
              'MUSIC_UI_WORKTREE':str(UI_ROOT),
              'LOCAL_OPERATOR_SCRATCHPAD':str(ROOT),
             'RADIENT_API_BASE_URL':upstream.base_url,'RADIENT_API_KEY':upstream.bearer}
        (ROOT/'tmp').mkdir()
        # The controller and every inherited child use only the owned CI root.
        os.environ.update(HOME=str(home), LOCAL_OPERATOR_CONFIG_DIR=str(config), TMPDIR=str(ROOT/'tmp'))
        os.chdir(ROOT)
        secret_path=ROOT/'qa-secrets.json'
        secret_path.write_text(json.dumps({'desktop':bearer,'upstream':upstream.bearer}))
        secret_path.chmod(0o600)
        # Persist a genuine synthetic provider row for the actual registration gate.
        seed="from pathlib import Path;import os;from local_operator.providers.auth_store import AuthStore;s=AuthStore(db_path=Path(os.environ['LOCAL_OPERATOR_CONFIG_DIR'])/'auth.db',config_dir=Path(os.environ['LOCAL_OPERATOR_CONFIG_DIR']));s.upsert_credential('radient',{'type':'api_key','source':'login','key':os.environ['RADIENT_API_KEY']});s.close()"
        subprocess.run([str(CORE_PYTHON),'-c',seed],env=env,check=True,timeout=30)
        log=(ROOT/'core.log').open('w')
        async def until(fn,limit=20):
            end=time.monotonic()+limit
            while time.monotonic()<end:
                try:
                    value=await fn()
                    if value:return value
                except (httpx.ConnectError,httpx.ReadError):pass
                await asyncio.sleep(.1)
            raise TimeoutError('owned serving preflight condition')
        core=subprocess.Popen([str(CORE),'serve','--host','127.0.0.1','--port','8080','--hosting','test','--model','mock-model'],env=env,cwd=ROOT,stdout=log,stderr=log)
        # Stay in the supervisor group as a final bounded-command safety net.
        owned.seeds.add(core.pid);owned.observe()
        record('core_pid',core.pid)
        async with httpx.AsyncClient(base_url='http://127.0.0.1:8080',headers={'Authorization':'Bearer '+bearer},timeout=15) as client:
            async def healthy():
                r=await client.get('/health');return r.json() if r.status_code==200 else None
            record('health',await until(healthy))
            bad=await client.post('/v1/desktop/sessions',json={'request_id':'invalid','cwd':str(ROOT)});assert bad.status_code==422;record('invalid_uuid',bad.status_code)
            created=await client.post('/v1/desktop/sessions',json={'request_id':str(uuid.uuid4()),'cwd':str(ROOT)});assert created.status_code==200,created.text
            sid=created.json()['result']['session_id'];target='/v1/desktop/sessions/'+sid;record('created',{'sid':sid,'status':200})
            held=asyncio.Event()
            async def events():
                async with client.stream('GET',target+'/events',timeout=None) as stream:
                    assert stream.status_code==200;held.set()
                    with (ROOT/'events.jsonl').open('w') as out:
                        async for line in stream.aiter_lines():
                            out.write(line+'\n');out.flush()
            listener=asyncio.create_task(events());await asyncio.wait_for(held.wait(),10)
            warm=await client.post(target+'/warm',json={});record('warm',{'status':warm.status_code,'body':warm.json()});assert warm.status_code==200
            async def is_live():
                r=await client.get(target);v=r.json().get('result',{}).get('payload',{});return v if v and not v.get('cold',True) else None
            record('actual_live_snapshot',await until(is_live,30))
            async def command(tool,args):
                cid='music-qa-'+uuid.uuid4().hex
                (ROOT/'model-command.json').write_text(json.dumps({'id':cid,'tool':tool,'args':args}))
                r=await client.post(target+'/prompt',json={'request_id':str(uuid.uuid4()),'text':'MUSIC_QA_TOOL '+cid});record('prompt_'+tool,{'status':r.status_code,'body':r.json()});assert r.status_code==200
            await command('generate_music',{'prompt':'Owned silent fixture','duration_ms':3000,'variations':2})
            async def generated():return upstream.facts() if upstream.generate_count==1 else None
            record('actual_generate_http',await until(generated))
            # Read actual production journal, never synthesize a job row.
            os.environ.update({k:v for k,v in env.items() if k in ['HOME','LOCAL_OPERATOR_CONFIG_DIR']})
            from local_operator.music.jobs import read_records
            directory=config/'sessions'/sid
            async def job_record():
                records=read_records(str(directory));return next(iter(records.values()),None)
            pending=await until(job_record);record('pending_journal',pending)
            # Quote/billed checks are per track, USD actuals from the synthetic
            # wire; not a live supplier invoice or aggregate quote heuristic.
            with upstream.lock:upstream.controls['complete']=True
            async def completed():
                v=await job_record();return v if v and v.get('state') in {'completed','failed','interrupted'} else None
            done=await until(completed,30);record('completed_journal',done)
            assert done['state']=='completed' and len(done['artifacts'])==2
            assert len({a['artifact_id'] for a in done['artifacts']})==2
            assert len({a['digest'] for a in done['artifacts']})==1
            assert all(t['cost']['basis']=='billed' and abs(t['cost']['amount_usd']-.0075)<1e-9 for t in done['tracks'])
            await command('music_status',{'job_id':done['job']})
            record('bootstrap_receipts',[str(p) for p in ROOT.glob('bootstrap-*.jsonl')])
            async def newest_except(exclude):
                values=read_records(str(directory))
                return next((v for k,v in values.items() if k not in exclude),None)
            async def generate_case(label,args,controls):
                before=set(read_records(str(directory)))
                with upstream.lock:upstream.controls.update(controls)
                await command('generate_music',args)
                async def fresh():return await newest_except(before)
                current=await until(fresh)
                return current
            # Complete per-track artifact verification against actual file cache.
            from local_operator.paths import config_dir
            attachments=config_dir()/'attachments'
            for artifact in done['artifacts']:
                import hashlib
                blob=attachments/(artifact['digest']+'.bin')
                assert hashlib.sha256(blob.read_bytes()).hexdigest()==upstream.digest
                peaks=attachments/(artifact['digest']+'.peaks.json')
                assert peaks.exists() and len(json.loads(peaks.read_text())['peaks'])>0
            record('actual_artifact_files',{'artifacts':done['artifacts'],'digest':upstream.digest})
            # Owned keep-section args from the independently exercised R2 path.
            before=set(read_records(str(directory)))
            await command('modify_music',{'duration_ms':4000,'sections':[
                {'kind':'keep','source':{'request_id':done['tracks'][0]['id']},'range':{'start_ms':0,'end_ms':1000}},
                {'kind':'generate','duration_ms':3000,'lyrics':'Synthetic owned line'}]})
            async def modified():
                v=await newest_except(before);return v if v and v.get('state')=='completed' else None
            record('modified_journal',await until(modified,30))
            partial=await generate_case('partial',{'prompt':'Owned partial','duration_ms':3000,'variations':2},{'partial':True,'complete':True})
            async def partial_done():
                v=read_records(str(directory)).get(partial['job']);return v if v and v.get('state')=='completed' else None
            partial=await until(partial_done,30)
            assert len(partial['artifacts'])==1 and sum(bool(t.get('error_type')) for t in partial['tracks'])==1
            record('partial_journal',partial)
            pending=await generate_case('late-cancel',{'prompt':'Owned delayed cancel','duration_ms':3000},{'partial':False,'complete':False,'billed_after_cancel':True})
            async def has_tracks():
                v=read_records(str(directory)).get(pending['job']);return v if v and v.get('tracks') else None
            pending=await until(has_tracks);count=upstream.cancel_count
            await command('music_status',{'job_id':pending['job'],'action':'cancel'})
            async def cancelled():return upstream.cancel_count==count+1
            await until(cancelled)
            with upstream.lock:upstream.controls['complete']=True
            async def late_done():
                v=read_records(str(directory)).get(pending['job']);return v if v and v.get('state')=='completed' else None
            late=await until(late_done,30)
            assert late['cancellation_requested'] and len(late['artifacts'])==1
            assert late['tracks'][0]['cost']['basis']=='billed' and late['tracks'][0]['cost']['amount_usd']>0
            record('late_billed_cancel',{'record':late,'cancel_delta':upstream.cancel_count-count})
            failed=await generate_case('settled-zero',{'prompt':'Owned failed','duration_ms':3000},{'failed':True,'complete':True})
            async def failed_done():
                v=read_records(str(directory)).get(failed['job']);return v if v and v.get('state')=='failed' else None
            zero=await until(failed_done,30);assert zero['tracks'][0]['cost']['amount_usd']==0;record('settled_zero',zero)
            receipts=[json.loads(line) for p in ROOT.glob('bootstrap-*.jsonl') for line in p.read_text().splitlines()]
            emitted=[x for x in receipts if x['event']=='tool_emitted']
            assert {'generate_music','modify_music','music_status'} <= {x['tool'] for x in emitted}
            assert any(x['pid']!=core.pid for x in emitted),'No actual worker-inherited tool dispatch'
            record('worker_bootstrap_dispatch',emitted)
            record('core_preflight_graph_pass',True)
            record('native_still_requires',['fresh resource/CPP lease','viewed loading/empty/error/populated actual native frames','player/seek','Files/Canvas/Highlights links','native actual cancel RPC'])
            if '--native-after-preflight' in sys.argv:
                if os.environ.get('MUSIC_NATIVE_LEASE')!='1':raise RuntimeError('Native lease not supplied; same serving graph will be reaped')
                # The SAME Core, worker, AuthStore, upstream and held SSE remain
                # alive throughout native interaction; never start a cold CLI.
                native_env={k:v for k,v in env.items() if k not in {'PYTHONPATH','RADIENT_API_KEY'}}
                native_env.update(MUSIC_CORE_PREFLIGHT_PASS='1',MUSIC_NATIVE_LEASE='1',MUSIC_CORE_CONFIG=str(config),MUSIC_SESSION_ID=sid)
                native_log=(ROOT/'native.log').open('w')
                native=await asyncio.create_subprocess_exec(shutil.which('node'),str(S/'music-native-serving-consumer.mjs'),cwd=UI_ROOT,env=native_env,stdout=native_log,stderr=native_log)
                owned.seeds.add(native.pid);owned.observe()
                handled=set();deadline=time.monotonic()+480
                while native.returncode is None:
                    if time.monotonic()>deadline:raise TimeoutError('Native consumer bounded480s')
                    control_path=ROOT/'native-control.json'
                    if control_path.exists():
                        ctl=json.loads(control_path.read_text())
                        if ctl['id'] not in handled:
                            handled.add(ctl['id']);reply={'id':ctl['id']}
                            try:
                                if ctl['action']=='start_pending':
                                    current=await generate_case('native-pending',{'prompt':'Native owned pending','duration_ms':3000,'variations':1},{'failed':False,'partial':False,'complete':False})
                                    async def native_tracks():
                                        v=read_records(str(directory)).get(current['job']);return v if v and v.get('tracks') else None
                                    reply['job']= (await until(native_tracks))['job'];reply['cancel_before']=upstream.cancel_count;reply['producing_call_id']=json.loads((ROOT/'model-command.json').read_text())['id']
                                elif ctl['action']=='inspect_cancel':
                                    if ctl.get('job')!=native_job:raise RuntimeError('Wrong pending job cancellation witness')
                                    reply.update(job=native_job,cancel_delta=upstream.cancel_count-reply_cancel_before)
                                elif ctl['action']=='inspect_links':
                                    inventory=await client.get(target+'/files',params={'scope':'self'})
                                    assert inventory.status_code==200,inventory.text
                                    reply['files']=inventory.json()['result'];reply['initial_batch']=done
                                elif ctl['action'] in {'start_partial','start_failed'}:
                                    failing = ctl['action']=='start_failed'
                                    current=await generate_case('native-error', {'prompt':'Owned native outcome','duration_ms':3000,'variations':1 if failing else 2}, {'failed':failing,'partial':not failing,'complete':True})
                                    async def native_outcome():
                                        v=read_records(str(directory)).get(current['job'])
                                        return v if v and v.get('state') in {'completed','failed'} else None
                                    reply['record']=await until(native_outcome,30)
                                elif ctl['action'] in {'settle_after_native_cancel','settle_without_native_cancel'}:
                                    if ctl['action']=='settle_after_native_cancel':
                                        async def actual_cancel():return upstream.cancel_count==reply_cancel_before+1
                                        await until(actual_cancel)
                                    observed=upstream.cancel_count
                                    if ctl['action']=='settle_after_native_cancel' and observed!=reply_cancel_before+1:
                                        raise RuntimeError('Native UI did not issue exactly one provider cancel; no fake tool/RPC fallback')
                                    with upstream.lock:upstream.controls['complete']=True
                                    async def native_done():
                                        v=read_records(str(directory)).get(native_job);return v if v and v.get('state')=='completed' else None
                                    reply['record']=await until(native_done,30);reply['cancel_count']=observed
                                else:raise RuntimeError('Unknown own native control action')
                                if ctl['action']=='start_pending':native_job=reply['job'];reply_cancel_before=reply['cancel_before']
                            except Exception as error:reply['error']=str(error)
                            (ROOT/'native-control-result.json').write_text(json.dumps(reply,default=str))
                    await asyncio.sleep(.1)
                rc=await native.wait();record('native_exit',rc)
                if rc:raise RuntimeError('Native consumer did not pass; see native-result.json')
    finally:
        async def stop_owned():
            # Snapshot before parents die so reparented helpers keep their exact
            # identity witness; remaining actions still run if the SSE failed.
            await owned.stop()
            if core:await asyncio.to_thread(core.wait,5)
            if native:await native.wait()
            record('cleanup_owned_absent',not owned.observe())
        async def stop_upstream():
            if upstream:await asyncio.to_thread(upstream.close)
        async def stop_watcher():
            await cancel_listener(watcher)
        async def close_logs():
            if native_log:native_log.close()
            if log:log.close()
        await cleanup_all([lambda:cancel_listener(listener),stop_owned,
                           stop_upstream,stop_watcher,close_logs])

if __name__=='__main__':
    # No resources are started merely by inspecting/importing this source.
    if '--resource-lease' not in sys.argv:raise SystemExit('Core held: explicit resource lease required')
    asyncio.run(run_signalled(main))
