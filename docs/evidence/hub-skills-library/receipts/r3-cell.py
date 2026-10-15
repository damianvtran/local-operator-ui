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
 initial=gate('lease granted before ONE actual candidate build (setup recovery)');threading.Thread(target=watch,daemon=True).start();env=dict(ENV,**json.loads((S/'r3-env-preflight.json').read_text())['inertEnv']);oldMtime=(W/'out/renderer/index.html').stat().st_mtime_ns;buildStarted=time.time_ns();run(['./node_modules/.bin/electron-vite','build'],'r3-build-recovery.log',300,env)
 assert (W/'out/renderer/index.html').stat().st_mtime_ns>oldMtime and (W/'out/renderer/index.html').stat().st_mtime_ns>=buildStarted,'fresh app build artifact mtime not proved before CSP'
 assert 'vite' in (S/'r3-build-recovery.log').read_text().lower(),'no actual Vite build output'
 assert all(sha(W/p)==h for p,h in pins.items()),'source changed during build'
 html=W/'out/renderer/index.html';before=sha(html);text=html.read_text();text,n=re.subn(r'connect-src[^;]+;',"connect-src 'self' http://127.0.0.1:8127;",text);assert n==1
 for d in ['frame-src','media-src','img-src']:text=re.sub(r'('+d+r' )([^;\"]*)',lambda m:m[0]if'127.0.0.1:8127'in m[2]else m[1]+m[2].strip()+' http://127.0.0.1:8127',text)
 html.write_text(text);assets={str(p.relative_to(W)):sha(p)for p in [W/'out/main/index.js',W/'out/preload/index.js',html]+sorted((W/'out/renderer/assets').glob('*'))if p.is_file()};identity={'baseHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'dirtySourcePins':pins,'assetsSha256':assets,'indexHtmlBeforeCspSha256':before,'indexHtmlAfterCspSha256':sha(html),'cspRigDelta':'connect confined to self/8127; frame/media/img add ONLY same stub origin before all pins; no per-boot mutation','oneBuild':True,'newBuildIdentityNotOldControl':True};(R/'r3-compiled-identity.json').write_text(json.dumps(identity,indent=2)+'\n');print('COMPILED',json.dumps({'main':assets['out/main/index.js'],'html':assets['out/renderer/index.html']}),flush=True)
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
