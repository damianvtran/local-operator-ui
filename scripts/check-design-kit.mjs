#!/usr/bin/env node
/**
 * The parity gate over `docs/design-kit/`: the vendored kit slice must equal the
 * kit at its locked ref, and this tree's brand must equal the slice.
 *
 * WHAT IT CATCHES, and each half is a real failure rather than a hypothetical
 * one:
 *
 *   1. THE PIN LYING. `docs/design-kit/` vendors byte copies of three files
 *      from `damianvtran/local-operator-design` at the ref `lock.json` names,
 *      plus a sha256 per file. If a slice file is hand-edited, dropped, or
 *      supplemented with a file nobody locked, this tree's copy of the brand
 *      record quietly stops being the kit's — and the next consumer to quote
 *      `app-family.json` publishes values that exist nowhere upstream. The
 *      remote half catches the same lie from the other side: the kit at `ref`
 *      no longer shipping the locked bytes (a moved tag, a rewritten remote) is
 *      invisible to any purely local check, so it is fetched and hashed too.
 *
 *   2. A BRAND VALUE EDITED HERE. The kit is the home of record: a colour or
 *      role change lands there first, with its measurement, and arrives here by
 *      a deliberate pin bump; a sanctioned departure is recorded in the kit's
 *      `divergences.json` before it lands here. An edit to
 *      `palettes/local-operator.ts` or to the `ThemePalette` contract that never
 *      went through the kit leaves the two records disagreeing, and this half
 *      finds it WITHOUT the network: it re-derives the two `localOperator*`
 *      palettes by executing the module the app renders from, scans the
 *      contract's member list, and compares both against the vendored
 *      `app-family.json`. The other fifty-seven palettes are community-owned
 *      identities and are deliberately not read.
 *
 * WHAT A FAILED FETCH MEANS. A network failure is not a drift verdict: it is
 * exit 2 and an explicit UNVERIFIED (never verified-false), never a skip — a
 * gate that cannot tell "the pin is honest" from "I could not look" is the
 * silent pass this directory exists to remove (`scripts/entry-point.mjs`
 * argues the same failure at the process level). HTTP non-200 is the same
 * answer for the same reason.
 *
 * WHY THIS IS NOT A BUILD-TIME IMPORT. The kit's consumption contract (its
 * README, "Consuming this kit: pin and lock") is a pinned slice plus a parity
 * gate, never an import and never an npm dependency: nothing under `src/` reads
 * this directory, and no build step does either. The slice is read-only bytes;
 * this script is the only thing that reads them, and `lock.json` is written
 * only by the vendoring procedure.
 *
 * Comment/string-aware `ThemePalette` scanning is deliberately the same shape
 * as the kit's `tools/extract-app-family.mjs` — the file that produced the
 * vendored `app-family.json` — so the two sides cannot drift into two different
 * readings of the contract, and the palette values are read by EXECUTING the
 * module (through an in-memory esbuild bundle of the shipped TypeScript) rather
 * than by re-parsing literals, for the same reason the kit states.
 *
 * Usage: node scripts/check-design-kit.mjs   (wired into `pnpm check-themes`)
 * Exit codes: 0 clean; 1 drift (either family above); 2 could-not-verify.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { isEntryPoint } from "./entry-point.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the pinned slice lives, relative to the repo root. */
const SLICE_RELATIVE = "docs/design-kit";

/** The two files the slice carries beside the locked ones. */
const BESIDE_THE_LOCK = new Set(["lock.json", "README.md"]);

/** How long one anonymous fetch may take before it counts as a network error. */
const FETCH_TIMEOUT_MS = 15000;

/** The two palettes the kit owns — the only brand palettes in the tree. */
const BRAND_PALETTES = ["localOperatorDark", "localOperatorLight"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Every file under `dir`, recursively, as repo-relative POSIX-ish names. */
function listFiles(dir, prefix = "") {
	const entries = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		const relativeName = prefix ? `${prefix}/${name}` : name;
		if (statSync(path).isDirectory())
			entries.push(...listFiles(path, relativeName));
		else entries.push(relativeName);
	}
	return entries;
}

/* ---- family 1: the pin is lying ---------------------------------------- */

function pinLying(detail) {
	return `the pin is lying: ${detail} — fix: re-vendor and re-lock from the kit's digests.json at the pinned ref; if the kit legitimately moved, land a deliberate pin bump with its reason recorded. A sanctioned difference is recorded in the kit's divergences.json, never edited into the slice.`;
}

/* ---- family 2: someone edited brand values locally ---------------------- */

function brandEdited(diffs) {
	return `someone edited brand values locally: ${diffs.join("; ")}. The kit is the home of record: a brand change lands in the kit first with its measurement and arrives here by a deliberate pin bump, and a sanctioned departure is recorded in the kit's divergences.json before it lands here.`;
}

/** Collect every value difference between two parsed JSON trees, by JSON path. */
function valueDiffs(local, vendored, path, out) {
	if (
		local === null ||
		vendored === null ||
		typeof local !== "object" ||
		typeof vendored !== "object"
	) {
		if (!Object.is(local, vendored)) {
			out.push(
				`${path}: this tree ${JSON.stringify(local)} vs vendored ${JSON.stringify(vendored)}`,
			);
		}
		return;
	}
	if (Array.isArray(local) || Array.isArray(vendored)) {
		if (JSON.stringify(local) !== JSON.stringify(vendored)) {
			out.push(
				`${path}: this tree ${JSON.stringify(local)} vs vendored ${JSON.stringify(vendored)}`,
			);
		}
		return;
	}
	const keys = [...new Set([...Object.keys(local), ...Object.keys(vendored)])];
	for (const key of keys.sort()) {
		valueDiffs(local[key], vendored[key], `${path}/${key}`, out);
	}
}

/* ---- the role contract scanner ------------------------------------------
   Byte-for-byte the reading the kit's extractor performs (its comments name
   the same three patterns): skip comments and string literals so braces or
   colons inside prose cannot offset the structure; the type body is the text
   between the opening `{` of `export type ThemePalette = {` and its matching
   `}`; a top-level member is a line segment `name:` or `name?:` at depth 0.
   Anything else fails the run rather than silently truncating the contract. */

function bodyOf(source, marker) {
	const markerIndex = source.search(marker);
	if (markerIndex < 0) throw new Error(`marker not found: ${marker}`);
	const open = source.indexOf("{", markerIndex);
	let depth = 0;
	let inLine = false;
	let inBlock = false;
	let inStr = null;
	for (let j = open; j < source.length; j++) {
		const c = source[j];
		const two = source.slice(j, j + 2);
		if (inLine) {
			if (c === "\n") inLine = false;
			continue;
		}
		if (inBlock) {
			if (two === "*/") {
				inBlock = false;
				j++;
			}
			continue;
		}
		if (inStr) {
			if (c === "\\") j++;
			else if (c === inStr) inStr = null;
			continue;
		}
		if (two === "//") {
			inLine = true;
			j++;
			continue;
		}
		if (two === "/*") {
			inBlock = true;
			j++;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			inStr = c;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return source.slice(open + 1, j);
		}
	}
	throw new Error("unbalanced braces: the type body never closed");
}

function topLevelMembers(body) {
	const out = [];
	let depth = 0;
	let inLine = false;
	let inBlock = false;
	let inStr = null;
	let lineStart = 0;
	for (let k = 0; k < body.length; k++) {
		const c = body[k];
		const two = body.slice(k, k + 2);
		if (inLine) {
			if (c === "\n") {
				inLine = false;
				lineStart = k + 1;
			}
			continue;
		}
		if (inBlock) {
			if (two === "*/") {
				inBlock = false;
				k++;
			}
			continue;
		}
		if (inStr) {
			if (c === "\\") k++;
			else if (c === inStr) inStr = null;
			continue;
		}
		if (two === "//") {
			inLine = true;
			k++;
			continue;
		}
		if (two === "/*") {
			inBlock = true;
			k++;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			inStr = c;
			continue;
		}
		if (c === "{") depth++;
		else if (c === "}") depth--;
		else if (c === "\n") lineStart = k + 1;
		else if (depth === 0 && c === ":" && k > 0) {
			const segment = body.slice(lineStart, k);
			const m = /^\s*([A-Za-z][A-Za-z0-9]*)\??\s*$/.exec(segment);
			if (m) out.push(m[1]);
		}
	}
	return out;
}

/* ---- re-derive the brand from THIS tree --------------------------------- */

async function deriveBrand(root) {
	const themeDir = join(root, "src", "renderer", "src", "shared", "themes");
	const contractSource = readFileSync(
		join(themeDir, "palette-contract.ts"),
		"utf8",
	);
	const members = topLevelMembers(
		bodyOf(contractSource, /export type ThemePalette = \{/),
	);
	if (members.length < 30) {
		throw new Error(
			`only ${members.length} ThemePalette member(s) found — the type shape changed and this scanner no longer sees it`,
		);
	}

	const bundle = await build({
		stdin: {
			contents:
				'export * from "./src/renderer/src/shared/themes/palettes/local-operator";',
			resolveDir: root,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(
			bundle.outputFiles[0].text,
		).toString("base64")}`
	);

	const palettes = {};
	for (const name of BRAND_PALETTES) {
		const definition = mod[name];
		if (!definition) {
			throw new Error(`the palette module did not export ${name}`);
		}
		const { id, name: displayName, descriptionKey, palette } = definition;
		const { mode, ...values } = palette;
		palettes[name] = { id, name: displayName, descriptionKey, mode, values };
	}
	return { members, palettes };
}

/** The family-2 findings for one derived-vs-vendored comparison. */
function brandFindings(derived, vendored) {
	const diffs = [];
	for (const name of BRAND_PALETTES) {
		const local = derived.palettes[name];
		const expected = vendored?.palettes?.[name];
		/*
		 * The picker's description is NOT compared. It is app copy now: a
		 * `descriptionKey` the registry resolves against `src/i18n/catalogues/`,
		 * translated into every shipped locale, while the kit's `description` is the
		 * English sentence recorded when the pin was taken. Brand identity is the
		 * id, the established name, the mode and the values; the key itself is
		 * typechecked (`MessageKey`) and generated (`generate --check`), so a
		 * missing or misspelt message fails earlier than this gate.
		 */
		const identity = (palette) =>
			palette
				? {
						id: palette.id,
						name: palette.name,
						mode: palette.mode,
						values: palette.values,
					}
				: palette;
		valueDiffs(identity(local), identity(expected), `/palettes/${name}`, diffs);
		if (
			typeof local?.descriptionKey !== "string" ||
			!local.descriptionKey.startsWith("ui.settings.appearance.theme.")
		) {
			diffs.push(
				`/palettes/${name}/descriptionKey: this tree has no theme-picker message key (${JSON.stringify(local?.descriptionKey)})`,
			);
		}
	}
	const vendoredMembers = vendored?.contract?.members ?? [];
	const missing = vendoredMembers.filter((m) => !derived.members.includes(m));
	const extra = derived.members.filter((m) => !vendoredMembers.includes(m));
	if (missing.length) {
		diffs.push(
			`/contract/members: this tree's ThemePalette no longer declares ${missing.join(", ")} (the vendored contract records them)`,
		);
	}
	if (extra.length) {
		diffs.push(
			`/contract/members: this tree's ThemePalette declares ${extra.join(", ")}, which the vendored contract does not`,
		);
	}
	return diffs.length ? [brandEdited(diffs)] : [];
}

/* ---- the remote witness ------------------------------------------------- */

/** One fetch, retried once on a network error, under a bounded timeout. */
async function fetchKitFile(fetchImpl, url) {
	let lastError;
	for (let attempt = 0; attempt < 2; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
		try {
			return await fetchImpl(url, { signal: controller.signal });
		} catch (error) {
			lastError = error;
		} finally {
			clearTimeout(timer);
		}
	}
	throw lastError;
}

/**
 * Fetch one locked file from the kit at `ref` and classify the outcome:
 * `{ verified: true }`, `{ finding }` (verified false — the pin is lying) or
 * `{ unverified }` (could not look; never a pass, never drift).
 */
async function remoteOutcome(fetchImpl, lock, name, expected) {
	const url = `https://raw.githubusercontent.com/${lock.kit}/${lock.ref}/${name}`;
	let response;
	try {
		response = await fetchKitFile(fetchImpl, url);
	} catch (error) {
		return {
			unverified:
				`the pin is UNVERIFIED (not verified-false): could not fetch ${url} ` +
				`(${error?.message ?? error}); rerun with network access to verify it.`,
		};
	}
	if (!response.ok) {
		return {
			unverified:
				`the pin is UNVERIFIED (not verified-false): ${url} answered HTTP ` +
				`${response.status}; rerun with network access (or correct the ref) to verify it.`,
		};
	}
	const actual = sha256(Buffer.from(await response.arrayBuffer()));
	if (actual !== expected) {
		return {
			finding: pinLying(
				`${lock.ref} on ${lock.kit} ships ${name} with sha256 ${actual}, but lock.json records ${expected}`,
			),
		};
	}
	return { verified: true };
}

/* ---- the gate ----------------------------------------------------------- */

/**
 * Check the vendored slice and this tree's brand against each other.
 *
 * Returns `{ exitCode, findings, unverified, lock }`. `findings` are the drift
 * messages (families 1 and 2 above) — exit 1; `unverified` are network failures
 * — exit 2, and only consulted when no drift was found. Every check is
 * collected rather than thrown so one run says everything that is wrong.
 * Options: `root` (defaults to this checkout) and `fetch` (defaults to the
 * global), injected so the tests run offline and against fixtures.
 */
export async function checkDesignKit(options = {}) {
	const root = options.root ?? ROOT;
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const sliceDir = join(root, SLICE_RELATIVE);
	const findings = [];
	const unverified = [];
	const finish = () => ({
		exitCode: findings.length ? 1 : unverified.length ? 2 : 0,
		findings,
		unverified,
		lock,
	});

	let lock;
	try {
		lock = JSON.parse(readFileSync(join(sliceDir, "lock.json"), "utf8"));
	} catch (error) {
		findings.push(
			pinLying(
				`${SLICE_RELATIVE}/lock.json is missing or unreadable (${error.message})`,
			),
		);
		return finish();
	}
	for (const field of ["kit", "version", "ref", "files"]) {
		if (!lock[field]) {
			findings.push(pinLying(`${SLICE_RELATIVE}/lock.json has no '${field}'`));
		}
	}
	if (findings.length) return finish();
	for (const [name, expected] of Object.entries(lock.files)) {
		if (!/^[0-9a-f]{64}$/.test(expected)) {
			findings.push(
				pinLying(
					`lock.json records '${expected}' for ${name}, which is not a sha256`,
				),
			);
		}
	}
	if (findings.length) return finish();

	// The slice as it sits on disk, against its own lock — bytes, not values:
	// the lock's job is byte identity with the kit.
	for (const [name, expected] of Object.entries(lock.files)) {
		let bytes;
		try {
			bytes = readFileSync(join(sliceDir, name));
		} catch {
			findings.push(
				pinLying(
					`${SLICE_RELATIVE}/${name} is recorded in lock.json but is not on disk`,
				),
			);
			continue;
		}
		const actual = sha256(bytes);
		if (actual !== expected) {
			findings.push(
				pinLying(
					`${SLICE_RELATIVE}/${name} has sha256 ${actual}, but lock.json records ${expected}`,
				),
			);
		}
	}

	// Nothing sits in the slice directory that the lock does not name — a file
	// beside the slice is exactly how a hand-edited copy survives a re-vendor.
	for (const name of listFiles(sliceDir)) {
		if (BESIDE_THE_LOCK.has(name)) continue;
		if (!Object.hasOwn(lock.files, name)) {
			findings.push(
				pinLying(
					`${SLICE_RELATIVE}/${name} sits beside the locked slice but is not in lock.json; the slice is written only by the vendoring procedure`,
				),
			);
		}
	}

	// The brand half — purely local, and deliberately value-based: a comment or
	// formatting edit to a palette file is not brand drift, a changed role or
	// value is.
	let vendored = null;
	try {
		vendored = JSON.parse(
			readFileSync(join(sliceDir, "app-family.json"), "utf8"),
		);
	} catch {
		// The slice check above has already reported this; there is nothing to
		// compare against.
	}
	if (vendored) {
		try {
			const derived = await deriveBrand(root);
			findings.push(...brandFindings(derived, vendored));
		} catch (error) {
			findings.push(
				brandEdited([
					`the brand palettes could not be re-derived from this tree (${error.message})`,
				]),
			);
		}
	}

	// The remote half. A failed fetch is its own verdict class, never a pass.
	const outcomes = await Promise.all(
		Object.entries(lock.files).map(([name, expected]) =>
			remoteOutcome(fetchImpl, lock, name, expected),
		),
	);
	for (const outcome of outcomes) {
		if (outcome.finding) findings.push(outcome.finding);
		if (outcome.unverified) unverified.push(outcome.unverified);
	}

	return finish();
}

async function main() {
	const result = await checkDesignKit();
	if (result.exitCode === 0) {
		const count = Object.keys(result.lock.files).length;
		console.log(
			`check-design-kit: ${count} slice file(s) match lock.json and ${result.lock.kit}@${result.lock.ref} (remote verified); the two localOperator palettes re-derive to the vendored app-family.json.`,
		);
		return;
	}
	if (result.exitCode === 2) {
		console.error(
			"check-design-kit: FAILED — the pin is UNVERIFIED (not verified-false)",
		);
		for (const line of result.unverified) console.error(`  - ${line}`);
		console.error(
			"  - no drift was found locally, but the kit-at-ref comparison did not " +
				"run: rerun with network access rather than reading this as a pass.",
		);
		process.exitCode = 2;
		return;
	}
	console.error("check-design-kit: FAILED — drift");
	for (const line of result.findings) console.error(`  - ${line}`);
	for (const line of result.unverified) console.error(`  - ${line}`);
	process.exitCode = 1;
}

if (isEntryPoint(import.meta.url)) {
	main().catch((error) => {
		console.error(`check-design-kit: FAILED to run: ${error.message}`);
		process.exitCode = 1;
	});
}
