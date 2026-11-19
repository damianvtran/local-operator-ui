import pathlib, subprocess, json, hashlib, unicodedata, os
P=pathlib.Path('/Users/damian/local-operator-ui/.worktrees/i18n-s8')
S=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD'])
R=pathlib.Path('/Users/damian/local-operator-ui/.worktrees/_s14-audits')
H='f04035bc3cb6a03644f8776a799e3daad93c7e58'; OLD='8a9ce1f808c266ebe9a0e924094344cea60c2c23'; BASE='0e12072d2b3'
log=[]
def run(args):
 p=subprocess.run(args,cwd=P,text=True,capture_output=True);log.extend(['$ '+' '.join(args),'exit='+str(p.returncode),p.stdout,p.stderr]);assert p.returncode==0;return p.stdout
def report(s):log.append('DERIVED: '+s);print(s)
assert run(['git','rev-parse','HEAD']).strip()==H
files={x:P/f'src/i18n/catalogues/{x}/ui.library.json' for x in ['en','ru']};files['context']=P/'src/i18n/catalogues/en/ui.library.context.json'
expected=json.loads((R/H/'expected-hashes.json').read_text())['hashes']; hashes={}
for k,f in files.items():
 out=run(['shasum','-a','256',str(f)]);hashes[k]=out.split()[0];assert hashes[k]==expected[{'en':'en/ui.library','ru':'ru/ui.library','context':'en/ui.library.context'}[k]]
report('All 3 hashes match expected manifest: '+json.dumps(hashes))
D={k:json.loads(f.read_text()) for k,f in files.items()}
rawdiff=run(['git','diff',OLD+'..HEAD','--','src/i18n/catalogues/ru/ui.library.json']);print(rawdiff)
plus=[x for x in rawdiff.splitlines() if x.startswith('+') and not x.startswith('+++')];minus=[x for x in rawdiff.splitlines() if x.startswith('-') and not x.startswith('---')]
assert len(plus)==len(minus)==1 and 'tag_category.custom' in plus[0] and 'tag_category.custom' in minus[0]
oldraw=run(['git','show',OLD+':src/i18n/catalogues/ru/ui.library.json']);old=json.loads(oldraw)
assert oldraw.replace('Пользовательские','Произвольные')==files['ru'].read_text()
base=json.loads(run(['git','show',BASE+':src/i18n/catalogues/ru/ui.library.json']))
assert set(D['en'])==set(D['ru']);assert all(D['ru'][k]==v for k,v in base.items());new=set(D['ru'])-set(base);assert len(new)==20
changed={k for k in D['ru'] if D['ru'][k]!=old[k]};assert changed=={'ui.library.tag_category.custom'}
report(f'Key parity {len(D["ru"])}; all {len(base)} legacy values unchanged; 20 new keys, 19 raw-line byte-identical to round 1; exactly one modified line')
val=D['ru']['ui.library.tag_category.custom'];assert val=='Произвольные';assert not any(unicodedata.category(c).startswith('C') or unicodedata.combining(c) for c in val)
assert unicodedata.normalize('NFC',val)==val
cells=sum(2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in val)
assert cells==12 and len(val)==12
assert all(c not in val for c in '{}<>`');report(f'Revised value: {val}; {len(val)} code points, {cells} cells; NFC, Cyrillic only; no placeholders/ICU/tags/markup/invisible/bidi controls')
js="import {findDuplicates} from './scripts/i18n/check-duplicates.mjs'; const r=findDuplicates("+json.dumps([str(f) for f in files.values()])+ "); console.log(JSON.stringify(r)); if(r.offenders.length)process.exit(1)"
print(run(['node','--input-type=module','-e',js]))
report('Ran repo findDuplicates validator narrowly on 3 input files: no duplicate keys. JSON parsing and assertions passed; no suite/build/installation/server/test tree.')
(S/'ru-delta-sol-b66bf0e9f121.audit.log').write_text('ACTUAL EXECUTION LOG — independent audit b66bf0e9f121 / openai/gpt-6.1-sol\n'+ '\n'.join(log)+'\nREAD (not executed): ru style guide; manager glossary; en/ru catalogues and current context; round1 ru-sol/ru-ds receipts; revision translator ru-rev.json; receipt/record models. Semantic conclusions are audit notes in receipt, not command output.\n')
(S/'ru-delta-sol-b66bf0e9f121-check-result.json').write_text(json.dumps({'hashes':hashes,'new_keys':sorted(new),'legacy_count':len(base),'namespace_count':len(D['ru']),'cells':cells},ensure_ascii=False,indent=2))
