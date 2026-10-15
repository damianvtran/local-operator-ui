import os,pathlib,subprocess,json,time,signal,re,hashlib,threading,datetime
W=pathlib.Path.home()/'local-operator-ui/.worktrees/skills-library-evidence';os.chdir(W);S=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD']);R=W/'docs/evidence/hub-skills-library/receipts';N=str(pathlib.Path.home()/'.nvm/versions/node/v22.13.1/bin/node');ENV={k:v for k,v in os.environ.items()if not k.startswith('CMUX_')and k not in ['XPC_FLAGS','NODE_TEST_CONTEXT']};ENV['PATH']=str(pathlib.Path(N).parent)+':'+ENV['PATH'];ENV['NODE_OPTIONS']='--max-old-space-size=4096';owned=[];done=threading.Event();aborted=threading.Event();readings=[]
def gate(label,start=True):
 k=int(subprocess.check_output(['df','-Pk','/System/Volumes/Data'],text=True).splitlines()[1].split()[3]);v=subprocess.check_output(['sysctl','-n','vm.swapusage'],text=True);sf=float(re.search(r'free = ([\d.]+)M',v)[1]);su=float(re.search(r'used = ([\d.]+)M',v)[1]);m=int(re.search(r'free percentage: (\d+)%',subprocess.check_output(['memory_pressure','-Q'],text=True))[1]);r={'at':datetime.datetime.now().astimezone().isoformat(),'phase':label,'availableKiB':k,'availableGiB':k/1048576,'swapFreeMiB':sf,'swapUsedDiagnosticMiB':su,'memoryFreePct':m};readings.append(r);print('RESOURCE',json.dumps(r),flush=True)
 if k<18874368 or(start and(k<20971520 or sf<500 or m<35)):raise RuntimeError('resource admission/abort floor REFUSED')
 return r
def stop(p):
 if p.poll()is None:
  try:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=12)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
 print('REAP',p.pid,p.returncode,flush=True)
def watch():
 while not done.wait(5):
  try:gate('mid-cell',False)
  except Exception as e:
   aborted.set();print('ABORT',str(e),flush=True)
   for p,_ in list(owned):stop(p)
   return
def run(args,log,bound,env=ENV):
 f=(S/log).open('w');p=subprocess.Popen([N,str(S/'r3-bounded.mjs'),str(bound),*args],stdout=f,stderr=subprocess.STDOUT,env=env,start_new_session=True);owned.append((p,f));print('START',datetime.datetime.now().astimezone().isoformat(),p.pid,log,flush=True)
 try:rc=p.wait(timeout=bound+20)
 except subprocess.TimeoutExpired:stop(p);raise
 f.flush();print('END',p.pid,rc,log,flush=True)
 if rc or aborted.is_set():raise RuntimeError('bounded candidate stage failed: '+log)
 return p.pid
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
pre=json.loads((S/'r3-preflight.json').read_text());pins=pre['sourcePins'];png=pre['existingPngPins'];assert all(sha(W/p)==h for p,h in pins.items()),'preflight source pins changed';assert all(sha(W/p)==h for p,h in png.items()),'old PNG changed';results=[]
try:
 initial=gate('lease granted before existing-fresh-build CSP constraint and allocated boots');threading.Thread(target=watch,daemon=True).start()
 held=json.loads((S/'r3-fresh-build-held-identity.json').read_text());assert all(sha(W/p)==h for p,h in held['compiledUnconstrainedAssets'].items()),'fresh existing build changed before reuse'
 assert all(sha(W/p)==h for p,h in pins.items()),'source changed during build'
 html=W/'out/renderer/index.html';before=sha(html)
 import importlib.util
 spec=importlib.util.spec_from_file_location('own_r3_csp',S/'r3-csp.py');csp=importlib.util.module_from_spec(spec);spec.loader.exec_module(csp);proof=csp.controls();text,actual=csp.constrain(html.read_text());html.write_text(text);proof.update({'actualMeta':actual,'beforeHtmlSha256':before,'afterHtmlSha256':sha(html),'reuseOneSuccessfulBuild':True,'noSecondBuild':True});(R/'r3-csp-proof.json').write_text(json.dumps(proof,indent=2)+'\n');assets={str(p.relative_to(W)):sha(p)for p in (W/'out').rglob('*')if p.is_file()};identity={'baseHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'dirtySourcePins':pins,'assetsSha256':assets,'indexHtmlBeforeCspSha256':before,'indexHtmlAfterCspSha256':sha(html),'cspRigDelta':'connect confined to self/8127; frame/media/img add ONLY same stub origin before all pins; no per-boot mutation','oneBuild':True,'newBuildIdentityNotOldControl':True};(R/'r3-compiled-identity.json').write_text(json.dumps(identity,indent=2)+'\n');print('COMPILED',json.dumps({'main':assets['out/main/index.js'],'html':assets['out/renderer/index.html']}),flush=True)
 for name,mode,version,size,theme in [('R3-fixed-focus-wide','fixed','0.72.1','1380x900','localOperatorDark'),('R3-old-wide','old','0.71.5','1380x900','localOperatorDark'),('R3-prerelease-narrow-light','unknown','0.72.2-dev','800x900','localOperatorLight'),('R3-disconnected-narrow-light','lost','0.72.1','800x900','localOperatorLight')]:
  gate('before '+name);assert all(sha(W/p)==h for p,h in pins.items());assert all(sha(W/p)==h for p,h in assets.items()),'compiled asset drift before boot';out=W/'docs/evidence/hub-skills-library/frames'/name
  run([N,str(S/'r3-probe.mjs'),'--mode',mode,'--version',version,'--out',str(out),'--window-size',size,'--theme',theme,'--window-mode=headless'],'r3-'+mode+'.log',60)
  rec=json.loads((out/('probe-'+mode+'-results.json')).read_text());assert rec['fails']==0,rec;assert all(sha(W/p)==h for p,h in assets.items()),'compiled asset changed during boot';results.append({'run':name,'result':rec,'frames':[str(p.relative_to(W))for p in out.glob('*.png')]});print('BOOTPASS',name,len(results[-1]['frames']),flush=True)
 final=gate('end',False);assert all(sha(W/p)==h for p,h in png.items()),'old74PNG changed';(R/'r3-native-results.json').write_text(json.dumps({'initial':initial,'final':final,'runs':results,'existingPngCountUnchanged':len(png),'nativeAppRealBackendAndPublicOriginStubs':True},indent=2)+'\n')
finally:
 done.set()
 for p,f in reversed(owned):stop(p);f.close()
 (R/'r3-resources.json').write_text(json.dumps(readings,indent=2)+'\n')
 for p in S.glob('r3-*.log'):
  if p.name in ['r3-build.log','r3-build-recovery.log','r3-fixed.log','r3-old.log','r3-unknown.log','r3-lost.log']:(R/p.name).write_bytes(p.read_bytes())
 listen=subprocess.run(['lsof','-nP','-iTCP:8127','-sTCP:LISTEN'],capture_output=True,text=True);print('FINAL8127',listen.returncode,listen.stdout,flush=True)
 if listen.returncode==0:raise RuntimeError('owned fixture listener remains')
