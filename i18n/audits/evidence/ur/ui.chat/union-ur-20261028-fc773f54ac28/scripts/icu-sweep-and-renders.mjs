#!/usr/bin/env node
/**
 * Independent mechanical sweep for the ur/ui.chat union audit.
 * Not a repo gate: this is the auditor's own checker over the exact union bytes,
 * using the repo's installed @formatjs/icu-messageformat-parser and
 * intl-messageformat. It proves structure, then RENDERS every message for real.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "@formatjs/icu-messageformat-parser";
import IntlMessageFormat from "intl-messageformat";

const ROOT = "src/i18n/catalogues";
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const en = JSON.parse(readFileSync(`${ROOT}/en/ui.chat.json`, "utf8"));
const ur = JSON.parse(readFileSync(`${ROOT}/ur/ui.chat.json`, "utf8"));
const ctx = JSON.parse(readFileSync(`${ROOT}/en/ui.chat.context.json`, "utf8"));

const problems = [];
const bad = (key, kind, detail) => problems.push({ key, kind, detail });

// ---------- 1. key sets ----------
if (JSON.stringify(Object.keys(en)) !== JSON.stringify(Object.keys(ur)))
  bad("*", "key-set", "en/ur key sets or order differ");
if (Object.keys(ur).length !== 142) bad("*", "key-count", `${Object.keys(ur).length} keys`);

// ---------- 2. ICU parse, arg parity ----------
function argsOf(ast) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 1) out.push({ name: n.value, kind: "string" });
      else if (n.type === 2) out.push({ name: n.value, kind: "number" });
      else if (n.type === 3) out.push({ name: n.value, kind: "date" });
      else if (n.type === 4) out.push({ name: n.value, kind: "time" });
      else if (n.type === 5) {
        out.push({ name: n.value, kind: "select", selectors: Object.keys(n.options) });
        for (const opt of Object.values(n.options)) walk(opt.value);
      } else if (n.type === 6) {
        out.push({
          name: n.value, kind: n.pluralType === "ordinal" ? "selectordinal" : "plural",
          selectors: Object.keys(n.options),
        });
        for (const opt of Object.values(n.options)) walk(opt.value);
      } else if (n.type === 8) {
        bad("*", "tag", `rich-text tag <${n.value}> found`);
        walk(n.children);
      }
    }
  };
  walk(ast);
  return out;
}

const asts = {};
for (const [key, value] of Object.entries(ur)) {
  try {
    asts[key] = parse(value);
  } catch (error) {
    bad(key, "icu-parse", error.message);
  }
  try {
    parse(en[key]);
  } catch (error) {
    bad(key, "icu-parse-en", error.message);
  }
}

const UR_PLURAL = new Intl.PluralRules("ur").resolvedOptions().pluralCategories;
const UR_CATS = new Set(UR_PLURAL);
for (const key of Object.keys(ur)) {
  if (!asts[key]) continue;
  const a = argsOf(asts[key]);
  const e = argsOf(parse(en[key]));
  const sig = (list) =>
    list
      .map((x) => `${x.name}:${x.kind}${x.selectors ? "[" + x.selectors.join(",") + "]" : ""}`)
      .sort()
      .join(" ");
  if (sig(a) !== sig(e)) bad(key, "arg-parity", `en{${sig(e)}} ur{${sig(a)}}`);
  for (const arg of a) {
    if (arg.kind === "plural" || arg.kind === "selectordinal") {
      for (const sel of arg.selectors) {
        if (!/^=\d+$/.test(sel) && !UR_CATS.has(sel))
          bad(key, "plural-category", `${arg.name} selector '${sel}' is not an ur CLDR category`);
      }
      if (!arg.selectors.includes("other"))
        bad(key, "plural-other", `${arg.name} has no 'other' arm`);
    }
  }
  // backtick spans and <tags> preserved
  const bt = (s) => (s.match(/`[^`]*`/g) ?? []).sort().join("|");
  if (bt(en[key]) !== bt(ur[key]))
    bad(key, "backtick", `en[${bt(en[key])}] ur[${bt(ur[key])}]`);
}

// ---------- 3. real renders ----------
const renders = [];
const failures = [];
const STRING_SAMPLES = {
  label: "Radient",
  name: "Fix the build",
  clock: "15:42",
  reason: "Team owns this slot",
  query: "Nova",
  token: "$seal-demo",
  digits: "1-3",
  status: " (HTTP 402)",
  body: "Top up to continue.",
  prefix: "10 میں سے سوال 2۔ ",
};
const sampleFor = (name) => STRING_SAMPLES[name] ?? "Nova";
function argSamples(arg, n = 1) {
  if (arg.kind === "select") return [{ [arg.name]: arg.selectors[0] }];
  if (arg.kind === "plural") {
    const pr = new Intl.PluralRules("ur");
    const arms = [];
    for (const cat of UR_PLURAL) {
      let probe = 0;
      while (pr.select(probe) !== cat && probe < 50) probe++;
      arms.push({ [arg.name]: cat === "one" ? 1 : probe || 2 });
    }
    return arms;
  }
  if (arg.kind === "string") return [{ [arg.name]: sampleFor(arg.name) }];
  if (arg.kind === "number") return [{ [arg.name]: n }];
  return [{ [arg.name]: "x" }];
}
for (const [key, value] of Object.entries(ur)) {
  if (!asts[key]) continue;
  const args = argsOf(asts[key]);
  // enumerate select/plural arms; a select's arms are covered by its selectors,
  // a plural's by the reachable CLDR categories, a plain number by 1 and 1234.5
  const perArg = args.map((a) =>
    a.kind === "select"
      ? a.selectors.map((s) => ({ [a.name]: s }))
      : argSamples(a),
  );
  const combos = perArg.reduce((acc, list) => acc.flatMap((x) => list.map((y) => ({ ...x, ...y }))), [{}]);
  const useCombos = combos.length ? combos : [{}];
  for (const argsObj of useCombos) {
    try {
      const msg = new IntlMessageFormat(value, "ur");
      const out = msg.format(argsObj);
      renders.push({ key, args: argsObj, out });
      if (/\b(undefined|NaN)\b/.test(out)) bad(key, "render-artifact", JSON.stringify(out));
    } catch (error) {
      failures.push({ key, args: argsObj, error: error.message });
    }
  }
  // big-number sample, every other argument at its ordinary sample, so a
  // number-only fixture never makes a message look broken
  if (args.some((a) => a.kind === "number")) {
    const big = {};
    for (const a of args) {
      if (a.kind === "number") big[a.name] = 1234567;
      else if (a.kind === "string") big[a.name] = sampleFor(a.name);
      else if (a.kind === "select") big[a.name] = a.selectors[0];
      else if (a.kind === "plural") big[a.name] = 2;
    }
    try {
      renders.push({ key, args: big, out: new IntlMessageFormat(value, "ur").format(big) });
    } catch (error) {
      failures.push({ key, args: big, error: error.message });
    }
  }
}

// ---------- 4. typography / unicode ----------
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/u;
const ZW = /[\u200b\u200c\u200d\ufeff]/u;
for (const [key, value] of Object.entries(ur)) {
  if (value.normalize("NFC") !== value) bad(key, "nfc", "value is not NFC");
  if (BIDI.test(value)) bad(key, "bidi-control", "contains a manual bidi control");
  if (ZW.test(value)) bad(key, "zero-width", "contains a zero-width character");
  if (/\u00a0|\u202f/.test(value)) bad(key, "nbsp", "contains a no-break space");
  if (/\.\.\./.test(value)) bad(key, "ascii-ellipsis", "uses ... instead of …");
  if (/\u0964/.test(value)) bad(key, "hindi-danda", "uses the Devanagari danda");
  if (/[؟?]/.test(value) && false) void 0;
  if (/\s{2,}/.test(value)) bad(key, "double-space", "contains a run of spaces");
  if (/\s$/.test(value) && key !== "ui.chat.question_dock.hint.prefix")
    bad(key, "trailing-space", "trailing whitespace");
  if (/^\s/.test(value) && key !== "ui.chat.question_dock.hint.prefix")
    bad(key, "leading-space", "leading whitespace");
  if (/["']/.test(value)) bad(key, "straight-quote", 'contains a straight quote');
  if (/؛/u.test(value)) void 0;
}
// the one intentional trailing space must survive
if (!ur["ui.chat.question_dock.hint.prefix"].endsWith(" "))
  bad("ui.chat.question_dock.hint.prefix", "trailing-space", "intentional trailing space lost");

// ---------- 5. English fallback / Latin islands ----------
const identical = Object.keys(ur).filter((k) => ur[k] === en[k]);

// ---------- 6. width (Arabic script ≈ 1 cell per char, combining marks 0) ----------
const widths = [];
const marks = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/u;
for (const key of Object.keys(ur)) {
  const hint = ctx[key]?.maxCells ?? ctx[key]?.maxChars;
  if (!hint) continue;
  let cells = 0;
  for (const ch of ur[key]) cells += marks.test(ch) ? 0 : 1;
  widths.push({ key, hint, cells, text: ur[key] });
  if (cells > hint) bad(key, "width", `${cells} cells > ${hint} hint`);
}

// ---------- report ----------
console.log(JSON.stringify({
  sha256: {
    en: sha(`${ROOT}/en/ui.chat.json`),
    ur: sha(`${ROOT}/ur/ui.chat.json`),
    context: sha(`${ROOT}/en/ui.chat.context.json`),
  },
  keys: { en: Object.keys(en).length, ur: Object.keys(ur).length },
  ur_plural_categories: UR_PLURAL,
  real_renders: renders.length,
  render_failures: failures,
  identical_to_english: identical,
  width_hints: widths,
  mechanical: problems.length ? "PROBLEMS" : "CLEAN",
  problems,
}, null, 1));

// samples for the log
const sampleKeys = [
  "ui.chat.composer.status.loop_progress_turns",
  "ui.chat.composer.status.loop_progress_of_turns",
  "ui.chat.header_identity.loading",
  "ui.chat.hub_update.update_all",
  "ui.chat.hub_update.update_all_label",
  "ui.chat.question_dock.hint.prefix",
  "ui.chat.checkpoint.jump_user",
  "ui.chat.checkpoint.turn",
  "ui.chat.provider_error.headline.out_of_credits",
  "ui.chat.mermaid.loading",
  "ui.chat.session_status.not_signed_in",
  "ui.chat.session_status.not_signed_in_description",
];
console.error("--- render samples (ur) ---");
for (const key of sampleKeys) {
  for (const r of renders.filter((x) => x.key === key)) {
    console.error(`${key} ${JSON.stringify(r.args)} => ${JSON.stringify(r.out)}`);
  }
}
console.error("--- en control for the two plural/number keys ---");
for (const n of [0, 1, 2, 1234567]) {
  console.error(`en loop_progress_turns ${JSON.stringify({ count: n })} => ${JSON.stringify(
    new IntlMessageFormat(en["ui.chat.composer.status.loop_progress_turns"], "en").format({ count: n }),
  )}`);
  console.error(`ur loop_progress_turns ${JSON.stringify({ count: n })} => ${JSON.stringify(
    new IntlMessageFormat(ur["ui.chat.composer.status.loop_progress_turns"], "ur").format({ count: n }),
  )}`);
  console.error(`ur loop_progress_of_turns ${JSON.stringify({ completed: n, total: 10 })} => ${JSON.stringify(
    new IntlMessageFormat(ur["ui.chat.composer.status.loop_progress_of_turns"], "ur").format({ completed: n, total: 10 }),
  )}`);
}
writeFileSync(
  new URL("./renders.json", import.meta.url),
  JSON.stringify(renders.map((r) => ({ key: r.key, args: r.args, out: r.out })), null, 1) + "\n",
);
process.exit(problems.length || failures.length ? 1 : 0);
