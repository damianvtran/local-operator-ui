/**
 * ur ui.agents.upload — round-1 independent audit verifier.
 *
 * Reads the two catalogues and the English context sidecar at the audited head
 * and prints ONE JSON object: key parity, ICU parse + placeholder skeleton,
 * plural categories, the manual-bidi-control scan the style guide forbids, the
 * repo's forbidden-script gate (Devanagari / Arabic-only kaf-yeh-teh-marbuta-
 * alef-maksura), Latin-residue classification, Urdu punctuation and hashes.
 * It writes nothing; the caller redirects stdout.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const EN = "src/i18n/catalogues/en/ui.agents.upload.json";
const UR = "src/i18n/catalogues/ur/ui.agents.upload.json";
const CTX = "src/i18n/catalogues/en/ui.agents.upload.context.json";
const NEW_KEYS = [
	"ui.agents.upload.action.publish",
	"ui.agents.upload.action.publishing",
	"ui.agents.upload.action.update_listing",
	"ui.agents.upload.availability.reserved_named",
	"ui.agents.upload.availability.reserved_unnamed",
	"ui.agents.upload.intro.org",
	"ui.agents.upload.intro.public",
	"ui.agents.upload.not_leaving.org",
	"ui.agents.upload.not_leaving.public",
	"ui.agents.upload.published.org_listed",
	"ui.agents.upload.receipt.title_hub",
	"ui.agents.upload.receipt.title_org",
	"ui.agents.upload.receipt.title_updated",
	"ui.agents.upload.target.blocked_hint",
	"ui.agents.upload.target.visibility_hint_public",
];

const sha = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");
const bytes = (path) => readFileSync(path, "utf8");

// Duplicate members are invisible to JSON.parse; scan raw tokens for them.
const duplicateMembers = (text) => {
	const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:]/g) ?? [];
	const stack = [];
	const dupes = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "{") stack.push(new Set());
		else if (token === "[") stack.push(null);
		else if (token === "}" || token === "]") stack.pop();
		else if (token.startsWith('"') && tokens[i + 1] === ":") {
			const key = JSON.parse(token);
			const seen = stack.at(-1);
			if (seen?.has(key)) dupes.push(key);
			seen?.add(key);
		}
	}
	return dupes;
};

const enText = bytes(EN);
const urText = bytes(UR);
const en = JSON.parse(enText);
const ur = JSON.parse(urText);
const ctx = JSON.parse(bytes(CTX));

/** Plain `{x}` arguments only, descending through select/plural options. */
const plainArgs = (ast, out = new Set()) => {
	for (const el of ast) {
		if (el.type === TYPE.argument) out.add(el.value);
		else if (el.type === TYPE.plural || el.type === TYPE.select)
			for (const opt of Object.values(el.options)) plainArgs(opt.value, out);
		else if (el.type === TYPE.tag) plainArgs(el.children, out);
	}
	return out;
};
/** Plural/select argument names with their option keys — the ICU skeleton. */
const skeleton = (ast, out = []) => {
	for (const el of ast) {
		if (el.type === TYPE.plural) {
			out.push({ arg: el.value, kind: "plural", options: Object.keys(el.options).sort() });
			for (const opt of Object.values(el.options)) skeleton(opt.value, out);
		} else if (el.type === TYPE.select) {
			out.push({ arg: el.value, kind: "select", options: Object.keys(el.options).sort() });
			for (const opt of Object.values(el.options)) skeleton(opt.value, out);
		} else if (el.type === TYPE.argument) {
			out.push({ arg: el.value, kind: "argument" });
		} else if (el.type === TYPE.tag) {
			out.push({ tag: el.value });
			skeleton(el.children, out);
		}
	}
	return out;
};

// The brief's set: LRM/RLM/ALM, the 202A-202E embeddings/overrides, FSI..PDI.
const MANUAL_BIDI = /[\u200E\u200F\u061C\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/g;
// The repo's shipped gate (scripts/i18n/ur-activation.test.mjs), same class.
const FORBIDDEN_SCRIPT = /[\u0964\u0900-\u097F\u0643\u064A\u0629\u0649]/g;
// Any other invisible formatting character: storage must be plain text.
const OTHER_INVISIBLE = /[\u00A0\u00AD\u200B\u200C\u200D\u2060\uFEFF\u2028\u2029]/g;

const findings = [];
const perKey = [];

const parseSafe = (text, where) => {
	try {
		return parse(text, { shouldParseSkeletons: true, requiresOtherClause: true });
	} catch (error) {
		findings.push({ id: "ICU-PARSE", where, detail: error.message });
		return null;
	}
};

for (const key of NEW_KEYS) {
	const enValue = en[key];
	const urValue = ur[key];
	if (enValue === undefined || urValue === undefined) {
		findings.push({ id: "KEY-PARITY", where: key, detail: "missing in en or ur" });
		continue;
	}
	const enAst = parseSafe(enValue, `en:${key}`);
	const urAst = parseSafe(urValue, `ur:${key}`);
	const enArgs = enAst ? [...plainArgs(enAst)].sort() : [];
	const urArgs = urAst ? [...plainArgs(urAst)].sort() : [];
	if (JSON.stringify(enArgs) !== JSON.stringify(urArgs))
		findings.push({ id: "PLACEHOLDER", where: key, en: enArgs, ur: urArgs });
	const enSk = enAst ? skeleton(enAst) : [];
	const urSk = urAst ? skeleton(urAst) : [];
	if (JSON.stringify(enSk) !== JSON.stringify(urSk))
		findings.push({ id: "ICU-SKELETON", where: key, en: enSk, ur: urSk });

	const bidi = [...(urValue.match(MANUAL_BIDI) ?? [])].map(
		(c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
	);
	if (bidi.length) findings.push({ id: "MANUAL-BIDI", where: key, chars: bidi });
	const script = [...(urValue.match(FORBIDDEN_SCRIPT) ?? [])].map(
		(c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
	);
	if (script.length) findings.push({ id: "FORBIDDEN-SCRIPT", where: key, chars: script });
	const invisible = [...(urValue.match(OTHER_INVISIBLE) ?? [])].map(
		(c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
	);
	if (invisible.length) findings.push({ id: "INVISIBLE", where: key, chars: invisible });

	// Latin runs outside ICU syntax: product names and tokens are allowed, a
	// translatable English word is residue.
	const outsideIcu = urValue.replace(/\{[^{}]*\}/g, " ");
	const latin = (outsideIcu.match(/[A-Za-z][A-Za-z0-9'\-]*(?: [A-Za-z][A-Za-z0-9'\-]*)*/g) ?? []).filter(
		(t) => t.trim() !== "",
	);
	perKey.push({
		key,
		latin_outside_icu: latin,
		context_present: Object.hasOwn(ctx, key),
		has_plural: urSk.some((s) => s.kind === "plural"),
		en_chars: [...enValue].length,
		ur_chars: [...urValue].length,
	});
}

// Whole-file scans, not just the new keys.
const fileScan = (text, name) => ({
	name,
	manual_bidi: [...(text.match(MANUAL_BIDI) ?? [])].length,
	forbidden_script: [...(text.match(FORBIDDEN_SCRIPT) ?? [])].length,
	other_invisible: [...(text.match(OTHER_INVISIBLE) ?? [])].length,
	duplicate_members: duplicateMembers(text),
	ends_with_newline: text.endsWith("\n"),
});

const allowedLatin = new Set(["Agent", "Hub", "Radient", "Team"]);

process.stdout.write(
	`${JSON.stringify(
		{
			head: "2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82",
			hashes: { en: sha(EN), ur: sha(UR), context: sha(CTX) },
			key_parity: {
				en_keys: Object.keys(en).length,
				ur_keys: Object.keys(ur).length,
				missing_in_ur: Object.keys(en).filter((k) => !(k in ur)),
				extra_in_ur: Object.keys(ur).filter((k) => !(k in en)),
				new_keys_audited: NEW_KEYS.length,
			},
			context_parity: {
				missing: Object.keys(en).filter((k) => !(k in ctx)),
				stale: Object.keys(ctx).filter((k) => !(k in en)),
			},
			latin_residue: perKey
				.filter((row) => row.latin_outside_icu.some((t) => t.split(" ")[0] && !allowedLatin.has(t.split(" ")[0])))
				.map((row) => ({ key: row.key, latin: row.latin_outside_icu })),
			per_key: perKey,
			file_scans: [fileScan(urText, "ur"), fileScan(enText, "en")],
			findings,
		},
		null,
		1,
	)}\n`,
);
