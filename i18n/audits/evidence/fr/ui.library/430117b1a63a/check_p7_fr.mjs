import { readFileSync } from "node:fs";
import { parse } from "/Users/damian/local-operator-ui/node_modules/@formatjs/icu-messageformat-parser/index.js";

const DIR = "/Users/damian/local-operator-ui/.worktrees/_p7-prep";
const keys = JSON.parse(readFileSync(`${DIR}/keys.json`, "utf8"));
const cand = JSON.parse(readFileSync(`${DIR}/fr.json`, "utf8"));

function args(msg) {
  const out = new Map();
  const walk = (els) => {
    for (const el of els) {
      if (el.type === 1) out.set(el.value, "arg");
      if (el.type === 5 || el.type === 6) { out.set(el.value, el.type === 6 ? "plural" : "select"); (el.options ?? []).forEach(o => walk(o.value)); }
      if (el.type === 4) out.set(`#${el.value ?? ""}`, "pound");
      if (el.type === 2) out.set(el.value, "number");
      if (el.type === 3) { out.set(el.value, "date"); }
      if (el.type === 8) walk(el.children ?? []);
      if (el.children) walk(el.children);
    }
  };
  walk(parse(msg));
  return out;
}
let fail = 0;
const order = Object.keys(keys);
const candOrder = Object.keys(cand.values);
if (JSON.stringify(order) !== JSON.stringify(candOrder)) { console.log("FAIL key order/set differs from keys.json"); fail++; }
const seen = new Set();
for (const k of order) {
  const [ns, ...rest] = k.split(".").slice(0, 2);
  const en = keys[k].english;
  const fr = cand.values[k];
  if (typeof fr !== "string" || fr.trim() === "") { console.log(`FAIL empty ${k}`); fail++; continue; }
  if (seen.has(k)) { console.log(`FAIL duplicate ${k}`); fail++; }
  seen.add(k);
  let ea, fa;
  try { ea = args(en); } catch (e) { console.log(`EN PARSE ERR ${k}: ${e.message}`); fail++; continue; }
  try { fa = args(fr); } catch (e) { console.log(`FAIL ICU parse ${k}: ${e.message}`); fail++; continue; }
  const ek = [...ea.keys()].sort().join(","), fk = [...fa.keys()].sort().join(",");
  const ok = ek === fk;
  console.log(`${ok ? "ok  " : "FAIL"} ${k}  en{${ek}} fr{${fk}}  nfc=${fr === fr.normalize("NFC")} identical=${fr === en}  en=${en.length}c fr=${fr.length}c`);
  if (!ok) fail++;
  // markup / code / tag scan
  for (const rx of [/<\/?[a-z][^>]*>/i, /`/, /\{@/, /\{!/]) {
    if (rx.test(fr) && !rx.test(en)) { console.log(`FAIL markup/code in fr only: ${k} (${rx})`); fail++; }
  }
  if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(fr)) { console.log(`FAIL bidi control in ${k}`); fail++; }
  if (/[\u00a0\u202f]/.test(fr)) { console.log(`NOTE nbsp/fine-space in ${k}`); }
  if (/ {2,}/.test(fr)) { console.log(`NOTE double space in ${k}`); }
  if (/['"]/.test(fr)) { console.log(`NOTE ascii quote/apostrophe in ${k}`); }
}
console.log(fail === 0 ? "MECHANICAL: PASS" : `MECHANICAL: ${fail} FAILURES`);
