import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deriveReceiptAudit} from '/Users/damian/local-operator-ui/.worktrees/i18n-s16a/scripts/i18n/ledger-rules.mjs';
const S='/Users/damian/.local-operator/sessions/3311618b2a8b/scratchpad';
const sha=(p)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const en=sha('/Users/damian/local-operator-ui/.worktrees/i18n-s16a/src/i18n/catalogues/en/ui.chat.canonical.json');
const draft=sha('/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/es-s16a.json');
const bytes=readFileSync(S+'/record.json');
try{
  const d=deriveReceiptAudit(bytes,{locale:'es',namespace:'ui.chat.canonical',sourceHash:en,targetHash:draft});
  console.log('RECEIPT ACCEPTED by ledger-rules.deriveReceiptAudit');
  console.log(JSON.stringify(d,null,2));
}catch(e){ console.log('RECEIPT REFUSED:', e.message); process.exitCode=1; }
