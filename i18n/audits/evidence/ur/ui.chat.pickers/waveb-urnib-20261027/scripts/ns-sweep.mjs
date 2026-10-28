/**
 * Namespace-wide mechanical sweep for the ur nib delta bundle.
 *
 * The delta is ONE value, but a re-bind must also show the file it sits in is
 * still whole: every one of the 738 values is parsed by the repo's own ICU
 * parser (@formatjs/icu-messageformat-parser, the parser `intl-messageformat`
 * uses at runtime), and every key's argument set is compared with the English
 * source's key-for-key — same names, same types, nothing added or dropped.
 *
 * Reads only. No translation service is involved anywhere in this check.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { parse } from "@formatjs/icu-messageformat-parser";

const WT = "/Users/damian/local-operator-ui/.worktrees/wave-b-bind";
const read = (p) => JSON.parse(readFileSync(`${WT}/${p}`, "utf8"));
const ur = read("src/i18n/catalogues/ur/ui.chat.pickers.json");
const en = read("src/i18n/catalogues/en/ui.chat.pickers.json");

const TYPES = { 0: "literal", 1: "argument", 2: "number", 3: "date", 4: "time", 5: "plural/select", 6: "pound", 7: "tag" };

function argsOf(message) {
  const out = [];
  const pluralCats = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type === 1) out.push(`arg:${n.value}`);
      if (n.type === 2) out.push(`num:${n.value}`);
      if (n.type === 3) out.push(`date:${n.value}`);
      if (n.type === 4) out.push(`time:${n.value}`);
      if (n.type === 5) {
        // type 5 is ICU plural OR select; `pluralType` is set only for plural.
        if (n.pluralType !== undefined) {
          out.push(`plural:${n.value}:${n.pluralType}`);
          pluralCats.push(...Object.keys(n.options));
        } else {
          out.push(`select:${n.value}`);
        }
      }
      if (n.type === 7) out.push(`tag:${n.value}`);
      if (Array.isArray(n.options)) for (const o of Object.values(n.options)) walk(o.value);
      if (Array.isArray(n.children)) walk(n.children);
    }
  };
  walk(parse(message));
  out.sort();
  return { args: out, pluralCats };
}

let parseErrors = 0;
const mismatches = [];
const kinds = {};
const allCats = new Set();
let pluralKeys = 0;
for (const [k, v] of Object.entries(ur)) {
  try {
    const { args: ua, pluralCats } = argsOf(v);
    kinds[typeof v] = (kinds[typeof v] ?? 0) + 1;
    if (ua.some((a) => a.startsWith("plural:"))) {
      pluralKeys++;
      for (const c of pluralCats) allCats.add(c);
    }
    const { args: ea } = argsOf(en[k]);
    if (JSON.stringify(ua) !== JSON.stringify(ea)) mismatches.push({ key: k, ur: ua, en: ea });
  } catch (e) {
    parseErrors++;
    mismatches.push({ key: k, parse_error: String(e) });
  }
}

const KEY = "ui.chat.pickers.slash.enter_needs_a_pick";
const baseBytes = execFileSync("git", ["-C", WT, "show", `a5356ce91c:src/i18n/catalogues/ur/ui.chat.pickers.json`]);
const baseValue = JSON.parse(baseBytes.toString("utf8"))[KEY];
const diskValue = ur[KEY];

console.log(JSON.stringify({
  file: "src/i18n/catalogues/ur/ui.chat.pickers.json",
  sha256: createHash("sha256").update(readFileSync(`${WT}/src/i18n/catalogues/ur/ui.chat.pickers.json`)).digest("hex"),
  keys_checked: Object.keys(ur).length,
  parse_errors: parseErrors,
  argument_or_type_mismatches_vs_en: mismatches,
  value_kinds: kinds,
  plural_keys_with_arms: pluralKeys,
  plural_categories_present: [...allCats].sort(),
  plural_surface: pluralKeys === 0
    ? "none: this namespace carries no ICU plural or select at all, so the ur one/other category rule is vacuous here and no category is claimed"
    : `present: ${pluralKeys} key(s), categories ${[...allCats].sort().join(", ")}`,
  ur_clld_categories_expected: ["one", "other"],
  changed_key_present: KEY in ur,
  changed_key_code_points: [...diskValue].length,
  changed_key_code_points_at_base: [...baseValue].length,
  changed_key_byte_delta: Buffer.byteLength(diskValue) - Buffer.byteLength(baseValue),
  changed_key_is_plain_literal_no_icu: argsOf(diskValue).args.length === 0,
  ok: parseErrors === 0 && mismatches.length === 0,
}, null, 1));
