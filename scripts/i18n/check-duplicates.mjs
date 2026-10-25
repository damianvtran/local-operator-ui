#!/usr/bin/env node
/**
 * THE CATALOGUE DUPLICATE-KEY GATE.
 *
 * WHY THIS EXISTS. A `git merge` of two catalogue edits can produce a JSON
 * object with the SAME key twice. Git reports no conflict — the edits are in
 * different places — and `JSON.parse` silently keeps the LAST copy, so:
 *
 *   - the translator's contribution is gone with nothing on screen to show it;
 *   - `check-coverage.mjs` compares parsed objects, so it sees full coverage;
 *   - `ledger-check.mjs` hashes file bytes, so it sees a perfectly valid file;
 *   - every other gate stays green.
 *
 * That is not hypothetical: on 2026-10-25 main and a feature branch both keyed
 * the same chat composer, six catalogue files merged with duplicate keys, and
 * no gate said a word because every gate reads PARSED objects — where the
 * duplicate has already been erased. This check therefore reads the RAW TEXT,
 * which is the only place the duplicate still exists.
 *
 * WHAT IT FLAGS. The same key twice within one object, at any depth. The same
 * key in two DIFFERENT objects (`card.title` and `tile.title`) is normal and is
 * not a duplicate.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied:
 *   - it does not validate JSON — `JSON.parse` in the other gates does that;
 *   - it scans context sidecars (`.context.json`) too, even though they are not
 *     shipped copy: a duplicate there loses a translator note just as silently;
 *   - it does not scan `src/i18n/keys.gen.ts`, which is generated and covered by
 *     `generate.mjs --check`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_CATALOGUES = join(REPO, "src", "i18n", "catalogues");

/**
 * Return every key that appears more than once inside the same object.
 *
 * Hand-written rather than a parser plugin, deliberately: the duplicate must be
 * found BEFORE `JSON.parse` collapses it. Strings are walked with escape
 * handling so a `"` inside a value cannot desynchronise the scan; a string only
 * counts as a key when the next non-space character is `:` inside an object.
 */
export function duplicateKeys(text) {
	const duplicates = [];
	const stack = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === "{") {
			stack.push(new Set());
			i += 1;
		} else if (c === "}") {
			if (stack.length) stack.pop();
			i += 1;
		} else if (c === '"') {
			let j = i + 1;
			let value = "";
			while (j < text.length) {
				if (text[j] === "\\") {
					value += text.slice(j, j + 2);
					j += 2;
					continue;
				}
				if (text[j] === '"') break;
				value += text[j];
				j += 1;
			}
			let k = j + 1;
			while (k < text.length && " \t\r\n".includes(text[k])) k += 1;
			if (k < text.length && text[k] === ":" && stack.length) {
				const keys = stack[stack.length - 1];
				const key = decodeKey(value);
				if (keys.has(key)) duplicates.push(key);
				keys.add(key);
			}
			i = j + 1;
		} else {
			i += 1;
		}
	}
	return duplicates;
}

/**
 * Decode the escapes a JSON key may carry, so `"\u0061"` and `"a"` are the same
 * key. JSON.parse would collapse them; this scanner compares raw text, so it
 * has to normalise them itself or a `\u`-escaped duplicate is a false negative.
 */
function decodeKey(raw) {
	return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
		String.fromCharCode(Number.parseInt(hex, 16)),
	);
}

export function catalogueFiles(dir = DEFAULT_CATALOGUES) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...catalogueFiles(full));
		else if (entry.endsWith(".json")) out.push(full);
	}
	return out;
}

export function findDuplicates(files = catalogueFiles()) {
	const offenders = [];
	for (const file of files) {
		const duplicates = duplicateKeys(readFileSync(file, "utf8"));
		if (duplicates.length) {
			offenders.push({
				file: relative(REPO, file),
				keys: [...new Set(duplicates)].sort(),
			});
		}
	}
	return { scanned: files.length, offenders };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	// `--dir` exists so the FAILURE path is testable: the suite plants a
	// duplicate in a scratch directory and asserts this exits non-zero, which a
	// guard that only ever runs against clean data can never prove.
	const dirFlag = process.argv.indexOf("--dir");
	const dir = dirFlag === -1 ? undefined : process.argv[dirFlag + 1];
	if (dirFlag !== -1 && !dir) {
		console.error("check-duplicates: --dir needs a path");
		process.exit(2);
	}
	const { scanned, offenders } = findDuplicates(
		dir ? catalogueFiles(dir) : undefined,
	);
	if (!scanned) {
		console.error(
			`check-duplicates: FAILED — no catalogue files found under ${dir ?? DEFAULT_CATALOGUES}`,
		);
		process.exit(1);
	}
	if (offenders.length) {
		for (const { file, keys } of offenders) {
			console.error(
				`check-duplicates: ${file}: duplicate key(s) ${keys.join(", ")}`,
			);
		}
		console.error(
			`check-duplicates: FAILED — ${offenders.length} file(s) with duplicate keys across ${scanned} scanned`,
		);
		process.exit(1);
	}
	console.log(
		`check-duplicates: ok — ${scanned} file(s) scanned, 0 duplicate key(s)`,
	);
}
