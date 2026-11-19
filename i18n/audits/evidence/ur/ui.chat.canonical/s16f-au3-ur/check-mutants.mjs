// Negative control for s16f-au3-ur: proves the structural checks in
// check-icu.mjs can FAIL. Each mutant is the real ur value with one defect
// injected; the same comparison (argument names/types, plural arms, select
// branches, CLDR categories, banned punctuation) must flag every one.
import {
	TYPE,
	parse,
} from "/Users/damian/local-operator-ui/node_modules/.pnpm/@formatjs+icu-messageformat-parser@3.5.21/node_modules/@formatjs/icu-messageformat-parser/index.js";
import { readFileSync } from "node:fs";

const base = "src/i18n/catalogues";
const en = JSON.parse(readFileSync(`${base}/en/ui.chat.canonical.json`, "utf8"));
const ur = JSON.parse(readFileSync(`${base}/ur/ui.chat.canonical.json`, "utf8"));
const UR_CATEGORIES = new Intl.PluralRules("ur").resolvedOptions().pluralCategories;
const BANNED = /[\u200E\u200F\u202A-\u202E\u2066-\u2069\u0964]/;

function signature(text) {
	const args = [];
	const branches = [];
	const bad = [];
	const walk = (els) => {
		for (const e of els) {
			if (e.type === TYPE.argument) args.push(`${e.value}:arg`);
			else if (e.type === TYPE.number) args.push(`${e.value}:number`);
			else if (e.type === TYPE.date) args.push(`${e.value}:date`);
			else if (e.type === TYPE.time) args.push(`${e.value}:time`);
			else if (e.type === TYPE.plural) {
				branches.push(`${e.value}:[${Object.keys(e.options).join("|")}]`);
				for (const [k, v] of Object.entries(e.options)) {
					if (!k.startsWith("=") && !UR_CATEGORIES.includes(k)) bad.push(k);
					walk(v.value);
				}
			} else if (e.type === TYPE.select) {
				branches.push(`${e.value}:[${Object.keys(e.options).join("|")}]`);
				for (const v of Object.values(e.options)) walk(v.value);
			} else if (e.type === TYPE.tag) walk(e.children);
		}
	};
	try {
		walk(parse(text));
	} catch (error) {
		return { args: "THROW", branches: "THROW", bad: "THROW", threw: String(error.name) };
	}
	return { args: [...args].sort().join(","), branches: [...branches].sort().join(" "), bad: bad.join(",") };
}

const MUTANTS = [
	["latest_update: dropped {total}", "ui.chat.canonical.sound.batch.latest_update", (v) => v.replace(/\{total, number, ::group-off\}/, "")],
	["summary: dropped has_attention other arm", "ui.chat.canonical.sound.batch.summary", (v) => v.replace(/(\{has_attention, select,[\s\S]*?) other \{\}\}$/, "$1}")],
	["summary: plural arm renamed to `few` (not an ur CLDR category)", "ui.chat.canonical.sound.batch.summary", (v) => v.replace("one {", "few {")],
	["item_status: dropped cancelled branch", "ui.chat.canonical.sound.batch.item_status", (v) => v.replace(/cancelled \{[^}]*\} /, "")],
	["media.image_label: {count} renamed to {n}", "ui.chat.canonical.media.image_label", (v) => v.replace("count, plural", "n, plural")],
	["estimated_zero: Hindi danda injected", "ui.chat.canonical.sound.cost.estimated_zero", (v) => v.replace("۔", "।")],
	["no_charge: manual RLM injected", "ui.chat.canonical.sound.cost.no_charge", (v) => v + "\u200F"],
];

let flagged = 0;
for (const [label, key, mutate] of MUTANTS) {
	const mutated = mutate(ur[key]);
	const a = signature(en[key]);
	const b = signature(mutated);
	const structural =
		b.threw !== undefined || a.args !== b.args || a.branches !== b.branches || b.bad !== "";
	const punctuation = BANNED.test(mutated);
	const ok = structural || punctuation;
	if (ok) flagged += 1;
	console.log(
		`${ok ? "FLAGGED" : "MISSED "} ${label} -> structural=${structural} punctuation=${punctuation}`,
	);
}
console.log(`\nnegative control: ${flagged}/${MUTANTS.length} mutants flagged`);

// And the unmutated values must NOT be flagged (control the other way).
let clean = 0;
const KEYS = Object.keys(en).filter((k) =>
	[
		"ui.chat.canonical.loading.",
		"ui.chat.canonical.media.",
		"ui.chat.canonical.sound.batch.",
		"ui.chat.canonical.sound.cost.",
		"ui.chat.canonical.supplement.sound_fallback_label",
	].some((p) => k.startsWith(p)),
);
for (const key of KEYS) {
	if (!(key in ur)) continue;
	const a = signature(en[key]);
	const b = signature(ur[key]);
	if (a.args === b.args && a.branches === b.branches && b.bad === "" && !BANNED.test(ur[key]))
		clean += 1;
}
console.log(`unmutated scope keys passing the same rules: ${clean}/${KEYS.length}`);
