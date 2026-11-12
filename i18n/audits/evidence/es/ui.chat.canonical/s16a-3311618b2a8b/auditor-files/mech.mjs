import {parse} from '/Users/damian/local-operator-ui/.worktrees/i18n-s16a/node_modules/@formatjs/icu-messageformat-parser/index.js';
import IntlMessageFormat from '/Users/damian/local-operator-ui/.worktrees/i18n-s16a/node_modules/intl-messageformat/index.js';
import fs from 'node:fs';

const W='/Users/damian/local-operator-ui/.worktrees/i18n-s16a';
const en=JSON.parse(fs.readFileSync(W+'/src/i18n/catalogues/en/ui.chat.canonical.json','utf8'));
const es=JSON.parse(fs.readFileSync('/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/es-s16a.json','utf8'));
const ctx=JSON.parse(fs.readFileSync(W+'/src/i18n/catalogues/en/ui.chat.canonical.context.json','utf8'));

const NEW=Object.keys(en).filter(k=>/tool\.composing_|tool\.queued_|image_gen\.state\./.test(k));
console.log('NEW_KEYS',NEW.length);
const esKeys=Object.keys(es);
console.log('ES_DRAFT_KEYS',esKeys.length,'| missing:',NEW.filter(k=>!(k in es)),'| extra:',esKeys.filter(k=>!NEW.includes(k)));

function walk(ast,nodes,out){
  for(const el of nodes||[]){
    if(el.type===0||el.type===1){ /* literal */ }
    else if(el.type===2){ out.plural?.length; }
    if(el.value!==undefined && el.value && typeof el.value!=='string'){ /* plural/select */ }
    if(el.type===6){ // plural
      out.args[el.value]={type:'plural',offset:el.offset||0};
      out.plurals[el.value]={options:Object.keys(el.options).sort(),offset:el.offset||0};
      for(const [k,v] of Object.entries(el.options)) walk(ast,v.value,out);
    } else if(el.type===5){ // select
      out.args[el.value]={type:'select'};
      out.selects[el.value]=Object.keys(el.options).sort();
      for(const [k,v] of Object.entries(el.options)) walk(ast,v.value,out);
    } else if(el.type===4){ out.args[el.value]={type:'number'}; if(el.style?.parsedOptions?.notation||JSON.stringify(el.style).includes('group')) out.skeletons.push([el.value,JSON.stringify(el.style)]); }
    else if(el.type===3){ out.args[el.value]={type:(el.style?'date/time':'other')}; }
    if(el.children) walk(ast,el.children,out);
  }
}
function info(msg){
  const ast=parse(msg);
  const out={args:{},plurals:{},selects:{},skeletons:[]};
  walk(ast,ast,out);
  return out;
}
const cats=new Intl.PluralRules('es').resolvedOptions().pluralCategories.slice().sort();
console.log('ES_CLDR_CATEGORIES',cats);

let bad=0;
for(const k of NEW){
  const e=info(en[k]), d=info(es[k]);
  const eArgs=Object.keys(e.args).sort(), dArgs=Object.keys(d.args).sort();
  const same=JSON.stringify(eArgs)===JSON.stringify(dArgs);
  const selOk=JSON.stringify(e.selects)===JSON.stringify(d.selects);
  const lines=[];
  lines.push(`${same?'OK ':'BAD'} args key=${k} en=${JSON.stringify(e.args)} es=${JSON.stringify(d.args)}`);
  if(Object.keys(e.selects).length) lines.push(`   select branches en=${JSON.stringify(e.selects)} es=${JSON.stringify(d.selects)} -> ${selOk?'OK':'BAD'}`);
  for(const [name,p] of Object.entries(d.plurals)){
    const missing=cats.filter(c=>!p.options.includes(c));
    lines.push(`   plural ${name} es opts=${JSON.stringify(p.options)} missingCLDR=${JSON.stringify(missing)} ${missing.length?'BAD':'OK'}`);
    if(missing.length) bad++;
  }
  if(!same||!selOk) bad++;
    const md=(s)=>({middot:(s.match(/\u00b7/g)||[]).length,ell:(s.match(/\u2026/g)||[]).length,braces:(s.match(/[{}]/g)||[]).length,backtick:(s.match(/`/g)||[]).length});
  const em=md(en[k]), dm=md(es[k]);
  if(em.middot!==dm.middot||em.ell!==dm.ell||em.braces!==dm.braces) { lines.push(`   TYPO MISMATCH en=${JSON.stringify(em)} es=${JSON.stringify(dm)}`); bad++; }
  console.log(lines.join('\n'));
}
console.log('STRUCTURAL_BAD',bad);
fs.writeFileSync('/Users/damian/.local-operator/sessions/3311618b2a8b/scratchpad/cats.json',JSON.stringify(cats));
