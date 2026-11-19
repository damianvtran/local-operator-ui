import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';
import { deriveReceiptAudit } from './scripts/i18n/ledger-rules.mjs';
const head='19868532b9cd2bca0eca468dbf22572d8dd78a5b', base='6dd43fd7494';
const repo=process.env.HOME+'/local-operator-ui';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(ref,path)=>execFileSync('git',['-C',repo,'show',`${ref}:${path}`]);
const groups={
 'ui.chat':['ui.chat.session_status.effort_level.low','ui.chat.session_status.effort_level.medium','ui.chat.session_status.effort_level.high'],
 'ui.chat.run_details':['ui.chat.run_details.wake.armed_count','ui.chat.run_details.wake.cadence_once'],
};
const proof={head,base,locale:'ru',key_count:5,namespace_count:2,input_hashes:{},namespaces:{},samples:[],checks:[],limits:{native_app:false,pseudolocale:false,pixels:false,build:false,tsc:false,scanner:false,installs:false,repo_writes:false,fit:'Static character/cell-risk inspection only; no measured pixel fit. No numeric maxCells/maxChars hints on the five keys.',validator:'Pinned repository locale-parity.test.mjs, byte-identical, on scratch snapshots of only the two assigned namespace files. 6 Russian tests passed; not a whole-repository gate.'}};
const receipt={auditor:'i18n-auditor',model:'openai/gpt-6.1-sol',instance:'97bb3462a65c-ru-census-r2',session:'97bb3462a65c',locale:'ru',audit_date:new Date().toISOString().slice(0,10),status:'passed',key_count:5,audit_kind:'independent second high-visibility five-key delta',operator_request:'Make sure to continue the work all the way for all languages to get the entire UI completely translated',scope:{head,base,keys:Object.values(groups).flat(),non_goals:['unrelated namespace wording','wire token translation','style redesign']},provenance:{agent:'i18n-auditor',session:'97bb3462a65c',model:'openai/gpt-6.1-sol',independent_from_translator_session:true,independence_source:'Delegation states this auditor is neither translator nor first auditor. No first-audit findings or receipts read.',actual_model_source:'Host model-switch notice: openai/gpt-6.1-sol fallback after provider quota failures. Original model anthropic/claude-sonnet-5-5; intermediate switch anthropic/claude-opus-5-5.',fallback:true},namespaces:{},findings:[],current_report_verdict:{status:'passed',unresolved_blocker_major_count:0,finding_ids:[]},retention:{status:'temporary staging; not tracked or on main',canonical_destination:'i18n/audits/evidence/ru/<namespace>/census2-97bb3462/record.json',instruction:'Manager must preserve this single byte-identical receipt for both namespace ledger rows and promote evidence into the canonical tracked root; this auditor was explicitly forbidden repo edits.'}};
function argumentsOf(nodes, found={}) {for(const n of nodes){if([TYPE.argument,TYPE.number,TYPE.date,TYPE.time,TYPE.select,TYPE.plural].includes(n.type)){(found[n.value]??=new Set()).add(n.type);}if(n.options)for(const o of Object.values(n.options))argumentsOf(o.value,found);}return Object.fromEntries(Object.entries(found).sort().map(([k,v])=>[k,[...v].sort()]));}
for(const [ns,keys]of Object.entries(groups)){
 const paths=Object.fromEntries(['en','ru'].map(l=>[l,`src/i18n/catalogues/${l}/${ns}.json`]));
 paths.context=`src/i18n/catalogues/en/${ns}.context.json`;
 const bytes=Object.fromEntries(Object.entries(paths).map(([r,p])=>[r,readFileSync(p)]));
 const data=Object.fromEntries(Object.entries(bytes).map(([r,b])=>[r,JSON.parse(b)]));
 const before=JSON.parse(git(base,paths.ru));
 const changed=Object.keys(data.ru).filter(k=>data.ru[k]!==before[k]).sort();
 assert.deepEqual(changed,[...keys].sort());
 assert.deepEqual(Object.keys(data.en).sort(),Object.keys(data.ru).sort());
 assert.deepEqual(Object.keys(before).filter(k=>!(k in data.ru)),[]);
 const input=Object.fromEntries(Object.entries(paths).map(([r,p])=>[r,{path:p,sha256:hash(bytes[r])}]));
 proof.input_hashes[ns]=input;
 const reviews=[];
 for(const k of keys){const en=data.en[k],ru=data.ru[k],a=parse(en),b=parse(ru);assert.deepEqual(argumentsOf(a),argumentsOf(b));assert(!/\p{Cf}/u.test(ru));assert.notEqual(en,ru);const plain=b.filter(n=>n.type===TYPE.literal).map(n=>n.value).join('');assert(!/\p{Script=Latin}/u.test(plain));reviews.push({key:k,en,ru,context:data.context[k],status:'passed',text_characters:[...ru].length,combining_marks:/\p{M}/u.test(ru),format_controls:false});}
 const c44match=['en','ru'].every(l=>hash(git('c44e9e8be8e',paths[l]))===input[l].sha256);
 assert(c44match);
 proof.namespaces[ns]={key_count:keys.length,total_namespace_keys:Object.keys(data.ru).length,key_reviews:reviews,catalogue_bytes_match_c44e9e8be8e:true};
 receipt.namespaces[ns]={status:'passed',key_count:keys.length,sha256:{en:input.en.sha256,ru:input.ru.sha256},input_hashes:input,findings:[]};
 if(ns==='ui.chat.run_details'){
  const key=keys[0],ast=parse(data.ru[key]),plural=ast.find(n=>n.type===TYPE.plural);
  assert.equal(plural.value,'count'); assert.equal(plural.pluralType,'cardinal');
  const categories=new Intl.PluralRules('ru').resolvedOptions().pluralCategories;
  for(const c of categories)assert(plural.options[c]);assert(plural.options['=1']);
  for(const arm of Object.values(plural.options)){assert(arm.value.some(n=>n.type===TYPE.argument&&n.value==='count_display'));assert(!arm.value.some(n=>n.type===TYPE.pound));}
  const fmt=new IntlMessageFormat(data.ru[key],'ru');
  for(const count of [0,1,2,3,4,5,11,21,22,25,101,1.5,2.1,1000,1000000000000000100]){
   const output=fmt.format({count,count_display:String(count)});
   assert(output.startsWith(String(count)+' '));assert(!/\p{Script=Latin}/u.test(output));
   proof.samples.push({count,cldr_category:new Intl.PluralRules('ru').select(count),output});
  }
  assert.equal(fmt.format({count:2,count_display:'RAW_COUNT'}),'RAW_COUNT пробуждения запланированы');
  proof.checks.push({name:'count selects; count_display prints',status:'PASS',negative_distinguishing_probe:'count=2, count_display=RAW_COUNT => RAW_COUNT пробуждения запланированы',categories,arms:Object.keys(plural.options)});
 }
}
proof.semantic_review={status:'passed',findings:[],effort:'Низкий / Средний / Высокий are idiomatic masculine level labels, ordered correctly; six/seven/seven Cyrillic characters, no combining or wide-script glyphs. Raw picker and slash values remain English tokens.',armed_count:'Запланировано/запланированы correctly communicates an armed scheduled follow-up, not a completed wake. Пробуждение follows the glossary. Exact =1 plus one/few/many/other all preserve appropriate noun case and predicate agreement, including fractional other.',cadence_once:'однократно is a lowercase adverb meaning one-time, natural standalone after the due-label separator. Read all direct call sites: wake cadence, monitor interval, schedules. keepRepeatLabel takes a separate keep_as_once branch for null intervals; repeating legacy schedule cadence uses non-null intervals, so no newly broken keep/starts/until embedding.',copy_constraints:'No markup, Rich tags, backtick code, flags, commands or identifiers occur in these five values; no translator-authored Cf characters. Five target keys present and non-English; no fallback required at the catalogue boundary.'};
proof.call_sites=[['src/renderer/src/features/chat/session-status/session-model.ts','444-464 display lookup only'],['src/renderer/src/features/chat/pickers/destination-pickers.tsx','2273-2282 value unchanged; display-only label'],['src/renderer/src/features/chat/components/slash-argument-rows.ts','1140-1152 raw value/current unchanged'],['src/renderer/src/features/chat/components/run-details/run-detail-model.ts','1688-1690 cadence;1715-1719 count;1932-1935 monitor interval'],['src/renderer/src/features/chat/components/run-details/run-detail-wakes.tsx','180-190 due label separator plus cadence'],['src/renderer/src/features/schedules/scheduled-task-model.ts','202-208 separate one-time keep label;718-739 repeating legacy cadence']];
proof.checks.push({name:'pinned repository parity validator',status:'PASS',command:"node --max-old-space-size=128 --test --test-name-pattern='\\[ru\\]' scripts/i18n/locale-parity.test.mjs",actual:'6 tests; 6 pass; 0 fail',log_sha256:hash(readFileSync('validator.log'))});
proof.provenance=receipt.provenance;proof.audit_notes_not_execution_log=false;proof.execution_note='Mechanical and formatter facts generated by this executed script; linguistic judgments written by the independent auditor. validator.log is the actual repository-validator stdout/stderr.';
writeFileSync('report.json',JSON.stringify(proof,null,2)+'\n');
receipt.artifacts=['report.json','validator.log','audit.mjs','scripts/i18n/locale-parity.test.mjs','scripts/i18n/ledger-rules.mjs'].map(p=>({path:p,sha256:hash(readFileSync(p))}));
receipt.limits=proof.limits;
const out=Buffer.from(JSON.stringify(receipt,null,2)+'\n');
for(const [ns,block] of Object.entries(receipt.namespaces)){
 const result=deriveReceiptAudit(out,{locale:'ru',namespace:ns,sourceHash:block.sha256.en,targetHash:block.sha256.ru});
 assert.equal(result.result,'clean');console.log(JSON.stringify({namespace:ns,...result}));
}
writeFileSync('receipt.json',out);
console.log(JSON.stringify({receipt:process.cwd()+'/receipt.json',receipt_sha256:hash(out),keys:5,namespaces:2,rendered_samples:proof.samples.length,findings:0,status:'passed'}));
