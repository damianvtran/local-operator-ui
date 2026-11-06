import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parse,TYPE} from '/Users/damian/local-operator-ui/node_modules/@formatjs/icu-messageformat-parser/index.js';
import {IntlMessageFormat} from '/Users/damian/local-operator-ui/node_modules/intl-messageformat/index.js';
import {messageArguments} from '/Users/damian/local-operator-ui/scripts/i18n/generate.mjs';
import {deriveReceiptAudit} from '/Users/damian/local-operator-ui/scripts/i18n/ledger-rules.mjs';
const root='/Users/damian/local-operator-ui', rev='19868532b9cd2bca0eca468dbf22572d8dd78a5b', base='6dd43fd7494';
const out=process.env.LOCAL_OPERATOR_SCRATCHPAD;
const sha=b=>createHash('sha256').update(b).digest('hex');
const get=p=>execFileSync('git',['show',`${rev}:${p}`],{cwd:root});
const keys={ 'ui.chat':['ui.chat.session_status.effort_level.low','ui.chat.session_status.effort_level.medium','ui.chat.session_status.effort_level.high'], 'ui.chat.run_details':['ui.chat.run_details.wake.armed_count','ui.chat.run_details.wake.cadence_once']};
const receipt={locale:'hi',audit_date:'2026-11-03',auditor:{agent:'i18n-auditor',session:'786d3d9ff0bb',model:'openai/gpt-6.1-sol',instance:'786d3d9ff0bb-hi-census-r2',independent_from_translator_session:true,actual_model_source:'Host model-switch notice: current fallback openai/gpt-6.1-sol after provider quota failure; originally anthropic/claude-sonnet-5-5, intermediate switch notice anthropic/claude-opus-5-5. Audit reasoning and execution completed under current fallback.'},instance:'786d3d9ff0bb-hi-census-r2',model:'openai/gpt-6.1-sol',status:'passed',source_commit:rev,comparison_base:base,key_count:5,namespaces:{},current_report_verdict:{status:'passed',unresolved_blocker_major_count:0,finding_ids:[]},findings:[],audit_notes_not_execution_log:['Independent second pass; no first-audit findings or receipts read. No translation/MT service used.','कम / मध्यम / उच्च are distinct, idiomatic effort-scale labels. एक बार is natural Hindi for once; the English one-word hint cannot literally apply to this idiom. जागृति follows the binding glossary and सक्रिय accurately conveys enabled/armed, not fired.','Consumers preserve raw effort wire values; only names/labels call effortDisplay. wakeClause passes numeric count and raw String(count).','Cadence is displayed after a due-time separator. Schedule keepRepeatLabel bypasses formatWakeCadence on null and uses its own keep_as_once translation; repeating cadence templates only receive non-null intervals. No new embedded-once grammar defect found.'],limits:['Five-key delta only, not a fresh audit of entire namespaces or all UI.','No native app/browser/TUI execution, screenshot, pseudo-locale or rendered-pixel proof; no font/shaping/geometry/overflow guarantee.','No builds, installs, worktrees, tsc, string scanner, repository edits, ledger writes, posts, commits or pushes. Receipt must be retained and assembled by manager using the same byte-identical file for both rows.','No numeric maxCells/maxChars supplied in these five context entries. Source inspection only for display/wire and embedding paths.'],input_hashes:[],artifacts:[]};
for(const [ns,scope] of Object.entries(keys)){
 const p=loc=>`src/i18n/catalogues/${loc}/${ns}.json`;
 const enB=get(p('en')), hiB=get(p('hi')), ctxPath=`src/i18n/catalogues/en/${ns}.context.json`,ctxB=get(ctxPath);
 const en=JSON.parse(enB),hi=JSON.parse(hiB),ctx=JSON.parse(ctxB);
 const old=JSON.parse(execFileSync('git',['show',`${base}:${p('hi')}`],{cwd:root}));
 assert.deepEqual(Object.keys(hi).sort(),Object.keys(en).sort());
 const added=Object.keys(hi).filter(k=>!Object.hasOwn(old,k));assert.deepEqual(added.sort(),[...scope].sort());
 for(const k of Object.keys(old))assert.equal(hi[k],old[k],`existing key changed ${k}`);
 for(const k of scope){
  assert.ok(ctx[k]);assert.ok(!/\p{Cf}/u.test(hi[k])); assert.ok(!/[A-Za-z]/.test(hi[k].replace(/\{[^{}]*\}/g,'')) || k.endsWith('armed_count'));
  assert.deepEqual(messageArguments(hi[k]),messageArguments(en[k]));
  const ast=parse(hi[k]);
  if(k.endsWith('armed_count')){
   assert.equal(ast.length,1);assert.equal(ast[0].type,TYPE.plural);assert.equal(ast[0].value,'count');assert.equal(ast[0].pluralType,'cardinal');
   assert.deepEqual(Object.keys(ast[0].options).sort(),['=1','one','other'].sort());
   for(const cat of new Intl.PluralRules('hi').resolvedOptions().pluralCategories)assert.ok(ast[0].options[cat]);
   for(const arm of Object.values(ast[0].options)){assert.equal(arm.value[0].type,TYPE.argument);assert.equal(arm.value[0].value,'count_display');assert.ok(arm.value.every(n=>n.type!==TYPE.pound));}
   const fmt=new IntlMessageFormat(hi[k],'hi');
   for(const count of [0,0.5,1,2,21,1000]){
    const actual=fmt.format({count,count_display:String(count)}); assert.ok(actual.startsWith(String(count)+' ')); console.log('plural case', count, new Intl.PluralRules('hi').select(count), actual);
   }
   assert.ok(fmt.format({count:2,count_display:'DISPLAY_SENTINEL'}).startsWith('DISPLAY_SENTINEL '));
  }else assert.equal(new IntlMessageFormat(hi[k],'hi').format(),hi[k]);
  console.log(JSON.stringify({key:k,text:hi[k],codepoints:[...hi[k]].length,graphemes:[...new Intl.Segmenter('hi',{granularity:'grapheme'}).segment(hi[k])].length,maxCells:ctx[k].maxCells??null,maxChars:ctx[k].maxChars??null,mechanical:'PASS'}));
 }
 const inputs={en:{path:p('en'),sha256:sha(enB)},context:{path:ctxPath,sha256:sha(ctxB)},hi:{path:p('hi'),sha256:sha(hiB)}};
 receipt.namespaces[ns]={status:'passed',sha256:{en:sha(enB),hi:sha(hiB)},key_count:scope.length,namespace_total_keys:Object.keys(hi).length,audited_keys:scope,input_hashes:inputs,findings:[]};
 receipt.input_hashes.push(...Object.values(inputs));
 console.log(JSON.stringify({namespace:ns,key_parity:'PASS',only_expected_additions:'PASS',unchanged_existing_values:'PASS',en_sha256:sha(enB),hi_sha256:sha(hiB),context_sha256:sha(ctxB),total_keys:Object.keys(hi).length,audited_keys:scope.length}));
}
const path=out+'/hi-census-r2-receipt.json';fs.writeFileSync(path,JSON.stringify(receipt,null,2)+'\n');
const bytes=fs.readFileSync(path);
for(const [namespace,block] of Object.entries(receipt.namespaces))console.log('deriveReceiptAudit',JSON.stringify(deriveReceiptAudit(bytes,{locale:'hi',namespace,sourceHash:block.sha256.en,targetHash:block.sha256.hi})));
console.log(JSON.stringify({receipt:path,sha256:sha(bytes),status:'passed',findings:0,namespaces:2,keys:5,heap_limit_MiB:256}));
