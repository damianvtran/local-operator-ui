import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TYPE, parse } from "@formatjs/icu-messageformat-parser";
import { build } from "esbuild";

/*
 * RUNTIME BIDI ISOLATION FOR RTL CATALOGUES, THE LIST JOINER, AND THE RAW-RUNG
 * SENTENCES (PR #1761, operator request: "ur must render RTL correctly" and
 * "switching to fr must leave NO English anywhere ... for every supported
 * language").
 *
 * The Urdu translation audits (receipts `*-s3a-ur-*`, `*-s3b-ur-*`) measured, with
 * `fribidi --rtl`, that a literal `/` or `$` after Urdu text paints on the wrong
 * side of the Latin word (`/model` -> `model/`) and that value-fed Latin tokens
 * (`/move <path>`, `⌘Z`) mirror. The ur catalogue may not carry the controls
 * (`ur-activation.test.mjs`), so `translate()` adds them at runtime for a message
 * an RTL catalogue answered (`src/i18n/bidi.ts`). Every assertion below is an
 * EXACT code-point comparison, not a "contains a mark" check, so a different
 * wrapper (or none: the old behaviour, which `translateRaw` still is) fails.
 *
 * NEGATIVE CONTROLS. `translateRaw` is the old `translate`; each positive is
 * paired with the raw output being UNMARKED, which is the defect, and with the
 * LTR locales and the English-fallback path being unmarked, which is the
 * "nothing else moved" half.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

const bundle = await build({
	stdin: {
		contents: [
			'export * as messages from "./src/i18n/messages";',
			'export * as locale from "./src/i18n/locale";',
			'export * as format from "./src/i18n/format";',
			'export * as bidi from "./src/i18n/bidi";',
			'export * as keys from "./src/i18n/keys.gen";',
			'export * as sessionModel from "./src/renderer/src/features/chat/session-status/session-model";',
			'export * as draftSelection from "./src/renderer/src/features/chat/draft-selection";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
});
const { messages, locale, format, bidi, keys, sessionModel, draftSelection } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

const FSI = "\u2068";
const LRI = "\u2066";
const PDI = "\u2069";
const CONTROLS = /[\u200e\u200f\u2066-\u2069]/g;
const strip = (value) => value.replace(CONTROLS, "");

const manifest = JSON.parse(
	readFileSync(join(ROOT, "i18n/languages.json"), "utf8"),
);
const RTL = manifest.languages
	.filter((l) => l.dir === "rtl")
	.map((l) => l.code);
const LTR = manifest.languages
	.filter((l) => l.dir !== "rtl")
	.map((l) => l.code);

/*
 * Fixtures are registered under a synthetic tag-free key set so they do not
 * depend on the ur files other sessions are still writing: the strings are the
 * audited ur values (receipts UR-1, UR-1b, UR-2, B1-1, B1-3, B1-4, B1-5)
 * verbatim. `registerCatalogue("ur", ...)` is the served-catalogue seam the
 * runtime already supports, so these take the same path as a bundled value.
 */
const UR = {
	"fx.could_not_run": "/{name} نہیں چل سکی: {reason}",
	"fx.move_hint": "وہاں جانے کے لیے {example} لکھیں۔",
	"fx.stop": "اسے /stop ہی ختم کرتا ہے۔",
	"fx.btw": "پھر /btw سے نئی ضمنی گفتگو شروع کریں۔",
	"fx.rail_open":
		"سوالات کھولیں{hasCap, select, yes { ({cap})} other {}} — {subject}",
	"fx.opens_with_dollar": "$name کی قدر درج کریں۔",
	"fx.after_latin": "Enter /goal چلاتا ہے۔",
	"fx.url": "دیکھیں https://example.com/a اور TCP/IP۔",
	"fx.url_deep": "دیکھیں https://mcp.example.com/mcp/server اور TCP/IP۔",
	// The shipped ur value of the insert-image dialog's example path, verbatim.
	"fx.path_literal": "/Users/eren/Documents/image.png",
	"fx.path_mid": "فائل /Users/eren/a.txt کھولیں۔",
	"fx.at_scope": "@scope/pkg نصب کریں۔",
	"fx.count": "{count, plural, one {# کام} other {# کام}} /stop",
	"fx.plain": "یہ ماڈل {levels} پیش کرتا ہے۔",
};
messages.registerCatalogue("ur", UR);
// The same keys in an LTR locale, so one fixture exercises both directions.
const EN_COPY = Object.fromEntries(
	Object.entries(UR).map(([key, value]) => [key, `Hello ${value}`]),
);
for (const code of LTR) messages.registerCatalogue(code, EN_COPY);

const raw = (key, params, tag) => messages.translateRaw(key, params, tag);
const run = (key, params, tag = "ur") => messages.translate(key, params, tag);

test("the manifest's rtl languages are exactly ur, and everything else is ltr", () => {
	assert.deepEqual(RTL, ["ur"]);
	assert.ok(LTR.includes("en") && LTR.includes("fr") && LTR.includes("zh-CN"));
});

test("a literal slash that opens the string or follows Urdu is isolated, byte for byte", () => {
	// Opens the string, argument is a Latin name: sigil + FSI value in one LRI run.
	assert.equal(
		run("fx.could_not_run", { name: "model", reason: "x" }),
		`${LRI}/${FSI}model${PDI}${PDI} نہیں چل سکی: ${FSI}x${PDI}`,
	);
	// Follows Urdu text.
	assert.equal(run("fx.stop", {}), `اسے ${LRI}/stop${PDI} ہی ختم کرتا ہے۔`);
	assert.equal(
		run("fx.btw", {}),
		`پھر ${LRI}/btw${PDI} سے نئی ضمنی گفتگو شروع کریں۔`,
	);
	// The dollar sigil, at the start of the string.
	assert.equal(
		run("fx.opens_with_dollar", {}),
		`${LRI}$name${PDI} کی قدر درج کریں۔`,
	);
	// Negative control: the old output (raw) has no controls at all - the defect.
	assert.equal(raw("fx.stop", {}, "ur"), "اسے /stop ہی ختم کرتا ہے۔");
	assert.doesNotMatch(
		raw("fx.could_not_run", { name: "model", reason: "x" }, "ur"),
		CONTROLS,
	);
});

test("value-fed Latin tokens are isolated with FSI/PDI, paths, commands and chords", () => {
	for (const example of [
		"/move <path>",
		"⌘Z",
		"~/src",
		"/effort <level>",
		"⌘+F",
	]) {
		assert.equal(
			run("fx.move_hint", { example }),
			`وہاں جانے کے لیے ${FSI}${example}${PDI} لکھیں۔`,
			example,
		);
	}
	// Raw (old) output: the token is bare, which is what painted `<move <path/`.
	assert.equal(
		raw("fx.move_hint", { example: "/move <path>" }, "ur"),
		"وہاں جانے کے لیے /move <path> لکھیں۔",
	);
});

test("only plain splices are wrapped: select selectors and plural counts keep their values", () => {
	// `hasCap` is a select SELECTOR: wrapping "yes" would fall through to `other`.
	assert.equal(
		run("fx.rail_open", { hasCap: "yes", cap: "⌘J", subject: "ABC" }),
		`سوالات کھولیں (${FSI}⌘J${PDI}) — ${FSI}ABC${PDI}`,
	);
	assert.equal(
		run("fx.rail_open", { hasCap: "no", cap: "⌘J", subject: "ABC" }),
		`سوالات کھولیں — ${FSI}ABC${PDI}`,
	);
	// A count stays a number; the literal after Urdu is still isolated.
	assert.equal(run("fx.count", { count: 2 }), `2 کام ${LRI}/stop${PDI}`);
	assert.equal(run("fx.count", { count: 1 }), `1 کام ${LRI}/stop${PDI}`);
	assert.deepEqual(
		[
			...bidi.plainArgumentNames(
				parse(
					"{a} {b, number} {c, select, x {{d}} other {}} {e, plural, other {#}}",
				),
			),
		].sort(),
		["a", "d"],
	);
});

test("values and text that must not be marked are left alone", () => {
	// Urdu value, a bare number, an empty string and an already-isolated value.
	assert.equal(
		run("fx.plain", { levels: "کم، زیادہ" }),
		"یہ ماڈل کم، زیادہ پیش کرتا ہے۔",
	);
	assert.equal(run("fx.plain", { levels: "12" }), "یہ ماڈل 12 پیش کرتا ہے۔");
	assert.equal(run("fx.plain", { levels: "" }), "یہ ماڈل  پیش کرتا ہے۔");
	const already = `${LRI}⌘R${PDI}`;
	assert.equal(
		run("fx.plain", { levels: already }),
		`یہ ماڈل ${already} پیش کرتا ہے۔`,
	);
	// A sigil after Latin text, a URL and TCP/IP already resolve left-to-right.
	assert.equal(run("fx.after_latin", {}), "Enter /goal چلاتا ہے۔");
	assert.equal(run("fx.url", {}), "دیکھیں https://example.com/a اور TCP/IP۔");
});

test("a multi-segment path or an @scope is ONE isolate, so RTL paints it in order", () => {
	/*
	 * THE DISCRIMINATING CASE (review round 1, M1). `LATIN_WORD` stopped at `/`,
	 * so a literal path became four adjacent LRI runs - `/Users`, `/eren`,
	 * `/Documents`, `/image.png` - and adjacent isolates in an RTL paragraph are
	 * ordered right-to-left, so the four segments painted
	 * `/image.png/Documents/eren/Users`. One isolate per token is the fix; the
	 * count of LRI runs is what tells the two apart, so assert the whole token
	 * sits inside a single run rather than merely that controls are present.
	 */
	assert.equal(
		run("fx.path_literal", {}),
		`${LRI}/Users/eren/Documents/image.png${PDI}`,
	);
	// After Urdu text, i.e. the mid-sentence case the editor's copy uses.
	assert.equal(
		run("fx.path_mid", {}),
		`فائل ${LRI}/Users/eren/a.txt${PDI} کھولیں۔`,
	);
	// An `@` sigil keeps the same treatment: one run over the whole scope name.
	assert.equal(run("fx.at_scope", {}), `${LRI}@scope/pkg${PDI} نصب کریں۔`);
	// The single-segment cases the earlier tests pin are unchanged by the wider
	// class: `/stop` and `$name` still take exactly one run each.
	assert.equal(run("fx.stop", {}), `اسے ${LRI}/stop${PDI} ہی ختم کرتا ہے۔`);
	assert.equal(
		run("fx.opens_with_dollar", {}),
		`${LRI}$name${PDI} کی قدر درج کریں۔`,
	);
	/*
	 * NEGATIVE CONTROL: a URL must stay untouched. Its scheme's `https` is a
	 * strong LTR character before the first `/`, so the `lastStrong !== "L"`
	 * gate skips it - including a deep path whose slashes the wider class would
	 * otherwise swallow.
	 */
	assert.equal(
		run("fx.url_deep", {}),
		"دیکھیں https://mcp.example.com/mcp/server اور TCP/IP۔",
	);
	assert.doesNotMatch(run("fx.url_deep", {}), CONTROLS);
});

test("LTR locales and the English fallback are byte-identical to the old output", () => {
	for (const code of LTR) {
		for (const [key, params] of [
			["fx.could_not_run", { name: "model", reason: "x" }],
			["fx.move_hint", { example: "/move <path>" }],
			["fx.stop", {}],
			["fx.rail_open", { hasCap: "yes", cap: "⌘J", subject: "ABC" }],
			["fx.count", { count: 3 }],
		]) {
			const out = run(key, params, code);
			assert.equal(out, raw(key, params, code), `${code} ${key}`);
			assert.doesNotMatch(out, CONTROLS, `${code} ${key}`);
		}
	}
	/*
	 * THE ENGLISH-SOURCE PATH IS UNMARKED. A message that no target catalogue
	 * answered — a per-key fallback, or a tag that resolves to no catalogue at
	 * all — is formatted AS ENGLISH, and English text is never bidi-marked, even
	 * when the UI tag asks for a right-to-left one.
	 *
	 * The probe used to be "a key the ur catalogue does not carry". The composer
	 * wave completes ur coverage, and `check-coverage` keeps it complete, so no
	 * bundled English key is missing from ur any more and that probe cannot be
	 * constructed — asserted below rather than left to rot, because a gap
	 * reappearing is exactly what the coverage gate must catch. The invariant is
	 * then pinned where it is still reachable: a real English message with a
	 * value-fed Latin token, rendered under the source locale and under a tag
	 * that has no catalogue (`zh-Hant` resolves to English).
	 */
	const english = keys.bundledEnglish;
	const englishOnly = Object.keys(english).filter(
		(key) => !(key in (keys.bundledCatalogues.ur ?? {})),
	);
	assert.deepEqual(
		englishOnly,
		[],
		"ur carries every English key; a gap here is an untranslated fallback",
	);
	const probe = "ui.chat.session_readout.effort.detail.not_reported";
	const probeParams = paramsFor(english[probe]);
	for (const tag of ["en", "zh-Hant"]) {
		const text = run(probe, probeParams, tag);
		assert.equal(text, raw(probe, probeParams, tag), tag);
		assert.doesNotMatch(text, CONTROLS, `${tag} ${probe}`);
	}
});

/** Parameters that exercise every argument the message names. */
function paramsFor(message) {
	const params = {};
	const walk = (elements) => {
		for (const element of elements) {
			if (element.type === TYPE.argument)
				params[element.value] ??= "/model <x>";
			else if (element.type === TYPE.number) params[element.value] ??= 7;
			else if (element.type === TYPE.date || element.type === TYPE.time)
				params[element.value] ??= new Date(0);
			else if (element.type === TYPE.plural) {
				params[element.value] ??= 2;
				for (const option of Object.values(element.options)) walk(option.value);
			} else if (element.type === TYPE.select) {
				params[element.value] ??= "other";
				for (const option of Object.values(element.options)) walk(option.value);
			} else if (element.type === TYPE.tag) walk(element.children);
		}
	};
	walk(parse(message));
	return params;
}

test("every bundled key of every LTR locale renders identically through translate and the raw path", () => {
	let checked = 0;
	for (const code of LTR) {
		const catalogue =
			code === "en"
				? keys.bundledEnglish
				: (keys.bundledCatalogues[code] ?? {});
		for (const [key, message] of Object.entries(catalogue)) {
			const params = paramsFor(message);
			assert.equal(
				run(key, params, code),
				raw(key, params, code),
				`${code} ${key}`,
			);
			checked += 1;
		}
	}
	assert.ok(
		checked > 8000,
		`expected the whole LTR catalogue walk, saw ${checked}`,
	);
});

test("every bundled ur key differs from its raw render ONLY by inserted bidi controls", () => {
	let marked = 0;
	for (const [key, message] of Object.entries(keys.bundledCatalogues.ur)) {
		const params = paramsFor(message);
		const out = run(key, params, "ur");
		const base = raw(key, params, "ur");
		assert.equal(strip(out), strip(base), key);
		if (out !== base) marked += 1;
	}
	// The shipped ur values already carry sigil tokens (audit: 24), so the pass
	// is not vacuous.
	assert.ok(
		marked >= 20,
		`expected the shipped ur sigil values to be isolated, saw ${marked}`,
	);
});

test("translateRaw never marks, in any locale (clipboard, file names, backend text)", () => {
	for (const [key, params] of [
		["fx.could_not_run", { name: "model", reason: "x" }],
		["fx.move_hint", { example: "/move <path>" }],
		["fx.stop", {}],
	]) {
		assert.doesNotMatch(raw(key, params, "ur"), CONTROLS);
	}
});

/** Every renderer source file, depth first; tests and stories are not call sites. */
function sources(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) sources(path, out);
		else if (/\.(ts|tsx)$/.test(name) && !/\.(test|stories)\./.test(name))
			out.push(path);
	}
	return out;
}

test("no clipboard write or outbound send passes t() output (the exempt call sites do not exist)", () => {
	const offenders = [];
	for (const file of sources(join(ROOT, "src/renderer/src"))) {
		const text = readFileSync(file, "utf8");
		/*
		 * Identifiers bound from `t()` output in this file, so the guard also sees
		 * `const notice = t(k); clipboard.writeText(notice)`. One hop only: this is
		 * a grep-shaped sweep of the call sites, not a data-flow analysis, and
		 * `messages.ts`'s `translateRaw` docstring states that limit rather than
		 * claiming more than it checks (review round 1, N4).
		 */
		const translated = new Set(
			[
				...text.matchAll(
					/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*[^;\n]*\bt\(/g,
				),
			].map((match) => match[1] ?? ""),
		);
		for (const match of text.matchAll(
			/(?:writeText|\.send(?:Message|Prompt)?|submitMessage)\(([^)]*)\)/g,
		)) {
			const argument = (match[1] ?? "").trim();
			if (/\bt\(\s*["`]/.test(argument) || translated.has(argument))
				offenders.push(`${file}: ${match[0]}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		"a clipboard/send site now passes t() output: use translateRaw there",
	);
});

/*
 * The guard above is a detector, so the detector is checked: the two shapes the
 * sweep claims to catch are fed to it as text. A guard that silently stopped
 * matching is worse than no guard, because `translateRaw`'s docstring points a
 * new caller at it (review round 1, N4).
 */
test("the clipboard/send detector catches an inline call and a one-hop binding", () => {
	const flagged = (text) =>
		[
			...text.matchAll(
				/(?:writeText|\.send(?:Message|Prompt)?|submitMessage)\(([^)]*)\)/g,
			),
		].some((match) => {
			const argument = (match[1] ?? "").trim();
			const translated = new Set(
				[
					...text.matchAll(
						/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*[^;\n]*\bt\(/g,
					),
				].map((entry) => entry[1] ?? ""),
			);
			return /\bt\(\s*["`]/.test(argument) || translated.has(argument);
		});
	assert.ok(flagged('clipboard.writeText(t("ui.x"));'));
	assert.ok(flagged('const notice = t("ui.x");\nclipboard.writeText(notice);'));
	// Negative controls: raw output and an unrelated string are not offenders.
	assert.ok(!flagged('clipboard.writeText(translateRaw("ui.x"));'));
	assert.ok(!flagged('const notice = t("ui.x");\nclipboard.writeText(plain);'));
});

test("fribidi paints every isolated token in logical Latin order (skipped without fribidi)", (context) => {
	const probe = spawnSync("fribidi", ["--version"]);
	if (probe.error) return context.skip("fribidi is not installed");
	const visual = (text) =>
		spawnSync("fribidi", ["--rtl", "--nopad", "--nobreak", "--clean"], {
			input: text,
			encoding: "utf8",
		}).stdout;
	const cases = [
		["fx.could_not_run", { name: "model", reason: "x" }, "/model"],
		["fx.stop", {}, "/stop"],
		["fx.btw", {}, "/btw"],
		["fx.opens_with_dollar", {}, "$name"],
		["fx.move_hint", { example: "/move <path>" }, "/move <path>"],
		// M1: the whole path in one run, so this is the row the old character
		// class fails - four runs paint `/image.png/Documents/eren/Users`.
		["fx.path_literal", {}, "/Users/eren/Documents/image.png"],
		["fx.path_mid", {}, "/Users/eren/a.txt"],
		["fx.at_scope", {}, "@scope/pkg"],
	];
	for (const [key, params, token] of cases) {
		assert.ok(
			visual(run(key, params)).includes(token),
			`${key}: ${JSON.stringify(visual(run(key, params)))}`,
		);
		assert.ok(
			!visual(raw(key, params, "ur")).includes(token),
			`${key} raw should be reversed (negative control)`,
		);
	}
});

test("list joiner: en is byte-identical to join(', '); other locales use their own separator", () => {
	for (const items of [
		[],
		["a"],
		["a", "b"],
		["low", "medium", "high"],
		["a", "b", "c", "d", "e"],
	]) {
		assert.equal(format.formatList(items, "en"), items.join(", "));
		assert.equal(format.formatList(items, "en-US"), items.join(", "));
	}
	const levels = ["low", "medium", "high"];
	assert.equal(format.formatList(levels, "zh-CN"), "low、medium、high");
	assert.equal(format.formatList(levels, "ur"), "low، medium، high");
	assert.equal(format.formatList(levels, "fr"), "low, medium, high");
	assert.equal(format.formatList(levels, "ru"), "low, medium, high");
	assert.equal(format.formatList(levels, "hi"), "low, medium और high");
	assert.equal(format.formatList(["a", "b"], "zh-CN"), "a、b");
	// Clause separators (attachment refusals): Chinese full-width, Urdu semicolon.
	assert.equal(format.formatClauses(["x", "y"], "en"), "x; y");
	assert.equal(format.formatClauses(["x", "y"], "fr"), "x; y");
	assert.equal(format.formatClauses(["x", "y"], "zh-CN"), "x\uFF1By");
	assert.equal(format.formatClauses(["x", "y"], "ur"), "x\u061B y");
});

test("the effort list is localized in the sentence a user reads, and English is unchanged", () => {
	const model = {
		reasoning_effort: "high",
		reasoning_efforts: ["low", "medium", "high"],
	};
	const detail = (tag) => {
		locale.setLocale(tag, "backend");
		return sessionModel.effortState(model).detail;
	};
	const english = detail("en");
	assert.equal(
		english,
		"Reasoning effort. This model offers low, medium, high.",
	);
	const zh = detail("zh-CN");
	assert.doesNotMatch(
		zh,
		/, /,
		`zh-CN must not carry an ASCII comma-space: ${zh}`,
	);
	assert.match(zh, /、/);
	const ur = detail("ur");
	assert.doesNotMatch(ur, /, /);
	for (const tag of ["fr", "ru", "hi"])
		assert.doesNotMatch(
			detail(tag),
			/\bmedium\b/,
			`${tag} must localize the level words`,
		);
	locale.setLocale("en", "backend");
});

/*
 * The ru / zh-CN sentences and level words below are registered as served
 * fixtures: the translators' catalogue files for these keys are still being
 * written and `keys.gen.ts` is regenerated only once they land, so the BUNDLED
 * maps cannot yet answer them. The values are the audited ones (ru receipt N1,
 * the shipped dash form; zh-CN is a plain rendering of the English). What is
 * under test is the code: that the rung handed to the sentence is the
 * localized label, not the English wire token.
 */
messages.registerCatalogue("ru", {
	"ui.chat.session_readout.draft.confirm_model_effort":
		"Этот разговор будет работать на {selector}; глубина рассуждений — {effort}.",
	"ui.chat.session_readout.draft.confirm_effort_changed":
		"Этот разговор будет работать на {selector}. Уровень теперь {level}, потому что {wanted} не входит в уровни модели.",
	"ui.chat.session_readout.effort.level.none": "Нет",
	"ui.chat.session_readout.effort.level.xhigh": "Очень высокий",
});
messages.registerCatalogue("zh-CN", {
	"ui.chat.session_readout.draft.confirm_model_effort":
		"此对话将在 {selector} 上运行，推理强度为{effort}。",
	"ui.chat.session_readout.draft.confirm_effort_changed":
		"此对话将在 {selector} 上运行。推理强度现为{level}，因为{wanted}不是该模型的级别。",
	"ui.chat.session_readout.effort.level.none": "无",
	"ui.chat.session_readout.effort.level.xhigh": "超高",
});

test("a raw wire rung quoted in a draft confirmation is localized (no English token in ru/zh-CN)", () => {
	const target = { ladder: ["none", "high"], ladderKnown: true, level: "high" };
	const sentence = (tag, carried) => {
		locale.setLocale(tag, "backend");
		return draftSelection.effortCarry(carried, target).confirmation("a/b");
	};
	try {
		// English is byte-identical to the old sentence for every wire rung.
		assert.equal(
			sentence("en", "none"),
			"This conversation will run a/b at none effort.",
		);
		assert.equal(
			sentence("en", "turbo"),
			"This conversation will run a/b. Its effort is now high, because turbo is not one of that model's levels.",
		);
		assert.equal(
			sentence("ru", "none"),
			"Этот разговор будет работать на a/b; глубина рассуждений — нет.",
		);
		assert.equal(
			sentence("zh-CN", "none"),
			"此对话将在 a/b 上运行，推理强度为无。",
		);
		// `wanted` and `level` are rungs too; an unknown token passes through raw.
		assert.equal(
			sentence("ru", "xhigh"),
			"Этот разговор будет работать на a/b. Уровень теперь высокий, потому что очень высокий не входит в уровни модели.",
		);
		assert.doesNotMatch(sentence("ru", "turbo"), /xhigh/);
		assert.match(sentence("ru", "turbo"), /turbo/);
	} finally {
		locale.setLocale("en", "backend");
	}
});
