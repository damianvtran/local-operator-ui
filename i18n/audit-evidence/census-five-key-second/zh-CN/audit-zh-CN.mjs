import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {writeFileSync, readFileSync} from 'node:fs';
import {messageArguments} from '/Users/damian/local-operator-ui/scripts/i18n/generate.mjs';
import {deriveReceiptAudit} from '/Users/damian/local-operator-ui/scripts/i18n/ledger-rules.mjs';
const repo='/Users/damian/local-operator-ui', head='19868532b9cd2bca0eca468dbf22572d8dd78a5b', base='6dd43fd7494', out=process.env.LOCAL_OPERATOR_SCRATCHPAD;
const require=createRequire(repo+'/package.json');
const {parse,TYPE}=require('@formatjs/icu-messageformat-parser');
const sha=b=>createHash('sha256').update(b).digest('hex');
const show=(path,rev=head)=>execFileSync('git',['-C',repo,'show',`${rev}:${path}`]);
for(const p of ['scripts/i18n/generate.mjs','scripts/i18n/ledger-rules.mjs']) assert.deepEqual(show(p),readFileSync(repo+'/'+p));
const groups={'ui.chat':['low','medium','high'].map(x=>'ui.chat.session_status.effort_level.'+x),'ui.chat.run_details':['ui.chat.run_details.wake.armed_count','ui.chat.run_details.wake.cadence_once']};
const receipt={locale:'zh-CN',instance:'6433b7a5b3e9',status:'passed',audit_date:new Date().toISOString(),auditor:{agent:'i18n-auditor',session:'6433b7a5b3e9',instance:'6433b7a5b3e9',model:'openai/gpt-6.1-sol',actual_model_source:'Host model-switch event: temporary fallback after provider quota failures; initial anthropic/claude-sonnet-5-5, then anthropic/claude-opus-5-5, then openai/gpt-6.1-sol. Substantive copy audit performed on openai/gpt-6.1-sol.',independent_from_translator_session:true,independence_basis:'Assigned SECOND auditor; no translation edits and no first-audit findings/receipts read.'},scope:{head,base,key_count:5,kind:'second-independent-high-visibility-five-key-delta',not_full_namespace_audit:true},namespaces:{},findings:[],limits:['No native application execution','No browser, screenshot, rendered or pseudo-pixel proof','No builds, installs, worktrees, TypeScript check or scanner','No full namespace semantic re-audit','No translation or MT service used','No repo edits, ledger writes, posts, commit or push; manager must retain this byte-identical receipt durably and reuse it for both rows'],audit_notes_not_execution_log:['低/中/高 are distinct, idiomatic ordered effort labels, two terminal cells each, without changing wire tokens.','唤醒项 follows glossary 唤醒; 待触发 accurately states armed/pending rather than already fired.','一次 is a natural terse occurrence adverb; no sentence-final punctuation. Existing 单次 schedule labels need not be homogenized to pass this delta.','Committed keepRepeatLabel routes null every_ms to separately translated 保持单次运行; shared formatWakeCadence is only embedded in 保持{every_ms__null} on the non-null branch. Thus the example “keep as once” in the generic context is not this actual one-shot path.','Committed display mapping feeds picker labels/names only; raw value and current comparisons remain unchanged.','No numeric maxCells/maxChars supplied for these five keys; static widths are risk screening, not geometry/pixel validation.'],current_report_verdict:{status:'passed',unresolved_blocker_major_count:0,finding_ids:[]}};
const logs=[];
for(const [ns,keys] of Object.entries(groups)){
 const paths={en:`src/i18n/catalogues/en/${ns}.json`,context:`src/i18n/catalogues/en/${ns}.context.json`,target:`src/i18n/catalogues/zh-CN/${ns}.json`};
 const hashes={},data={};for(const [role,p] of Object.entries(paths)){const b=show(p);hashes[role]={path:p,sha256:sha(b)};data[role]=JSON.parse(b);}
 const old=JSON.parse(show(paths.target,base));
 const added=Object.keys(data.target).filter(k=>!Object.hasOwn(old,k)); assert.deepEqual(added.sort(),[...keys].sort());
 assert.equal(Object.keys(old).filter(k=>!Object.hasOwn(data.target,k)).length,0);
 for(const k of Object.keys(old)) assert.equal(data.target[k],old[k]);
 const checked=[];
 for(const k of keys){
  assert.ok(Object.hasOwn(data.en,k));assert.ok(Object.hasOwn(data.context,k));assert.ok(Object.hasOwn(data.target,k));
  const s=data.en[k],t=data.target[k],ast=parse(t);assert.deepEqual(messageArguments(s).sort(),messageArguments(t).sort());assert.ok(!/\p{Cf}/u.test(t));assert.notEqual(s,t);
  let pluralArms=[]; const walk=nodes=>{for(const n of nodes){if(n.type===TYPE.plural){pluralArms=Object.keys(n.options);assert.deepEqual(pluralArms,['other']);assert.deepEqual(pluralArms,new Intl.PluralRules('zh-CN').resolvedOptions().pluralCategories);assert.equal(n.value,'count');for(const opt of Object.values(n.options)){assert.ok(opt.value.some(x=>x.type===TYPE.argument&&x.value==='count_display'));assert.ok(!opt.value.some(x=>x.type===TYPE.pound));}}if(n.options)for(const opt of Object.values(n.options))walk(opt.value);}};walk(ast);
  assert.ok(!/[A-Za-z]/.test(t.replace(/\{count, plural, other \{|\{count_display\}|\}/g,'')));
  const literal=t.replace(/\{count, plural, other \{|\{count_display\}|\}/g,'');const literalCells=[...literal].reduce((n,c)=>n+(c.codePointAt(0)>127?2:1),0);
  checked.push({key:k,en:s,target:t,arguments:messageArguments(t),plural_arms:pluralArms,literal_cells:literalCells,context:data.context[k]});
 }
 receipt.namespaces[ns]={status:'passed',source_sha256:hashes.en.sha256,target_sha256:hashes.target.sha256,input_hashes:hashes,key_count:keys.length,findings:[],checked_keys:checked};
 logs.push(`${ns}: PASS JSON; exactly ${keys.length} additions, no old keys removed/changed; source/context present; repo messageArguments and ICU parse pass; identical argument names/types; zh-CN CLDR other only; count selector and count_display output; no Cf; no new English fallback in five target literals.`);
}
const path=out+'/zh-CN-second-census-receipt.json',bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');writeFileSync(path,bytes);
for(const [namespace,b] of Object.entries(receipt.namespaces)){const d=deriveReceiptAudit(bytes,{locale:'zh-CN',namespace,sourceHash:b.source_sha256,targetHash:b.target_sha256});assert.equal(d.result,'clean');logs.push('deriveReceiptAudit '+namespace+': '+JSON.stringify(d));}
logs.push('Receipt '+path+' sha256='+sha(bytes));writeFileSync(out+'/zh-CN-second-census-audit.log',logs.join('\n')+'\n');console.log(logs.join('\n'));
