import os,json,hashlib,pathlib,subprocess,unicodedata,re
R=pathlib.Path('/Users/damian/local-operator-ui/.worktrees/i18n-s8')
S=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD']); instance=S.parent.name
stem=f'vi-sol-{instance}'; head='e5fb4310dab638f9cf428779d62539ec039a8990'
N=['ui.chat','ui.chat.composer_media','ui.common.actions']
K={'ui.chat':['ui.chat.image_actions.actions','ui.chat.audio.position_label'],'ui.chat.composer_media':['ui.chat.composer_media.pasted_image'],'ui.common.actions':['ui.common.actions.actions_for_name']}
G=pathlib.Path('/Users/damian/local-operator-ui/.worktrees/_s12-audits')/head/'glossary.md'
style=pathlib.Path('/Users/damian/local-operator/i18n/style-guides/vi.md')
E=json.loads((G.parent/'expected-hashes.json').read_text())
log=['Independent vi four-key audit; actual auditor openai/gpt-6.1-sol / '+instance+'. No fallback.','Execution log below contains actual subprocess commands and their observed stdout/stderr/exit codes.','Earlier actual shell inspections: git rev-parse HEAD; git status --porcelain; read-only git diff origin/main HEAD -- scoped en/vi catalogues and contexts; shasum -a 256 on the nine input files; git rev-parse origin/main; shasum on style guide and supplied glossary. Their output is in this session transcript.','Read-only inspections (not execution tests): vi style guide; manager-provided full glossary copy; model receipt and record; English contexts; same-locale neighbouring terms; get-file-name.ts and attachment-encode.ts; UI AGENTS.md i18n section, docs/I18N.md audit/retention sections, repository validator helper source.','No builds, installs, servers, MT services, browser, repository edits or ledger writes.']
env={k:v for k,v in os.environ.items() if not k.startswith('CMUX_')};env.pop('XPC_FLAGS',None)
def run(args,stdin=None):
 p=subprocess.run(args,cwd=R,env=env,input=stdin,text=True,capture_output=True)
 log.extend(['\nCOMMAND: '+repr(args)]+(['STDIN SOURCE:\n'+stdin] if stdin else [])+['EXIT: '+str(p.returncode),'STDOUT:\n'+p.stdout,'STDERR:\n'+p.stderr]);assert p.returncode==0,(args,p.stderr)
 return p.stdout
assert run(['git','rev-parse','HEAD']).strip()==head
assert run(['git','status','--porcelain'])==''
base=run(['git','rev-parse','origin/main']).strip()
paths=[]; nsdata={}; consistency={};count=0
for ns in N:
 inputs={}
 for lang,suffix,label in [('en','','en'),('vi','','vi'),('en','.context','context')]:
  path=f'src/i18n/catalogues/{lang}/{ns}{suffix}.json';paths.append(path)
  out=run(['shasum','-a','256',path]);h=out.split()[0]
  assert h==E['hashes'][f'{lang}/{ns}{suffix}']
  inputs[label]={'path':path,'sha256':h}
 en=json.loads((R/inputs['en']['path']).read_text());vi=json.loads((R/inputs['vi']['path']).read_text());ct=json.loads((R/inputs['context']['path']).read_text())
 assert en.keys()==vi.keys()
 before=json.loads(run(['git','show','origin/main:'+inputs['vi']['path']]))
 changed={k for k in before if k not in vi or before[k]!=vi[k]};added=set(vi)-set(before)
 assert not changed and added==set(K[ns])
 run(['git','diff','origin/main','HEAD','--',inputs['vi']['path']])
 consistency[ns]={'key_count':len(vi),'fully_audited_key_count':len(K[ns]),'consistency_only_key_count':len(vi)-len(K[ns]),'key_set_matches_english':True,'legacy_removed_or_changed':[],'new_keys':sorted(added),'base_ref_sha':base}
 count+=len(vi)
 nsdata[ns]={'status':'passed','result':'clean','source_sha256':inputs['en']['sha256'],'target_sha256':inputs['vi']['sha256'],'input_hashes':inputs,'findings':[]}
node=r'''import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {duplicateKeys} from './scripts/i18n/check-duplicates.mjs';
import {namespaceGap} from './scripts/i18n/context-parity.mjs';
const require=createRequire(new URL('./scripts/i18n/generate.mjs',import.meta.url));
const {parse,TYPE}=require('@formatjs/icu-messageformat-parser');
const {IntlMessageFormat}=require('intl-messageformat');
const specs={'ui.chat':['ui.chat.image_actions.actions','ui.chat.audio.position_label'],'ui.chat.composer_media':['ui.chat.composer_media.pasted_image'],'ui.common.actions':['ui.common.actions.actions_for_name']};
let checked=0;
for(const [ns,keys] of Object.entries(specs)){
 for(const path of [`en/${ns}.json`,`vi/${ns}.json`,`en/${ns}.context.json`]){
  const text=readFileSync('src/i18n/catalogues/'+path,'utf8');JSON.parse(text);
  if(duplicateKeys(text).length)throw Error('Duplicate keys: '+path);
 }
 const gap=namespaceGap(ns);const allowance=JSON.parse(readFileSync('i18n/context-allowance.json','utf8')).namespaces[ns]?.keys??[]; const unexpected=gap.uncovered.filter(k=>!allowance.includes(k));if(!gap.hasSidecar||unexpected.length||gap.orphaned.length)throw Error('Context parity: '+ns);console.log(JSON.stringify({namespace:ns,allowed_legacy_context_gaps:gap.uncovered,unexpected_gaps:unexpected}));
 const en=JSON.parse(readFileSync(`src/i18n/catalogues/en/${ns}.json`,'utf8'));
 const vi=JSON.parse(readFileSync(`src/i18n/catalogues/vi/${ns}.json`,'utf8'));
 for(const key of keys){
  const a=parse(en[key]),b=parse(vi[key]);
  const args=x=>x.filter(n=>n.type===TYPE.argument).map(n=>n.value).sort();
  if(JSON.stringify(args(a))!==JSON.stringify(args(b)))throw Error('Placeholder mismatch: '+key);
  if(b.some(n=>n.type!==TYPE.literal&&n.type!==TYPE.argument))throw Error('Unexpected typed/ICU/tag structure: '+key);
  const samples=[];
  for(const label of ['report.txt','Ảnh mùa hè.png','报告截图.png','O\'Brien “final”, (v2)!','{name} <tag>']){
   const params={name:label,label};const rendered=new IntlMessageFormat(vi[key],'vi').format(params);
   if(args(b).length&&!rendered.includes(label))throw Error('Verbatim interpolation failed: '+key);
   samples.push({inserted:label,rendered});
  }
  console.log(JSON.stringify({key,source:en[key],target:vi[key],arguments:args(b),samples}));checked++;
 }
}
console.log('PASS: repository duplicate/context validators on 3 scoped namespaces (9 JSON files); production ICU parser and IntlMessageFormat on '+checked+' new keys; 5 arbitrary user-string samples per key.');
'''
log.extend(['Earlier failed actual check: node --input-type=module importing duplicateKeys, namespaceGap and the ICU parser/formatter stopped at ui.chat context parity (exit 1): Error: Context parity: ui.chat. The first probe incorrectly required zero legacy context gaps.', 'Actual follow-up: node --input-type=module printed namespaceGap and i18n/context-allowance.json for the three namespaces. ui.chat has six uncovered legacy keys, all explicitly allowed: ui.chat.highlights.file_resolution_failed; ui.chat.usage.blocked; ui.chat.usage.continue; ui.chat.usage.eligibility_unknown; ui.chat.usage.family_caps; ui.chat.usage.unlimited. Other namespaces have no gaps; none has orphans. Corrected scoped validator honours repository allowance rather than suppressing new gaps.'])
for ns in N:
 enbefore=json.loads(run(['git','show','origin/main:src/i18n/catalogues/en/'+ns+'.json']))
 ctbefore=json.loads(run(['git','show','origin/main:src/i18n/catalogues/en/'+ns+'.context.json']))
 log.append('BASELINE legacy uncovered '+ns+': '+repr(sorted(set(enbefore)-set(ctbefore))))
nodeout=run(['node','--input-type=module'],node)
checks=[]
assess={
'ui.chat.image_actions.actions':'Thao tác với ảnh is an idiomatic neutral menu label, matching file_actions_menu.file_actions = Thao tác với tệp and image_actions.copy_image = Sao chép ảnh / expand_image = Mở rộng ảnh.',
'ui.chat.audio.position_label':'Vị trí phát names playback position rather than play/pause; matches attachments.playback_position = Vị trí phát. The invariant connector của takes any verbatim title without case/gender/number agreement; play_label = Phát {label}, pause_label = Tạm dừng {label}.',
'ui.chat.composer_media.pasted_image':'Ảnh đã dán is a compact accurate fallback noun phrase parallel to pasted_file = Tệp đã dán. No extension, MIME identifier or user-name transformation.',
'ui.common.actions.actions_for_name':'Thao tác với {name} names the actions applicable to the asset and matches existing ui.chat.canonical.link_toolkit.actions_for = Thao tác với {name} and file_actions_menu.file_actions = Thao tác với tệp. Invariant với is grammatical for Latin/CJK, punctuation or quoted filenames; no agreement or added quoting.'}
for ns in N:
 en=json.loads((R/nsdata[ns]['input_hashes']['en']['path']).read_text());vi=json.loads((R/nsdata[ns]['input_hashes']['vi']['path']).read_text())
 for key in K[ns]:
  t=vi[key]; assert unicodedata.normalize('NFC',t)==t
  invisible=[{'codepoint':f'U+{ord(c):04X}','name':unicodedata.name(c,'UNKNOWN')} for c in t if unicodedata.category(c)=='Cf' or c in '\u00a0\u202f\u2007']
  assert not invisible
  assert re.findall(r'\{[^}]+\}',en[key])==re.findall(r'\{[^}]+\}',t)
  checks.append({'key':key,'source':en[key],'current_text':t,'findings':[],'assessment':assess[key],'placeholder_integrity':{'arguments':re.findall(r'\{([^}]+)\}',t),'matches_english':True},'plural_select':[]})
log.extend(['\nPYTHON DERIVED CHECKS: 9 shasum results match expected-hashes.json; all 3 vi/en key sets match; all old vi keys and values unchanged vs recorded origin/main; four new keys only.','NFC/invisible scan: all four targets NFC; no NBSP U+00A0, narrow NBSP U+202F, figure space U+2007, Cf zero-width or bidi controls.','Linguistic assessment is auditor reasoning, not command output. No glossary terms are contradicted. Short noun phrases, sentence case and direct neutral register conform to vi guide lines 12–17; ảnh matches existing copy_image/expand_image; tệp guide lines 26–28; all placeholders preserved per glossary line 126.','Metadata review (source reading, no executed attachment behavior): getFileName routes image data URIs to pasted_image; other data URIs including missing MIME/invalid percent encoding to pasted_file; valid decoded names remain verbatim. attachment-encode passes source untouched, uses getFileName for synthetic upload metadata and stored.name ?? name for persisted names. Broadened pasted_file note is accurate.','Not certified: semantic correctness of legacy values; rendered/pixel fit, screen-reader output, full application or attachment runtime. Width is advisory; new labels compact without hard bounds.','Full aggregate pnpm check-i18n and ledger commands not run: read-only scoped task; only repository duplicate/context helper validators on nine allowed inputs plus ICU parser/formatter above.','Glossary conformance checked against manager-owned copy '+str(G)+'; this is a supplied byte-copy, not direct reading of core glossary.'])
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
auditor={'agent':'i18n-auditor','instance':instance,'session':instance,'model':'openai/gpt-6.1-sol','actual_model_source':f'Served session header: openai/gpt-6.1-sol; session {instance}. No fallback used.','fallback_used':False,'independent_from_translator_session':True}
translator={'agent':'i18n-translator','model':'anthropic/claude-sonnet-5-5','source':'Delegation supplies translator session 9b4eaf460088 and values verbatim. Auditor did not translate or participate in translation.'}
scope=f'PR #1842 @ {head}; vi four new keys fully audited; other namespace keys consistency_only (not legacy semantic certification). English pasted_file broadened metadata checked against source.'
unverified=['No browser, rendered UI, screen-reader or pixel-fit validation.','Legacy translation values are consistency_only; not certified by this audit.','No aggregate check-i18n, ledger updates, repository writes, PR comment or tracked retention. Manager must retain scratch deliverables under canonical evidence root.']
receipt={'locale':'vi','mode':'Fresh independent four-key delta audit; read-only frozen worktree. Allocation: fix (<2h), bounded audit only.','scope':scope,'head_sha':head,'audit_date':'2026-11-10','key_count':count,'translator':translator,'auditor':auditor,'status':'passed','result':'clean','verdict':'clean','findings':[],'severity_counts':dict.fromkeys(['blocker','major','minor','nit'],0),'namespaces':nsdata,'per_key_checks':checks,'remediation_verification':{'status':'No in-scope findings; fully_audited_key_count = 4; all other keys consistency_only. Glossary conformance checked against manager-provided byte-copy at _s12-audits/e5fb4310dab638f9cf428779d62539ec039a8990/glossary.md (SHA-256 0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8).','prior_findings':[],'policy_sources':[str(style),str(G),'docs/I18N.md'],'executed_checks':['See companion audit.log: actual shasum, git, Python consistency checks, scoped repository duplicate/context validators and ICU parser/formatter.'],'typography_fit':'Four strings NFC, ordinary spaces only, no invisible/bidi controls, sentence case, no terminal punctuation; no hard length constraint. No rendered fit claimed.','out_of_scope_pre_existing':['Six ui.chat context gaps are present on origin/main and explicitly listed in i18n/context-allowance.json; no new gap, no in-scope missing context. First strict helper probe failed on these; corrected allowance-aware probe passes. See audit.log.']},'unverified':unverified,'receipt_contract_review':'Root, namespace, auditor, translator and per-key field sets copied from required reference receipt. Python readback/schema-set/hash/identity checks executed.','audit_notes_not_execution_log':True}
receiptpath=S/(stem+'.json');logpath=S/(stem+'.audit.log');recordpath=S/(stem+'.record.json')
receiptpath.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
log.append('Artifact validation: Python JSON roundtrip, exact reference root/namespace field sets, namespace input hashes rechecked, auditor instance verified from scratch parent, independent translator session confirmed.')
logpath.write_text('\n'.join(log)+'\n')
record={'locale':'vi','namespace':N,'audit_date':'2026-11-10','key_count':count,'fully_audited_key_count':4,'consistency_only_key_count':count-4,'scope':scope,'head_sha':head,'auditor':auditor,'translator':translator,'input_hashes':{ns:nsdata[ns]['input_hashes'] for ns in N},'policy_inputs':{'style_guide':{'path':str(style),'sha256':sha(style)},'glossary':{'path':str(G),'sha256':sha(G)}},'artifacts':[{'path':receiptpath.name,'sha256':sha(receiptpath),'kind':'audit_notes_not_execution_log','record_reference':recordpath.name},{'path':logpath.name,'sha256':sha(logpath),'kind':'actual_execution_log','record_reference':recordpath.name}],'current_report_verdict':{'status':'passed','unresolved_blocker_major_count':0,'finding_ids':[]},'finding_report':receiptpath.name,'audit_notes_not_execution_log':True,'execution_log':logpath.name,'retention':{'state':'scratch_handoff_only_per_explicit_read_only_task','intended_tracked_directory':'i18n/audits/evidence/vi/<namespace>/s12-sol-'+instance,'manager_action_required':'Retain record and companions under canonical evidence root and assemble immutable UI ledger receipts. No ledger command run here.','proposed_note':'passed; retain namespace-scoped record under i18n/audits/evidence/vi/<namespace>/s12-sol-'+instance+'/record.json'},'unverified':unverified}
recordpath.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
ref=json.loads(pathlib.Path('/Users/damian/local-operator-ui/.worktrees/_s10-audits/fd09d8f/fr-sol-e23a48ff2216.json').read_text())
assert receipt.keys()==ref.keys()
assert all(d.keys()==next(iter(ref['namespaces'].values())).keys() for d in nsdata.values())
for p in [receiptpath,recordpath]:json.loads(p.read_text())
for ns in N:
 for x in nsdata[ns]['input_hashes'].values():assert sha(R/x['path'])==x['sha256']
assert auditor['instance']==S.parent.name and instance!='9b4eaf460088'
print(json.dumps({'status':'passed','result':'clean','namespace_checks':consistency,'hashes':'9/9 match','four_new_keys':'4/4 parse, identical placeholders, arbitrary-string ICU formatting passes; NFC and no invisibles','artifacts':[str(receiptpath),str(recordpath),str(logpath)]},ensure_ascii=False,indent=2))
