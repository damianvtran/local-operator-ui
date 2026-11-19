const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
const root='/Users/damian/local-operator-ui/.worktrees/i18n-s4';
const req=require('node:module').createRequire(root+'/package.json');
const {IntlMessageFormat}=req('intl-messageformat');
const base='6031bc9ad71',head='2cf1ea7b5fd95b85d6c8bfaa264f6bd3c4e5c3b9';
function get(p,rev){return JSON.parse(rev?cp.execFileSync('git',['show',rev+':'+p],{cwd:root,encoding:'utf8'}):fs.readFileSync(root+'/'+p,'utf8'));}
function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
const results={head,base,input_hashes:{},checks:[],keys:[],terminology:[],renders:[],limits:['ICU formatter execution and source-path inspection only; no browser or rendered-frame validation.','Only nine newly added Chinese keys receive a fresh linguistic audit; existing keys supply terminology context, not a full namespace re-audit.']};
const nses=['ui.chat.canonical','ui.agents.upload'];
for(const ns of nses){
 const paths={en:`src/i18n/catalogues/en/${ns}.json`,context:`src/i18n/catalogues/en/${ns}.context.json`,target:`src/i18n/catalogues/zh-CN/${ns}.json`};
 results.input_hashes[ns]=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,{path:p,sha256:hash(root+'/'+p)}]));
 const en=get(paths.en),zh=get(paths.target),before=get(paths.target,base),beforeEn=get(paths.en,base),ctx=get(paths.context);
 const keys=Object.keys(en).filter(k=>en[k]!==beforeEn[k]);
 if(keys.length !== (ns==='ui.chat.canonical'?8:1)) throw Error('unexpected delta');
 for(const k of keys){
  if(!zh[k]||!ctx[k])throw Error('missing '+k);
  const enFmt=new IntlMessageFormat(en[k],'en'),zhFmt=new IntlMessageFormat(zh[k],'zh-CN');
  const args=f=>f.getAst().filter(a=>a.type!==0).map(a=>[a.value,a.type]).sort();
  if(JSON.stringify(args(enFmt))!==JSON.stringify(args(zhFmt)))throw Error('placeholder mismatch '+k);
  if(JSON.stringify(args(zhFmt).map(a=>a[0]))!==JSON.stringify(Object.keys(ctx[k].placeholders).sort()))throw Error('context mismatch');
  const literal=zh[k].replace(/\{[^}]*\}/g,'');
  if(/[A-Za-z\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(literal)||zh[k]!==zh[k].trim()||/  /.test(zh[k]))throw Error('residue '+k);
  results.keys.push({namespace:ns,key:k,en:en[k],target:zh[k],placeholder_ast:args(zhFmt)});
 }
 results.checks.push({namespace:ns,changed_keys:keys.length,icu_parse:'PASS',placeholder_parity:'PASS',context_parity:'PASS',english_bidi_whitespace_residue:'PASS',unchanged_existing_keys:Object.keys(before).every(k=>zh[k]===before[k])});
}
const zh=get('src/i18n/catalogues/zh-CN/ui.chat.canonical.json');
for(const [newKey,oldKey]of [['interrupted','tool_row.outcome.interrupted'],['not_run','tool_row.outcome.never_ran']]){
 const a='ui.chat.canonical.transcript.'+newKey,b='ui.chat.canonical.'+oldKey;
 const before=get('src/i18n/catalogues/zh-CN/ui.chat.canonical.json',base);
 if(zh[a]!==before[b])throw Error('term drift');results.terminology.push({term:zh[a],new_key:a,preexisting_key:b,match:true});
}
const previous=get('src/i18n/catalogues/zh-CN/ui.chat.canonical.json',base);
for(const [term,key]of [['耗时','ui.chat.canonical.turn_summary.took'],['任务','ui.chat.canonical.fold.receipt.job_result']]){if(!previous[key].includes(term))throw Error('missing terminology');results.terminology.push({term,preexisting_key:key,value:previous[key]});}
const upload=get('src/i18n/catalogues/zh-CN/ui.agents.upload.json',base);
for(const [term,key]of [['智能体','ui.agents.upload.action.edit_agent'],['发布','ui.agents.upload.action.publish']]){if(!upload[key].includes(term))throw Error('term missing');results.terminology.push({term,preexisting_key:key,value:upload[key]});}
const fmt=(k,p={})=>new IntlMessageFormat(zh['ui.chat.canonical.transcript.'+k],'zh-CN').format(p);
results.renders.push({key:'worked',actual:fmt('worked')});
for(const duration of ['0s','2m 4s','1h 2m']){const actual=fmt('worked_for',{duration});if(actual!=='工作耗时'+duration)throw Error('duration altered');results.renders.push({key:'worked_for',duration,actual});}
for(const id of ['job-123','abc_9','任务-42']){
 const suffix=fmt('job_suffix',{id}); const actual='审阅器'+' '+suffix;
 if(actual!=='审阅器 · 任务'+id||[...suffix].filter(c=>c==='·').length!==1)throw Error('separator regression');
 results.renders.push({key:'job_suffix',id,suffix,actual,codepoints:[...suffix].map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0'))});
}
results.style_and_glossary=['i18n/glossary.md','i18n/style-guides/zh-CN.md'].map(p=>({repo:'local-operator',path:p,sha256:hash('/Users/damian/local-operator/'+p)}));
results.status='PASS';console.log(JSON.stringify(results,null,2));
