import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {deriveReceiptAudit} from './ledger-rules.mjs';
const bytes=readFileSync(new URL('./receipt.json',import.meta.url));
const input=JSON.parse(readFileSync(new URL('./inputs.json',import.meta.url)));
const results={};
for(const namespace of ['ui.chat','ui.chat.run_details']){
 const b=input[namespace];
 results[namespace]=deriveReceiptAudit(bytes,{locale:'vi',namespace,sourceHash:b.en.sha256,targetHash:b.vi.sha256});
 assert.equal(results[namespace].result,'clean');
 assert.deepEqual(results[namespace].findings,{blocker:0,major:0,minor:0,nit:0});
}
assert.equal(results['ui.chat'].receipt_sha256,results['ui.chat.run_details'].receipt_sha256);
writeFileSync(new URL('./validation.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
