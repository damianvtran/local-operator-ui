import json, hashlib, re, subprocess, unicodedata, os
from pathlib import Path
root=Path.home()/'local-operator-ui/.worktrees/i18n-s8'
out=Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD'])/'aud3-fr-sol'
ref=Path.home()/'local-operator-ui/.worktrees/_s10-audits/89d7458/fr-sol-8195830a463b.json'
session='e23a48ff2216'; key='ui.chat.sidebar.agents.builtin_offer'; ns='ui.chat.sidebar'
def git(*args): return subprocess.check_output(['git',*args],cwd=root,text=True).strip()
def unique(pairs):
 d={}
 for k,v in pairs:
  assert k not in d, ('duplicate JSON key',k)
  d[k]=v
 return d
def load(p): return json.loads(p.read_text(),object_pairs_hook=unique)
head=git('rev-parse','HEAD'); assert head=='fd09d8f296318319817edb5a511a42ff6a07868f'
assert git('status','--short')==''
print('HEAD',head,'; git status --short: empty')
paths={l:f'src/i18n/catalogues/{l}/ui.chat.sidebar.json' for l in ['en','fr']}
paths['context']='src/i18n/catalogues/en/ui.chat.sidebar.context.json'
hashes={}
data={}
for l,p in paths.items():
 b=(root/p).read_bytes(); h=hashlib.sha256(b).hexdigest(); hashes[l]={'path':p,'sha256':h}
 actual=subprocess.check_output(['shasum','-a','256',p],cwd=root,text=True).split()[0]
 assert h==actual
 assert b==subprocess.check_output(['git','show',f'HEAD:{p}'],cwd=root)
 data[l]=load(root/p); print('shasum -a 256',p,':',h,'; HEAD byte match: PASS')
assert hashes['fr']['sha256'].startswith('ec93a140d65c')
assert hashes['en']['sha256'].startswith('7db9ba5108a6')
assert set(data['en'])==set(data['fr']) and len(data['fr'])==86
base=json.loads(subprocess.check_output(['git','show',f'origin/main:{paths["fr"]}'],cwd=root,text=True))
changed=[k for k in data['fr'] if base.get(k)!=data['fr'][k]]
assert changed==[key] and set(base)==set(data['fr'])
print('Duplicate-free valid JSON; source/target key sets identical: 86; changed French keys:',changed)
# Deliberately bounded parser for the ICU subset present here, not a replacement for production validation.
def close(s,i):
 depth=1
 for j in range(i+1,len(s)):
  if s[j]=='{': depth+=1
  elif s[j]=='}':
   depth-=1
   if depth==0: return j
 raise AssertionError('unbalanced braces')
def parse(s):
 nodes=[]; i=0; text=''
 while i<len(s):
  if s[i]=='{':
   if text: nodes.append(('text',text)); text=''
   j=close(s,i); inner=s[i+1:j]; parts=inner.split(',',2); name=parts[0].strip()
   if len(parts)==1: nodes.append(('arg',name,'string',None))
   elif parts[1].strip()=='number':
    assert len(parts)==3 and parts[2].strip()=='::group-off'
    nodes.append(('arg',name,'number','::group-off'))
   else:
    assert len(parts)==3 and parts[1].strip()=='plural'
    tail=parts[2]; arms={}; n=0
    while n<len(tail):
     if tail[n].isspace(): n+=1; continue
     m=re.match(r'(=\d+|one|many|other)\s*\{',tail[n:]); assert m, tail[n:]
     label=m.group(1); opening=n+m.end()-1; end=close(tail,opening)
     assert label not in arms; arms[label]=parse(tail[opening+1:end]); n=end+1
    nodes.append(('plural',name,arms))
   i=j+1
  else:
   assert s[i]!='}'; text+=s[i]; i+=1
 if text: nodes.append(('text',text))
 return nodes
def args(nodes):
 a=set()
 for node in nodes:
  if node[0]=='arg': a.add((node[1],node[2]))
  if node[0]=='plural':
   a.add((node[1],'plural'))
   for arm in node[2].values(): a|=args(arm)
 return a
source=data['en'][key]; target=data['fr'][key]
e=parse(source); f=parse(target); old=parse(base[key])
assert len(f)==len(old)==1
assert set(f[0][2])=={'=0','one','=2','=3','=4','=5','=6','many','other'}
assert set(f[0][2])-set(old[0][2])=={'many'}
for arm in old[0][2]: assert f[0][2][arm]==old[0][2][arm]
assert args(e)==args(f)=={('count','plural'),('count','number'),('list','string')}
print('ICU subset parser: balanced braces; exact argument/type parity; exact ::group-off; one/many/other present; all existing arms unchanged: PASS')
special=[(i,f'U+{ord(c):04X}',unicodedata.name(c,'UNKNOWN')) for i,c in enumerate(target) if c.isspace() and c!=' ' or unicodedata.category(c)=='Cf']
assert not special
assert "'" not in target and 'd’agents intégrés' in target
assert all(target[i-1:i+2]==' — ' for i,c in enumerate(target) if c=='—')
print('Unexpected non-ASCII whitespace/bidi/zero-width: none; U+2019 apostrophes and spaced em dashes: PASS')
# Rule taken from binding fr guide lines 53–56, for ordinary integer operands only.
def category(n): return 'one' if n in (0,1) else 'many' if n!=0 and n%1000000==0 else 'other'
def render(nodes,n,list_value):
 result=''
 for node in nodes:
  if node[0]=='text': result+=node[1]
  elif node[0]=='arg': result+=str(n) if node[1]=='count' else list_value
  else:
   arm='='+str(n) if '='+str(n) in node[2] else category(n)
   result+=render(node[2][arm],n,list_value)
 return result
expansions=[]
for n in [0,1,2,7,1000000,1500000,2000000]:
 arm='='+str(n) if '='+str(n) in f[0][2] else category(n)
 sentence=render(f,n,'Atlas et Nova')
 print(f'{n} -> {arm}: {sentence}')
 expansions.append({'count':n,'arm':arm,'list':'Atlas et Nova','text':sentence})
print('Expansions above are Python derivations, not production formatter output. List fixture preserved verbatim.')
for dirpath in [Path.home()/'local-operator-ui/i18n/receipts',Path.home()/'local-operator-ui/i18n/audits/evidence']:
 assert dirpath.is_dir(),str(dirpath)
 hits=[str(p) for p in dirpath.rglob('*') if p.is_file() and session.encode() in p.read_bytes()]
 assert not hits,hits
 print('Instance collision search:',dirpath,': no matches')
r=load(ref)
r.update(locale='fr',mode='Fresh independent one-key delta audit; one full key plus 85 namespace keys read for term consistency. Read-only worktree. Allocation: fix (<2h), bounded audit only.',scope=f'PR #1837 @ {head}; origin/main..HEAD French builtin_offer only: added many arm, all old arms unchanged. No full legacy namespace certification.',head_sha=head,audit_date='2026-11-10',key_count=86)
r['translator']={'agent':'i18n-translator','model':'anthropic/claude-sonnet-5-5','source':'Translator model supplied by delegation; translator session not supplied. This auditor did not translate or participate in translation.'}
r['auditor']={'agent':'i18n-auditor','instance':session,'session':session,'model':'openai/gpt-6.1-sol','actual_model_source':'Served session header: openai/gpt-6.1-sol; session e23a48ff2216. No fallback used.','fallback_used':False,'independent_from_translator_session':True}
r.update(status='passed',result='clean',verdict='clean',findings=[],severity_counts={'blocker':0,'major':0,'minor':0,'nit':0})
r['namespaces']={ns:{'status':'passed','result':'clean','source_sha256':hashes['en']['sha256'],'target_sha256':hashes['fr']['sha256'],'input_hashes':hashes,'findings':[]}}
r['per_key_checks']=[{'key':key,'source':source,'current_text':target,'findings':[],'assessment':'The many arm is grammatical: d’agents supplies elided de after million multiples; plural intégrés/prêts/installés agrees, modifier remains consistent, vous register preserved. Exact-zero and singular arms remain intact; agent names are interpolated verbatim. No hard width budget in context; no visual-fit claim.','placeholder_integrity':{'arguments':[['count','number'],['list','string']],'matches_english':True,'number_skeleton':'::group-off'},'plural_select':[['count',list(f[0][2])]]}]
r['remediation_verification']={'status':'Missing French many arm repaired; no in-scope findings.','prior_findings':[],'policy_sources':['~/local-operator/i18n/style-guides/fr.md','~/local-operator/i18n/glossary.md','docs/I18N.md'],'executed_checks':['See companion audit.log: actual Python checks, shasum, read-only git and derived seven-count expansions. Not Node/production execution.'],'typography_fit':'U+2019 apostrophes; em dash with U+0020 on both sides; no NBSP, U+202F, bidi or zero-width characters in key. No prose colon/semicolon/exclamation/question mark requiring U+202F. Number grouping intentionally suppressed by source ::group-off; no new style conflict. No maxCells/maxChars hint.','out_of_scope_pre_existing':[]}
r['unverified']=['Node validator, production ICU parser/formatter, CLDR runtime selection and ledger commands not executed: explicit no-Node/read-only task constraints. Integer selection is derived using binding fr guide, not a runtime test.','No browser or pixel-fit/width/screen-reader validation: task forbids browser/builds. No rendered UI proof claimed.','No ledger writes, tracked evidence retention, PR comment or commits. Scratch deliverables require manager retention under canonical evidence root; evidence README absent in pinned worktree.','Translator session identity is not supplied; independence is based on this fresh auditor session and no participation in translation.']
r['receipt_contract_review']='Exact root, namespace, auditor, translator and per-key field sets copied from required reference receipt. Python schema-set/identity/hash/status checks executed; Node contract not executed.'
r['audit_notes_not_execution_log']=True
original=load(ref)
assert set(r)==set(original)
assert set(r['namespaces'][ns])==set(original['namespaces'][ns])
for field in ['auditor','translator','remediation_verification']:
 assert set(r[field])==set(original[field])
assert set(r['per_key_checks'][0])==set(original['per_key_checks'][0])
assert set(r['per_key_checks'][0]['placeholder_integrity'])==set(original['per_key_checks'][0]['placeholder_integrity'])
(out/'receipt.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
(out/'expansions.json').write_text(json.dumps(expansions,ensure_ascii=False,indent=2)+'\n')
assert load(out/'receipt.json')['auditor']['instance']==session
assert git('status','--short')=='' and git('rev-parse','HEAD')==head
print('Reference receipt field-set comparison, readback, final HEAD and clean worktree: PASS')
print('Verdict clean; severity counts 0/0/0/0; actual model openai/gpt-6.1-sol; no fallback')
