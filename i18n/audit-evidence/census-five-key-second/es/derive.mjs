import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deriveReceiptAudit} from './ledger-rules.mjs';
const receiptBytes=readFileSync(new URL('./receipt.json',import.meta.url));
const receipt=JSON.parse(receiptBytes);
for(const namespace of Object.keys(receipt.namespaces)) {
 const hashFile=(lang)=>createHash('sha256').update(readFileSync(new URL(`./${lang}-${namespace}.json`,import.meta.url))).digest('hex');
 console.log(JSON.stringify({namespace,...deriveReceiptAudit(receiptBytes,{locale:'es',namespace,sourceHash:hashFile('en'),targetHash:hashFile('es')})}));
}
