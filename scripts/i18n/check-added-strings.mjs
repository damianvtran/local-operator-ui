#!/usr/bin/env node
/**
 * Fail-closed, base-aware guard for literal UI copy outside the original
 * JSX-text/literal-attribute inventory. It deliberately has NO baseline: only
 * findings whose literal starts on an added diff line fail, while the existing
 * shrink-only ratchet continues to govern the old shapes and historical debt.
 *
 * Covered additions:
 *   - copy-valued object properties such as `{ label: "New chat" }`;
 *   - expression-valued copy attributes such as `aria-label={"New chat"}`;
 *   - static literal arms of conditionals, logical fallbacks and `+`
 *     concatenations, plus literal spans of template expressions in either sink;
 *   - static text in JSX expression containers, including logical branches.
 *
 * This is a static sink check, not a claim about arbitrary runtime or server
 * text. Dynamic values, non-copy property names, and calls such as `t()` do not
 * expose a static literal to flag. Technical copy still needs the same narrow
 * `i18n: ignore <reason>` or allowlist reason as the original scanner.
 *
 * Usage: node scripts/i18n/check-added-strings.mjs [--base origin/main]
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SyntaxKind } from "typescript/unstable/ast";

import {
	ALLOWLIST,
	COPY_ATTRIBUTES,
	SCAN_ROOTS,
	allowlistReason,
	collapse,
	enclosingElement,
	inSpan,
	isScanned,
	lineSpan,
	loadAllowlist,
	openSnapshot,
	pragmaLines,
} from "./check-strings.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LETTER_RE = /\p{L}/u;
const CATALOGUE_KEY_RE = /^ui(?:\.[a-z0-9_]+)+$/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const TEST_DIRECTORY_RE = /(?:^|\/)(?:__tests__|tests?)\//;
const TEST_FILE_RE = /\.(?:test|spec)\.[^.]+$/;

/** Property names whose string values are product copy, not arbitrary data. */
export const COPY_PROPERTIES = new Set([
	...COPY_ATTRIBUTES,
	"label",
	"description",
	"message",
	"text",
	"tooltip",
	"helperText",
	"emptyText",
]);

function git(repo, args) {
	const result = spawnSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed: ${
				result.error?.message || result.stderr.trim() || `exit ${result.status}`
			}`,
		);
	}
	return result.stdout;
}

/** Resolve the comparison commit rather than silently accepting a missing ref. */
export function resolveComparisonBase(repo, requestedBase) {
	return git(repo, ["merge-base", requestedBase, "HEAD"]).trim();
}

/**
 * Read new-side hunk ranges. Count zero is legal and adds no lines; malformed
 * hunk headers fail closed instead of turning an unreadable diff into a pass.
 */
export function parseAddedLines(diff) {
	const added = new Set();
	let sawHunk = false;
	for (const line of diff.split("\n")) {
		if (!line.startsWith("@@")) continue;
		const match = HUNK_RE.exec(line);
		if (!match) throw new Error(`Cannot parse diff hunk header: ${line}`);
		sawHunk = true;
		const start = Number(match[1]);
		const count = match[2] === undefined ? 1 : Number(match[2]);
		for (let offset = 0; offset < count; offset += 1) {
			added.add(start + offset);
		}
	}
	return { added, sawHunk };
}

function propertyName(node) {
	if (
		node.kind === SyntaxKind.Identifier ||
		node.kind === SyntaxKind.StringLiteral
	) {
		return node.text;
	}
	return undefined;
}

/** Return only literal text nodes whose value is statically present in copy. */
function staticTextNodes(node) {
	switch (node.kind) {
		case SyntaxKind.StringLiteral:
		case SyntaxKind.NoSubstitutionTemplateLiteral:
			return [node];
		case SyntaxKind.TemplateExpression:
			return [node.head, ...node.templateSpans.map((span) => span.literal)];
		case SyntaxKind.ConditionalExpression:
			return [
				...staticTextNodes(node.whenTrue),
				...staticTextNodes(node.whenFalse),
			];
		case SyntaxKind.BinaryExpression: {
			const operator = node.operatorToken.kind;
			if (operator === SyntaxKind.AmpersandAmpersandToken) {
				// Only the right arm of && can become copy; the left is its guard.
				return staticTextNodes(node.right);
			}
			if (
				operator === SyntaxKind.PlusToken ||
				operator === SyntaxKind.BarBarToken ||
				operator === SyntaxKind.QuestionQuestionToken
			) {
				return [...staticTextNodes(node.left), ...staticTextNodes(node.right)];
			}
			return [];
		}
		case SyntaxKind.ParenthesizedExpression:
		case SyntaxKind.AsExpression:
		case SyntaxKind.SatisfiesExpression:
		case SyntaxKind.NonNullExpression:
			return staticTextNodes(node.expression);
		default:
			return [];
	}
}

/**
 * Find the additional copy shapes in one parsed file. `addedLines === null`
 * means a new/untracked file, for which every finding is new by construction.
 */
export function findAddedCopyViolations(sourceFile, addedLines) {
	const pragmas = pragmaLines(sourceFile);
	const findings = [];
	const isAdded = (line) => addedLines === null || addedLines.has(line);
	const exempt = (node) => {
		const element = enclosingElement(node);
		return (
			inSpan(lineSpan(sourceFile, node), pragmas) ||
			(element !== undefined && inSpan(lineSpan(sourceFile, element), pragmas))
		);
	};
	const take = (node, kind) => {
		for (const literal of staticTextNodes(node)) {
			const text = collapse(literal.text);
			/* Key tables defer t() until presentation so locale switches cannot leave
			 * stale copy behind. Only property sinks may hold those keys; a raw key in
			 * JSX or an attribute is still user-visible and must remain a finding. */
			if (kind.startsWith("property:") && CATALOGUE_KEY_RE.test(text)) continue;
			const line =
				sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile))
					.line + 1;
			if (LETTER_RE.test(text) && isAdded(line) && !exempt(literal)) {
				findings.push({ line, kind, text });
			}
		}
	};
	const visit = (node) => {
		if (node.kind === SyntaxKind.PropertyAssignment) {
			const name = propertyName(node.name);
			if (name !== undefined && COPY_PROPERTIES.has(name)) {
				take(node.initializer, `property:${name}`);
			}
		} else if (node.kind === SyntaxKind.JsxAttribute) {
			const name = node.name.text;
			const initializer = node.initializer;
			if (
				COPY_ATTRIBUTES.has(name) &&
				initializer?.kind === SyntaxKind.JsxExpression &&
				initializer.expression
			) {
				take(initializer.expression, `attribute:${name}`);
			}
		} else if (node.kind === SyntaxKind.JsxExpression) {
			// Attribute expressions are handled by their named copy sink above.
			// Every other JSX expression container is rendered child text.
			if (node.parent?.kind !== SyntaxKind.JsxAttribute && node.expression) {
				take(node.expression, "jsx-expression");
			}
		}
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return findings.sort(
		(a, b) => a.line - b.line || a.kind.localeCompare(b.kind),
	);
}

function isGuardedFile(rel) {
	/* Test fixtures and specs contain assertions about English, not rendered
	 * product copy. Keep them out of this added-line sink scan just as stories
	 * and fixtures are already outside the original scanner's corpus. */
	return (
		isScanned(rel) && !TEST_DIRECTORY_RE.test(rel) && !TEST_FILE_RE.test(rel)
	);
}

function changedFiles(repo, base) {
	const changed = git(repo, [
		"diff",
		"--name-only",
		"-z",
		"--diff-filter=ACMR",
		base,
		"--",
		...SCAN_ROOTS,
	])
		.split("\0")
		.filter(Boolean);
	const untracked = git(repo, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
		...SCAN_ROOTS,
	])
		.split("\0")
		.filter(Boolean);
	return {
		tracked: changed.filter((rel) => isGuardedFile(rel)),
		untracked: untracked.filter((rel) => isGuardedFile(rel)),
	};
}

export function runAddedCheck({ repo = REPO, base = "origin/main" } = {}) {
	const comparisonBase = resolveComparisonBase(repo, base);
	const { tracked, untracked } = changedFiles(repo, comparisonBase);
	const allowlist = loadAllowlist(join(repo, "i18n", "allowlist.json"));
	const additions = new Map();
	for (const rel of tracked) {
		if (allowlistReason(rel, allowlist)) continue;
		const diff = git(repo, [
			"diff",
			"--unified=0",
			"--no-color",
			comparisonBase,
			"--",
			rel,
		]);
		const { added } = parseAddedLines(diff);
		if (added.size > 0) additions.set(rel, added);
	}
	for (const rel of untracked) {
		if (!allowlistReason(rel, allowlist)) additions.set(rel, null);
	}
	const files = [...additions.keys()];
	if (files.length === 0) {
		return { base: comparisonBase, files, findings: [] };
	}

	const { api, snapshot } = openSnapshot(
		repo,
		files.map((rel) => join(repo, rel)),
	);
	try {
		const findings = [];
		for (const rel of files) {
			const abs = join(repo, rel);
			if (!existsSync(abs)) throw new Error(`Changed file disappeared: ${rel}`);
			const project = snapshot.getDefaultProjectForFile(abs);
			const sourceFile = project.program.getSourceFile(abs);
			if (!sourceFile) throw new Error(`TypeScript could not parse ${rel}`);
			for (const finding of findAddedCopyViolations(
				sourceFile,
				additions.get(rel),
			)) {
				findings.push({ path: rel, ...finding });
			}
		}
		return { base: comparisonBase, files, findings };
	} finally {
		api.close();
	}
}

export function main(argv = process.argv.slice(2)) {
	let base = "origin/main";
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--base" && argv[index + 1]) {
			base = argv[++index];
		} else {
			throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
		}
	}
	const result = runAddedCheck({ base });
	for (const finding of result.findings) {
		console.log(
			`${finding.path}:${finding.line}: ${finding.kind}: ${finding.text}`,
		);
	}
	if (result.findings.length > 0) {
		console.error(
			`FAIL: ${result.findings.length} newly added literal-copy finding(s). Use t() or a narrow reasoned i18n exemption; do not add a baseline.`,
		);
		return 1;
	}
	console.log(
		`PASS: no newly added literal copy in ${result.files.length} changed file(s) against ${result.base}.`,
	);
	return 0;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(`check-added-strings.mjs: ${error.message}`);
		process.exitCode = 2;
	}
}
