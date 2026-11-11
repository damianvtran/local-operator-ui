// Tiny ICU audit harness: compile en + ur draft, compare AST argument shapes,
// record plural categories, format across counts and materials.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const WT = "/Users/damian/local-operator-ui/.worktrees/i18n-s16a";
const req = createRequire(WT + "/package.json");
const { IntlMessageFormat } = req("intl-messageformat");

const draft = JSON.parse(readFileSync("/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16a-drafts/ur-s16a.json", "utf8"));
const en = JSON.parse(readFileSync(`${WT}/src/i18n/catalogues/en/ui.chat.canonical.json`, "utf8"));

const pr = new Intl.PluralRules("ur");
const need = new Set();
for (const n of [0, 1, 2, 3, 5, 11, 21, 22, 100, 1000000]) need.add(pr.select(n));
console.log("ur CLDR categories needed:", [...need].sort().join(","), "| sample:", [0,1,2,3,5,11,21,22,100,1000000].map(n=>`${n}->${pr.select(n)}`).join(" "));

// structural shape: argument name -> set of kinds, and select/plural option keys
function shape(msg) {
  const mf = new IntlMessageFormat(msg, "ur");
  const out = {};
  const walk = (els) => {
    for (const el of els) {
      if (el.type === 1) { // argument
        (out[el.value] ??= new Set()).add("plain");
      } else if ([2,3,4].includes(el.type)) {
        (out[el.value] ??= new Set()).add("structural:" + el.type);
      } else if (el.type === 5 || el.type === 6) {
        (out[el.value] ??= new Set()).add(el.type === 5 ? "select" : "plural");
        out["__opts:" + el.value] = Object.keys(el.options).sort().join("|");
        for (const o of Object.values(el.options)) walk(o.value);
      } else if (el.type === 8) walk(el.children);
    }
  };
  walk(mf.getAst());
  const norm = {};
  for (const [k, v] of Object.entries(out)) norm[k] = typeof v === "string" ? v : [...v].sort().join("+");
  return { norm, mf, src: (el) => el };
}
function cmpShapes(key) {
  const a = shape(en[key]).norm;
  const b = shape(draft[key]).norm;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) if (a[k] !== b[k]) diffs.push(`${k}: en=${a[k]} ur=${b[k]}`);
  return diffs;
}
const counts = [0, 1, 2, 3, 5, 11, 21, 22, 100, 1000000];
const materials = ["video", "voiceover", "sound_effect", "image"];
console.log("\n=== SHAPE PARITY ===");
for (const k of Object.keys(draft)) {
  const d = cmpShapes(k);
  console.log(d.length ? `DIFF ${k}\n   ${d.join("\n   ")}` : `ok   ${k}`);
}
console.log("\n=== FORMAT RUNS ===");
for (const k of Object.keys(draft)) {
  const msg = draft[k];
  const opts = [...new Set([...msg.matchAll(/\{(\w+)/g)].map(m => m[1]))];
  const rows = [];
  if (opts.includes("material")) {
    for (const mat of materials)
      for (const n of [1, 2, 3, 5, 11, 100]) rows.push([`${mat}/${n}`, { material: mat, total: n, count: n }]);
  } else if (opts.includes("count") || opts.includes("total")) {
    for (const n of counts) rows.push([String(n), { count: n, total: n }]);
  } else if (opts.includes("size")) {
    for (const s of ["12.4 KB", "0 B", "1.2 MB"]) rows.push([s, { size: s }]);
  } else rows.push(["-", {}]);
  console.log(`\n## ${k}`);
  for (const [label, v] of rows) {
    let out;
    try { out = new IntlMessageFormat(msg, "ur").format(v); } catch (e) { out = "ERROR " + e.message; }
    console.log(`   [${label}] ${JSON.stringify(out)}`);
  }
}
