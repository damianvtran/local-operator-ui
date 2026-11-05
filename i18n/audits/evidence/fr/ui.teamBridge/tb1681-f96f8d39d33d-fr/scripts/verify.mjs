// Audit check for PR #1681 ui.teamBridge.conversation_menu.* (all 7 locales): ICU parse,
// argument names/kinds equal to en, NFC, no bidi controls, fr U+202F before high punctuation,
// zh-CN no CJK/Latin space around placeholders/@, key set and order equal to en, #channel literals kept.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { parse, TYPE } = require("@formatjs/icu-messageformat-parser");
const d = "src/i18n/catalogues";
const en = JSON.parse(readFileSync(`${d}/en/ui.teamBridge.json`, "utf8"));
const args = (ast, out = new Map()) => { for (const n of ast) { if (n.value !== undefined && [TYPE.argument, TYPE.number, TYPE.date, TYPE.time, TYPE.plural, TYPE.select].includes(n.type)) out.set(n.value, n.type); if (n.options) for (const o of Object.values(n.options)) args(o.value, out); if (n.children) args(n.children, out); } return out; };
const BIDI = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;
const delta = Object.keys(en).filter((k) => k.includes(".conversation_menu."));
for (const loc of ["es", "fr", "hi", "ru", "ur", "vi", "zh-CN"]) {
  const t = JSON.parse(readFileSync(`${d}/${loc}/ui.teamBridge.json`, "utf8"));
  const probs = [];
  const ek = Object.keys(en), tk = Object.keys(t);
  if (ek.length !== tk.length || ek.some((k, i) => tk[i] !== k)) probs.push("key set/order differs");
  for (const k of ek) {
    const v = t[k]; let a, b;
    try { a = parse(en[k]); b = parse(v); } catch (e) { probs.push(`${k}: parse ${e.message}`); continue; }
    const ea = args(a), ta = args(b);
    if ([...ea.keys()].sort().join() !== [...ta.keys()].sort().join()) probs.push(`${k}: arg names ${[...ea.keys()]} vs ${[...ta.keys()]}`);
    for (const [n, ty] of ta) if (ea.get(n) !== ty) probs.push(`${k}: arg ${n} kind differs`);
    if (v.normalize("NFC") !== v) probs.push(`${k}: not NFC`);
    if (BIDI.test(v)) probs.push(`${k}: bidi control`);
    if (delta.includes(k)) {
      if (v === en[k]) probs.push(`${k}: identical to en`);
      if (loc === "fr" && / [:;!?»]/.test(v)) probs.push(`${k}: U+0020 before high punct`);
      if (loc === "fr" && /\u00A0[:;!?]/.test(v)) probs.push(`${k}: NBSP (not NNBSP)`);
      if (loc === "zh-CN" && /([\u4e00-\u9fff\uff0c\u3002] +[0-9A-Za-z{#@]|[0-9A-Za-z}@] +[\u4e00-\u9fff])/.test(v)) probs.push(`${k}: CJK/Latin space`);
      if (loc !== "fr" && /\u202F/.test(v)) probs.push(`${k}: stray U+202F`);
      for (const ch of (en[k].match(/#[a-z]+/g) || [])) if (!v.includes(ch)) probs.push(`${k}: channel literal ${ch} lost`);
    }
  }
  console.log(`== ${loc}: ${tk.length} keys (${delta.length} delta); ${probs.length} problem(s)`);
  for (const p of probs) console.log("  " + p);
}
