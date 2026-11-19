import json, pathlib, hashlib, subprocess, re, unicodedata, os
root=pathlib.Path('/Users/damian/local-operator-ui/.worktrees/i18n-s8')
policy=root.parent/'_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23'
scratch=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD']); instance=scratch.parent.name
stem=f'hi-sol-{instance}'
sha=lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
load=lambda p:json.loads(pathlib.Path(p).read_text())
paths={'en':'src/i18n/catalogues/en/ui.library.json','hi':'src/i18n/catalogues/hi/ui.library.json','context':'src/i18n/catalogues/en/ui.library.context.json'}
en,hi,context=[load(root/paths[k]) for k in ['en','hi','context']]
keys=load(policy/'keys20.json'); expected=load(policy/'expected-hashes.json')
head=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
assert head==expected['head']=='8a9ce1f808c266ebe9a0e924094344cea60c2c23'
inputs={k:{'path':p,'sha256':sha(root/p)} for k,p in paths.items()}
for k in paths:
 manifest_key={'en':'en/ui.library','hi':'hi/ui.library','context':'en/ui.library.context'}[k]
 assert inputs[k]['sha256']==expected['hashes'][manifest_key]
assert sha(policy/'glossary.md')=='0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8'
base=json.loads(subprocess.check_output(['git','-C',str(root),'show','0e12072d2b3:src/i18n/catalogues/hi/ui.library.json'],text=True))
assert en.keys()==hi.keys()
assert set(hi)-set(base)==set(keys) and len(keys)==20
assert not set(base)-set(hi)
assert all(hi[k]==v for k,v in base.items())
assert all(en[k]==v['english'] and context[k]==v['context'] for k,v in keys.items())
invisible=[]
for k in keys:
 assert not re.search(r'[{}<>`]',en[k]+hi[k]),k
 for pos,ch in enumerate(hi[k]):
  if unicodedata.category(ch)=='Cf' or ch in '\u00a0\u202f\u2007':invisible.append([k,pos,f'U+{ord(ch):04X}'])
assert not invisible
checks={'head':head,'hash_binding':'all 3 catalogue/context hashes and full glossary SHA-256 match manifest/brief','total_namespace_keys':len(hi),'delta_keys':len(keys),'legacy_unchanged_keys':len(base),'key_parity':True,'added_only_semantic_diff':True,'keys20_source_context_binding':True,'new_keys_placeholder_plural_markup_code_count':0,'invisible_characters':invisible,'lengths_codepoints':{k:len(hi[k]) for k in keys},'new_badge_heading_over_12_codepoints':{k:len(hi[k]) for k in keys if k!='ui.library.preview.unsupported_generic' and len(hi[k])>12}}
print(json.dumps(checks,ensure_ascii=False,indent=2))
logpath=scratch/f'{stem}.audit.log'
with logpath.open('a') as f:
 f.write('\nActual execution: python3 '+str(scratch/'hi-sol-check.py')+'\n')
 f.write(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')
 f.write('\nREAD/REASONED (not execution proof): Read Hindi guide, full binding glossary, source/context and all 20 target values; targeted existing Hindi catalogue terms; model receipt and record schema. Source-only library-viewers.tsx lines 107-111 verifies other uses generic, with no inserted kind. No render, build, installs, test tree, MT, ledger or repository write. Earlier shell git diff and shasum commands are recorded in session tool results; this log does not reproduce those historical stdout bytes. The two targeted rg shell queries triggered query-budget notices; conclusions use subsequent direct Python/source reads rather than completeness of rg.\n')
auditor={'agent':'i18n-auditor','instance':instance,'session':instance,'model':'openai/gpt-6.1-sol','actual_model_source':f'Served session header for session {instance}: Model openai/gpt-6.1-sol. No model switch or fallback occurred.','fallback_used':False,'independent_from_translator_session':True}
translator={'agent':'i18n-translator','model':'anthropic/claude-sonnet-5-5','source':'Agent/model supplied by delegation. Translator session: not supplied. Auditor did not translate or participate in translation.'}
finding={'id':'M1','severity':'minor','key':'ui.library.kind.other (English context.note)','current_text':'Rendered inside the sentence ui.library.preview.unsupported ONLY via the generic fallback; see manifest.','english_source':'Other','problem':'English metadata misleadingly says the Other label is rendered inside unsupported. The implementation selects unsupported_generic for other and never interpolates this badge label into that sentence. The remainder of this context accurately describes the badge. Hindi translation is unaffected.','recommendation':'For this kind, the preview uses ui.library.preview.unsupported_generic; the localized Other badge label is not interpolated into ui.library.preview.unsupported.','evidence':['src/i18n/catalogues/en/ui.library.json: ui.library.preview.unsupported_generic = "This file has no in-app preview here."','src/i18n/catalogues/hi/ui.library.json: ui.library.preview.unsupported_generic = "इस फ़ाइल का प्रीव्यू यहाँ ऐप में नहीं दिखता।"','src/renderer/src/features/library/components/library-viewers.tsx:107-111 selects unsupported_generic for asset.kind === "other", otherwise unsupported with kind: libraryKindLabel(asset.kind).'],'gates':False}
policy_inputs={'style_guide':{'path':'~/local-operator/i18n/style-guides/hi.md','sha256':sha(pathlib.Path('/Users/damian/local-operator/i18n/style-guides/hi.md'))},'glossary':{'path':str(policy/'glossary.md'),'sha256':sha(policy/'glossary.md'),'note':'Binding manager-owned byte-copy; matches the full SHA-256 supplied by the task. Original glossary not read (outside allowed reads).'}}
concerns={
'a':'PASS: all 20 meanings preserved; ordinary Hindi noun labels and neutral register.',
'b':'PASS: तस्वीर is singular of category.images तस्वीरें; spreadsheet matches स्प्रेडशीट; code कोड, video वीडियो, other अन्य. Audio ऑडियो is justified by ui.canvas.files.audio ऑडियो: category.sounds आवाज़ें labels sounds rather than one audio format. Source स्रोत and status स्थिति exactly match filters; type प्रकार stays distinct from sort.kind क़िस्म. Topic विषय is natural subject-matter wording, corroborated by ui.teamBridge.create.topic विषय (वैकल्पिक).',
'c':'PASS individually: HTML matches ui.canvas.create_file_dialog.html_html HTML (.html); PDF matches ui.canvas.pdf_preview.pdf PDF: {title}; Markdown matches ui.canvas.create_file_dialog.markdown_md Markdown (.md). DOCX and PPTX have no prior literal occurrence in existing Hindi values (apart from additions); official format acronyms are consistent with Latin HTML/PDF practice and glossary §1 technology spelling, no contradictory localized rendering found. Audio uses ऑडियो, Video वीडियो and Code कोड, matching existing catalogue, not Latin English loans.',
'd':'PASS: इस फ़ाइल का प्रीव्यू यहाँ ऐप में नहीं दिखता। parallels legacy {kind} फ़ाइल का प्रीव्यू यहाँ ऐप में नहीं दिखता।, names no kind and has no placeholder; danda retained.',
'e':'PASS textual fit sanity only: badge/heading maximum 10 code points (स्प्रेडशीट); all <= about-12-character hint. Generic prose is 44 code points versus English 37, not a badge. Devanagari shaping not measured in rendered UI; no numeric maxCells/maxChars in these sidecars; no actual overflow alleged.',
'f':'PASS: no NBSP, narrow NBSP, ZW*, bidi controls or other Unicode Cf in the 20 target strings. Hindi is LTR; Urdu RTL check not applicable.',
'g':'PASS: 179 English/Hindi keys; precisely 20 additions from base 0e12072d2b3; all 159 legacy values byte-identical as decoded JSON strings. Legacy values not recertified.',
'h':'PASS WITH MINOR M1: roles, tone, badge/rail notes otherwise accurate; Other interpolation note misleading, contrary to generic branch in viewers source.',
'i':'PASS: frozen head verified and all relevant expected source/target/context hashes plus full binding glossary hash match.'}
namespace={'status':'passed','result':'clean-with-findings','source_sha256':inputs['en']['sha256'],'target_sha256':inputs['hi']['sha256'],'input_hashes':inputs,'fully_audited_keys':list(keys),'findings':[finding]}
receipt={'locale':'hi','mode':'Fresh independent delta audit; fix (<2h), read-only bounded audit. All 20 new messages audited; 159 legacy namespace values checked only for parse/key parity/no changes and targeted consistency, not recertified.','scope':'PR damianvtran/local-operator-ui #1851; ui.library 20 new messages at frozen head; English metadata in scope; no full legacy certification.','head_sha':head,'audit_date':'2026-11-10','key_count':len(hi),'fully_audited_key_count':20,'consistency_only_key_count':len(base),'translator':translator,'auditor':auditor,'policy_sources':{**policy_inputs,'expected_hashes':{'path':str(policy/'expected-hashes.json'),'sha256':sha(policy/'expected-hashes.json')}},'status':'passed','result':'clean-with-findings','verdict':'clean-with-findings','findings':[finding],'severity_counts':{'blocker':0,'major':0,'minor':1,'nit':0},'namespaces':{'ui.library':namespace},'concern_verdicts':concerns,'mechanical_checks':checks,'unverified':['No full validator CLI or ICU runtime parser; narrow repository duplicate/context validators and own JSON/delta checks executed. New keys contain no ICU, placeholders, markup or code.','No rendered-frame, terminal cell_len or actual layout measurement.','No repository edits, ledger command, tracked retention, PR comment or commit; read-only delegation permits own scratchpad only.','Translator session not supplied; independence states no participation in translation, not a verified cross-session identity match.']}
receiptpath=scratch/f'{stem}.json';receiptpath.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
record={'locale':'hi','namespaces':{'ui.library':{'status':'passed','fully_audited_key_count':20,'consistency_only_key_count':len(base),'finding_ids':['M1'],'input_hashes':inputs}},'audit_date':'2026-11-10','key_count':len(hi),'fully_audited_key_count':20,'consistency_only_key_count':len(base),'scope':receipt['scope'],'head_sha':head,'auditor':auditor,'translator':translator,'policy_inputs':policy_inputs,'artifacts':[{'path':p.name,'sha256':sha(p),'kind':kind,'record_reference':f'{stem}.record.json'} for p,kind in [(receiptpath,'audit_notes_not_execution_log'),(logpath,'actual_execution_log'),(scratch/'hi-sol-check.py','executed_check_source')]],'current_report_verdict':{'status':'passed','unresolved_blocker_major_count':0,'finding_ids':['M1']},'finding_report':receiptpath.name,'audit_notes_not_execution_log':False,'execution_log':logpath.name,'retention':{'state':'scratch_handoff_only_per_explicit_read_only_task','intended_tracked_directory':'i18n/audits/evidence/hi/ui.library/s14-sol-f603475ab4ac','manager_action_required':'Retain receipt, record, audit log and check source under canonical evidence root; manager records ledger entry. No ledger write executed by auditor.','proposed_note':'passed; 0 blocker/major; M1 English metadata minor; record i18n/audits/evidence/hi/ui.library/s14-sol-f603475ab4ac/record.json'},'unverified':receipt['unverified']}
recordpath=scratch/f'{stem}.record.json';recordpath.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
for p in [receiptpath,recordpath]:
 parsed=load(p); assert parsed['auditor']['model']=='openai/gpt-6.1-sol'; assert set(parsed['namespaces'])=={'ui.library'}
 print('JSON parse-back PASS:',p)
print('ARTIFACTS',receiptpath,recordpath,logpath,sep='\n')
