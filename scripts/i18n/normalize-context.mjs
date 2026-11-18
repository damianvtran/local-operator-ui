#!/usr/bin/env node
/**
 * NORMALIZE CONTEXT SIDECARS onto the exact field set core's reader accepts.
 *
 * WHY THIS EXISTS. Translator agents read `.context.json` only through core's
 * audited `read_public_copy` reader. That reader validates the WHOLE file and
 * refuses it on any unknown field, wrong type or non-object entry (operator
 * decision, ask a-82fb, 2026-11-17: exact typed fields in core plus writer-side
 * checks in every repo). The desktop sidecars had drifted — `length_hint`,
 * `plural_guidance`, `params`, bare-string and `[role, tone, note]` entries — so
 * every file carrying one was unreadable to translators. This script is the
 * one-off, deterministic migration onto the exact set; `context-parity.mjs`
 * (`checkContextSchema`) is the guard that keeps it there.
 *
 * NO INFORMATION LOSS. Every original string value must survive verbatim in the
 * normalized entry (`normalize-context.test.mjs` and `--verify` prove it over the
 * real tree). Mapping:
 *   length_hint              -> length (appended to a non-empty length with "; ")
 *   params                   -> merged into placeholders
 *   placeholder (singular)   -> note clause "Placeholder: …"
 *   plural_guidance / plural -> note clause "Plural: …"
 *   select_guidance          -> note clause "Select: …"
 *   context                  -> note clause "Context: …"
 *   description              -> note clause "Description: …"
 *   note as object           -> note string "name: text; name: text"
 *   placeholders as list     -> flat dict ({} when empty), else a note clause
 *   entry as string          -> { note }
 *   entry as [role, tone, note] (every list entry today) -> { role, tone, note }
 * Field order is preserved: a renamed or folded field takes the position of the
 * first field that produced it. Files that need no change are not rewritten, so
 * they stay byte-identical; rewritten files use the repo convention (tab
 * indentation, trailing newline).
 *
 *   node scripts/i18n/normalize-context.mjs           # rewrite drifted sidecars
 *   node scripts/i18n/normalize-context.mjs --check   # exit 1 if any would change
 *   node scripts/i18n/normalize-context.mjs --verify <pre-migration ref>
 *     # retention proof: keys, every original string, catalogues byte-identical
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CATALOGUES = join(REPO, "src", "i18n", "catalogues");

/**
 * Drifted string fields folded into `note`, with the clause label each gets.
 *
 * The labels are English prefixes written into translator-context notes by this
 * one-time migration; they never reach the product UI. The literal-copy guard
 * reads `placeholder:` / `description:` as copy-bearing property names, so the
 * two entries it flags carry a per-line `i18n: ignore` pragma (a pragma covers
 * only its own literal, so the rest of the map stays scanned).
 */
const NOTE_CLAUSES = {
	placeholder: "Placeholder", // i18n: ignore migration-only clause label written into English translator-context notes, never product UI
	plural_guidance: "Plural",
	plural: "Plural",
	select_guidance: "Select",
	context: "Context",
	description: "Description", // i18n: ignore migration-only clause label written into English translator-context notes, never product UI
};

const SENTENCE_END = /[.!?:;]$/;

function appendClause(note, clause) {
	if (note === undefined || note === "") return clause;
	// Keep clauses readable as sentences without altering either string.
	return SENTENCE_END.test(note) ? `${note} ${clause}` : `${note}. ${clause}`;
}

function flattenStrings(value, prefix = "") {
	if (typeof value === "string") return prefix ? `${prefix}: ${value}` : value;
	if (Array.isArray(value))
		return value.map((v) => flattenStrings(v)).join("; ");
	if (value && typeof value === "object")
		return Object.entries(value)
			.map(([k, v]) => flattenStrings(v, k))
			.join("; ");
	return prefix ? `${prefix}: ${String(value)}` : String(value);
}

/**
 * Normalize one entry. Pure: returns a new object, never mutates the input.
 * Throws on a shape it has no lossless rule for, so a new drift kind stops the
 * migration instead of being silently dropped.
 */
export function normalizeEntry(entry) {
	if (typeof entry === "string") return { note: entry };
	if (Array.isArray(entry)) {
		if (entry.length === 3 && entry.every((x) => typeof x === "string")) {
			const [role, tone, note] = entry;
			return { role, tone, note };
		}
		return { note: flattenStrings(entry) };
	}
	if (!entry || typeof entry !== "object")
		throw new Error(`no lossless rule for a ${typeof entry} entry`);

	// Build an ordered list of [field, value] slots, then emit them in order.
	const out = new Map();
	const set = (field, value) => out.set(field, value);
	for (const [field, value] of Object.entries(entry)) {
		if (field === "length_hint") {
			const prior = out.get("length") ?? entry.length;
			if (prior !== undefined && prior !== "")
				set("length", `${prior}; ${value}`);
			else set("length", value);
		} else if (field === "length") {
			// A later length_hint may already have claimed (and merged) this slot.
			if (!out.has("length")) set("length", value);
		} else if (field === "params" || field === "placeholders") {
			const merged = { ...(out.get("placeholders") ?? {}) };
			if (Array.isArray(value)) {
				if (value.length > 0)
					set(
						"note",
						appendClause(
							out.get("note"),
							`Placeholders: ${flattenStrings(value)}`,
						),
					);
			} else {
				for (const [name, text] of Object.entries(value ?? {})) {
					const flat = typeof text === "string" ? text : flattenStrings(text);
					merged[name] =
						merged[name] !== undefined && merged[name] !== flat
							? `${merged[name]}; ${flat}`
							: flat;
				}
			}
			set("placeholders", merged);
		} else if (field === "note") {
			const flat = typeof value === "string" ? value : flattenStrings(value);
			// Clauses folded before the note's own position keep the note first.
			const prior = out.get("note");
			set("note", prior === undefined ? flat : appendClause(flat, prior));
		} else if (field in NOTE_CLAUSES) {
			set(
				"note",
				appendClause(out.get("note"), `${NOTE_CLAUSES[field]}: ${value}`),
			);
		} else {
			set(field, value);
		}
	}
	return Object.fromEntries(out);
}

/** Every `<locale>/*.context.json` path under the catalogue root. */
export function contextFiles(cataloguesDir = CATALOGUES) {
	const files = [];
	for (const locale of readdirSync(cataloguesDir).sort()) {
		let names;
		try {
			names = readdirSync(join(cataloguesDir, locale));
		} catch {
			continue;
		}
		for (const name of names.sort())
			if (name.endsWith(".context.json"))
				files.push(join(cataloguesDir, locale, name));
	}
	return files;
}

/** Normalized text for one file, or null when it already conforms. */
export function normalizeFile(path) {
	const text = readFileSync(path, "utf8");
	const data = JSON.parse(text);
	const next = {};
	let changed = false;
	for (const [key, entry] of Object.entries(data)) {
		next[key] = normalizeEntry(entry);
		if (JSON.stringify(next[key]) !== JSON.stringify(entry)) changed = true;
	}
	return changed ? `${JSON.stringify(next, null, "\t")}\n` : null;
}

/** Every string an entry carries — values AND object keys (placeholder names). */
export function entryStrings(value, out = []) {
	if (typeof value === "string") out.push(value);
	else if (Array.isArray(value)) for (const v of value) entryStrings(v, out);
	else if (value && typeof value === "object")
		for (const [k, v] of Object.entries(value)) {
			out.push(k);
			entryStrings(v, out);
		}
	return out;
}

/**
 * The strings an original entry must keep: every value, plus nested object keys
 * (placeholder names, note-object names). The entry's own FIELD names are not
 * content — renaming `length_hint` to `length` is the migration's point.
 */
export function retainedStrings(entry) {
	if (entry && typeof entry === "object" && !Array.isArray(entry))
		return Object.values(entry).flatMap((v) => entryStrings(v));
	return entryStrings(entry);
}

/**
 * Retention proof for one file: the key set is unchanged and every string the
 * original entry carried (values and names) appears verbatim in the normalized
 * entry. Returns human-readable failures naming key and string index only.
 */
export function retentionFailures(label, original, normalized) {
	const failures = [];
	const a = Object.keys(original);
	const b = Object.keys(normalized);
	if (JSON.stringify(a) !== JSON.stringify(b))
		failures.push(`${label}: key set or key order changed`);
	for (const key of a) {
		if (!(key in normalized)) continue;
		const haystack = entryStrings(normalized[key]);
		retainedStrings(original[key]).forEach((s, i) => {
			if (!haystack.some((h) => h.includes(s)))
				failures.push(`${label}: ${key}: original string #${i} not retained`);
		});
	}
	return failures;
}

function git(args) {
	return execFileSync("git", args, {
		cwd: REPO,
		encoding: "utf8",
		maxBuffer: 1 << 28,
	});
}

/**
 * `--verify <ref>`: prove the migration against the pre-migration tree. Checks
 * every context file's retention, that the set of context files is unchanged,
 * and that no catalogue (non-context) JSON differs from <ref> by a single byte.
 */
export function verifyAgainst(ref) {
	const failures = [];
	const rel = (p) => p.slice(REPO.length + 1);
	const before = git([
		"ls-tree",
		"-r",
		"--name-only",
		ref,
		"--",
		"src/i18n/catalogues",
	])
		.split("\n")
		.filter((p) => p.endsWith(".context.json"))
		.sort();
	const now = contextFiles().map(rel).sort();
	if (JSON.stringify(before) !== JSON.stringify(now))
		failures.push("the set of .context.json files changed");
	let entries = 0;
	let strings = 0;
	for (const path of now) {
		const original = JSON.parse(git(["show", `${ref}:${path}`]));
		const normalized = JSON.parse(readFileSync(join(REPO, path), "utf8"));
		entries += Object.keys(original).length;
		for (const e of Object.values(original))
			strings += retainedStrings(e).length;
		failures.push(...retentionFailures(path, original, normalized));
	}
	const catalogueDiff = git([
		"diff",
		"--name-only",
		ref,
		"--",
		"src/i18n/catalogues",
	])
		.split("\n")
		.filter((p) => p.endsWith(".json") && !p.endsWith(".context.json"));
	for (const p of catalogueDiff) failures.push(`catalogue changed: ${p}`);
	return { failures, files: now.length, entries, strings };
}

export function main(argv, cataloguesDir = CATALOGUES) {
	const verifyAt = argv.indexOf("--verify");
	if (verifyAt !== -1) {
		const ref = argv[verifyAt + 1];
		if (!ref) {
			process.stderr.write("normalize-context: --verify needs a git ref\n");
			return 2;
		}
		const { failures, files, entries, strings } = verifyAgainst(ref);
		for (const f of failures) process.stderr.write(`normalize-context: ${f}\n`);
		process.stdout.write(
			`normalize-context: retention vs ${ref} — ${files} file(s), ${entries} entr(ies), ${strings} original string(s), ${failures.length} failure(s)\n`,
		);
		return failures.length > 0 ? 1 : 0;
	}
	const check = argv.includes("--check");
	const changed = [];
	for (const path of contextFiles(cataloguesDir)) {
		const next = normalizeFile(path);
		if (next === null) continue;
		changed.push(path);
		if (!check) writeFileSync(path, next);
	}
	process.stdout.write(
		`normalize-context: ${changed.length} file(s) ${check ? "would change" : "rewritten"}\n`,
	);
	return check && changed.length > 0 ? 1 : 0;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
	process.exit(main(process.argv.slice(2)));
}
