import { readFileSync } from "node:fs";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
const CLDR = new Intl.PluralRules("hi").resolvedOptions().pluralCategories.slice().sort();
const NSS = ["ui.chat","ui.chat.header","ui.chat.response_actions","ui.chat.sidebar"];
let total = 0, bad = 0;
for (const ns of NSS) {
  for (const loc of ["en","hi"]) {
    const d = JSON.parse(readFileSync(`src/i18n/catalogues/${loc}/${ns}.json`,"utf8"));
    for (const [k,v] of Object.entries(d)) {
      const walk = (n, out=[]) => {
        if (Array.isArray(n)) { n.forEach((x)=>walk(x,out)); return out; }
        if (!n || typeof n !== "object") return out;
        if (n.type === TYPE.plural) out.push([n.value, Object.keys(n.options).sort()]);
        if (Array.isArray(n.children)) n.children.forEach((x)=>walk(x,out));
        if (n.options) for (const o of Object.values(n.options)) walk(o?.value ?? o,out);
        return out;
      };
      const arms = walk(parse(v));
      for (const [arg, list] of arms) {
        total++;
        const missing = CLDR.filter((c)=>!list.includes(c));
        if (missing.length) { bad++; console.log(`MISSING ${loc}/${ns}/${k} ${arg}: has ${list} needs ${CLDR}`); }
        else if (loc==="hi") console.log(`ok ${ns}/${k} ${arg}: [${list}]`);
      }
    }
  }
}
console.log(`\nplural messages inspected=${total} hi-cldr=${CLDR} missing=${bad}`);
