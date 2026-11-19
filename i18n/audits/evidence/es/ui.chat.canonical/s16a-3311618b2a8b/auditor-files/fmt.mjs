import IntlMessageFormat from '/Users/damian/local-operator-ui/.worktrees/i18n-s16a/node_modules/intl-messageformat/index.js';
import fs from 'node:fs';
const es=JSON.parse(fs.readFileSync('/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/es-s16a.json','utf8'));
const EN=JSON.parse(fs.readFileSync('/Users/damian/local-operator-ui/.worktrees/i18n-s16a/src/i18n/catalogues/en/ui.chat.canonical.json','utf8'));
const counts=[0,1,2,3,5,11,21,22,100,1000000];
const materials=['image','video','voiceover','sound_effect','sound-effect','unknown'];
function F(msg,vals){ try { return new IntlMessageFormat(msg,'es').format(vals); } catch(e){ return 'ERROR: '+e.message; } }
const out=[];
const log=s=>out.push(s);
log('### tool status keys (es / en)');
for(const k of ['ui.chat.canonical.tool.composing_sized','ui.chat.canonical.tool.queued_sized','ui.chat.canonical.tool.queued_empty','ui.chat.canonical.tool.composing_empty']){
  const vals = k.endsWith('_sized')?{size:'12,4 KB'}:{};
  log(`${k}\n  es=${JSON.stringify(F(es[k],vals))}\n  en=${JSON.stringify(F(EN[k],vals))}`);
}
log('\n### state.queued / writing_request / already_finished');
for(const k of ['ui.chat.canonical.image_gen.state.queued','ui.chat.canonical.image_gen.state.writing_request','ui.chat.canonical.image_gen.state.already_finished']){
  log(`${k}\n  es=${JSON.stringify(F(es[k],{}))}\n  en=${JSON.stringify(F(EN[k],{}))}`);
}
log('\n### queue_ahead by count');
for(const c of counts){
  log(`  count=${c}  es=${JSON.stringify(F(es['ui.chat.canonical.image_gen.state.queue_ahead'],{count:c}))}   en=${JSON.stringify(F(EN['ui.chat.canonical.image_gen.state.queue_ahead'],{count:c}))}`);
}
for(const k of ['running','done','done_batch','failed','failed_batch']){
  log(`\n### ${k} by material`);
  for(const m of materials){
    log(`  ${m.padEnd(13)} es=${JSON.stringify(F(es['ui.chat.canonical.image_gen.state.'+k],{material:m}))}`);
  }
}
log('\n### running_batch by material x total');
for(const m of materials.slice(0,4)){
  for(const t of counts){
    log(`  ${m.padEnd(13)} total=${String(t).padStart(7)} es=${JSON.stringify(F(es['ui.chat.canonical.image_gen.state.running_batch'],{material:m,total:t}))}`);
  }
  log('');
}
fs.writeFileSync('/Users/damian/.local-operator/sessions/3311618b2a8b/scratchpad/fmt.out.txt',out.join('\n'));
console.log(out.join('\n'));
