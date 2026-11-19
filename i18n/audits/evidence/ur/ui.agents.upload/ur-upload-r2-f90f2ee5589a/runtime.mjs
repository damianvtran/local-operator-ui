import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/package.json');
const {build}=require('esbuild');
const bundle=await build({stdin:{contents:'export * as messages from "./src/i18n/messages";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {messages}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const t=(key,p={})=>messages.translate(key,p,'ur');
const fallback=t('ui.agents.upload.target.org_unnamed');
assert.equal(fallback,'اس تنظیم');
const controls=/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
assert.equal(fallback.match(controls),null);
const frames=['intro.org','not_leaving.org','title.published_org','receipt.title_org','published.org_listed','title.publish_org'].map(k=>'ui.agents.upload.'+k).concat('ui.hub.subscriptions.enable_private');
const results=[];
for(const key of frames){
 const params={name:'fleet-ops',item:'fleet-ops',destination:fallback,organization:fallback};
 const text=t(key,params); const raw=messages.translateRaw(key,params,'ur');
 assert.notEqual(text,key);assert.ok(text.includes(fallback));assert.ok(!text.includes('{'));
 assert.equal(text.replace(controls,''),raw);
 const named=t(key,{...params,destination:'Acme Corp',organization:'Acme Corp'});
 assert.ok(named.includes('\u2068Acme Corp\u2069'));
 // RTL fallback itself remains unwrapped; the Latin agent/item gets runtime isolation.
 assert.ok(!text.includes('\u2068'+fallback));
 if(raw.includes('fleet-ops'))assert.ok(text.includes('\u2068fleet-ops\u2069'));
 results.push({key,text,raw,named_control:named,pass:true});
}
console.log(JSON.stringify({fallback,frames:results,assertions:'PASS: seven consuming frames, translated fallback, no manual controls; runtime Latin-island FSI/PDI controls; translateRaw negative control',visual_evidence:false},null,2));
