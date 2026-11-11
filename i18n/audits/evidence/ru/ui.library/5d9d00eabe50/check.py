import pathlib,json,hashlib,subprocess,unicodedata,os
root=pathlib.Path.home()/'local-operator-ui/.worktrees/i18n-s8'
bundle=root.parent/'_s14-audits/8a9ce1f808c266ebe9a0e924094344cea60c2c23'
scratch=pathlib.Path(os.environ['LOCAL_OPERATOR_SCRATCHPAD']); log=[]
def run(args):
 p=subprocess.run(args,cwd=root,text=True,capture_output=True); log.append('$ '+ ' '.join(args)+'\nexit='+str(p.returncode)+'\n'+p.stdout+p.stderr); assert p.returncode==0,p.stderr; return p.stdout
assert run(['git','rev-parse','HEAD']).strip()=='8a9ce1f808c266ebe9a0e924094344cea60c2c23'
enp=root/'src/i18n/catalogues/en/ui.library.json'; rup=root/'src/i18n/catalogues/ru/ui.library.json'; cp=root/'src/i18n/catalogues/en/ui.library.context.json'
en=json.loads(enp.read_text()); ru=json.loads(rup.read_text()); context=json.loads(cp.read_text())
base=json.loads(run(['git','show','0e12072d2b3:src/i18n/catalogues/ru/ui.library.json']))
keys=[k for k in en if k not in base]; assert len(keys)==20; assert set(en)==set(ru); assert all(ru[k]==v for k,v in base.items()); assert set(ru)-set(base)==set(keys)
expected=json.loads((bundle/'expected-hashes.json').read_text())['hashes']
for label,path in [('en/ui.library',enp),('ru/ui.library',rup),('en/ui.library.context',cp)]:
 out=run(['shasum','-a','256',str(path)]); assert out.split()[0]==expected[label]
run(['shasum','-a','256',str(bundle/'glossary.md'),str(pathlib.Path.home()/'local-operator/i18n/style-guides/ru.md')])
node='''import {readFileSync} from 'node:fs'; import {duplicateKeys} from './scripts/i18n/check-duplicates.mjs'; import {namespaceGap} from './scripts/i18n/context-parity.mjs'; import {parse} from '@formatjs/icu-messageformat-parser';
for(const p of ['en/ui.library.json','ru/ui.library.json','en/ui.library.context.json']){const s=readFileSync('src/i18n/catalogues/'+p,'utf8');if(duplicateKeys(s).length)throw Error('duplicates');JSON.parse(s); console.log(p+': JSON valid, no duplicate keys');}
const gap=namespaceGap('ui.library');if(gap.uncovered.length||gap.orphaned.length)throw Error('context parity'); console.log('repo namespaceGap validator: 0 uncovered, 0 orphaned');
const en=JSON.parse(readFileSync('src/i18n/catalogues/en/ui.library.json')); const ru=JSON.parse(readFileSync('src/i18n/catalogues/ru/ui.library.json'));let n=0;for(const k of Object.keys(en).filter(k=>k.includes('.kind.')||k.includes('.tag_category.')||k.endsWith('.unsupported_generic'))){for(const m of [en[k],ru[k]]){const ast=parse(m);if(ast.some(x=>x.type!==0))throw Error('unexpected argument/markup/ICU');}n++;} console.log(n+' delta keys: production ICU parser PASS; literal-only, no placeholders/plurals/tags');'''
run(['node','--input-type=module','-e',node])
invis=[]
for k in keys:
 for ch in ru[k]:
  if unicodedata.category(ch) in ['Cf','Mn','Me'] or (ch.isspace() and ch!=' '): invis.append([k,hex(ord(ch)),unicodedata.name(ch,'?')])
assert not invis
log.append('Derived independent checks: '+json.dumps({'total_keys':len(en),'new_keys':len(keys),'legacy_unchanged':len(base),'key_set_parity':True,'invisible_or_combining_characters':invis,'lengths':{k:len(ru[k]) for k in keys}},ensure_ascii=False))
log.append('READ (not executed validation): Russian style guide; binding glossary; all 20 English context entries; en/ru ui.library; targeted ru ui.canvas neighbours; library-model.ts mappings and Unsupported viewer branch. Semantics, term choices and English metadata judged independently by auditor. No MT service. No build/install/server/test tree. Repository validator exports and production ICU parser executed above; full check-i18n not run. Initial diff and source-inspection commands were executed in earlier tool calls; their outputs are in the session transcript, not reproduced as execution output here.')
(scratch/'ru-sol-5d9d00eabe50.audit.log').write_text('\n\n'.join(log)+'\n')
print(log[-2]);print('All scoped validations PASS; actual execution log saved.')
