#!/usr/bin/env node
/**
 * The i18n ratchet for hardcoded user-facing strings (RFC §2.7, TS half).
 *
 * WHAT IT FLAGS, precisely — the two shapes the RFC's inventory measured
 * (`aria-label`/`placeholder`/`title`/`alt` attribute copy, and JSX text),
 * found through the REAL TypeScript compiler rather than a regex:
 *
 *   - `JsxText` nodes whose text contains a letter (whitespace-only,
 *     punctuation-only — `·`, `—` — and digit-only texts are ignored);
 *   - literal `aria-label` / `placeholder` / `title` / `alt` attributes
 *     whose value contains a letter.
 *
 * KNOWN BOUNDARIES, stated rather than implied (the core checker's own
 * docstring has the same section, and for the same reason — a false negative
 * nothing reports is the one outcome this file must not quietly produce):
 *
 *   - Strings in plain object literals (`{ title: "New chat" }`, menu data,
 *     command definitions) are NOT counted in v1; the extraction slices that
 *     reach those shapes extend this walker then, with their counts.
 *   - A copy attribute whose value is an EXPRESSION (`aria-label={cond ? "A"
 *     : "B"}`) is not counted; only literal values are.
 *   - A string assembled with `+` or a template literal is not counted (the
 *     core checker documents the same blind spot for its own grammar).
 *
 * THE RATCHET, mirroring `local-operator/scripts/i18n/check.py`:
 *
 *   - `i18n/baseline.json` carries per-file counts that may only stay equal or
 *     go down. `--init` writes it once (the capture of the tree as it stands);
 *     `--update <paths>` lowers entries (and refuses to raise them); a file
 *     with no entry starts at 0.
 *   - `i18n/allowlist.json` exempts a file (or a directory prefix ending in
 *     `/`) with a REQUIRED reason; no globs (a glob silently spans
 *     directories; a directory is written as one, visibly).
 *   - `// i18n: ignore <reason>` (or the JSX-comment spelling
 *     `{/* i18n: ignore <reason> *​/}`) inside the flagged node's own span, or
 *     inside its enclosing JSX element, exempts it — the core's
 *     "within the call's first through last line" rule, translated: a JSX
 *     attribute cannot carry a comment of its own, so its enclosing element is
 *     the span that reads naturally (the fixture beside this file pins both).
 *   - ENFORCEMENT IS SCOPED (RFC §9: P1 ships ADVISORY). Findings inside the
 *     enforced prefixes fail; everything else prints as `advisory:` and does
 *     not. The shipped default covers the code this program owns — the i18n
 *     core and this tooling; extraction slices activate their area by adding
 *     its prefix to `enforced` in a reviewed change.
 *
 * THE COMPILER API, and why this file is the only place it is touched: this
 * repository's `typescript` is the native TS 7, whose programmatic surface is
 * `typescript/unstable/*` (the classic `ts.createSourceFile` no longer exists
 * in its package). `check-strings.test.mjs` drives every branch of this file
 * on fixtures that live in `scripts/i18n/fixtures/` — which are excluded from
 * the scan itself, exactly because they exist to be flagged.
 *
 * USAGE:
 *   node scripts/i18n/check-strings.mjs             # check (exit 1 on failure)
 *   node scripts/i18n/check-strings.mjs --init      # write the baseline once
 *   node scripts/i18n/check-strings.mjs --update <path>…   # lower ceilings
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const BASELINE = join(REPO, "i18n", "baseline.json");
export const ALLOWLIST = join(REPO, "i18n", "allowlist.json");

/**
 * The scanned corpus, repo-relative. `scripts/i18n/` is scanned because it is
 * inside the enforced scope: the tooling must not grow user-visible prose of
 * its own. `scripts/i18n/fixtures/` is EXCLUDED — those files exist to be
 * flagged by the tests, and they live outside the scan for exactly that
 * reason (the exclusion is asserted by `check-strings.test.mjs`).
 */
export const SCAN_ROOTS = ["src", "scripts/i18n"];
const SCAN_EXCLUDED = ["scripts/i18n/fixtures/"];

/** Fallback enforcement scope when the baseline carries no `enforced` field. */
export const DEFAULT_ENFORCED = ["src/i18n/", "scripts/i18n/"];

export const BASELINE_NOTE =
	"enforced = blocking scope (path prefixes or exact paths); findings elsewhere are " +
	"advisory (report-only) until the area's extraction slice adds its prefix. " +
	"files = per-file literal ceilings (shrink-only; new files start at 0). " +
	"See scripts/i18n/check-strings.mjs.";

/** The copy-bearing attributes the RFC's inventory measured. */
export const COPY_ATTRIBUTES = new Set([
	"aria-label",
	"placeholder",
	"title",
	"alt",
]);

/** Any Unicode letter — the line between prose and punctuation/format tokens. */
const LETTER_RE = /\p{L}/u;

/*
 * `// i18n: ignore <reason>`, and the JSX block-comment spelling of the same
 * pragma between braces (a slash-star comment — its closer is deliberately
 * not written out here, because it would end THIS comment) — non-newline
 * whitespace only, so the reason cannot be the prose on the next line (the
 * core's line-bounded `\s+\S`, kept for the same false-positive reason).
 *
 * TWO patterns rather than one, because the block form's CLOSER would
 * otherwise supply the reason: in a reasonless block pragma the character
 * after `ignore` is the closing `*`, which a single `\S` arm would count as
 * a reason. The block pattern therefore requires the reason to START with a
 * character that is neither whitespace nor `*` (the `//` form needs no such
 * care: its comment runs to end of line).
 */
const LINE_PRAGMA_RE = /\/\/[^\S\n]*i18n:[^\S\n]*ignore[^\S\n]+\S/g;
const BLOCK_PRAGMA_RE =
	/\/\*[^\S\n]*i18n:[^\S\n]*ignore[^\S\n]+([^\s*][^\n]*?)\*\//g;

const SCRIPT_RE = /\.(ts|tsx|mjs)$/;

function toPosix(path) {
	return path.split(sep).join("/");
}

/** The repo-relative path of `abs`, or null when it is outside `repo`. */
function repoRelative(repo, abs) {
	const rel = toPosix(relative(repo, abs));
	if (rel === "" || rel.startsWith("..") || rel.includes("/../")) return null;
	return rel;
}

function isScanned(rel) {
	if (!SCRIPT_RE.test(rel) || rel.endsWith(".d.ts")) return false;
	/* Stories are NOT product copy: they exist to render component states in
	 * Storybook and the gallery, nobody translates them, and counting them
	 * would inflate every ceiling with literals no extraction slice ever
	 * lowers. A story that grows product copy is a story that should render a
	 * real translated component instead. */
	if (rel.includes(".stories.")) return false;
	if (SCAN_EXCLUDED.some((prefix) => rel.startsWith(prefix))) return false;
	return SCAN_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`));
}

// ---------------------------------------------------------------------------
// The walker
// ---------------------------------------------------------------------------

function lineOf(sourceFile, position) {
	return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

/** The 1-based [first, last] lines a node spans (position is its own span). */
function lineSpan(sourceFile, node) {
	const start = node.getStart(sourceFile);
	const end = Math.max(start, node.getEnd() - 1);
	return [
		sourceFile.getLineAndCharacterOfPosition(start).line + 1,
		sourceFile.getLineAndCharacterOfPosition(end).line + 1,
	];
}

/** The nearest enclosing JSX element/fragment, if any. */
function enclosingElement(node) {
	let current = node.parent;
	while (current) {
		if (
			current.kind === SyntaxKind.JsxElement ||
			current.kind === SyntaxKind.JsxSelfClosingElement ||
			current.kind === SyntaxKind.JsxFragment
		) {
			return current;
		}
		current = current.parent;
	}
	return undefined;
}

/** The lines carrying an `i18n: ignore` pragma, as a Set. */
function pragmaLines(sourceFile) {
	const lines = new Set();
	for (const match of sourceFile.text.matchAll(LINE_PRAGMA_RE)) {
		lines.add(sourceFile.getLineAndCharacterOfPosition(match.index).line + 1);
	}
	for (const match of sourceFile.text.matchAll(BLOCK_PRAGMA_RE)) {
		lines.add(sourceFile.getLineAndCharacterOfPosition(match.index).line + 1);
	}
	return lines;
}

function inSpan([first, last], lines) {
	for (let line = first; line <= last; line += 1) {
		if (lines.has(line)) return true;
	}
	return false;
}

/** One line of display text, shorter than the source line in the report. */
function collapse(text) {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * The findings of one parsed file: `{ kind, line, text }`, in source order.
 *
 * `kind` is `jsx-text` or `attribute:<name>`; `line` is where the report can
 * point a reader. The pragma check consults the node's own span AND its
 * enclosing element's (see the module docstring for why both).
 */
export function findViolations(sourceFile) {
	const pragmas = pragmaLines(sourceFile);
	const findings = [];
	const visit = (node) => {
		if (node.kind === SyntaxKind.JsxText) {
			if (LETTER_RE.test(node.text)) {
				const exempt =
					inSpan(lineSpan(sourceFile, node), pragmas) ||
					(enclosingElement(node)
						? inSpan(lineSpan(sourceFile, enclosingElement(node)), pragmas)
						: false);
				if (!exempt) {
					findings.push({
						kind: "jsx-text",
						line: lineOf(sourceFile, node.getStart(sourceFile)),
						text: collapse(node.text),
					});
				}
			}
		} else if (node.kind === SyntaxKind.JsxAttribute) {
			const name = node.name?.text;
			const initializer = node.initializer;
			if (
				name !== undefined &&
				COPY_ATTRIBUTES.has(name) &&
				initializer?.kind === SyntaxKind.StringLiteral &&
				LETTER_RE.test(initializer.text)
			) {
				const exempt =
					inSpan(lineSpan(sourceFile, node), pragmas) ||
					(enclosingElement(node)
						? inSpan(lineSpan(sourceFile, enclosingElement(node)), pragmas)
						: false);
				if (!exempt) {
					findings.push({
						kind: `attribute:${name}`,
						line: lineOf(sourceFile, initializer.getStart(sourceFile)),
						text: collapse(initializer.text),
					});
				}
			}
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return findings.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Allowlist and baseline (shapes mirror check.py, JSON instead of TOML)
// ---------------------------------------------------------------------------

/**
 * `[{ path, reason }]` entries. A missing reason is a hard error: the reason
 * is the whole reason the entry is reviewable.
 */
export function loadAllowlist(path) {
	let data;
	try {
		data = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw new Error(`${path}: ${error.message}`);
	}
	const entries = data?.entries ?? [];
	if (!Array.isArray(entries)) {
		throw new Error(
			`${path}: \`entries\` must be a list of { path, reason } objects`,
		);
	}
	return entries.map((entry) => {
		if (
			typeof entry !== "object" ||
			entry === null ||
			typeof entry.path !== "string"
		) {
			throw new Error(
				`${path}: every allowlist entry must be { "path": ..., "reason": ... }`,
			);
		}
		if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
			throw new Error(
				`${path}: allowlist entry ${JSON.stringify(entry.path)} has no reason`,
			);
		}
		return { path: entry.path, reason: entry.reason };
	});
}

/**
 * The reason this repo-relative path is exempt, or undefined.
 *
 * Two forms, both exact: a file path, or a directory prefix ending in `/`.
 * No globs on purpose (the core checker's rule, kept).
 */
export function allowlistReason(rel, entries) {
	for (const entry of entries) {
		if (entry.path.endsWith("/")) {
			if (rel.startsWith(entry.path)) return entry.reason;
		} else if (rel === entry.path) {
			return entry.reason;
		}
	}
	return undefined;
}

/** The baseline object; a missing or damaged file reads as empty (fail closed). */
export function loadBaseline(path) {
	let data = {};
	try {
		data = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// Missing or damaged: the DEFAULT_ENFORCED fallback below is fail-closed.
	}
	if (typeof data !== "object" || data === null) data = {};
	const files = data.files;
	const enforced = data.enforced;
	return {
		schema: data.schema ?? 1,
		note: typeof data.note === "string" ? data.note : BASELINE_NOTE,
		enforced: Array.isArray(enforced)
			? enforced.map(String)
			: [...DEFAULT_ENFORCED],
		files:
			typeof files === "object" && files !== null
				? Object.fromEntries(
						Object.entries(files).map(([key, value]) => [key, Number(value)]),
					)
				: {},
	};
}

export function saveBaseline(path, files, enforced, note) {
	/*
	 * Rendered line-by-line rather than JSON.stringify'd, because the repo's
	 * formatter (biome) COLLAPSES a short array onto one line and this file is
	 * read by humans in review — the two must agree or every re-init produces
	 * a re-format. Reproduce biome's decision for the sizes this file carries:
	 * `enforced` inline while it fits the 80-column line, one per line after.
	 */
	const sorted = Object.keys(files).sort();
	const lines = ["{", '\t"schema": 1,', `\t"note": ${JSON.stringify(note)},`];
	const inlineEnforced = enforced
		.map((entry) => JSON.stringify(entry))
		.join(", ");
	const inlineLine = `\t"enforced": [${inlineEnforced}],`;
	if (inlineLine.length <= 80) {
		lines.push(inlineLine);
	} else {
		lines.push('\t"enforced": [');
		for (const entry of enforced) lines.push(`\t\t${JSON.stringify(entry)},`);
		lines.push("\t],");
	}
	if (sorted.length === 0) {
		lines.push('\t"files": {}');
	} else {
		lines.push('\t"files": {');
		sorted.forEach((key, index) => {
			const comma = index < sorted.length - 1 ? "," : "";
			lines.push(`\t\t${JSON.stringify(key)}: ${files[key]}${comma}`);
		});
		lines.push("\t}");
	}
	lines.push("}");
	writeFileSync(path, `${lines.join("\n")}\n`);
}

export function inEnforcedScope(rel, enforced) {
	for (const entry of enforced) {
		if (entry.endsWith("/")) {
			if (rel.startsWith(entry)) return true;
		} else if (rel === entry) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Scanning a snapshot
// ---------------------------------------------------------------------------

/**
 * Open a snapshot with the two tsconfig projects plus any extra files.
 *
 * Extra files are how fixtures are scanned: with no tsconfig above them they
 * land in the compiler's inferred project, which parses TSX fine (pinned by
 * the tests). The caller MUST `api.close()` — that is what reaps the compiler
 * server child.
 */
export function openSnapshot(repo, extraFiles = []) {
	const api = new API({ cwd: repo });
	const snapshot = api.updateSnapshot({
		openProjects: [
			join(repo, "tsconfig.app.json"),
			join(repo, "tsconfig.node.json"),
		],
		openFiles: extraFiles,
	});
	return { api, snapshot };
}

/** `scripts/i18n`'s own top-level scripts — scanned, fixtures excluded. */
export function toolingFiles(repo) {
	const dir = join(repo, "scripts", "i18n");
	return readdirSync(dir)
		.filter((name) => name.endsWith(".mjs"))
		.map((name) => join(dir, name));
}

/**
 * Violations per scanned file: `Map<repoRelativePath, findings[]>`.
 *
 * Two corpora, one at a time. With no `extraScan`, the corpus is the scan
 * roots: candidates come from both projects' programs plus the top-level
 * `scripts/i18n` scripts no project includes, filtered by `isScanned`.
 * With `extraScan` (repo-relative fixture paths), the corpus is EXACTLY those
 * files, whatever the roots would say — that is how the tests scan the
 * fixtures, which deliberately live inside the excluded fixtures directory.
 */
export function scanSnapshot(snapshot, repo, { extraScan = [] } = {}) {
	const scanned = new Map();
	const add = (rel, sourceFile) => {
		if (sourceFile && !scanned.has(rel)) {
			scanned.set(rel, findViolations(sourceFile));
		}
	};
	if (extraScan.length > 0) {
		for (const rel of extraScan) {
			const abs = join(repo, rel);
			const project = snapshot.getDefaultProjectForFile(abs);
			add(rel, project?.program.getSourceFile(abs));
		}
		return scanned;
	}
	for (const project of snapshot.getProjects()) {
		for (const name of project.program.getSourceFileNames()) {
			const rel = repoRelative(repo, name);
			if (rel === null || !isScanned(rel)) continue;
			add(rel, project.program.getSourceFile(name));
		}
	}
	for (const abs of toolingFiles(repo)) {
		const rel = repoRelative(repo, abs);
		if (rel === null || !isScanned(rel)) continue;
		const project = snapshot.getDefaultProjectForFile(abs);
		add(rel, project?.program.getSourceFile(abs));
	}
	return scanned;
}

/** Per-file counts after the allowlist, files with none omitted. */
export function countsOf(scanned, allowlist) {
	const counts = {};
	for (const [rel, violations] of scanned) {
		if (allowlistReason(rel, allowlist) !== undefined) continue;
		if (violations.length > 0) counts[rel] = violations.length;
	}
	return counts;
}

/**
 * The counted files that exceed — or are missing from — their ceiling.
 * A file with no recorded ceiling starts at 0 (the core's rule).
 */
export function ratchetFindings(counts, files) {
	const out = [];
	for (const rel of Object.keys(counts).sort()) {
		/* `countsOf` never records zero-count files; a hand-built map (tests,
		 * callers) may, and a zero count is at-or-below any ceiling — including
		 * the implicit 0 of a file with no entry. */
		if (counts[rel] === 0) continue;
		const ceiling = Object.prototype.hasOwnProperty.call(files, rel)
			? files[rel]
			: undefined;
		if (ceiling === undefined)
			out.push({ path: rel, count: counts[rel], ceiling: null });
		else if (counts[rel] > ceiling)
			out.push({ path: rel, count: counts[rel], ceiling });
	}
	return out;
}

// ---------------------------------------------------------------------------
// The check, and the CLI
// ---------------------------------------------------------------------------

/**
 * Run the whole check. Returns everything the caller (CLI or test) needs;
 * nothing here prints or exits.
 */
export function runCheck({
	repo = REPO,
	extraScan = [],
	allowlist,
	baseline,
	allowlistPath = ALLOWLIST,
	baselinePath = BASELINE,
} = {}) {
	const entries = allowlist ?? loadAllowlist(allowlistPath);
	const { api, snapshot } = openSnapshot(
		repo,
		extraScan.map((rel) => join(repo, rel)),
	);
	try {
		const scanned = scanSnapshot(snapshot, repo, { extraScan });
		const counts = countsOf(scanned, entries);
		const loaded = baseline ?? loadBaseline(baselinePath);
		const over = ratchetFindings(counts, loaded.files);
		const failures = [];
		const advisories = [];
		for (const finding of over) {
			if (inEnforcedScope(finding.path, loaded.enforced))
				failures.push(finding);
			else advisories.push(finding);
		}
		return { scanned, counts, failures, advisories, baseline: loaded };
	} finally {
		api.close();
	}
}

function findingLine(finding) {
	if (finding.ceiling === null) {
		return `${finding.path}: ${finding.count} literal(s) — not in baseline.json; a file with no recorded ceiling starts at 0`;
	}
	return `${finding.path}: ${finding.count} literal(s) against a ceiling of ${finding.ceiling}`;
}

export function main(
	argv,
	{ baselinePath = BASELINE, allowlistPath = ALLOWLIST } = {},
) {
	let mode = "check";
	let force = false;
	const updatePaths = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--init") mode = "init";
		else if (arg === "--update") {
			mode = "update";
			while (
				argv[index + 1] !== undefined &&
				!argv[index + 1].startsWith("--")
			) {
				updatePaths.push(argv[++index]);
			}
		} else if (arg === "--force") force = true;
		else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				"usage: node scripts/i18n/check-strings.mjs [--init [--force]] [--update <path>…]\n",
			);
			return 0;
		} else {
			process.stderr.write(`check-strings.mjs: unknown argument ${arg}\n`);
			return 2;
		}
	}

	if (mode === "init") {
		// ANY existing baseline refuses without --force — an empty file must
		// not read as "no baseline" (the core's round-1 n3 lesson, kept).
		let exists = true;
		try {
			readFileSync(baselinePath);
		} catch {
			exists = false;
		}
		if (exists && !force) {
			process.stdout.write(
				"check-strings.mjs --init: a baseline already exists; use --force only for a " +
					"reviewed scanner-coverage change (say so in the PR body).\n",
			);
			return 2;
		}
		const entries = loadAllowlist(allowlistPath);
		const { api, snapshot } = openSnapshot(REPO);
		try {
			const counts = countsOf(scanSnapshot(snapshot, REPO), entries);
			const preserved = loadBaseline(baselinePath);
			saveBaseline(baselinePath, counts, preserved.enforced, preserved.note);
			const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
			process.stdout.write(
				`check-strings.mjs --init: baseline written: ${Object.keys(counts).length} file(s), ` +
					`${total} literal(s); enforced: ${preserved.enforced.join(", ") || "none"}\n`,
			);
			return 0;
		} finally {
			api.close();
		}
	}

	if (mode === "update") {
		if (updatePaths.length === 0) {
			process.stderr.write(
				"check-strings.mjs --update: name at least one path\n",
			);
			return 2;
		}
		const entries = loadAllowlist(allowlistPath);
		const { api, snapshot } = openSnapshot(REPO);
		try {
			const scanned = scanSnapshot(snapshot, REPO);
			const counts = countsOf(scanned, entries);
			const loaded = loadBaseline(baselinePath);
			const files = loaded.files;
			for (const raw of updatePaths) {
				const rel = toPosix(raw);
				if (allowlistReason(rel, entries) !== undefined) {
					process.stdout.write(
						`check-strings.mjs --update: ${rel} is allowlisted; nothing to lower\n`,
					);
					continue;
				}
				const next = counts[rel] ?? 0;
				const previous = Object.prototype.hasOwnProperty.call(files, rel)
					? files[rel]
					: undefined;
				if (previous === undefined) {
					if (next > 0) {
						process.stdout.write(
							`check-strings.mjs --update: ${rel} has ${next} literal(s) with no recorded ceiling — a file with no recorded ceiling starts at 0: extract, pragma, or allowlist instead of recording one.\n`,
						);
						return 1;
					}
					continue;
				}
				if (next > previous) {
					process.stdout.write(
						`check-strings.mjs --update: ${rel} went ${previous} -> ${next}; the baseline may only stay equal or go down.\n`,
					);
					return 1;
				}
				if (next > 0) files[rel] = next;
				else delete files[rel];
			}
			saveBaseline(baselinePath, files, loaded.enforced, loaded.note);
			process.stdout.write(
				`check-strings.mjs --update: baseline now ${Object.keys(files).length} file(s)\n`,
			);
			return 0;
		} finally {
			api.close();
		}
	}

	const { scanned, counts, failures, advisories } = runCheck();
	for (const advisory of advisories) {
		process.stdout.write(`advisory: ${findingLine(advisory)}\n`);
	}
	for (const failure of failures) {
		process.stdout.write(`${findingLine(failure)}\n`);
		const details = scanned.get(failure.path) ?? [];
		for (const detail of details.slice(0, 40)) {
			process.stdout.write(
				`  ${failure.path}:${detail.line}: ${detail.kind} ${JSON.stringify(detail.text)}\n`,
			);
		}
	}
	if (failures.length > 0) {
		process.stdout.write(
			`check-strings.mjs: FAILED — ${failures.length} finding(s) in the enforced scope (${advisories.length} advisory finding(s) outside it). Extract the string, add \`i18n: ignore <reason>\`, or (for a file-level exemption) record it in i18n/allowlist.json with a reason.\n`,
		);
		return 1;
	}
	const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
	const suffix =
		advisories.length > 0
			? `; ${advisories.length} advisory finding(s) (report-only until activated)`
			: "";
	process.stdout.write(
		`check-strings.mjs: ok — ${scanned.size} file(s) scanned, ${total} literal(s) at or ` +
			`below the baseline${suffix}\n`,
	);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
