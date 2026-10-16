import os, pathlib, subprocess, hashlib, json, time
sp=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD'])
root=pathlib.Path.home()/'local-operator-ui/.worktrees/browser-tab-strip'
iso=sp/'b2-build-home';iso.mkdir(exist_ok=True)
env={'HOME':str(iso),'PATH':os.environ['PATH'],'TMPDIR':str(sp),'TERM':'xterm-256color','NODE_OPTIONS':'--max-old-space-size=3072','LOCAL_OPERATOR_CONFIG_DIR':str(iso/'config'),'LOCAL_OPERATOR_LOG_DIR':str(iso/'logs'),'LOCAL_OPERATOR_UI_NO_BYTECODE':'true','VITE_GOOGLE_CLIENT_ID':'synthetic-browser-audit','VITE_GOOGLE_CLIENT_SECRET':'SYNTHETIC_NON_CREDENTIAL','VITE_MICROSOFT_CLIENT_ID':'synthetic-browser-audit','VITE_MICROSOFT_TENANT_ID':'synthetic-browser-audit','VITE_LOCAL_OPERATOR_API_URL':'http://127.0.0.1:1','VITE_DISABLE_BACKEND_MANAGER':'true','LOCAL_OPERATOR_UI_TELEMETRY':'off','LOCAL_OPERATOR_NO_NOTIFICATIONS':'1'}
assert not subprocess.run(['git','diff','--quiet','HEAD','--','src'],cwd=root).returncode, 'src differs from frozen HEAD'
lock=root/'node_modules/.pnpm/lock.yaml';before=hashlib.sha256(lock.read_bytes()).hexdigest()
cmd=[str(pathlib.Path.home()/'local-operator/.venv/bin/python'),str(pathlib.Path.home()/'local-operator/scripts/run_bounded.py'),'--timeout','300','--grace','5','--',str(root/'node_modules/.bin/electron-vite'),'build']
start=time.time()
with (sp/'b2-build.log').open('w') as log:
 p=subprocess.run(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
after=hashlib.sha256(lock.read_bytes()).hexdigest()
receipt={'source_sha':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'source_tree':subprocess.check_output(['git','rev-parse','HEAD:src'],cwd=root,text=True).strip(),'command':cmd,'build_mode':'build:npm equivalent; plain JS, no bytecode/Electron compiler launch','synthetic_oauth_credentials':True,'backend_manager_disabled':True,'renderer_api_root':'http://127.0.0.1:1','elapsed_seconds':round(time.time()-start,2),'exit_code':p.returncode,'installed_lock_before':before,'installed_lock_after':after,'artifact_files':{}}
for base in ['out/main','out/preload','out/renderer']:
 for path in (root/base).rglob('*'):
  if path.is_file():receipt['artifact_files'][str(path.relative_to(root))]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':path.stat().st_size,'mtime_ns':path.stat().st_mtime_ns}
(sp/'b2-build-identity.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps({k:v for k,v in receipt.items() if k!='artifact_files'},indent=2));print('artifact_file_count',len(receipt['artifact_files']));print('log',sp/'b2-build.log')
raise SystemExit(p.returncode or (0 if before==after else 1))
