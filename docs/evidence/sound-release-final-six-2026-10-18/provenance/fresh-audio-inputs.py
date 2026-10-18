import os,sys,json,asyncio,hashlib,subprocess,dataclasses,pathlib
from datetime import datetime,timezone
root=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD'])/'final-audio-inputs';root.mkdir(exist_ok=True)
# Credentials are read only into memory before isolating the provider config.
key=subprocess.check_output(['lop','secret','get','RADIENT_API_KEY']).decode().strip()
elkey=subprocess.check_output(['lop','secret','get','ELEVENLABS_API_KEY']).decode().strip()
for k in list(os.environ):
 if k.startswith(('CMUX_','LOP_')) or k in ('RADIENT_API_KEY','OPENAI_API_KEY','XPC_FLAGS'):os.environ.pop(k,None)
os.environ['HOME']=str(root/'home');os.environ['LOCAL_OPERATOR_CONFIG_DIR']=str(root/'config');os.environ['ELEVENLABS_API_KEY']=elkey
os.environ['GIT_CONFIG_SYSTEM']='/dev/null';os.environ['GIT_TERMINAL_PROMPT']='0'
pathlib.Path(os.environ['HOME']).mkdir(exist_ok=True);pathlib.Path(os.environ['LOCAL_OPERATOR_CONFIG_DIR']).mkdir(exist_ok=True)
import httpx
async def main():
 async with httpx.AsyncClient(timeout=60) as c:
  headers={'Authorization':'Bearer '+key}
  r=await c.get('https://api.radienthq.com/v1/tools/audio/result',params={'request_id':'aud_6ad446940d2c53091b89c45a'},headers=headers)
  # Deliberately never retain a successful body: it can include expiring URLs.
  print('identity GET',r.status_code)
  (root/'identity.json').write_text(json.dumps({'http_status':r.status_code,'request_id':'aud_6ad446940d2c53091b89c45a','at':datetime.now(timezone.utc).isoformat()}))
  r=await c.post('https://api.radienthq.com/v1/tools/audio/sound-effects',json={'prompt':'a door creak','model':'radient/sound-effects'},headers=headers)
  assert r.status_code==400, f'refusal HTTP {r.status_code}'
  body=r.json();assert body['code']=='audio_rejected';assert body['details']['reason']=="duration_seconds is required: the provider's auto-duration mode cannot be quoted"
  (root/'refusal.json').write_text(json.dumps(body,indent=2));print('fresh refusal HTTP 400',json.dumps(body))
 from local_operator.tools.audio_tool import execute_generate_sound_effect,_describe_sound_effect_approval
 from local_operator.harness.types import ToolContext
 from local_operator.audiogen import availability,pricing
 from local_operator.paths import config_dir
 assert not availability.radient_available(config_dir())
 args={'prompt':'a short wooden door creak, close perspective','duration_s':0.5}
 spent=[]
 ctx=ToolContext(cwd=str(root)).model_copy(update={'record_channel_spend':spent.append})
 result=await execute_generate_sound_effect('release-fresh-byok',args,context=ctx)
 data=result.model_dump(mode='json');assert not result.is_error,data
 assert data['details']['provider']=='elevenlabs';assert data['details']['billing_basis']=='estimated';assert data['details']['cost_source']=='rate_table';assert data['details']['cost_usd']==0.002
 estimate=dataclasses.asdict(pricing.sound_effect_estimate('elevenlabs','eleven_text_to_sound_v2',.5));assert estimate['units']==1
 # This is the vendor contract's absent charge, separate from the harness estimate.
 output={'at':datetime.now(timezone.utc).isoformat(),'args':args,'result':data,'cost':None,'estimate':estimate,'approval':_describe_sound_effect_approval(args,str(root)),'channel_spend':[x.model_dump(mode='json') if hasattr(x,'model_dump') else dataclasses.asdict(x) if dataclasses.is_dataclass(x) else x for x in spent]}
 (root/'byok.json').write_text(json.dumps(output,indent=2,default=str));print('fresh BYOK',json.dumps(output,default=str))
 from local_operator.audiogen.peaks import compute_peaks
 source=pathlib.Path('/Users/damian/.local-operator/sessions/7046cbee7da0/scratchpad/audio-live')
 assets=[]
 for rid,title,tool,dur in [('aud_6ad446940d2c53091b89c45a','Real Radient voiceover','generate_voiceover',1.619592),('aud_6ad446a1e73ab027182a5272','Real Radient door creak','generate_sound_effect',.522449)]:
  p=source/(rid+'.mp3');raw=p.read_bytes();peaks=compute_peaks(raw);assert peaks and max(peaks)>0
  assets.append(dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest(),title=title,tool=tool,duration_s=dur,peaks=peaks,request_id=rid))
 (root/'assets.json').write_text(json.dumps(assets,indent=2));print('assets',[(a['request_id'],a['sha256']) for a in assets]);print('store',config_dir()/'attachments')
asyncio.run(main())
