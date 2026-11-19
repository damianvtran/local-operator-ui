import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { parse, TYPE } = require("@formatjs/icu-messageformat-parser");
const d = "src/i18n/catalogues";
const en = JSON.parse(readFileSync(`${d}/en/ui.teamBridge.json`, "utf8"));
const ctx = JSON.parse(readFileSync(`${d}/en/ui.teamBridge.context.json`, "utf8"));
const CAT = { fr: ["one", "many", "other"], vi: ["other"], "zh-CN": ["other"] };
const args = (ast, out = new Map()) => {
  for (const n of ast) {
    if (n.value !== undefined && [TYPE.argument, TYPE.number, TYPE.date, TYPE.time, TYPE.plural, TYPE.select].includes(n.type)) out.set(n.value, n.type);
    if (n.options) for (const [k, o] of Object.entries(n.options)) args(o.value, out);
    if (n.children) args(n.children, out);
  }
  return out;
};
const plurals = (ast, out = []) => { for (const n of ast) { if (n.type === TYPE.plural) out.push(Object.keys(n.options)); if (n.options) for (const o of Object.values(n.options)) plurals(o.value, out); } return out; };
const BIDI = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;
for (const loc of ["fr", "vi", "zh-CN"]) {
  const raw = readFileSync(`${d}/${loc}/ui.teamBridge.json`, "utf8");
  const t = JSON.parse(raw);
  const probs = [];
  const ek = Object.keys(en), tk = Object.keys(t);
  if (ek.length !== tk.length || ek.some((k) => !(k in t))) probs.push("keyset differs");
  for (const k of ek) {
    const v = t[k];
    let a, b;
    try { a = parse(en[k]); b = parse(v); } catch (e) { probs.push(`${k}: parse ${e.message}`); continue; }
    const ea = args(a), ta = args(b);
    const en_names = [...ea.keys()].sort().join(), t_names = [...ta.keys()].sort().join();
    if (en_names !== t_names) probs.push(`${k}: arg names ${en_names} vs ${t_names}`);
    for (const [n, ty] of ta) if (ea.get(n) !== ty) probs.push(`${k}: arg ${n} kind en=${ea.get(n)} ${loc}=${ty} (info)`);
    for (const cats of plurals(b)) { const miss = CAT[loc].filter((c) => !cats.includes(c)); const extra = cats.filter((c) => !CAT[loc].includes(c) && !c.startsWith("=")); if (miss.length || extra.length) probs.push(`${k}: plural miss ${miss} extra ${extra}`); }
    if (v.normalize("NFC") !== v) probs.push(`${k}: not NFC`);
    if (BIDI.test(v)) probs.push(`${k}: bidi control`);
    if (loc === "fr" && / [:;!?»]/.test(v)) probs.push(`${k}: U+0020 before high punct: ${JSON.stringify(v.match(/.{0,12} [:;!?»].{0,4}/g))}`);
    if (loc === "fr" && /\u00A0[:;!?]/.test(v)) probs.push(`${k}: NBSP (not NNBSP) before punct`);
    if (loc === "zh-CN" && /([\u4e00-\u9fff] +[0-9A-Za-z{#]|[0-9}#] +[\u4e00-\u9fff])/.test(v)) probs.push(`${k}: CJK/Latin space: ${JSON.stringify(v)}`);
    // backticks preserved
    const bt = (s) => (s.match(/`[^`]*`/g) || []).join("|");
    if (bt(en[k]) !== bt(v)) probs.push(`${k}: code span differs`);
  }
  console.log(`== ${loc}: ${tk.length} keys; ${probs.length} notes`);
  for (const p of probs) console.log("  " + p);
}
console.log("context keys:", Object.keys(ctx).length);
for (const k of ["ui.teamBridge.builtin.general_topic","ui.teamBridge.delivery.refused_out_of_scope","ui.teamBridge.attachmentCard.list","ui.teamBridge.attachmentCard.bytes","ui.teamBridge.fileCard.list"]) console.log(k, JSON.stringify(ctx[k] ?? ctx[k.replace("ui.teamBridge.","")]));
