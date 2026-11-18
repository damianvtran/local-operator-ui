import json,sys
run=sys.argv[1]; d=json.load(open(f"{run}/flash.json"))
opens=[]
for o in d['cold'][:1]: opens.append(('cold0',o,None))
for i,o in enumerate(d['restarts'],1): opens.append((f'restart{i}',o,o.get('boot')))
for i,o in enumerate(d['cold'][1:],1): opens.append((f'cold{i}',o,None))
navs=sorted(o['navAt'] for _,o,_ in opens)
reads=[r for r in d['requests'] if r['p'].endswith('/read') and r['m']=='POST']
out=[];bad=[]
for name,o,boot in opens:
    nxt=min(min([n for n in navs if n>o['navAt']],default=10**15), o['navAt']+int(sys.argv[2]))
    rp=[{'path':r['p'],'rel_ms':r['at']-o['navAt']} for r in reads if o['navAt']<=r['at']<nxt]
    seq=[]
    for s in o['states']:
        if s['trig'] and (not seq or seq[-1]['title']!=s['trig']): seq.append({'rel_ms':s['rel'],'title':s['trig'],'gate':s['gate'],'rows':s['rows']})
    titles=[s['title'] for s in seq]
    seedpaint=[t for t in titles if 'Pergamon' in t or 'All organizations' in t]
    rows_perg=[s for s in o['states'] if 'pergamon' in (s['rows'] or '')]
    nondefault=[r for r in rp if 'qaperg' in r['path']]
    ok= titles==['Organization: Minerva'] and not seedpaint and not rows_perg and not nondefault
    if not ok: bad.append(name)
    out.append({'open':name,'boot_storage':boot,'scope_sequence':seq,'read_posts':rp,'pergamon_rows_painted':len(rows_perg),'ok':ok,'frames_saved':len(o['frames'])})
print(json.dumps({'run':run,'allClean':d['allClean'],'error':d.get('error'),'opens':len(out),'bad':bad,'seed_storage':d.get('seed_storage')},indent=1))
for x in out: print(x['open'], x['ok'], [s['title'] for s in x['scope_sequence']], [ (r['path'].split('/')[-2],r['rel_ms']) for r in x['read_posts']], 'first+'+str(x['scope_sequence'][0]['rel_ms'] if x['scope_sequence'] else None), (x['boot_storage'] or {}).get('durable'))
json.dump({'membership_delay_ms':int(run[3:]),'allClean':d['allClean'],'error':d.get('error'),'seed_storage':d.get('seed_storage'),'opens':out},open(f"{run}-timeline.json","w"),indent=1)
