import { IntlMessageFormat } from "intl-messageformat";
import { parse } from "@formatjs/icu-messageformat-parser";
import fs from "node:fs";

const draft = JSON.parse(fs.readFileSync("/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/hi-s16a.json","utf8"));
const en = JSON.parse(fs.readFileSync("/Users/damian/local-operator-ui/.worktrees/i18n-s16a/src/i18n/catalogues/en/ui.chat.canonical.json","utf8"));

function shape(ast){ // structural skeleton: element types, arg names, select/plural options
  const walk=(els)=>els.map(e=>{
    if(e.type===0) return "#";                       // literal
    if(e.type===1) return "{arg:"+e.value+"}";        // argument
    if(e.type===2) return "{num:"+e.value+"}";
    if(e.type===5) return "{select:"+e.value+"["+Object.keys(e.options).sort().join("|")+"]}";
    if(e.type===6) return "{plural:"+e.value+":"+(e.offset||0)+"["+Object.keys(e.options).sort().join("|")+"]}";
    return "{type"+e.type+"}";
  }).join("");
  return walk(ast);
}
function recursiveShape(els){
  return els.map(e=>{
    if(e.type===5||e.type===6){
      const opts=Object.keys(e.options).sort().map(k=>k+":"+recursiveShape(e.options[k].value));
      return (e.type===5?"select":"plural")+"("+e.value+")["+opts.join(" ; ")+"]";
    }
    if(e.type===4) return "pound";
    if(e.type===1) return "arg("+e.value+")";
    if(e.type===2) return "num("+e.value+")";
    if(e.type===0) return "lit";
    return "t"+e.type;
  }).join("");
}

const counts=[0,1,2,3,5,11,21,22,100,1000000];
const materials=["image","video","voiceover","sound_effect","unknown_material"];
const sizes=["12.4 KB","1.2 MB"];

let problems=0;
for(const key of Object.keys(draft)){
  const src=en[key], tgt=draft[key];
  let sAst,tAst;
  try{ tAst=parse(tgt); }catch(err){ console.log("PARSE FAIL",key,err.message); problems++; continue; }
  sAst=parse(src);
  const sameShape = recursiveShape(sAst)===recursiveShape(tAst);
  console.log("\n=== "+key);
  console.log("  source:", src);
  console.log("  target:", tgt);
  console.log("  recursive shape equal:", sameShape);
  if(!sameShape){
    console.log("   src shape:", recursiveShape(sAst));
    console.log("   tgt shape:", recursiveShape(tAst));
    problems++;
  }
  // whitespace/punctuation checks
  const srcEll = src.includes("\u2026"), tgtEll = tgt.includes("\u2026");
  if(srcEll!==tgtEll){ console.log("   ELLIPSIS MISMATCH src:",srcEll,"tgt:",tgtEll); problems++; }
  const srcDot = src.includes("\u00B7"), tgtDot = tgt.includes("\u00B7");
  if(srcDot!==tgtDot){ console.log("   MIDDLEDOT MISMATCH src:",srcDot,"tgt:",tgtDot); problems++; }
  if(/\.\.\./.test(tgt)){ console.log("   ASCII TRIPLE DOT in target"); problems++; }
  if(/[{}]/.test(tgt)===false && /[{}]/.test(src)) { console.log("   braces dropped?"); }
  // format matrix
  const needs={};
  if(key.includes("composing_sized")||key.includes("queued_sized")) needs.size=sizes;
  if(key.includes("queue_ahead")) needs.count=counts;
  if(key.endsWith(".running")) needs.material=materials;
  if(key.endsWith(".running_batch")) { needs.material=materials; needs.total=counts; }
  if(key.endsWith(".done")||key.endsWith(".done_batch")||key.endsWith(".failed")||key.endsWith(".failed_batch")) needs.material=materials;
  if(Object.keys(needs).length===0){
    const mf=new IntlMessageFormat(tgt,"hi");
    console.log("   render:", mf.format({}));
  } else if(needs.material && needs.total){
    for(const mat of materials){
      const outs=counts.map(c=>{
        const mf=new IntlMessageFormat(tgt,"hi");
        return c+"→"+mf.format({material:mat,total:c});
      });
      console.log("   ["+mat+"]", outs.join("  "));
    }
  } else if(needs.material){
    for(const mat of materials){
      const mf=new IntlMessageFormat(tgt,"hi");
      console.log("   ["+mat+"]", mf.format({material:mat}));
    }
  } else if(needs.count){
    const mf=new IntlMessageFormat(tgt,"hi");
    console.log("   ", counts.map(c=>c+"→"+mf.format({count:c})).join("  "));
  } else if(needs.size){
    const mf=new IntlMessageFormat(tgt,"hi");
    console.log("   ", sizes.map(s=>mf.format({size:s})).join("  |  "));
  }
}
console.log("\nSTRUCTURAL PROBLEMS:",problems);
