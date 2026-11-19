import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
// Resolve existing shared dependencies from the worktree, not a scratch install.
import {createRequire} from 'node:module';
const require=createRequire(`${process.cwd()}/package.json`);
const {IntlMessageFormat}=require('intl-messageformat');
const base='6031bc9ad71';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,'2cf1ea7b5fd95b85d6c8bfaa264f6bd3c4e5c3b9');
const namespaces=['ui.chat.canonical','ui.agents.upload'];
const entries=[];
const hashes={};
for(const ns of namespaces){
 const paths={en:`src/i18n/catalogues/en/${ns}.json`,context:`src/i18n/catalogues/en/${ns}.context.json`,ru:`src/i18n/catalogues/ru/${ns}.json`};
 const values={};hashes[ns]={};
 for(const [role,path] of Object.entries(paths)){
  const bytes=fs.readFileSync(path);
  assert.deepEqual(bytes,execFileSync('git',['show',`${head}:${path}`]));
  hashes[ns][role]={path,sha256:createHash('sha256').update(bytes).digest('hex')};
  values[role]=JSON.parse(bytes);
 }
 const before=JSON.parse(execFileSync('git',['show',`${base}:${paths.ru}`],{encoding:'utf8'}));
 const keys=Object.keys(values.ru).filter(k=>values.ru[k]!==before[k]);
 assert.equal(keys.length,ns==='ui.chat.canonical'?8:1);
 for(const key of keys){
  const source=values.en[key],target=values.ru[key];
  assert.ok(values.context[key]);
  const enFmt=new IntlMessageFormat(source,'en'),ruFmt=new IntlMessageFormat(target,'ru');
  const args=ast=>ast.filter(x=>x.type===1).map(x=>x.value).sort();
  const sourceArgs=args(enFmt.getAst()),targetArgs=args(ruFmt.getAst());
  assert.deepEqual(targetArgs,sourceArgs);
  assert.deepEqual(targetArgs,Object.keys(values.context[key].placeholders??{}).sort());
  assert.equal(target.normalize('NFC'),target);
  assert.ok(!/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(target));
  assert.ok(!/[A-Za-z]/.test(target.replace(/\{[^}]+\}/g,'')));
  const params=Object.fromEntries(targetArgs.map(arg=>[arg,arg==='id'?'job_ru-42':'2m 4s']));
  const formatted=ruFmt.format(params);
  assert.equal(typeof formatted,'string');
  for(const param of Object.values(params))assert.ok(formatted.includes(param));
  if(key.endsWith('.job_suffix'))assert.equal(formatted,'· Задание job_ru-42');
  if(key.endsWith('.worked_for'))assert.equal(formatted,'Время работы: 2m 4s');
  entries.push({namespace:ns,key,source,target,source_arguments:sourceArgs,target_arguments:targetArgs,formatted,checks:'PASS: ICU parse/format; exact placeholders; context; NFC; no bidi controls; no English residue outside placeholders'});
 }
}
assert.equal(entries.length,9);
console.log(JSON.stringify({head,base,namespaces,hashes,entries,summary:{keys_checked:9,passed:9,failed:0},limitations:['Formatter-level text, not rendered UI. Duration/ID samples deliberately retain supplied technical text.']},null,2));
