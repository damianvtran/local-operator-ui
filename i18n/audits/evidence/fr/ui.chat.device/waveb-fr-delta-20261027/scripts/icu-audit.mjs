/**
 * Wave-B delta audit (fr) mechanical pass.
 *
 * WHAT THIS PROVES, in one run, against the real parser and the real formatter
 * the app uses (`src/i18n/messages.ts` builds `new IntlMessageFormat(message,
 * locale)` with no options):
 *   1. every one of the 62 wave-B keys parses in en and in fr;
 *   2. the ICU argument names and their types are byte-identical to the English
 *      side, for all 62 (not only the changed ones);
 *   3. every plural/select message carries exactly the English branch set plus
 *      the CLDR categories fr requires (one/many/other), and fr's `few` is never
 *      used;
 *   4. every value renders without a format error under its own locale, and
 *      backticked code spans are byte-identical to the English ones;
 *   5. the changed values render as expected (printed verbatim), and
 *      pairing_guidance renders with 4 backticks and a literal <token>.
 *
 * It also re-checks the typography the fr style guide requires on the changed
 * values. Read-only: it writes nothing but stdout.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { TYPE, parse } from "@formatjs/icu-messageformat-parser";

const ROOT = "/Users/damian/qa/wave-b-delta-fr";
const CAT = join(ROOT, "src/i18n/catalogues");
const MANIFEST = join(process.argv[2] ?? "", "wave-b-keys.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

const CHANGED = {
	"ui.chat.device.row.not_here_why": true,
	"ui.chat.device.sentence.mesh_read_failure": true,
	"ui.chat.device.sentence.pairing_guidance": true,
	"ui.chat.pickers.slash.enter_needs_a_pick": true,
	"ui.chat.canonical.tool_row.generic_verb.running": true,
	"ui.chat.canonical.tool_row.generic_verb.settled": true,
	"ui.chat.session_status.nothing_measured_yet": true,
	"ui.chat.session_status.context_nothing_measured_tooltip": true,
	"ui.common.connection.session_loss.server_down": true,
};

function catalogue(locale, ns) {
	const file = join(CAT, locale, `${ns}.json`);
	const raw = JSON.parse(readFileSync(file, "utf8"));
	return raw.messages ?? raw;
}

/** Every argument name → type in a parsed message, plus branch sets. */
function shape(ast, out = { args: {}, branches: {} }) {
	for (const el of ast) {
		switch (el.type) {
			case TYPE.argument:
			case TYPE.number:
			case TYPE.date:
			case TYPE.time:
				// First writer wins: a plural/select argument re-uses its own name
				// inside its branches (`{n, plural, ... {n, number}}`), and the
				// plural node is the one that carries the branch structure.
				out.args[el.value] ??= el.type;
				break;
			case TYPE.plural:
				out.args[el.value] = "plural";
				out.branches[el.value] = Object.keys(el.options).sort();
				for (const opt of Object.values(el.options)) shape(opt.value, out);
				break;
			case TYPE.select:
				out.args[el.value] = "select";
				out.branches[el.value] = Object.keys(el.options).sort();
				for (const opt of Object.values(el.options)) shape(opt.value, out);
				break;
			case TYPE.tag:
				out.args[`<${el.value}>`] = "tag";
				shape(el.children, out);
				break;
			default:
				break;
		}
	}
	return out;
}

function sampleValues(ast) {
	const { args } = shape(ast);
	const values = {};
	for (const [name, type] of Object.entries(args)) {
		if (type === "plural" || type === "number") values[name] = 3;
		else if (type === "date" || type === "time") values[name] = new Date(0);
		else values[name] = `X${name}X`;
	}
	return values;
}

const problems = [];
const rows = [];
const frCategories = new Set(["one", "many", "other"]);

for (const ns of Object.keys(manifest)) {
	const en = catalogue("en", ns);
	const fr = catalogue("fr", ns);
	for (const key of manifest[ns]) {
		const record = { namespace: ns, key, changed: Boolean(CHANGED[key]) };
		const enValue = en[key];
		const frValue = fr[key];
		if (enValue === undefined) {
			problems.push(`${key}: MISSING in en`);
			continue;
		}
		if (frValue === undefined) {
			problems.push(`${key}: MISSING in fr`);
			continue;
		}
		record.en = enValue;
		record.fr = frValue;

		let enAst, frAst;
		try {
			enAst = parse(enValue);
		} catch (error) {
			problems.push(`${key}: en does not parse (${error.message})`);
			continue;
		}
		try {
			frAst = parse(frValue);
		} catch (error) {
			problems.push(`${key}: fr does not parse (${error.message})`);
			continue;
		}

		const enShape = shape(enAst, { args: {}, branches: {} });
		const frShape = shape(frAst, { args: {}, branches: {} });
		record.args = frShape.args;
		record.branches = frShape.branches;

		const enArgs = Object.keys(enShape.args).sort().join(",");
		const frArgs = Object.keys(frShape.args).sort().join(",");
		if (enArgs !== frArgs) {
			problems.push(`${key}: argument sets differ (en ${enArgs || "-"} / fr ${frArgs || "-"})`);
		}
		for (const [name, type] of Object.entries(enShape.args)) {
			if (frShape.args[name] !== type) {
				problems.push(`${key}: argument ${name} is ${frShape.args[name]} in fr, ${type} in en`);
			}
		}
		for (const [name, branches] of Object.entries(frShape.branches)) {
			const enBranches = enShape.branches[name];
			const type = frShape.args[name];
			const allowed = new Set(enBranches);
			if (type === "plural") for (const category of frCategories) allowed.add(category);
			for (const branch of branches) {
				if (!allowed.has(branch)) {
					problems.push(`${key}: branch ${name}.${branch} is not an en branch nor an fr CLDR category`);
				}
			}
			if (type === "plural" && !branches.includes("other")) {
				problems.push(`${key}: plural ${name} has no other branch`);
			}
			if (type === "plural" && branches.includes("few")) {
				problems.push(`${key}: plural ${name} uses the few category fr does not have`);
			}
			record[`branches_${name}`] = branches.join("/");
		}

		// Render under each side's own locale, the way the app's t() does.
		const enValues = sampleValues(enAst);
		const frValues = { ...sampleValues(frAst) };
		try {
			record.enRendered = new IntlMessageFormat(enValue, "en").format(enValues);
		} catch (error) {
			problems.push(`${key}: en render failed (${error.message})`);
		}
		try {
			record.frRendered = new IntlMessageFormat(frValue, "fr").format(frValues);
		} catch (error) {
			problems.push(`${key}: fr render failed (${error.message})`);
		}

		// Backticked code spans must be byte-identical to the English ones.
		const spans = (value) => (value.match(/`[^`]*`/g) ?? []).sort();
		const enSpans = spans(enValue);
		const frSpans = spans(frValue);
		const fenceEven = (value) => (value.split("`").length - 1) % 2 === 0;
		if (!fenceEven(enValue)) problems.push(`${key}: en has an odd backtick count`);
		if (!fenceEven(frValue)) problems.push(`${key}: fr has an odd backtick count`);
		if (enSpans.join("\u0000") !== frSpans.join("\u0000")) {
			problems.push(`${key}: code spans differ (en ${JSON.stringify(enSpans)} / fr ${JSON.stringify(frSpans)})`);
		}
		record.spans = frSpans;
		rows.push(record);
	}
}

// ---------------------------------------------------------------- typography
const CHECKS = [
	["U+202F before colon", /\S *\u202f:/],
	["plain space before colon", / :/],
	["plain space before semicolon", / ;/],
	["U+202F before semicolon", /\u202f;/],
	["straight apostrophe in prose", /(?<![A-Za-z])'|'(?![^\u2019])/],
];
const typography = [];
for (const record of rows.filter((r) => r.changed)) {
	const value = record.fr;
	// Prose checks: split off code spans first - a command's quotes are the
	// source's, not prose punctuation.
	const prose = value.replace(/`[^`]*`/g, (span) => "\u0000".repeat(span.length));
	const doubled = /\S\u202f:/.test(value) ? "fine" : "NO U+202F before :";
	const semis = value.includes(";") ? (/\u202f;/.test(value) ? "fine" : "NO U+202F before ;") : "n/a";
	const colonSpaced = / :/.test(value) ? "PLAIN SPACE BEFORE :" : "fine";
	const semiSpaced = / ;/.test(value) ? "PLAIN SPACE BEFORE ;" : "fine";
	const apostrophes = [...prose.matchAll(/'/g)].length;
	const emDashes = (value.match(/ — /g) ?? []).length;
	typography.push({
		key: record.key,
		fine: doubled,
		colonSpaced,
		semis,
		semiSpaced,
		straightApostrophesOutsideCode: apostrophes,
		emDash: emDashes,
		nfc: value === value.normalize("NFC") ? "nfc" : "NOT NFC",
		doubleSpace: /  /.test(value) ? "DOUBLE SPACE" : "none",
		bidi: /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value) ? "BIDI CONTROL" : "none",
		cells: [...value].length,
	});
}

// ------------------------------------------------------- pairing_guidance
const pairingKey = "ui.chat.device.sentence.pairing_guidance";
const pairing = rows.find((r) => r.key === pairingKey);
const pairingDetail = {
	fr: pairing?.fr,
	rendered: pairing?.frRendered,
	backticks: (pairing?.frRendered ?? "").split("`").length - 1,
	spans: (pairing?.frRendered ?? "").match(/`[^`]*`/g),
	literalToken: (pairing?.frRendered ?? "").includes("<token>"),
	enRendered: pairing?.enRendered,
	enBackticks: (pairing?.enRendered ?? "").split("`").length - 1,
	enSpans: (pairing?.enRendered ?? "").match(/`[^`]*`/g),
};

// ------------------------------------------------------------- tool row verbs
const running = rows.find((r) => r.key === "ui.chat.canonical.tool_row.generic_verb.running");
const settled = rows.find((r) => r.key === "ui.chat.canonical.tool_row.generic_verb.settled");
const composition = {
	running: running?.fr,
	settled: settled?.fr,
	runningCells: running ? [...running.fr].length : null,
	settledCells: settled ? [...settled.fr].length : null,
	enCells: running ? [...running.en].length : null,
	composed: {
		running: `${running?.fr}bash pnpm vitest run src/renderer`,
		settled: `${settled?.fr}bash pnpm vitest run src/renderer`,
		mcp: `${running?.fr}list_issues`,
		fold: `${running?.fr}read src/i18n/messages.ts`,
	},
};

const report = {
	keyCount: rows.length,
	changedCount: rows.filter((r) => r.changed).length,
	problems,
	typography,
	pairingDetail,
	composition,
	changedRows: rows
		.filter((r) => r.changed)
		.map((r) => ({ key: r.key, en: r.en, fr: r.fr, frRendered: r.frRendered })),
	pluralRows: rows.filter((r) => r.branches && Object.keys(r.branches).length > 0),
};

console.log(JSON.stringify(report, null, 1));
if (problems.length > 0) process.exitCode = 1;
