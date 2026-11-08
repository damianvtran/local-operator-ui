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
 *   - static text in JSX expression containers, including logical branches;
 *   - a TEMPLATE in a plain `const X = …`, `return …` or array-literal element
 *     under `src/renderer/` (the `template:` sinks). This is the one shape the
 *     ratchet (`check-strings.mjs`) deliberately leaves out: measured at this
 *     head, 234 such templates in 108 renderer files carry a letter and most of
 *     them are ids, URLs, units and CSS, so listing them would put machine text
 *     in the debt ledger. An ADDED line needs no allowance, so the diff guard
 *     takes the shape instead — new copy of it cannot land, and the historical
 *     occurrences stay a stated gap rather than a silent one.
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
	copyTexts,
	enclosingElement,
	inSpan,
	isScanned,
	lineSpan,
	loadAllowlist,
	onDataShapeSurface,
	openSnapshot,
	pragmaLines,
	staticTextNodes,
} from "./check-strings.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LETTER_RE = /\p{L}/u;
const CATALOGUE_KEY_RE = /^ui(?:\.[a-z0-9_]+)+$/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const TEST_DIRECTORY_RE = /(?:^|\/)(?:__tests__|tests?)\//;
const TEST_FILE_RE = /\.(?:test|spec)\.[^.]+$/;

/**
 * Property names whose string values are product copy, not arbitrary data.
 *
 * The four native attributes are spelled out rather than spread from
 * `COPY_ATTRIBUTES`: that set also holds component-prop names (`content`,
 * `summary`, `empty`, `header`...) which are prose as JSX props but are
 * ordinary data keys in object literals elsewhere, and widening this guard
 * with them would flag unrelated added lines. Widening object-literal
 * coverage is its own measured change.
 */
export const COPY_PROPERTIES = new Set([
	"aria-label",
	"placeholder",
	"title",
	"alt",
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

/**
 * The nearest in-file declaration whose initializer holds static copy, if any.
 *
 * Walks OUT from the usage, so a name reused under the same spelling in two
 * blocks reports against the binding actually in scope at the render site rather
 * than whichever declaration the file mentions first. A declaration that binds
 * the name but holds no literal (a computed value, a `t()` call) answers
 * `undefined` and stops the walk: it shadows any outer copy const of that name,
 * which is exactly what the render site sees.
 *
 * Only block-shaped scopes are searched (block, module, source file). A const
 * hoisted into a `switch` clause or declared in a function's expression body is
 * not resolved - both are copy shapes the scanner's own corpus does not produce,
 * and accepting them here would mean claiming coverage this walker does not have.
 */
function nearestCopyDeclaration(identifier) {
	let scope = identifier.parent;
	while (scope) {
		/*
		 * Only REAL lexical scopes are searched, and the walk stops at the first
		 * one that binds the name: a copy const reused under the same spelling in
		 * two blocks is reported against the binding actually in scope at the
		 * render site, not whichever declaration the file happened to mention
		 * first.
		 */
		if (
			scope.kind === SyntaxKind.Block ||
			scope.kind === SyntaxKind.SourceFile ||
			scope.kind === SyntaxKind.ModuleBlock
		) {
			for (const statement of scope.statements) {
				if (statement.kind !== SyntaxKind.VariableStatement) continue;
				for (const declaration of statement.declarationList.declarations) {
					if (declaration.name.kind !== SyntaxKind.Identifier) continue;
					if (declaration.name.text !== identifier.text) continue;
					const initializer = declaration.initializer;
					if (initializer === undefined) return undefined;
					return staticTextNodes(initializer).length > 0
						? initializer
						: undefined;
				}
			}
		}
		scope = scope.parent;
	}
	return undefined;
}

/**
 * Find the additional copy shapes in one parsed file. `addedLines === null`
 * means a new/untracked file, for which every finding is new by construction.
 */
export function findAddedCopyViolations(
	sourceFile,
	addedLines,
	{ templateSinks = false } = {},
) {
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
	/**
	 * A JSX sink whose expression is a bare identifier.
	 *
	 * THE BLIND SPOT THIS CLOSES: a sentence kept in a module `const` and
	 * rendered as `{SECRET_CLOSURE_NOTICE}` reached neither sink this walker
	 * knew. The JSX-expression sink is an Identifier and `staticTextNodes` only
	 * reads literals, so a whole user-facing sentence could ship in English in
	 * every locale while the catalogue guard still reported zero missing keys -
	 * the string never was a key, so nothing counted it as missing.
	 *
	 * Resolved by SHAPE rather than by name: any identifier whose nearest
	 * declaration in this file holds static copy is reported at the line that
	 * renders it, which is the line a reviewer reads in the diff. There is no
	 * name blacklist and no baseline here, because either would let the next
	 * differently-spelled const through.
	 *
	 * BOUNDS, stated rather than implied: same file only. A copy const imported
	 * from another module needs that exporting file's own diff line, and
	 * widening this walker to cross-file symbols is its own measured change
	 * rather than a silent expansion of this guard's scope.
	 */
	const takeReference = (expression, kind) => {
		if (expression.kind !== SyntaxKind.Identifier) {
			take(expression, kind);
			return;
		}
		const declaration = nearestCopyDeclaration(expression);
		if (declaration === undefined) return;
		const line =
			sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile))
				.line + 1;
		if (!isAdded(line) || exempt(expression)) return;
		for (const literal of staticTextNodes(declaration)) {
			const text = collapse(literal.text);
			if (LETTER_RE.test(text)) {
				findings.push({ line, kind: `${kind}:const`, text });
			}
		}
	};
	/**
	 * A template in a plain `const` / `return` / array position.
	 *
	 * The ONE shape `check-strings.mjs` leaves to this guard (see its KNOWN
	 * BOUNDARIES): the ratchet cannot tell prose from ids, URLs, units and CSS
	 * in that position, because there is no key vocabulary to appeal to, so 234
	 * such templates stay outside its allowance. Here they cost one pragma on a
	 * line the author just wrote, never a debt entry — and `copyTexts` is the
	 * shared renderer that already treats a template as ONE sentence.
	 *
	 * Bounds: a template whose text is a single token still counts (the letter
	 * test is the same one every other sink uses), so a machine-shaped template
	 * takes an `// i18n: ignore <reason>`, exactly as a token site does in the
	 * ratchet. Narrowing this by a prose heuristic would make the guard's
	 * verdict depend on how the sentence happens to start.
	 */
	const takeTemplate = (node, kind) => {
		if (
			node === undefined ||
			(node.kind !== SyntaxKind.TemplateExpression &&
				node.kind !== SyntaxKind.NoSubstitutionTemplateLiteral)
		)
			return;
		const line =
			sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
			1;
		if (!isAdded(line) || exempt(node)) return;
		for (const sentence of copyTexts(node)) {
			const text = collapse(sentence);
			if (LETTER_RE.test(text)) findings.push({ line, kind, text });
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
				takeReference(initializer.expression, `attribute:${name}`);
			}
		} else if (node.kind === SyntaxKind.JsxExpression) {
			// Attribute expressions are handled by their named copy sink above.
			// Every other JSX expression container is rendered child text.
			if (node.parent?.kind !== SyntaxKind.JsxAttribute && node.expression) {
				takeReference(node.expression, "jsx-expression");
			}
		} else if (templateSinks && node.kind === SyntaxKind.VariableDeclaration) {
			takeTemplate(node.initializer, "template:const");
		} else if (templateSinks && node.kind === SyntaxKind.ReturnStatement) {
			takeTemplate(node.expression, "template:return");
		} else if (
			templateSinks &&
			node.kind === SyntaxKind.ArrayLiteralExpression
		) {
			for (const element of node.elements)
				takeTemplate(element, "template:array");
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

/**
 * `afterListing` is a test seam fired between listing changed files and
 * reading them: it is the exact window in which a concurrent process can
 * delete a file, so tests can open that window deterministically.
 *
 * Why vanished UNTRACKED files are skipped but TRACKED ones still throw: many
 * sibling tests write a transient `_*.bundle.mjs` into scripts/i18n, import it
 * and unlink it, and under `node --test` concurrency the checker can list it
 * and then lose it (CI runs 41603855749 / 41595469149, exit 2 instead of 1).
 * A file that existed only as untracked scratch and is gone can never be
 * committed, so it holds no copy to guard. A tracked file that vanishes is a
 * real working-tree change the check cannot vouch for, so it stays fail-closed.
 */
export function runAddedCheck({
	repo = REPO,
	base = "origin/main",
	afterListing,
} = {}) {
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
	afterListing?.();
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
			const isUntracked = additions.get(rel) === null;
			if (!existsSync(abs)) {
				if (isUntracked) {
					// Named on stderr so a skip is never silent; stdout and the exit
					// code keep their meaning.
					console.error(
						`check-added-strings.mjs: skipped untracked file that vanished before it was read: ${rel}`,
					);
					continue;
				}
				throw new Error(`Changed file disappeared: ${rel}`);
			}
			const project = snapshot.getDefaultProjectForFile(abs);
			const sourceFile = project.program.getSourceFile(abs);
			// Vanished between existsSync and parse: same untracked-only rule.
			if (!sourceFile && isUntracked && !existsSync(abs)) continue;
			if (!sourceFile) throw new Error(`TypeScript could not parse ${rel}`);
			for (const finding of findAddedCopyViolations(
				sourceFile,
				additions.get(rel),
				/* The template sinks are the ratchet's stated boundary, so they
				 * follow the SAME surface the ratchet's data shapes do. */
				{ templateSinks: onDataShapeSurface(rel) },
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
