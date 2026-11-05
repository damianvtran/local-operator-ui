// Round-2 delta check for PR #1670 ui.teamBridge (7 locales), 1acab59..HEAD:
// full-file ICU parse, argument names/kinds equal en, key set/order equal en, NFC,
// no bidi controls; on the 6 delta keys: {channel} present exactly once and no
// literal #general/#humans/#agents left, fr NNBSP rule, zh-CN CJK/Latin spacing;
// and the three notes equal their round-1 audited bytes with only #name -> {channel}.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { parse, TYPE } = require("@formatjs/icu-messageformat-parser");
const d = "src/i18n/catalogues";
const P = "ui.teamBridge.members_panel.";
const DELTA = ["confirm.remove_body", "confirm.remove_invited_body", "confirm.leave_body", "note.general", "note.humans", "note.agents"].map((k) => P + k);
const en = JSON.parse(readFileSync(`${d}/en/ui.teamBridge.json`, "utf8"));
const args = (ast, out = new Map()) => { for (const n of ast) { if (n.value !== undefined && [TYPE.argument, TYPE.number, TYPE.date, TYPE.time, TYPE.plural, TYPE.select].includes(n.type)) out.set(n.value, n.type); if (n.options) for (const o of Object.values(n.options)) args(o.value, out); if (n.children) args(n.children, out); } return out; };
const BIDI = /[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/;
for (const loc of ["es", "fr", "hi", "ru", "ur", "vi", "zh-CN"]) {
  const t = JSON.parse(readFileSync(`${d}/${loc}/ui.teamBridge.json`, "utf8"));
  const r1 = JSON.parse(execFileSync("git", ["show", `1acab5915d98:${d}/${loc}/ui.teamBridge.json`], { encoding: "utf8" }));
  const probs = [];
  const ek = Object.keys(en), tk = Object.keys(t);
  if (ek.length !== tk.length || ek.some((k, i) => tk[i] !== k)) probs.push("key set/order differs");
  const changed = tk.filter((k) => r1[k] !== t[k]);
  if (changed.some((k) => !DELTA.includes(k))) probs.push(`non-delta change: ${changed.filter((k) => !DELTA.includes(k))}`);
  for (const k of ek) {
    const v = t[k]; let a, b;
    try { a = parse(en[k]); b = parse(v); } catch (e) { probs.push(`${k}: parse ${e.message}`); continue; }
    const ea = args(a), ta = args(b);
    if ([...ea.keys()].sort().join() !== [...ta.keys()].sort().join()) probs.push(`${k}: arg names ${[...ea.keys()]} vs ${[...ta.keys()]}`);
    for (const [n, ty] of ta) if (ea.get(n) !== ty) probs.push(`${k}: arg ${n} kind differs`);
    if (v.normalize("NFC") !== v) probs.push(`${k}: not NFC`);
    if (BIDI.test(v)) probs.push(`${k}: bidi control`);
  }
  for (const k of DELTA) {
    const v = t[k];
    if (k.includes(".note.")) {
      const ch = "#" + k.split(".").pop();
      if ((v.match(/\{channel\}/g) || []).length !== 1) probs.push(`${k}: {channel} count != 1`);
      if (v.includes(ch)) probs.push(`${k}: literal ${ch} left`);
      if (r1[k].replace(ch, "{channel}") !== v) probs.push(`${k}: differs from round-1 bytes beyond #name -> {channel}`);
    }
    if (loc === "fr" && / [:;!?»]/.test(v)) probs.push(`${k}: U+0020 before high punct`);
    if (loc === "fr" && /\u00A0[:;!?]/.test(v)) probs.push(`${k}: NBSP (not NNBSP)`);
    if (loc === "zh-CN" && /([\u4e00-\u9fff] +[0-9A-Za-z{#]|[0-9A-Za-z}] +[\u4e00-\u9fff])/.test(v)) probs.push(`${k}: CJK/Latin space`);
  }
  console.log(`== ${loc}: ${tk.length} keys; ${changed.length} changed vs 1acab59 (${DELTA.length} delta keys); ${probs.length} problem(s)`);
  for (const p of probs) console.log("  " + p);
}
