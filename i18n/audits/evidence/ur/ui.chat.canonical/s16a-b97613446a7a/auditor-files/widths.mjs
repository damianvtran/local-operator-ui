import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const WT="/Users/damian/local-operator-ui/.worktrees/i18n-s16a";
const req=createRequire(WT+"/package.json");
const { IntlMessageFormat } = req("intl-messageformat");
const d=JSON.parse(readFileSync("/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/ur-s16a.json","utf8"));
const en=JSON.parse(readFileSync(WT+"/src/i18n/catalogues/en/ui.chat.canonical.json","utf8"));
const mats=["video","voiceover","sound_effect","image"];
for (const k of ["ui.chat.canonical.image_gen.state.running","ui.chat.canonical.image_gen.state.done","ui.chat.canonical.image_gen.state.done_batch","ui.chat.canonical.image_gen.state.failed","ui.chat.canonical.image_gen.state.failed_batch"]) {
  console.log("##",k);
  for (const m of mats) {
    const u=new IntlMessageFormat(d[k],"ur").format({material:m});
    const e=new IntlMessageFormat(en[k],"en").format({material:m});
    console.log(`   ${m.padEnd(13)} ur=${[...u].length.toString().padStart(3)} en=${[...e].length.toString().padStart(3)}  ${u}`);
  }
}
console.log("## running_batch (other branch, n=2)");
for (const m of mats) {
  const u=new IntlMessageFormat(d["ui.chat.canonical.image_gen.state.running_batch"],"ur").format({material:m,total:2});
  const e=new IntlMessageFormat(en["ui.chat.canonical.image_gen.state.running_batch"],"en").format({material:m,total:2});
  console.log(`   ${m.padEnd(13)} ur=${[...u].length.toString().padStart(3)} en=${[...e].length.toString().padStart(3)}  ${u}`);
}
// separator spacing
for (const k of ["ui.chat.canonical.tool.composing_sized","ui.chat.canonical.tool.queued_sized"]) {
  const v=d[k];
  const i=v.indexOf("\u00b7");
  console.log(k, "chars around dot:", JSON.stringify(v.slice(i-1,i+2)), [...v].map(c=>c.codePointAt(0).toString(16)).join(" "));
}
