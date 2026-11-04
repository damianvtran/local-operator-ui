import {readFileSync} from 'node:fs';
import {deriveReceiptAudit} from './ledger-rules.mjs';
const bytes=readFileSync(new URL('./record.json',import.meta.url));
const r=JSON.parse(bytes);
for(const [namespace,block] of Object.entries(r.namespaces)){
 console.log(JSON.stringify({namespace,...deriveReceiptAudit(bytes,{locale:r.locale,namespace,sourceHash:block.sha256.en,targetHash:block.sha256.fr})}));
}
