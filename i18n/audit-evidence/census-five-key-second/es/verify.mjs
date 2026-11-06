import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { messageArguments } from './generate-resolved.mjs';
import { namespaceGap } from './context-parity.mjs';
const require = createRequire('/Users/damian/local-operator-ui/package.json');
const {parse, TYPE} = await import(pathToFileURL(require.resolve('@formatjs/icu-messageformat-parser')));
const {IntlMessageFormat} = await import(pathToFileURL(require.resolve('intl-messageformat')));
const dir=dirname(fileURLToPath(import.meta.url));
const scopes={'ui.chat':['low','medium','high'].map(x=>'ui.chat.session_status.effort_level.'+x),'ui.chat.run_details':['ui.chat.run_details.wake.armed_count','ui.chat.run_details.wake.cadence_once']};
let checked=0;
const results={};
for (const [ns,keys] of Object.entries(scopes)) {
 const en=JSON.parse(readFileSync(join(dir,`en-${ns}.json`)));
 const es=JSON.parse(readFileSync(join(dir,`es-${ns}.json`)));
 const gap=namespaceGap(ns,join(dir,'catalogues'));
 assert(gap.hasSidecar); assert.deepEqual(gap.uncovered.filter(k=>keys.includes(k)),[]); assert.deepEqual(gap.orphaned.filter(k=>keys.includes(k)),[]);
 assert.deepEqual(Object.keys(es).sort(),Object.keys(en).sort());
 console.log(`REPO_VALIDATOR namespaceGap ${ns}: assigned keys have context; namespace uncovered=${JSON.stringify(gap.uncovered)} (baseline equality separately verified); key parity ${Object.keys(en).length}/${Object.keys(es).length}`);
 results[ns]={key_count:keys.length,namespace_total_keys:Object.keys(es).length,keys:{}};
 for (const key of keys) {
  assert.deepEqual(messageArguments(es[key]),messageArguments(en[key]));
  const ast=parse(es[key]); parse(en[key]);
  assert(!/\p{Cf}/u.test(es[key])); assert.notEqual(es[key],en[key]);
  assert.deepEqual(es[key].match(/`[^`]*`/g)||[],en[key].match(/`[^`]*`/g)||[]);
  results[ns].keys[key]={text:es[key],codepoints:[...es[key]].length,arguments:messageArguments(es[key])};
  console.log(`REPO_VALIDATOR messageArguments + ICU/Cf/source-difference ${key}: PASS ${JSON.stringify(messageArguments(es[key]))}`);
  checked++;
 }
}
const key='ui.chat.run_details.wake.armed_count';
const es=JSON.parse(readFileSync(join(dir,'es-ui.chat.run_details.json')));
const ast=parse(es[key]); assert.equal(ast.length,1); assert.equal(ast[0].type,TYPE.plural); assert.equal(ast[0].value,'count');
const categories=new Intl.PluralRules('es').resolvedOptions().pluralCategories;
assert.deepEqual(Object.keys(ast[0].options).sort(),categories.slice().sort());
for(const option of Object.values(ast[0].options)) {
 assert(option.value.some(n=>n.type===TYPE.argument&&n.value==='count_display'));
 assert(!option.value.some(n=>n.type===TYPE.pound || (n.type!==TYPE.literal && n.value==='count')));
}
const fm=new IntlMessageFormat(es[key],'es');
const rendered=[];
for(const count of [0,1,2,1.5,1000000,1500000]) {
 const value=fm.format({count,count_display:String(count)});
 assert(value.startsWith(String(count)+' '));
 rendered.push({count,category:new Intl.PluralRules('es').select(count),value});
 console.log(`FORMAT count=${count}: ${value}`);
}
assert.equal(fm.format({count:1,count_display:'RAW'}),'RAW despertar activado');
assert.equal(fm.format({count:2,count_display:'RAW'}),'RAW despertares activados');
console.log(`CLDR categories: ${categories.join(', ')}; count selects, count_display prints: PASS`);
console.log(`TOTAL assigned keys=${checked}; BLOCKER=0 MAJOR=0 MINOR=0 NIT=0; source-only audit, no native/pixel proof`);
writeFileSync(join(dir,'mechanical.json'),JSON.stringify({checked,results,categories,rendered,counts:{blocker:0,major:0,minor:0,nit:0}},null,2)+'\n');
