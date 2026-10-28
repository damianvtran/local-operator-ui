#!/usr/bin/env node
/**
 * Hindi wave-A audit harness (read-only).
 *
 * For the 38 manifest keys and every key of the four namespaces it checks:
 *   1. ICU parses on both sides with @formatjs/icu-messageformat-parser.
 *   2. Placeholder signatures equal: same argument names, same kind (plain /
 *      number+style / date / time / select / plural, same selector argument)
 *      and byte-identical raw `{...}` span spellings.
 *   3. Plural arms cover every CLDR category Intl.PluralRules('hi') returns.
 *   4. Every audited value renders through the repo's intl-messageformat with
 *      realistic and adversarial argument values.
 *   5. NFC, bidi controls, ASCII apostrophes/quotes, edge whitespace, ellipsis.
 * JSON goes to stdout; the human render table and failures go to stderr.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";
import IntlMessageFormat from "intl-messageformat";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const S = "/Users/damian/qa/wave-a-audit-hi";
const NSS = [
	"ui.chat",
	"ui.chat.header",
	"ui.chat.response_actions",
	"ui.chat.sidebar",
];
const manifest = JSON.parse(readFileSync(`${S}/wave-a-keys.json`, "utf8"));
const pathOf = (p) => `${ROOT}/${p.replace(/^\/+/, "")}`;
const hashOf = (p) => createHash("sha256").update(readFileSync(pathOf(p))).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(pathOf(p), "utf8"));

const CLDR = new Intl.PluralRules("hi").resolvedOptions().pluralCategories.sort();
const failures = [];
const note = (m) => {
	failures.push(m);
	console.error(`FAIL ${m}`);
};

function signatures(ast) {
	const out = {};
	const add = (k, v) => {
		out[k] ||= [];
		out[k].push(v);
	};
	const walk = (n) => {
		if (Array.isArray(n)) {
			n.forEach(walk);
			return;
		}
		if (!n || typeof n !== "object") return;
		switch (n.type) {
			case TYPE.argument:
				add(n.value, "plain");
				return;
			case TYPE.number:
				add(n.value, `number:${n.style ? JSON.stringify(n.style) : "default"}`);
				return;
			case TYPE.date:
				add(n.value, "date");
				return;
			case TYPE.time:
				add(n.value, "time");
				return;
			case TYPE.select:
				add(n.value, "select");
				for (const o of Object.values(n.options)) walk(o.value);
				return;
			case TYPE.plural:
				add(n.value, `plural:${n.pluralType ?? "cardinal"}`);
				for (const o of Object.values(n.options)) walk(o.value);
				return;
			default:
				if (Array.isArray(n.children)) n.children.forEach(walk);
				if (Array.isArray(n.options))
					n.options.forEach((o) => walk(o?.value ?? o));
		}
	};
	walk(ast);
	for (const k of Object.keys(out)) out[k] = out[k].sort();
	return out;
}

function pluralArms(ast) {
	const found = {};
	const walk = (n) => {
		if (Array.isArray(n)) {
			n.forEach(walk);
			return;
		}
		if (!n || typeof n !== "object") return;
		if (n.type === TYPE.plural) found[n.value] = Object.keys(n.options).sort();
		if (Array.isArray(n.children)) n.children.forEach(walk);
		if (n.options) for (const o of Object.values(n.options)) walk(o?.value ?? o);
	};
	walk(ast);
	return found;
}

const sortKeys = (o) =>
	Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const rawSpans = (s) =>
	[...s.matchAll(/\{[^{}]*\}/g)].map((m) => m[0]).sort();
const isNfc = (s) => s === s.normalize("NFC");
const bidiCount = (s) =>
	[...s].filter((c) => /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(c)).length;

const ARGS = {
	turn: 12,
	total: 34,
	clock: "3:42 PM",
	name: "Acme Ops",
	label: "Acme Ops",
	title: "Q3 planning sync",
	reason: "The runtime closed this seat.",
	count: 3,
};
const NAME_CASES = [
	["latin", "Acme Ops"],
	["latin-vowel-initial", "Indira Rao"],
	["devanagari", "इंदिरा राव"],
	["devanagari-vowel-initial", "आशा टीम"],
	["ascii-quotes", '"Q" O\'Brien'],
	["comma", "टीम, प्रमुख"],
	["danda", "अंत। नया"],
	["cjk", "山田太郎"],
	["rtl-name", "محمد علي"],
	["long", "A very long agent display name that goes on and on"],
	["token-like", "agent_01 (beta)"],
	["percent-braces-like", "100% done {x}"],
];

const out = {
	locale: "hi",
	head: "a81c00cdda2667dc6b094128ff47ec72d0c4d095",
	cldr_hi: CLDR,
	namespaces: {},
	keys: [],
};
const byNs = {};

for (const ns of NSS) {
	const en = readJson(`src/i18n/catalogues/en/${ns}.json`);
	const ctx = readJson(`src/i18n/catalogues/en/${ns}.context.json`);
	const hi = readJson(`src/i18n/catalogues/hi/${ns}.json`);
	byNs[ns] = { en, ctx, hi };
	const enKeys = Object.keys(en).sort();
	const hiKeys = Object.keys(hi).sort();
	out.namespaces[ns] = {
		en_keys: enKeys.length,
		hi_keys: hiKeys.length,
		key_sets_equal: JSON.stringify(enKeys) === JSON.stringify(hiKeys),
		missing_in_hi: enKeys.filter((k) => !(k in hi)),
		extra_in_hi: hiKeys.filter((k) => !(k in en)),
		sha256: {
			en: hashOf(`/src/i18n/catalogues/en/${ns}.json`),
			context: hashOf(`/src/i18n/catalogues/en/${ns}.context.json`),
			target: hashOf(`/src/i18n/catalogues/hi/${ns}.json`),
		},
	};
	if (!out.namespaces[ns].key_sets_equal) note(`${ns}: key sets differ`);
	if (!(enKeys.length === hiKeys.length)) note(`${ns}: key count differs`);
}

for (const item of manifest) {
	const { key, namespace: ns } = item;
	const { en, ctx, hi } = byNs[ns];
	const rec = {
		key,
		namespace: ns,
		en: en[key],
		hi: hi[key],
		context: ctx[key] ?? null,
		checks: {},
		renders: [],
	};
	if (hi[key] === undefined) {
		note(`${key}: missing from hi`);
		out.keys.push(rec);
		continue;
	}
	let enAst;
	let hiAst;
	try {
		enAst = parse(en[key]);
	} catch (e) {
		note(`${key}: EN ICU parse failed: ${e.message}`);
	}
	try {
		hiAst = parse(hi[key]);
	} catch (e) {
		note(`${key}: HI ICU parse failed: ${e.message}`);
	}
	if (!enAst || !hiAst) {
		out.keys.push(rec);
		continue;
	}
	const enSig = signatures(enAst);
	const hiSig = signatures(hiAst);
	const enRaw = rawSpans(en[key]);
	const hiRaw = rawSpans(hi[key]);
	Object.assign(rec.checks, {
		en_signature: enSig,
		hi_signature: hiSig,
		signature_equal:
			JSON.stringify(sortKeys(enSig)) === JSON.stringify(sortKeys(hiSig)),
		raw_spans_en: enRaw,
		raw_spans_hi: hiRaw,
		raw_spans_equal: JSON.stringify(enRaw) === JSON.stringify(hiRaw),
		args: Object.keys(enSig).sort(),
		plural: pluralArms(hiAst),
		nfc: isNfc(hi[key]),
		bidi_controls: bidiCount(hi[key]),
		ascii_apostrophe: hi[key].includes("'"),
		ascii_double_quote: hi[key].includes('"'),
		edge_space: hi[key] !== hi[key].trim(),
		ellipsis_parity: en[key].endsWith("\u2026") === hi[key].endsWith("\u2026"),
	});
	if (!rec.checks.signature_equal)
		note(
			`${key}: placeholder signature differs EN=${JSON.stringify(enSig)} HI=${JSON.stringify(hiSig)}`,
		);
	if (!rec.checks.raw_spans_equal)
		note(
			`${key}: raw placeholder spans differ EN=${JSON.stringify(enRaw)} HI=${JSON.stringify(hiRaw)}`,
		);
	for (const [arg, arms] of Object.entries(rec.checks.plural)) {
		const missing = CLDR.filter((c) => !arms.includes(c));
		rec.checks.plural_cldr_missing = { ...(rec.checks.plural_cldr_missing ?? {}), [arg]: missing };
		if (missing.length) note(`${key}: plural ${arg} misses CLDR ${missing}`);
	}
	if (!rec.checks.nfc) note(`${key}: not NFC`);
	if (rec.checks.bidi_controls) note(`${key}: has bidi controls`);
	if (rec.checks.ascii_apostrophe) note(`${key}: ASCII apostrophe`);
	if (rec.checks.ascii_double_quote) note(`${key}: ASCII double quote`);
	if (rec.checks.edge_space) note(`${key}: leading/trailing space`);
	if (!rec.checks.ellipsis_parity) note(`${key}: ellipsis parity differs`);

	const render = (args, label) => {
		try {
			return { label, text: new IntlMessageFormat(hi[key], "hi").format(args) };
		} catch (e) {
			note(`${key}: render threw for ${label}: ${e.message}`);
			return { label, error: e.message };
		}
	};
	rec.renders.push(render({ ...ARGS }, "base"));
	const nameParam = ["name", "label", "title"].find((p) => p in enSig);
	if (nameParam)
		for (const [label, value] of NAME_CASES)
			rec.renders.push(render({ ...ARGS, [nameParam]: value }, `${nameParam}=${label}`));
	if (Object.keys(rec.checks.plural).length)
		for (const count of [0, 1, 2, 5, 21, 1000000])
			rec.renders.push(render({ ...ARGS, count, shown: count }, `count=${count}`));
	out.keys.push(rec);
}

out.failures = failures;
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
console.error(`\n[icu-audit] keys=${out.keys.length} failures=${failures.length}`);
process.exit(failures.length ? 1 : 0);
