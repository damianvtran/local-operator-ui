/**
 * Round-2 ur remediation audit — mechanical verification.
 *
 * Reads the EN catalogue, the UR catalogue and the EN context sidecar for the
 * seven ur namespaces of the agents/hub literals wave; binds them by sha256,
 * diffs the ur values against the pre-remediation commit a9e536bf89 through
 * `git show` (nothing is checked out), and reports:
 *   - JSON validity, key set and key order against English
 *   - ICU argument sets per key (parsed with the repo's own @formatjs parser)
 *   - the exact changed-key set of the remediation delta
 *   - manual bidi controls, ASCII punctuation, NFC/whitespace hygiene
 *   - the five remediated values formatted through IntlMessageFormat in `ur`
 *
 * Read-only: no file is written. Run from the worktree root.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "package.json"));
const { parse } = require("@formatjs/icu-messageformat-parser");
const IntlMessageFormat = require("intl-messageformat").default;

const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const PARENT = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim();

const NAMESPACES = [
	"ui.agents.config",
	"ui.agents.detail",
	"ui.agents.pages",
	"ui.agents.upload",
	"ui.common.actions",
	"ui.hub.pages",
	"ui.hub.teams",
];

const CHANGED = [
	"ui.hub.pages.card.updated",
	"ui.agents.pages.ask.manual_agent",
	"ui.agents.pages.ask.manual_team",
	"ui.hub.teams.recency.created",
	"ui.hub.teams.recency.updated",
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** Every argument name an ICU message references (simple, plural, select, tag-free). */
function argNames(message) {
	const names = new Set();
	const walk = (nodes) => {
		for (const node of nodes) {
			if (node.type === 1 /* argument */) names.add(node.value);
			else if (node.type === 2 /* number */) names.add(node.value);
			else if (node.type === 3 /* date */) names.add(node.value);
			else if (node.type === 4 /* time */) names.add(node.value);
			else if (node.type === 5 /* select */) {
				names.add(node.value);
				for (const opt of Object.values(node.options)) walk(opt.value);
			} else if (node.type === 6 /* plural */) {
				names.add(node.value);
				names.add(`#${node.value}`);
				for (const opt of Object.values(node.options)) walk(opt.value);
			} else if (node.type === 8 /* pound */) names.add(`#${node.value}`);
			else if (node.type === 9 /* tag */) walk(node.children);
		}
	};
	walk(parse(message));
	return [...names].sort();
}

/** Argument names without the plural-offset marker. */
const plainArgs = (message) => argNames(message).filter((n) => !n.startsWith("#"));

const facts = {
	head: HEAD,
	parent: PARENT,
	namespaces: {},
	changed_keys: [],
	problems: [],
};

const TEXT_KEYS = new Set();
for (const ns of NAMESPACES) {
	const enPath = `src/i18n/catalogues/en/${ns}.json`;
	const urPath = `src/i18n/catalogues/ur/${ns}.json`;
	const ctxPath = `src/i18n/catalogues/en/${ns}.context.json`;
	const enBytes = readFileSync(path.join(ROOT, enPath));
	const urBytes = readFileSync(path.join(ROOT, urPath));
	const ctxBytes = readFileSync(path.join(ROOT, ctxPath));
	let en;
	let ur;
	try {
		en = JSON.parse(enBytes.toString("utf8"));
		ur = JSON.parse(urBytes.toString("utf8"));
	} catch (error) {
		facts.problems.push(`${ns}: invalid JSON — ${error.message}`);
		continue;
	}
	let oldUr;
	try {
		oldUr = JSON.parse(
			execFileSync("git", ["show", `${PARENT}:${urPath}`], {
				encoding: "utf8",
				maxBuffer: 64 * 1024 * 1024,
			}),
		);
	} catch (error) {
		facts.problems.push(`${ns}: cannot read ${PARENT}:${urPath} — ${error.message}`);
		oldUr = {};
	}
	const enKeys = Object.keys(en);
	const urKeys = Object.keys(ur);
	const sameKeys = enKeys.length === urKeys.length && enKeys.every((k, i) => k === urKeys[i]);
	if (!sameKeys)
		facts.problems.push(
			`${ns}: key set/order differs — en ${enKeys.length} ur ${urKeys.length}`,
		);

	const changed = [];
	const valueChanged = [];
	const argMismatch = [];
	for (const key of enKeys) {
		if (!Object.hasOwn(ur, key)) continue;
		const a = plainArgs(en[key]).join(",");
		const b = plainArgs(ur[key]).join(",");
		if (a !== b) argMismatch.push({ key, en: a, ur: b });
		const before = Object.hasOwn(oldUr, key) ? oldUr[key] : undefined;
		if (before !== ur[key]) {
			changed.push(key);
			if (before !== undefined) valueChanged.push(key);
		}
	}
	const removed = Object.keys(oldUr).filter((k) => !Object.hasOwn(ur, k));
	if (removed.length) facts.problems.push(`${ns}: keys removed vs parent — ${removed.join(",")}`);
	if (argMismatch.length)
		facts.problems.push(`${ns}: ICU arg mismatch — ${JSON.stringify(argMismatch)}`);
	facts.changed_keys.push(...changed);

	facts.namespaces[ns] = {
		en_path: enPath,
		ur_path: urPath,
		context_path: ctxPath,
		en_sha256: sha(enBytes),
		ur_sha256: sha(urBytes),
		context_sha256: sha(ctxBytes),
		key_count: enKeys.length,
		same_key_set_and_order: sameKeys,
		keys_changed_vs_parent: changed,
		keys_changed_in_place_vs_parent: valueChanged,
		keys_added_or_removed_vs_parent: removed.length,
		arg_mismatches: argMismatch,
	};
}

// ---- hygiene over every ur value in the seven groups --------------------------
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/u;
const ASCII_PUNCT = /[.?!,;:]/u;
const hygiene = { bidi_controls: [], zero_width: [], ascii_punct: [], not_nfc: [], edges: [] };
for (const ns of NAMESPACES) {
	const ur = JSON.parse(
		readFileSync(path.join(ROOT, `src/i18n/catalogues/ur/${ns}.json`), "utf8"),
	);
	for (const [key, value] of Object.entries(ur)) {
		const where = `${ns} :: ${key}`;
		if (BIDI_CONTROLS.test(value)) hygiene.bidi_controls.push(where);
		if (ZERO_WIDTH.test(value)) hygiene.zero_width.push(where);
		const text = value.replace(/\{[^}]*\}/g, "").replace(/#/g, "");
		if (ASCII_PUNCT.test(text)) hygiene.ascii_punct.push(where);
		if (value.normalize("NFC") !== value) hygiene.not_nfc.push(where);
		if (value !== value.trim() || /\s{2,}/.test(value)) hygiene.edges.push(where);
	}
}

// ---- the five remediated values, formatted through ICU in `ur` ---------------
const SAMPLES = {
	"ui.hub.pages.card.updated": [
		{ when: "3 دن پہلے" },
		{ when: "2 گھنٹے پہلے" },
		{ when: "5 منٹ پہلے" },
	],
	"ui.hub.teams.recency.updated": [
		{ when: "2 گھنٹے پہلے" },
		{ when: "ابھی" },
		{ when: "10 اکتوبر، 2026" },
	],
	"ui.hub.teams.recency.created": [
		{ when: "3 دن پہلے" },
		{ when: "ابھی" },
		{ when: "10 اکتوبر، 2026" },
	],
	"ui.agents.pages.ask.manual_agent": [{}],
	"ui.agents.pages.ask.manual_team": [{}],
};

const rendered = [];
for (const ns of NAMESPACES) {
	const ur = JSON.parse(
		readFileSync(path.join(ROOT, `src/i18n/catalogues/ur/${ns}.json`), "utf8"),
	);
	for (const key of CHANGED) {
		if (!Object.hasOwn(ur, key)) continue;
		for (const sample of SAMPLES[key] ?? [{}]) {
			const mf = new IntlMessageFormat(ur[key], "ur");
			rendered.push({ key, args: sample, out: mf.format(sample) });
		}
	}
}

facts.hygiene = Object.fromEntries(
	Object.entries(hygiene).map(([k, v]) => [k, { count: v.length, hits: v.slice(0, 10) }]),
);
facts.rendered = rendered;
facts.changed_keys = [...new Set(facts.changed_keys)].sort();
facts.changed_key_count = facts.changed_keys.length;

console.log(JSON.stringify(facts, null, 1));
