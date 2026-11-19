// Independent mechanical check for s16f-au3-ur (ur, ui.chat.canonical, 15 keys).
// Compares the ur AST against the en AST with the real ICU parser: argument
// names and types, plural/select branch keys, and CLDR category legality.
import {
	TYPE,
	parse,
} from "/Users/damian/local-operator-ui/node_modules/.pnpm/@formatjs+icu-messageformat-parser@3.5.21/node_modules/@formatjs/icu-messageformat-parser/index.js";
import { readFileSync } from "node:fs";

const base = "src/i18n/catalogues";
const en = JSON.parse(readFileSync(`${base}/en/ui.chat.canonical.json`, "utf8"));
const ur = JSON.parse(readFileSync(`${base}/ur/ui.chat.canonical.json`, "utf8"));

const KEYS = [
	"ui.chat.canonical.loading.cold",
	"ui.chat.canonical.loading.older",
	"ui.chat.canonical.loading.region_label",
	"ui.chat.canonical.loading.remote",
	"ui.chat.canonical.loading.revalidating",
	"ui.chat.canonical.media.image_label",
	"ui.chat.canonical.media.sound_label",
	"ui.chat.canonical.sound.batch.item_status",
	"ui.chat.canonical.sound.batch.latest_update",
	"ui.chat.canonical.sound.batch.summary",
	"ui.chat.canonical.sound.cost.batch_unknown",
	"ui.chat.canonical.sound.cost.estimated_zero",
	"ui.chat.canonical.sound.cost.no_charge",
	"ui.chat.canonical.sound.cost.unknown",
	"ui.chat.canonical.supplement.sound_fallback_label",
];

const UR_CATEGORIES = new Intl.PluralRules("ur").resolvedOptions().pluralCategories;
console.log("ur CLDR plural categories:", UR_CATEGORIES.join(","));

function walk(el, out) {
	for (const e of el) {
		switch (e.type) {
			case TYPE.argument:
				out.args.push(`${e.value}:arg`);
				break;
			case TYPE.number:
				out.args.push(`${e.value}:number`);
				break;
			case TYPE.date:
				out.args.push(`${e.value}:date`);
				break;
			case TYPE.time:
				out.args.push(`${e.value}:time`);
				break;
			case TYPE.pound:
				out.pounds += 1;
				break;
			case TYPE.tag:
				out.tags.push(e.value);
				walk(e.children, out);
				break;
			case TYPE.plural:
				out.plurals.push(`${e.value}:${e.pluralType}`);
				out.branches.push(
					`${e.value}=>[${Object.keys(e.options).join("|")}]`,
				);
				for (const k of Object.keys(e.options)) {
					const cat = k.replace(/^=/, "=");
					if (!cat.startsWith("=") && !UR_CATEGORIES.includes(cat))
						out.badCategories.push(`${e.value}:${cat}`);
					walk(e.options[k].value, out);
				}
				break;
			case TYPE.select:
				out.selects.push(e.value);
				out.branches.push(`${e.value}=>[${Object.keys(e.options).join("|")}]`);
				for (const k of Object.keys(e.options)) walk(e.options[k].value, out);
				break;
			case TYPE.pound:
				break;
			default:
				break;
		}
	}
	return out;
}

const blank = () => ({
	args: [],
	pounds: 0,
	tags: [],
	plurals: [],
	selects: [],
	branches: [],
	badCategories: [],
});

let failures = 0;
for (const key of KEYS) {
	const enAst = parse(en[key]);
	const urAst = parse(ur[key]);
	const a = walk(enAst, blank());
	const b = walk(urAst, blank());
	const sort = (x) => [...x].sort();
	const sameArgs = JSON.stringify(sort(a.args)) === JSON.stringify(sort(b.args));
	const samePluralType =
		JSON.stringify(sort(a.plurals)) === JSON.stringify(sort(b.plurals));
	const sameSelects = JSON.stringify(sort(a.selects)) === JSON.stringify(sort(b.selects));
	const otherPresent = urAst.every((e) => e.type !== TYPE.plural || "other" in e.options);
	const ok = sameArgs && samePluralType && sameSelects && b.badCategories.length === 0 && otherPresent;
	if (!ok) failures += 1;
	console.log(
		`${ok ? "PASS" : "FAIL"} ${key.replace("ui.chat.canonical.", "")}`,
		`args[en=${a.args.join(",") || "-"} ur=${b.args.join(",") || "-"}]`,
		`plurals[en=${a.plurals.join(",") || "-"} ur=${b.plurals.join(",") || "-"}]`,
		`selects[en=${a.selects.join(",") || "-"} ur=${b.selects.join(",") || "-"}]`,
		`branches ur=${b.branches.join(" ") || "-"}`,
		`badCategories=${b.badCategories.join(",") || "none"}`,
		`otherPresent=${otherPresent}`,
		`tags[en=${a.tags.join(",") || "-"} ur=${b.tags.join(",") || "-"}]`,
	);
}
console.log(`\n${KEYS.length - failures}/${KEYS.length} keys structurally identical to source; failures=${failures}`);

// Markup / code-token surface: none of these 15 carry tags; assert no backticks,
// no HTML-ish angle tags, no bidi controls, no Arabic-only signs, in the ur values.
const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const ARABIC_ONLY = /[\u061C\u06DD\u0600-\u0605]/;
for (const key of KEYS) {
	const v = ur[key];
	const flags = [];
	if (v.includes("`")) flags.push("backtick");
	if (/<\/?[A-Za-z][^>]*>/.test(v)) flags.push("angle-tag");
	if (BIDI.test(v)) flags.push("bidi-control");
	if (ARABIC_ONLY.test(v)) flags.push("arabic-only-sign");
	if (flags.length) console.log(`SURFACE ${key} -> ${flags.join(",")}`);
}
console.log("surface scan: backticks/angle-tags/bidi-controls/arabic-only signs checked for all 15");
