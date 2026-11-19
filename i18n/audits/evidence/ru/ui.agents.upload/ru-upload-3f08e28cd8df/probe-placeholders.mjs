import { readFileSync } from "node:fs";
const { parse, TYPE } = await import("/Users/damian/local-operator-ui/.worktrees/i18n-s4/node_modules/@formatjs/icu-messageformat-parser/index.js");
const base="/Users/damian/local-operator-ui/.worktrees/i18n-s4/src/i18n/catalogues/";
const ru=JSON.parse(readFileSync(base+"ru/ui.agents.upload.json","utf8"));
const en=JSON.parse(readFileSync(base+"en/ui.agents.upload.json","utf8"));
const NEW=["action.publish","action.publishing","action.update_listing","availability.reserved_named","availability.reserved_unnamed","intro.org","intro.public","not_leaving.org","not_leaving.public","published.org_listed","receipt.title_hub","receipt.title_org","receipt.title_updated","target.blocked_hint","target.visibility_hint_public"].map(k=>"ui.agents.upload."+k);
function args(ast){const out=new Set();const cats={};const walk=(els)=>{for(const e of els){
  if(e.type===TYPE.argument||e.type===TYPE.number||e.type===TYPE.date||e.type===TYPE.time) out.add(e.value);
  if(e.type===TYPE.plural||e.type===TYPE.select){ if(e.value) cats[e.value]=Object.keys(e.options||{}); if(e.options) for(const o of Object.values(e.options)) walk(o.value); }
}};walk(ast);return {args:[...out].sort(),cats};}
let bad=0;
for(const k of NEW){
  const a=args(parse(ru[k])), b=args(parse(en[k]));
  const sameArgs=JSON.stringify(a.args)===JSON.stringify(b.args);
  const sameCats=JSON.stringify(a.cats)===JSON.stringify(b.cats);
  if(!sameArgs||!sameCats) bad++;
  console.log(`${sameArgs&&sameCats?"OK  ":"DIFF"} ${k.replace("ui.agents.upload.","")} ru=${JSON.stringify(a)} en=${JSON.stringify(b)}`);
}
console.log("mismatches:",bad);
