import { readFileSync } from "node:fs";
const d = JSON.parse(readFileSync("/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/ur-s16a.json","utf8"));
const en = JSON.parse(readFileSync("/Users/damian/local-operator-ui/.worktrees/i18n-s16a/src/i18n/catalogues/en/ui.chat.canonical.json","utf8"));
const BAD = { "\u200e":"LRM","\u200f":"RLM","\u2066":"LRI","\u2067":"RLI","\u2068":"FSI","\u2069":"PDI","\u202a":"LRE","\u202b":"RLE","\u202c":"PDF","\u202d":"LRO","\u202e":"RLO","\u0964":"Devanagari danda","\u0660":"Arabic-Indic digit","\u06f0":"Extended Arabic-Indic digit","\u061f":"Arabic question mark","\u060c":"Arabic comma"};
for (const [k,v] of Object.entries(d)) {
  const cp = [...v];
  const bad = cp.filter(c => BAD[c]).map(c => BAD[c]+"(U+"+c.codePointAt(0).toString(16).toUpperCase()+")");
  const asciiDot = v.includes(".");
  const threeDots = v.includes("...");
  const hasU2026 = v.includes("\u2026");
  const middot = (v.match(/\u00b7/g)||[]).length;
  const bullet = v.includes("\u2022");
  const latinLetters = (v.match(/[A-Za-z]+/g)||[]);
  console.log(`${k}\n   cells ur=${cp.length} en=${[...en[k]].length} | bad=${bad.join(",")||"-"} | asciiDot=${asciiDot} threeDots=${threeDots} U2026=${hasU2026} middot=${middot} bullet=${bullet} | latin=[${latinLetters.join("|")}]`);
}
