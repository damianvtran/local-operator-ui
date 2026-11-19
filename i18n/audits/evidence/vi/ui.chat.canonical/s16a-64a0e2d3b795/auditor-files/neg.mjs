/*
 * Independent vi audit (s16a v3) — mechanical layer.
 * READ-ONLY on the repo. Parses the DRAFT against the ENGLISH source with the
 * repo's own ICU parser + intl-messageformat from the worktree node_modules.
 * Writes nothing into the repo.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const WT_EARLY = "/Users/damian/local-operator-ui/.worktrees/i18n-s16a";
const req = createRequire(WT_EARLY + "/package.json");
const { parse } = req("@formatjs/icu-messageformat-parser");
const { IntlMessageFormat } = req("intl-messageformat");

const WT = "/Users/damian/local-operator-ui/.worktrees/i18n-s16a";
const DRAFT = "/Users/damian/.local-operator/sessions/64a0e2d3b795/scratchpad/vi-s16a-v3-audit/neg.json";

const en = JSON.parse(readFileSync(`${WT}/src/i18n/catalogues/en/ui.chat.canonical.json`, "utf8"));
const vi = JSON.parse(readFileSync(DRAFT, "utf8"));

const NEW = [
	"ui.chat.canonical.tool.composing_sized",
	"ui.chat.canonical.tool.composing_empty",
	"ui.chat.canonical.tool.queued_sized",
	"ui.chat.canonical.tool.queued_empty",
	"ui.chat.canonical.image_gen.state.queued",
	"ui.chat.canonical.image_gen.state.writing_request",
	"ui.chat.canonical.image_gen.state.queue_ahead",
	"ui.chat.canonical.image_gen.state.running",
	"ui.chat.canonical.image_gen.state.running_batch",
	"ui.chat.canonical.image_gen.state.done",
	"ui.chat.canonical.image_gen.state.done_batch",
	"ui.chat.canonical.image_gen.state.already_finished",
	"ui.chat.canonical.image_gen.state.failed",
	"ui.chat.canonical.image_gen.state.failed_batch",
];

const problems = [];
const notes = [];

/* ---------- 1. key set ---------- */
const draftKeys = Object.keys(vi);
const missing = NEW.filter((k) => !(k in vi));
const extra = draftKeys.filter((k) => !NEW.includes(k));
if (missing.length) problems.push(`MISSING KEYS: ${missing.join(", ")}`);
if (extra.length) problems.push(`EXTRA KEYS: ${extra.join(", ")}`);
if (draftKeys.length !== NEW.length) problems.push(`key count ${draftKeys.length} != ${NEW.length}`);

/* ---------- 2. AST walk: argument names/types, plural categories ---------- */
function walk(ast, out) {
	for (const el of ast) {
		if (el.type === 1) {
			out.args.set(el.value, "arg");
		} else if (el.type === 2) {
			out.args.set(el.value, "number");
		} else if (el.type === 3) {
			out.args.set(el.value, "date");
		} else if (el.type === 4) {
			out.args.set(el.value, "time");
		} else if (el.type === 5) {
			out.args.set(el.value, "select");
			for (const [k, v] of Object.entries(el.options)) walk(v.value, out);
		} else if (el.type === 6) {
			out.args.set(el.value, "plural");
			out.plurals.set(el.value, Object.keys(el.options));
			for (const [k, v] of Object.entries(el.options)) walk(v.value, out);
			// # inside a plural must belong to that plural
			const hasPound = JSON.stringify(el.options).includes('"type":8');
			out.pounds.set(el.value, hasPound);
		} else if (el.type === 8) {
			out.poundsSeen.push(el.value);
		}
	}
	return out;
}

const viPluralCats = new Intl.PluralRules("vi").resolvedOptions().pluralCategories;
const enPluralCats = new Intl.PluralRules("en").resolvedOptions().pluralCategories;
notes.push(`CLDR plural categories: en=${JSON.stringify(enPluralCats)} vi=${JSON.stringify(viPluralCats)}`);

for (const key of NEW) {
	const src = en[key];
	const tgt = vi[key];
	if (typeof tgt !== "string") {
		problems.push(`${key}: not a string`);
		continue;
	}
	let aAst, bAst;
	try {
		aAst = parse(src, { ignoreTag: false });
	} catch (e) {
		problems.push(`${key}: EN parse error ${e.message}`);
		continue;
	}
	try {
		bAst = parse(tgt, { ignoreTag: false });
	} catch (e) {
		problems.push(`${key}: VI PARSE ERROR ${e.message}`);
		continue;
	}
	const a = walk(aAst, { args: new Map(), plurals: new Map(), pounds: new Map(), poundsSeen: [] });
	const b = walk(bAst, { args: new Map(), plurals: new Map(), pounds: new Map(), poundsSeen: [] });

	// argument set + type
	const aKeys = [...a.args.keys()].sort();
	const bKeys = [...b.args.keys()].sort();
	if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) {
		problems.push(`${key}: argument set differs en=${JSON.stringify(aKeys)} vi=${JSON.stringify(bKeys)}`);
	}
	for (const k of aKeys) {
		if (b.args.has(k) && a.args.get(k) !== b.args.get(k)) {
			problems.push(`${key}: argument '${k}' type en=${a.args.get(k)} vi=${b.args.get(k)}`);
		}
	}
	// plural categories must be legal for vi and cover what vi needs
	for (const [arg, cats] of b.plurals) {
		const illegal = cats.filter((c) => c !== "zero" && c !== "one" && c !== "two" && c !== "few" && c !== "many" && c !== "other");
		if (illegal.length) problems.push(`${key}: illegal plural category ${illegal.join(",")}`);
		const needed = viPluralCats.filter((c) => !cats.includes(c));
		if (needed.length) problems.push(`${key}: vi plural '${arg}' missing CLDR categories ${needed.join(",")}`);
	}
	// select branches must match exactly (material)
	for (let i = 0; i < aAst.length; i++) {
		const ae = aAst[i];
		const be = bAst[i];
		if (ae?.type === 5 && be?.type === 5) {
			const ak = Object.keys(ae.options).sort();
			const bk = Object.keys(be.options).sort();
			if (JSON.stringify(ak) !== JSON.stringify(bk)) {
				problems.push(`${key}: select branches differ en=${ak} vi=${bk}`);
			}
		}
	}
	// literal protection: middle dot, ellipsis, trailing punctuation
	if (src.includes("·") !== tgt.includes("·")) problems.push(`${key}: middle dot mismatch`);
	if ((src.match(/·/g) || []).length !== (tgt.match(/·/g) || []).length) {
		problems.push(`${key}: middle dot count ${(src.match(/·/g) || []).length} vs ${(tgt.match(/·/g) || []).length}`);
	}
	if (src.includes("…") !== tgt.includes("…")) problems.push(`${key}: ellipsis U+2026 mismatch`);
	const srcDot = /\.$/.test(src.trim());
	const tgtDot = /\.$/.test(tgt.trim());
	if (srcDot !== tgtDot) problems.push(`${key}: trailing full stop en=${srcDot} vi=${tgtDot}`);
	if (src.trim() !== src) problems.push(`${key}: EN has outer whitespace`);
	if (tgt.trim() !== tgt) problems.push(`${key}: VI has outer whitespace`);
	if (/ {2,}/.test(tgt)) problems.push(`${key}: VI double space`);
	if (!tgt.trim()) problems.push(`${key}: VI empty`);
	if (tgt === src) problems.push(`${key}: VI identical to EN (untranslated)`);
}

/* ---------- 3. real formatting ---------- */
const COUNTS = [0, 1, 2, 3, 5, 11, 21, 22, 100, 1000000];
const MATERIALS = ["image", "video", "voiceover", "sound_effect"];
const fmt = [];
function render(key, values, locale) {
	try {
		const mf = new IntlMessageFormat(vi[key], locale);
		return mf.format(values);
	} catch (e) {
		problems.push(`${key}: FORMAT ERROR (${locale}) ${e.message}`);
		return "<<error>>";
	}
}
for (const c of COUNTS) {
	const v = render("ui.chat.canonical.image_gen.state.queue_ahead", { count: c }, "vi");
	fmt.push(`queue_ahead count=${c} -> ${JSON.stringify(v)}`);
	if (c === 1000000 && v.includes(".")) problems.push(`queue_ahead 1000000 must not group: ${v}`);
}
for (const m of MATERIALS) {
	fmt.push(`running ${m} -> ${JSON.stringify(render("ui.chat.canonical.image_gen.state.running", { material: m }, "vi"))}`);
	fmt.push(`done ${m} -> ${JSON.stringify(render("ui.chat.canonical.image_gen.state.done", { material: m }, "vi"))}`);
	fmt.push(`done_batch ${m} -> ${JSON.stringify(render("ui.chat.canonical.image_gen.state.done_batch", { material: m }, "vi"))}`);
	fmt.push(`failed ${m} -> ${JSON.stringify(render("ui.chat.canonical.image_gen.state.failed", { material: m }, "vi"))}`);
	fmt.push(`failed_batch ${m} -> ${JSON.stringify(render("ui.chat.canonical.image_gen.state.failed_batch", { material: m }, "vi"))}`);
	for (const c of COUNTS) {
		fmt.push(`running_batch ${m} total=${c} -> ${JSON.stringify(render("ui.chat.canonical.image_gen.state.running_batch", { material: m, total: c }, "vi"))}`);
	}
}
fmt.push(`composing_sized -> ${JSON.stringify(render("ui.chat.canonical.tool.composing_sized", { size: "12.4 KB" }, "vi"))}`);
fmt.push(`queued_sized -> ${JSON.stringify(render("ui.chat.canonical.tool.queued_sized", { size: "12.4 KB" }, "vi"))}`);
for (const k of ["ui.chat.canonical.tool.composing_empty", "ui.chat.canonical.tool.queued_empty", "ui.chat.canonical.image_gen.state.queued", "ui.chat.canonical.image_gen.state.writing_request", "ui.chat.canonical.image_gen.state.already_finished"]) {
	fmt.push(`${k} -> ${JSON.stringify(render(k, {}, "vi"))}`);
}

/* ---------- 4. EN control: same formatter, same inputs ---------- */
const enFmt = [];
const enMf = new IntlMessageFormat(en["ui.chat.canonical.image_gen.state.queue_ahead"], "en");
enFmt.push(`EN queue_ahead 3 -> ${JSON.stringify(enMf.format({ count: 3 }))}`);

/* ---------- 5. width ---------- */
const width = [];
for (const k of NEW) {
	width.push(`${k}: en=${en[k].length} vi=${vi[k].length}`);
}

console.log("=== PROBLEMS ===");
console.log(problems.length ? problems.join("\n") : "none");
console.log("\n=== NOTES ===");
console.log(notes.join("\n"));
console.log("\n=== FORMATTED (vi) ===");
console.log(fmt.join("\n"));
console.log("\n=== EN CONTROL ===");
console.log(enFmt.join("\n"));
console.log("\n=== RAW LENGTHS (chars) ===");
console.log(width.join("\n"));
