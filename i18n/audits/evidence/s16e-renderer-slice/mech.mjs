// Second independent i18n audit (S16e) — mechanical checks only.
// Uses the repo's own ICU parser (@formatjs/icu-messageformat-parser, the same
// dependency scripts/i18n/generate.mjs imports) from the PRIMARY checkout's
// node_modules by absolute path: no install, no worktree write.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const require = createRequire("/Users/damian/local-operator-ui/package.json");
const { parse, TYPE } = require("@formatjs/icu-messageformat-parser");

const WORK = "/Users/damian/local-operator-ui/.worktrees/i18n-s16e";
const DRAFT_ROOT = "/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e";
const KEYS = [
  "state.cancelled_batch", "cancel.queued", "cancel.running", "cancel.checking",
  "settlement.pending", "error.audio_rate_limited", "error_class.audio_rate_limited",
  "error_class.unknown_tool", "error_class.invalid_arguments", "error_class.duplicate_id",
  "error_class.denied", "error_class.gate_failed",
].map((s) => "ui.chat.canonical.image_gen." + s);
const LOCALES = ["fr", "es", "ru", "vi", "zh-CN", "hi", "ur"];
const EXPECTED_SELECT = ["other", "sound_effect", "video", "voiceover"];

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const en = JSON.parse(readFileSync(`${WORK}/src/i18n/catalogues/en/ui.chat.canonical.json`, "utf8"));
const enSlice = Object.fromEntries(KEYS.map((k) => [k, en[k]]));

let failures = 0;
const out = (s) => console.log(s);
const bad = (s) => { failures++; console.log("FAIL " + s); };
const ok = (s) => console.log("ok   " + s);

function walk(ast, acc = { args: {}, branches: {}, literals: [] }) {
  for (const el of ast) {
    if (el.type === TYPE.argument) acc.args[el.value] = "argument";
    else if (el.type === TYPE.number) acc.args[el.value] = "number";
    else if (el.type === TYPE.tag) acc.args["<" + el.value + ">"] = "tag";
    else if (el.type === TYPE.literal) acc.literals.push(el.value);
    else if (el.type === TYPE.pound) acc.literals.push("#");
    else if (el.type === TYPE.select || el.type === TYPE.plural) {
      acc.args[el.value] = el.type === TYPE.select ? "select" : "plural";
      acc.branches[el.value] = Object.keys(el.options).sort();
      for (const k of Object.keys(el.options)) walk(el.options[k].value, acc);
    }
  }
  return acc;
}

// ---------------- negative + passing controls ----------------
{
  const r = [];
  // 1 unbalanced brace must throw
  let threw1 = false; try { parse("{material, select, video {A} other {B}"); } catch { threw1 = true; }
  r.push(["unbalanced brace throws", threw1]);
  // 2 select without `other` parses but is missing a required category
  let missingOther = false;
  try { const a = walk(parse("{material, select, video {A} voiceover {B} sound_effect {C}}")); missingOther = !a.branches.material.includes("other"); } catch { missingOther = true; }
  r.push(["missing `other` detected", missingOther]);
  // 3 renamed branch must not match the expected set (parser throws or set differs)
  let renamed = false;
  try { const a = walk(parse("{material, select, video {A} other {B} default {C}}")); renamed = JSON.stringify(a.branches.material) !== JSON.stringify(EXPECTED_SELECT); } catch { renamed = true; }
  r.push(["extra/renamed branch detected", renamed]);
  // 4 a valid nested plural must parse (passing control)
  let nestedOk = true;
  try { const a = walk(parse("{n, plural, one {# x} other {# xs}}")); nestedOk = a.branches.n.join() === "one,other"; } catch { nestedOk = false; }
  r.push(["valid nested plural parses", nestedOk]);
  // 5 a dropped placeholder must be detected
  let dropDetected = false;
  try { const a = walk(parse("Video batch stopped.")); dropDetected = Object.keys(a.args).length === 0; } catch { dropDetected = false; }
  r.push(["dropped placeholder detected", dropDetected]);
  for (const [name, pass] of r) pass ? ok(`CONTROL ${name}`) : bad(`CONTROL ${name}`);
}

// ---------------- per-value checks ----------------
function checkValue(loc, key, src, tgt) {
  const tag = `${loc} ${key.slice("ui.chat.canonical.image_gen.".length)}`;
  let a, b;
  try { a = walk(parse(src)); } catch (e) { bad(`${tag} EN parse threw: ${e.message}`); return; }
  try { b = walk(parse(tgt)); } catch (e) { bad(`${tag} TARGET parse threw: ${e.message}`); return; }
  const aj = JSON.stringify(a.args), bj = JSON.stringify(b.args);
  if (aj !== bj) bad(`${tag} argument/type set differs: en=${aj} tgt=${bj}`);
  const ab = JSON.stringify(a.branches), bb = JSON.stringify(b.branches);
  if (ab !== bb) bad(`${tag} select/plural branches differ: en=${ab} tgt=${bb}`);
  for (const [arg, brs] of Object.entries(a.branches)) {
    if (!b.branches[arg]) continue;
    const missing = brs.filter((x) => !b.branches[arg].includes(x));
    const extra = b.branches[arg].filter((x) => !brs.includes(x));
    if (missing.length) bad(`${tag} missing branch(es) for {${arg}}: ${missing}`);
    if (extra.length) bad(`${tag} extra branch(es) for {${arg}}: ${extra}`);
  }
  // every branch must carry a literal (no empty branch)
  for (const brs of Object.values(b.branches)) if (!brs.length) bad(`${tag} empty branch set`);
  const prose = b.literals.filter((s) => s.trim().length).join(" | ");
  if (!prose.trim()) bad(`${tag} no literal text rendered`);
  return prose;
}

function typography(loc, key, s) {
  const tag = `${loc} ${key.slice("ui.chat.canonical.image_gen.".length)}`;
  if (s !== s.trim()) bad(`${tag} leading/trailing whitespace`);
  if (/ {2,}|\u00A0\u00A0/.test(s)) bad(`${tag} run of spaces`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) bad(`${tag} control character`);
  if (/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(s)) bad(`${tag} manual bidi control character (ur guide forbids)`);
  if (loc === "fr") {
    const before = (ch) => (s.match(new RegExp("([\\s\\u0085\\u00A0\\u202F])?" + ch, "g")) || []);
    for (const m of s.matchAll(/([\s\u00A0\u202F])?([;:!?])/g)) {
      if (m[2] === ":" || m[2] === ";" || m[2] === "!" || m[2] === "?") {
        if (!m[1]) bad(`${tag} fr: no space before '${m[2]}'`);
        else if (m[1] !== "\u202F") bad(`${tag} fr: '${m[2]}' preceded by U+${m[1].codePointAt(0).toString(16).toUpperCase()} (guide: U+202F)`);
      }
    }
    if (s.includes("'")) bad(`${tag} fr: ASCII apostrophe (guide: U+2019)`);
    if (s.includes("—") && !/ — /.test(s)) bad(`${tag} fr: em dash not spaced with U+0020 (guide: " — ")`);
  }
  if (loc === "es") {
    if (/ [;:!?]/.test(s)) bad(`${tag} es: French-style space before '${s.match(/ ([;:!?])/)[1]}'`);
  }
  if (loc === "ru" || loc === "vi") {
    if (/ [;:!?]/.test(s)) bad(`${tag} ${loc}: space before '${s.match(/ ([;:!?])/)[1]}'`);
  }
  if (loc === "zh-CN") {
    if (/[\u4E00-\u9FFF][A-Za-z0-9]|[A-Za-z0-9][\u4E00-\u9FFF]/.test(s) && /[A-Za-z]{2,}/.test(s)) {
      // informational only: guide forbids inserting spaces, so this must NOT fire on a space
    }
    if (/[\u4E00-\u9FFF] [\u4E00-\u9FFF]/.test(s)) bad(`${tag} zh-CN: space inside Chinese prose`);
    if (/[A-Za-z0-9] [\u4E00-\u9FFF]|[\u4E00-\u9FFF] [A-Za-z0-9]/.test(s)) bad(`${tag} zh-CN: space between Chinese and Latin run`);
    if (/\.\.\./.test(s)) bad(`${tag} zh-CN: three ASCII dots (guide: …… )`);
    if (/[\u4E00-\u9FFF],|[\u4E00-\u9FFF];|[\u4E00-\u9FFF]\./.test(s)) bad(`${tag} zh-CN: half-width punctuation after Chinese text`);
  }
  if (loc === "hi") {
    // Shipped hi houses style uses the ASCII ";" as its clause separator
    // (176 of 9,125 values), so ";" is correct here; only a half-width full
    // stop or comma after Devanagari is wrong (danda / "," house rules).
    if (/[\u0900-\u097F]\./.test(s)) bad(`${tag} hi: half-width full stop after Devanagari`);
  }
  if (loc === "ur") {
    if (s.includes("\u0964")) bad(`${tag} ur: Hindi danda present`);
    if (/[\u0900-\u097F]/.test(s)) bad(`${tag} ur: Devanagari characters present`);
    if (/[\u0660-\u0669]/.test(s)) bad(`${tag} ur: Arabic-Indic digits (Latin required)`);
  }
  if (loc === "vi") {
    if (s.normalize("NFC") !== s) bad(`${tag} vi: not NFC`);
  }
}

// kept-English allowlist for non-Latin-script locales: Latin prose words must be
// either a glossary kept-Latin token or a machine token.
const ALLOWED_LATIN = new Set([
  "endpoint", "id", "ID", "API", "CLI", "TUI", "JSON", "YAML", "HTTP", "URL",
  "GPU", "MCP", "lop", "Local", "Operator",
]);
function latinScan(loc, key, prose) {
  if (!["zh-CN", "hi", "ur"].includes(loc)) return;
  const tag = `${loc} ${key.slice("ui.chat.canonical.image_gen.".length)}`;
  for (const w of prose.match(/[A-Za-z][A-Za-z0-9_.-]*/g) || []) {
    if (!ALLOWED_LATIN.has(w)) bad(`${tag} Latin token '${w}' in a ${loc} value (kept-English check)`);
  }
}

// rough terminal width: wide CJK 2 cells, marks/format 0, U+202F 1 cell (fr guide)
function cells(s) {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0x202F) { n += 1; continue; }
    if (/\p{Mn}|\p{Me}|\p{Cf}/u.test(ch)) continue;
    if ((cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) ||
        (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) ||
        (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60) ||
        (cp >= 0xFFE0 && cp <= 0xFFE6)) { n += 2; continue; }
    n += 1;
  }
  return n;
}

out(`# mech log  audit=s16e-second-independent head=bd8e90542506e8bec4a98862b868095409b28329`);
out(`sha256 en catalogue = ${sha(`${WORK}/src/i18n/catalogues/en/ui.chat.canonical.json`)}`);
out(`sha256 en context   = ${sha(`${WORK}/src/i18n/catalogues/en/ui.chat.canonical.context.json`)}`);
out(`sha256 en-slice-12  = ${createHash("sha256").update(JSON.stringify(enSlice)).digest("hex")}`);
let totalValues = 0;
for (const loc of LOCALES) {
  const p = `${DRAFT_ROOT}/${loc}/draft-${loc}-s16e.json`;
  const raw = readFileSync(p, "utf8");
  let draft;
  try { draft = JSON.parse(raw); } catch (e) { bad(`${loc} invalid JSON: ${e.message}`); continue; }
  out(`\n## ${loc}  sha256=${sha(p)}  keys=${Object.keys(draft).length}  bytes=${Buffer.byteLength(raw)}`);
  const dk = Object.keys(draft).sort(), ek = [...KEYS].sort();
  if (JSON.stringify(dk) !== JSON.stringify(ek)) {
    bad(`${loc} key set differs: extra=${dk.filter((k) => !ek.includes(k))} missing=${ek.filter((k) => !dk.includes(k))}`);
  }
  const seen = new Map();
  for (const key of KEYS) {
    const tgt = draft[key];
    if (typeof tgt !== "string") { bad(`${loc} ${key} missing`); continue; }
    totalValues++;
    const prose = checkValue(loc, key, en[key], tgt);
    typography(loc, key, tgt);
    if (prose) latinScan(loc, key, prose);
    if (seen.has(tgt)) bad(`${loc} identical value for ${seen.get(tgt)} and ${key}`);
    seen.set(tgt, key);
    out(`   cells ${String(cells(tgt)).padStart(3)} | en ${String(cells(en[key])).padStart(3)} | ${key.slice("ui.chat.canonical.image_gen.".length)}`);
  }
}
out(`\nTOTAL values checked = ${totalValues} (expected 84)`);
if (totalValues !== 84) bad(`value count ${totalValues} != 84`);
out(`\nRESULT ${failures === 0 ? "mechanical-pass" : "mechanical-fail"} failures=${failures}`);
process.exitCode = failures === 0 ? 0 : 1;
