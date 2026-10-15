import os,pathlib,subprocess,json,time,signal,re,hashlib,threading,datetime
S=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD']);original=(S/'r3-cell.py').read_text();exec(original[:original.index("pre=json.loads")])
pre=json.loads((S/'r3-preflight.json').read_text());pins=pre['sourcePins'];compiled=json.loads((R/'r3-compiled-identity.json').read_text());assets=compiled['assetsSha256'];existing={str(p.relative_to(W)):sha(p)for p in (W/'docs/evidence/hub-skills-library/frames').rglob('*.png')};assert len(existing)==76
results=[]
try:
 initial=gate('lease granted before remaining THREE boots; NO BUILD');threading.Thread(target=watch,daemon=True).start()
 for name,mode,version,size,theme in [('R3-fixed-short-narrow-light','fixed-short','0.72.1','800x900','localOperatorLight'),('R3-old-wide','old','0.71.5','1380x900','localOperatorDark'),('R3-prerelease-narrow-light','unknown','0.72.2-dev','800x900','localOperatorLight')]:
  gate('before '+name);assert all(sha(W/p)==h for p,h in pins.items()),'source drift';assert all(sha(W/p)==h for p,h in assets.items()),'compiled asset drift';out=W/'docs/evidence/hub-skills-library/frames'/name
  pid=run([N,str(S/'r3-probe.mjs'),'--mode',mode,'--version',version,'--out',str(out),'--window-size',size,'--theme',theme,'--window-mode=headless'],'r3-'+mode+'.log',60)
  rec=json.loads((out/('probe-'+mode+'-results.json')).read_text());assert rec['fails']==0,rec;assert all(sha(W/p)==h for p,h in assets.items()),'compiled asset changed';row={'run':name,'wrapperPid':pid,'result':rec,'frames':[str(p.relative_to(W))for p in out.glob('*.png')]};results.append(row);print('BOOTPASS',name,len(row['frames']),flush=True)
 final=gate('end',False);assert all(sha(W/p)==h for p,h in existing.items()),'earlier76PNGs changed';(R/'r3-native-results.json').write_text(json.dumps({'initial':initial,'final':final,'focusBoot1':json.loads((S/'r3-partial-focus-result.json').read_text()),'remainingRuns':results,'prior76PngBytesUnchanged':True,'appBuilds':1,'totalNativeBoots':4,'realAppDaemonAndPublicOriginStubs':True,'noControlRebuild':True},indent=2)+'\n')
finally:
 done.set()
 for p,f in reversed(owned):stop(p);f.close()
 (R/'r3-remaining-resources.json').write_text(json.dumps(readings,indent=2)+'\n')
 for p in S.glob('r3-*.log'):
  if p.name in ['r3-fixed-short.log','r3-old.log','r3-unknown.log']:(R/p.name).write_bytes(p.read_bytes())
 listener=subprocess.run(['lsof','-nP','-iTCP:8127','-sTCP:LISTEN'],capture_output=True,text=True);print('FINAL8127',listener.returncode,listener.stdout,flush=True)
 if listener.returncode==0:raise RuntimeError('owned fixture port remains')
