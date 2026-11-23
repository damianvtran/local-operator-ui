// Second independent i18n audit (S16e) — typography codepoint evidence.
// Read-only: reports the actual code points around punctuation in the drafts.
import { readFileSync } from "node:fs";

const DRAFT_ROOT = "/Users/damian/.local-operator/sessions/3ef6295a5545/scratchpad/s16e";
const LOCALES = ["fr", "es", "ru", "vi", "zh-CN", "hi", "ur"];
const NAME = {
  0x20: "SP", 0x202f: "NNBSP(U+202F)", 0x00a0: "NBSP(U+00A0)", 0x2019: "RSQUO",
  0x27: "APOS", 0x3b: "SEMI", 0x3a: "COLON", 0x21: "BANG", 0x3f: "QUEST",
  0x2014: "EMDASH", 0x061b: "ARABIC-SEMI", 0x061f: "ARABIC-QUEST", 0x06d4: "URDU-FULLSTOP",
  0x0964: "DANDA", 0x3002: "IDEO-FULLSTOP", 0x3001: "IDEO-COMMA", 0xff0c: "FULLWIDTH-COMMA",
  0xff1b: "FULLWIDTH-SEMI", 0x200e: "LRM", 0x200f: "RLM", 0x2066: "FSI", 0x2069: "PDI",
  0x202a: "LRE", 0x202b: "RLE", 0x202c: "PDF", 0x200b: "ZWSP",
};
const label = (cp) => NAME[cp] || (cp < 0x80 ? String.fromCharCode(cp) : "U+" + cp.toString(16).toUpperCase().padStart(4, "0"));

let fails = 0;
const bad = (s) => { fails++; console.log("FAIL " + s); };

for (const loc of LOCALES) {
  const d = JSON.parse(readFileSync(`${DRAFT_ROOT}/${loc}/draft-${loc}-s16e.json`, "utf8"));
  console.log(`\n## ${loc}`);
  for (const [key, v] of Object.entries(d)) {
    const short = key.slice("ui.chat.canonical.image_gen.".length);
    const cps = [...v].map((c) => c.codePointAt(0));
    // punctuation adjacency report
    const notes = [];
    cps.forEach((cp, i) => {
      if ([0x3b, 0x3a, 0x21, 0x3f, 0x2014, 0x061b, 0x061f].includes(cp)) {
        const prev = cps[i - 1], next = cps[i + 1];
        notes.push(`${label(cp)}:prev=${label(prev)} next=${label(next)}`);
      }
    });
    const unusual = cps.filter((cp) => [0x202f, 0x00a0, 0x200e, 0x200f, 0x2066, 0x2067, 0x2069, 0x202a, 0x202b, 0x202c, 0x200b, 0x27, 0x0964, 0x0660, 0x0661].includes(cp));
    const uniq = [...new Set(unusual.map(label))];
    console.log(`  ${short}\n    punct: ${notes.join(" | ") || "none"}\n    marks: ${uniq.join(",") || "none"}`);

    if (loc === "fr") {
      // fr guide: U+202F before : ; ! ?  ·  apostrophe U+2019  ·  no U+00A0
      if (cps.includes(0x00a0)) bad(`fr ${short}: U+00A0 present (guide pins U+202F)`);
      if (cps.includes(0x27)) bad(`fr ${short}: ASCII apostrophe (guide: U+2019)`);
      cps.forEach((cp, i) => {
        if ([0x3b, 0x3a, 0x21, 0x3f].includes(cp)) {
          if (cps[i - 1] !== 0x202f) bad(`fr ${short}: '${String.fromCharCode(cp)}' not preceded by U+202F (found ${label(cps[i - 1])})`);
        }
        if (cp === 0x2014) {
          if (cps[i - 1] !== 0x20 || cps[i + 1] !== 0x20) bad(`fr ${short}: em dash not space-padded`);
        }
      });
    }
    if (loc === "ur") {
      if (cps.includes(0x061b) === false && v.includes(";")) bad(`ur ${short}: ASCII ';' used (guide: ، ؛ ۔)`);
      if (cps.includes(0x200e) || cps.includes(0x200f) || cps.includes(0x2066) || cps.includes(0x2069) || cps.includes(0x202a) || cps.includes(0x202b) || cps.includes(0x202c))
        bad(`ur ${short}: manual bidi control character (guide forbids)`);
      // Label keys carry no full stop by contract, so only sentence keys are
      // required to end in Urdu punctuation.
      const isLabel = short.startsWith("error_class.") || v.includes("{material, select");
      if (!isLabel && v.trim() !== "" && !/[\u06D4\u061B]$/.test(v.trim()))
        bad(`ur ${short}: sentence value does not end in Urdu punctuation`);
    }
    if (loc === "zh-CN") {
      const cjk = /[\u4E00-\u9FFF]/;
      if (/[\u4E00-\u9FFF][,;:!?]/.test(v)) bad(`zh-CN ${short}: half-width punctuation after Chinese`);
      if (/\.[\u4E00-\u9FFF]|[\u4E00-\u9FFF]\./.test(v)) bad(`zh-CN ${short}: ASCII full stop next to Chinese`);
      if (cjk.test(v) && /\.\.\./.test(v)) bad(`zh-CN ${short}: ASCII ellipsis`);
    }
  }
}
console.log(`\nRESULT ${fails === 0 ? "typography-pass" : "typography-fail"} failures=${fails}`);
process.exitCode = fails ? 1 : 0;
