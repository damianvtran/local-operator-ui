import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {messageArguments} from '/Users/damian/local-operator-ui/scripts/i18n/generate.mjs';
import {deriveReceiptAudit} from '/Users/damian/local-operator-ui/scripts/i18n/ledger-rules.mjs';
const root='/Users/damian/local-operator-ui';
const require=createRequire(root+'/package.json');
const {parse,TYPE}=require('@formatjs/icu-messageformat-parser');
const {IntlMessageFormat}=require('intl-messageformat');
const head='19868532b9cd2bca0eca468dbf22572d8dd78a5b',base='6dd43fd7494';
const hash=x=>createHash('sha256').update(x).digest('hex');
const show=(rev,path)=>execFileSync('git',['show',`${rev}:${path}`],{cwd:root});
const groups={'ui.chat':['ui.chat.session_status.effort_level.low','ui.chat.session_status.effort_level.medium','ui.chat.session_status.effort_level.high'],'ui.chat.run_details':['ui.chat.run_details.wake.armed_count','ui.chat.run_details.wake.cadence_once']};
const log=[];const namespaces={};
const allHashes={};
for(const [ns,keys] of Object.entries(groups)) {
 const enpath=`src/i18n/catalogues/en/${ns}.json`,urpath=`src/i18n/catalogues/ur/${ns}.json`,ctxpath=`src/i18n/catalogues/en/${ns}.context.json`;
 const eb=show(head,enpath),ub=show(head,urpath),cb=show(head,ctxpath);
 const en=JSON.parse(eb),ur=JSON.parse(ub),ctx=JSON.parse(cb),old=JSON.parse(show(base,urpath));
 assert.deepEqual(Object.keys(ur).filter(k=>!(k in old)).sort(),[...keys].sort());
 assert.deepEqual(Object.keys(old).filter(k=>!(k in ur)),[]);
 for(const k of Object.keys(old))assert.equal(old[k],ur[k]);
 const entries=[];
 for(const key of keys){
  assert.equal(typeof en[key],'string');assert.equal(typeof ur[key],'string');assert.ok(ctx[key]);
  assert.deepEqual(messageArguments(ur[key]),messageArguments(en[key]));
  assert.ok(!/\p{Cf}/u.test(ur[key]));
  assert.ok(!/[a-zA-Z]/.test(ur[key].replace(/\{count_display\}|\b(?:count|plural|one|other)\b/g,'')));
  const ast=parse(ur[key]);
  const entry={key,en:en[key],ur:ur[key],arguments:messageArguments(ur[key]),unicode_codepoints:[...ur[key]].length,context:ctx[key]};
  if(key.endsWith('armed_count')){
   assert.equal(ast.length,1);const p=ast[0];assert.equal(p.type,TYPE.plural);assert.equal(p.value,'count');
   const categories=new Intl.PluralRules('ur').resolvedOptions().pluralCategories;
   for(const category of categories)assert.ok(p.options[category]);
   for(const arm of Object.values(p.options)){
    assert.equal(arm.value.filter(n=>n.type===TYPE.argument&&n.value==='count_display').length,1);
    assert.ok(!arm.value.some(n=>n.type===TYPE.pound||n.type===TYPE.number||n.type===TYPE.argument&&n.value==='count'));
   }
   entry.cldr_categories=categories;entry.arms=Object.keys(p.options);
   const fmt=new IntlMessageFormat(ur[key],'ur');
   entry.formatted=[0,1,2,1.5,1000].map(count=>({count,category:new Intl.PluralRules('ur').select(count),output:fmt.format({count,count_display:String(count)})}));
   entry.distinct_selector_display=fmt.format({count:1,count_display:'RAW-001'});
   assert.equal(entry.distinct_selector_display,'RAW-001 بیداری فعال ہے');
  }
  entries.push(entry);
 }
 const hashes={en:{path:enpath,sha256:hash(eb)},context:{path:ctxpath,sha256:hash(cb)},ur:{path:urpath,sha256:hash(ub)}};
 allHashes[ns]=hashes;
 namespaces[ns]={status:'passed',en_sha256:hash(eb),ur_sha256:hash(ub),key_count:keys.length,keys,findings:[],input_hashes:hashes};
 log.push({namespace:ns,added_keys:keys.length,unchanged_existing_keys:Object.keys(old).length,namespace_target_total:Object.keys(ur).length,mechanical:'PASS',entries});
}
const receipt={schema:1,locale:'ur',audit_date:new Date().toISOString(),instance:'25304c88781e-ur-census-second',agent:'i18n-auditor',model:'openai/gpt-6.1-sol',status:'passed',key_count:5,auditor:{agent:'i18n-auditor',instance:'25304c88781e-ur-census-second',session:'25304c88781e',model:'openai/gpt-6.1-sol',independent_from_translator_session:true,actual_model_source:'Host model-switch notice: temporary openai/gpt-6.1-sol fallback after anthropic/claude-opus-5-5 quota failure; initial configured model anthropic/claude-sonnet-5-5. Audit analysis and execution performed on openai/gpt-6.1-sol.'},scope:{base,head,pass:'second independent high-visibility five-key delta only',operator_request:'Make sure to continue the work all the way for all languages to get the entire UI completely translated',first_audit_read:false,translation_service_used:false},namespaces,findings:[],current_report_verdict:{status:'passed',unresolved_blocker_major_count:0,finding_ids:[]},semantic_notes:['کم / متوسط / زیادہ form a natural, distinct ascending effort scale; neutral product register, no address/formality issue.','بیداری uses glossary noun; فعال ہے / فعال ہیں correctly distinguishes singular and plural armed states, not delivery completion.','ایک بار is an idiomatic one-time cadence, also valid in embedded schedule prose. Committed keepRepeatLabel uses a separate keep_as_once key on null cadence; repeating schedule embeds only the non-null branch.','No manual bidi controls, arrows, Latin literals or punctuation in the three effort labels or cadence. Count display remains the Latin-digit raw interpolation. Logical string order checked; visual bidi ordering/shaping not exercised.','No numeric maxCells/maxChars hints for these five keys; effort labels are single words, cadence is a natural two-word equivalent, and wake count remains a brief status clause. No measured layout claim.'],limits:['Committed catalogue and call-site static review only; no native UI, browser, screenshots, pseudolocale or pixel/geometry proof.','Focused repo messageArguments validator helper and existing ICU parser/formatter executed; no full scanner, generator, build, tsc, dependency installation or worktree.','Receipt created in session scratch under explicit no-repo-edits instruction; manager must retain the same bytes in repository evidence and use one receipt for both ledger rows. No ledger written by auditor.'],audit_notes_not_execution_log:log};
const out=process.env.LOCAL_OPERATOR_SCRATCHPAD+'/ur-census-second.receipt.json';
writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');
const bytes=readFileSync(out);
const derived=Object.keys(groups).map(namespace=>({namespace,...deriveReceiptAudit(bytes,{locale:'ur',namespace,sourceHash:allHashes[namespace].en.sha256,targetHash:allHashes[namespace].ur.sha256})}));
console.log(JSON.stringify({execution:'PASS',receipt:out,receipt_sha256:hash(bytes),key_count:5,mechanical_results:log,derived},null,2));
