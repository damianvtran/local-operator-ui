#!/usr/bin/env node
/**
 * Auditor's own mechanical grid for the hi delta audit (S16f / PR #1876, round 4).
 *
 * WHY THIS EXISTS. The repo validator (scripts/i18n/locale-parity.test.mjs) already
 * asserts placeholder integrity across the whole file. An auditor must not merely
 * echo a green suite, so this script re-derives the same properties for the keys in
 * this audit's scope with the REAL ICU parser (@formatjs/icu-messageformat-parser —
 * the one the validator itself uses) and prints the two ASTs side by side, so the
 * evidence shows a comparison rather than a claim about one. It additionally
 * reports every plural/select branch keyword per selector, which is what the locale's
 * required CLDR categories are checked against.
 *
 * Scope of keys: the 3 keys cbb8782a changed (hi) plus every other key in the
 * namespace whose value carries the same noun (ध्वनि) or the kept-loan compound
 * (साउंड इफ़ेक्ट) — the noun-consistency judgement the round-4 brief asks for.
 *
 * Read-only. Usage: node check-hi-s16f-au4.mjs <repo-root>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TYPE, parse } from "@formatjs/icu-messageformat-parser";

const root = process.argv[2] ?? process.cwd();
const NS = "ui.chat.canonical";
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const en = read(`src/i18n/catalogues/en/${NS}.json`);
const hi = read(`src/i18n/catalogues/hi/${NS}.json`);
const ctx = read(`src/i18n/catalogues/en/${NS}.context.json`);

const CHANGED = [
	"ui.chat.canonical.media.sound_label",
	"ui.chat.canonical.sound.player_failed",
	"ui.chat.canonical.supplement.sound_fallback_label",
];
const NOUN_SIBLINGS = Object.keys(hi)
	.filter((k) => hi[k].includes("ध्वनि") || hi[k].includes("साउंड"))
	.sort();
const KEYS = [...new Set([...CHANGED, ...NOUN_SIBLINGS])].sort();

/** Walk an ICU AST: argument name -> kind, and selector -> branch keywords. */
function walk(elements, acc = { args: new Map(), selectors: [] }) {
	for (const el of elements) {
		switch (el.type) {
			case TYPE.argument:
			case TYPE.number:
			case TYPE.date:
			case TYPE.time:
				acc.args.set(el.value, `${el.type}${el.style ? `:${JSON.stringify(el.style).slice(0, 24)}` : ""}`);
				break;
			case TYPE.pound:
				break;
			case TYPE.select:
			case TYPE.plural:
				acc.args.set(el.value, el.type);
				acc.selectors.push({ selector: el.value, type: el.type, keywords: Object.keys(el.options) });
				for (const opt of Object.values(el.options)) walk(opt.value, acc);
				break;
			case TYPE.tag:
				if (el.children) walk(el.children, acc);
				break;
			default:
				break;
		}
	}
	return acc;
}

const shape = (m) => {
	const a = walk(parse(m));
	const args = [...a.args].map(([n, t]) => `${n}:${t}`).sort().join(" ");
	const sel = a.selectors.map((s) => `${s.selector}[${s.keywords.join("|")}]`).sort().join(" ");
	return { args, sel };
};

let fails = 0;
const row = (label, ok, detail) => {
	if (!ok) fails++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const hiRules = new Intl.PluralRules("hi");
const enRules = new Intl.PluralRules("en");
const cats = (r) => r.resolvedOptions().pluralCategories.join("/");
console.log(`namespace ${NS}`);
console.log(
	`en keys ${Object.keys(en).length} · hi keys ${Object.keys(hi).length} · symmetric difference ${[...Object.keys(en).filter((k) => !(k in hi)), ...Object.keys(hi).filter((k) => !(k in en))].length}`,
);
console.log(`CLDR plural categories — hi ${cats(hiRules)} · en ${cats(enRules)}`);
console.log(`keys under audit (3 changed + same-noun siblings): ${KEYS.length}\n`);

for (const k of KEYS) {
	const e = en[k];
	const t = hi[k];
	let es;
	let hs;
	try {
		es = shape(e);
		hs = shape(t);
	} catch (err) {
		row(`${k} parses as ICU`, false, String(err.message));
		continue;
	}
	console.log(k);
	console.log(`  en: ${e}`);
	console.log(`  hi: ${t}`);
	console.log(`  args en=[${es.args}] hi=[${hs.args}]`);
	console.log(`  selectors en=[${es.sel}] hi=[${hs.sel}]`);
	row(`  ${k} placeholder names+types identical`, es.args === hs.args, es.args === hs.args ? "" : `${es.args} != ${hs.args}`);
	row(`  ${k} plural/select structure identical`, es.sel === hs.sel, es.sel === hs.sel ? "" : `${es.sel} != ${hs.sel}`);
	// Every plural the target renders must offer the locale's `other` fallback.
	const plurals = [...t.matchAll(/\{\s*\w+\s*,\s*plural/gi)];
	const otherOk = plurals.every((_, i) => new RegExp(`other\\s*\\{`).test(t));
	row(`  ${k} every plural carries 'other' (mandatory CLDR fallback)`, plurals.length === 0 || otherOk);
	if (plurals.length) {
		for (const sel of hs.sel.split(" ")) console.log(`  branch keywords hi: ${sel}`);
	}
	console.log(`  context role: ${ctx[k]?.role ?? "(none)"}\n`);
}

// ---- corpus evidence for the noun decision ---------------------------------
const scan = (needle) => {
	const hits = [];
	for (const ns of ["ui.settings.notifications", "ui.canvas", "ui.chat.canonical"]) {
		const m = read(`src/i18n/catalogues/hi/${ns}.json`);
		const values = Object.values(m).filter((v) => v.includes(needle)).length;
		const keys = Object.keys(m).filter((key) => m[key].includes(needle)).length;
		if (values) hits.push(`${ns}: ${values} key(s)`);
	}
	return hits.join(" · ");
};
console.log(`noun census (hi catalogue)`);
console.log(`  ध्वनि → ${scan("ध्वनि")}`);
console.log(`  साउंड → ${scan("साउंड") || "(none)"}`);
console.log(`  ऑडियो → ${scan("ऑडियो")}`);

// Compose the label the way the audio player's callsite does (ui.chat.json).
const chat = read("src/i18n/catalogues/hi/ui.chat.json");
const label = hi["ui.chat.canonical.media.sound_label"].match(/=1 \{([^}]+)\}/)[1];
console.log(`\ncomposed accessible names with label='${label}'`);
for (const k of ["ui.chat.audio.play_label", "ui.chat.audio.pause_label", "ui.chat.audio.position_label"]) {
	console.log(`  ${k} -> ${chat[k].replace("{label}", label)}`);
}

console.log(`\n${fails === 0 ? "ALL CHECKS PASS" : `${fails} CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
